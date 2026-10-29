import { PROACTIVE_PACING_RULE, recentContactActivity } from './proactive-pacing.js?v=1.0.5';
import { COMMUNICATION_LANGUAGE_RULE } from './communication-language.js?v=1.0.5';
import { smsReplyClassification } from './sms-context.js?v=1.0.5';
import { storyTime } from './story-clock.js?v=1.0.5';
import { createNarrativePrompt } from './narrative-prompt.js?v=1.0.5';
import { JOURNAL_KEY, messageSignatures, revisionsFor, reconcileJournal, replayJournal, appendChange, isMemoryHidden } from './journal.js?v=1.0.5';
import { CHINESE_NAME_RULE, localizedPerson, sameNamedPerson } from './names.js?v=1.0.5';
import { narrativeReplyCount } from './contact-policy.js?v=1.0.5';
import { isBlocked } from './contact-events.js?v=1.0.5';
import { financialEvidenceMatches } from './assets-policy.js?v=1.0.5';
export const STORY_PHONE_KEY='durian_phone_story_events';
const norm=s=>String(s??'').normalize('NFKC').trim().toLowerCase();
const set=(collection,key,value)=>({collection,key,value});
const safe=value=>JSON.stringify(value).replace(/\{\{/g,'\\u007b\\u007b');
const evidenceText = value => String(value || '').normalize('NFKC')
    .replace(/&(?:quot|#34);/g,'"').replace(/&(?:apos|#39);/g,"'").replace(/&amp;/g,'&').replace(/&(?:nbsp|#160);/g,' ')
    .replace(/<[^>]*>/g,'').replace(/[\s*_`“”‘’"']/g,'');
export function storyAnnotations(message,tag){
    if(message?.is_user||(message?.is_system&&!isMemoryHidden(message)))return [];
    const text=String(message?.mes||'').replace(/```[\s\S]*?```/g,'').replace(/<(think|thinking|script|style)[^>]*>[\s\S]*?<\/\1>/gi,'');
    const prose=text.replace(/<!--[\s\S]*?-->/g,'');const result=[];
    for(const m of text.matchAll(new RegExp('<!--\\s*'+tag+'\\s*:\\s*([\\s\\S]*?)-->','g'))){
        try{const row=JSON.parse(m[1]);if(typeof row.evidence==='string'&&row.evidence.trim().length>=4&&(prose.includes(row.evidence.trim())||(tag==='durian-money'&&financialEvidenceMatches(prose,row.evidence))||(tag==='durian-contact'&&evidenceText(row.evidence).length>=4&&evidenceText(prose).includes(evidenceText(row.evidence)))))result.push({...row,prose});}catch{/* Incomplete narrative metadata never creates an event. */}
    }
    return result;
}
// Called only after a complete, stable narrative revision. Source-floor events
// are replayed alongside normal phone changes; no model call or prose rewrite.
export function importStoryPhone(raw,revisions,chat,context){
    let journal=raw,state=replayJournal(raw),changed=false;
    for(let index=0;index<chat.length;index++){
        const rows=storyAnnotations(chat[index],'durian-contact').slice(0,20);
        for(let n=0;n<rows.length;n++){
            const row=rows[n],eventId='story-phone:'+revisions[index]+':'+n;
            const saved=journal?.events.find(e=>e.id===eventId);
            if(saved){
                // Older imports omitted replyable. Repair only messages whose
                // still-valid source explicitly denied replies, including edits
                // that rollback may restore. Null erasure markers stay erased.
                if(row.kind==='sms'&&row.replyable===false&&saved.source.index===index&&saved.source.revision===revisions[index]){
                    const needsFlag=c=>c.collection==='messages'&&c.key===eventId&&c.value?.origin==='narrative'&&c.value.role==='assistant'&&c.value.replyable!==false;
                    if(journal.events.some(e=>e.changes.some(needsFlag))){
                        journal=structuredClone(journal);
                        for(const event of journal.events)for(const change of event.changes)if(needsFlag(change))change.value.replyable=false;
                        state=replayJournal(journal);changed=true;
                    }
                }
                continue;
            }
            const isUser=value=>value==='user'||(context.name1&&norm(value)===norm(context.name1));
            const outgoing=isUser(row.sender)&&typeof row.recipient==='string'&&!!row.recipient.trim()&&!isUser(row.recipient);
            const incoming=isUser(row.recipient)&&!isUser(row.sender);
            if((!incoming&&!outgoing)||!['sms','call'].includes(row.kind)||(typeof row.name!=='string'||!row.name.trim())||row.name.length>100||norm(row.name)===norm(context.name1))continue;
            // Explicit endpoints must agree with the counterpart. Legacy incoming
            // tags may omit sender; newly generated tags always include both.
            const endpoint=outgoing?row.recipient:row.sender;
            if(endpoint&& !sameNamedPerson({name:endpoint},row))continue;
            if(outgoing&&row.kind==='sms'&&(typeof row.text!=='string'||!evidenceText(row.prose).includes(evidenceText(row.text))))continue;
            const identity=localizedPerson(row,context,Object.values(state.contacts));
            const matches=(context.characters||[]).map((c,i)=>({c,i})).filter(({c})=>sameNamedPerson(c,identity));
            if(matches.length>1)continue;
            const matched=matches[0],known=Object.values(state.contacts).find(c=>sameNamedPerson(c,identity));
            const id=known?.id||(matched?.c.avatar?'card:'+matched.c.avatar:'name:'+norm(identity.name));
            const participant={id,name:identity.name,aliases:identity.aliases,characterId:matched?.i??null};
            if(isBlocked(state,id,row.kind==='sms'?'messages':'phone')){journal=appendChange(journal,revisions.slice(0,index+1),[set('profiles','ignored:'+eventId,{ignored:true})],eventId);state=replayJournal(journal);changed=true;continue;}
            const recordId=eventId,now=(Number(new Date(chat[index].send_date))||Date.now())+n,clock=storyTime(chat.slice(0,index+1));
            const number=typeof row.number==='string'&&row.prose.replace(/\D/g,'').includes(row.number.replace(/\D/g,''))&&/\d{5}/.test(row.number.replace(/\D/g,''))?row.number.trim():known?.number||null;
            const acquisition={route:outgoing?'sent_contact':'received_contact',reason:outgoing?'正文中实际发出通信':'正文中实际收到通信',evidence:row.evidence,sourceIndex:index};
            const changes=[];
            if(row.kind==='sms'){
                // The narrative can show the sender/notification without quoting
                // the complete message twice. The valid contact tag carries it.
                if(typeof row.text!=='string'||!row.text.trim()||row.text.length>6000)continue;
                changes.push(set('messages',recordId,{id:recordId,contactId:id,participant,name:participant.name,role:outgoing?'user':'assistant',text:row.text.trim(),proactive:incoming,replyable:row.replyable!==false,origin:'narrative',createdAt:now,storyTime:clock,read:outgoing||row.read===true,...(outgoing?{replyStatus:'sent'}:{}),acquisition}));
                changes.push(...smsReplyClassification(recordId,id,row.sms_category));
            }else{
                if(!['ringing','missed','declined','connected','ended'].includes(row.status))continue;
                const previous=row.call_id?state.calls[row.call_id]:null;
                if(row.call_id&&(!previous||previous.contactId!==id))continue;
                const callId=previous?.id||recordId;
                const turns=(Array.isArray(row.turns)?row.turns:[]).filter(t=>['user','assistant'].includes(t.role)&&typeof t.text==='string'&&t.text.trim()&&row.prose.includes(t.text.trim())).slice(0,30).map(t=>({role:t.role,text:t.text.trim().slice(0,6000),storyTime:clock}));
                changes.push(set('calls',callId,{...(previous||{}),id:callId,contactId:id,participant,name:participant.name,number,direction:previous?.direction||(outgoing?'outgoing':'incoming'),storyTime:previous?.storyTime||clock,status:row.status,turns:[...(previous?.turns||[]),...(['connected','ended'].includes(row.status)?turns:[])],createdAt:previous?.createdAt||now,read:row.status==='connected'||row.status==='ended'||row.status==='declined',origin:'narrative',revision:revisions[index],acquisition}));
            }
            // Actual user-involved communication permits a normal return call/reply.
            // Withheld caller ID is recorded but does not grant return access.
            if(!state.contacts[id]&&row.replyable!==false)changes.unshift(set('contacts',id,{...participant,number,sourceKind:outgoing?'sent':'received',sourceIndex:index,evidence:row.evidence}));
            journal=appendChange(journal,revisions.slice(0,index+1),changes,eventId);state=replayJournal(journal);changed=true;
        }
    }
    return {journal,changed};
}
export function buildStoryPhonePrompt(state,context,settings,chat){
    const channels={phone:!!settings.apps.phone,messages:!!settings.apps.messages};
    if(!channels.phone&&!channels.messages)return '';
    const due=(narrativeReplyCount(chat)+1)%3===0;
    const contacts=Object.values(state.contacts).map(c=>({id:c.id,name:c.name}));
    const blocked=Object.entries(state.profiles).filter(([id,p])=>id.startsWith('blocked:')&&(p.phone||p.messages)).map(([id,p])=>({id:id.slice(8),phone:!!p.phone,messages:!!p.messages}));
    const group=context.groups?.find(g=>String(g.id)===String(context.groupId));
    const actors=(context.characters||[]).filter((c,i)=>i===Number(context.characterId)||group?.members?.includes(c.avatar));
    const calls=Object.values(state.calls).filter(c=>['ringing','connected'].includes(c.status)).slice(-10).map(c=>({id:c.id,name:c.name,status:c.status}));
    return CHINESE_NAME_RULE+settings.prompts.storyContact+'\n来电偏好：'+(channels.phone?settings.prompts.incoming:'关闭')+'\n短信偏好：'+(channels.messages?settings.prompts.incomingMessages:'关闭')+'\n这是正文生成中的手机衔接，不是独立手机 API 任务。先按酒馆预设写正文，不要输出整篇 JSON。'+
        '\n主动联系开关：'+settings.proactiveEnabled+'；可用渠道：'+safe(channels)+'。'+(settings.proactiveEnabled?(due?'本次是可选的联系考虑时机；没有独立且适合此刻的理由就不安排任何新联系，不需要凑一条通知。':'本次不额外催生主动联系；若剧情本来自然发生通信或延续既有通话，正常描写并记录。'):'主动联系已关闭，不额外安排主动来电或短信。')+
        '\n'+PROACTIVE_PACING_RULE+'\n近期联络节奏（仅元数据，空列表不表示必须联系）：'+safe(recentContactActivity(state,chat))+
        '\n来电/短信的动机和取得 user 号码的途径由正文 AI 结合完整人设、关系、记忆及场景判断。不限情侣、异地、亲友；追求、听闻消息想打听、事务或普通分享也可以。已有正常联系或剧情中合理可获得号码即可，不强制逐字写过交换号码或预先成为手机联系人；也不能让完全没有途径的人凭空知道号码。不要求危机，不用恋人标签强制联系；同场、忙碌、失联等由剧情判断。来电接听、拒接、未接或继续通话由正文依当前扮演规则推进，手机只记已经写出的事实。'+
        '\n这是 user 个人的手机。只记录本轮正文中 user 实际发送或收到的短信、拨出或接到的电话。user 发出的短信也要逐条记录，不能只保存对方回复。完全忽略其他人物之间的通信：即使 user 目睹、听说或叙述视角切换到 char，也不能存进 user 手机。sender/recipient 必须如实填写实际双方，不能为了导入把第三方改成 user。不记录想象、回忆、未来打算、草稿或已在手机发生的旧消息。收到的短信可只在 text 放全文，但正文必须有确实到达 user 手机的事实；user 发出的短信必须在正文已经逐字写出并实际发送，不能借记录补写 user 发言。无通信不输出标签。号码数字未写出则省略，不能编造。关闭或拉黑渠道不可收到新联系。'+
        '\n当前身份及状态（数据）：'+safe({user:context.name1,characters:actors.map(c=>({name:c.name,id:'card:'+c.avatar})),contacts,blocked,calls})+
        '\n按本轮实际通信发生顺序，每条短信及通话状态在正文末尾附不可见 HTML 注释（不是代码块）：<!--durian-contact:{"sender":"实际发送者：user 或对方真实姓名","recipient":"实际接收者：user 或对方真实姓名","name":"与 user 通信的对方真实姓名","kind":"sms 或 call","evidence":"本次正文中确实发送或收到该通信且能识别双方的连续逐字原句","text":"仅 sms：实际发送或收到的完整短信原文，不得改写；收到时正文可只描写通知，发出时必须已在正文逐字写明","read":false,"status":"仅 call：ringing/missed/declined/connected/ended","call_id":"仅更新上述既有通话时填该 id；新来电省略","turns":[{"role":"user 或 assistant","text":"仅接通电话：正文中实际说出的逐字对白，可为空"}],"replyable":true}-->。短信附 sms_category（A=日常问候/闲聊/生活分享/即时状态，B=待办/约定/持续请求/情感纠纷；按语义和上下文，同一具体事项尽量同类，不按长短、问号或回复状态判断）。短信一条一注释，不抄回旧记录。隐藏号码不可回拨时 replyable:false。不要输出来源校验、手机规则等技术说明给读者。内容语言遵循酒馆预设。'+COMMUNICATION_LANGUAGE_RULE;
}
export function createStoryPhoneBridge({getContext,getSettings,onError=()=>{}}){
    const first=getContext(),bus=first?.eventSource,types=first?.event_types??first?.eventTypes??{},hooks=[];
    let generation=0,disposed=false;
    const output=createNarrativePrompt({getContext,key:STORY_PHONE_KEY});
    const clear=()=>{generation++;output.clear();};
    const listen=(name,fn)=>{if(types[name]&&bus?.on){bus.on(types[name],fn);hooks.push([types[name],fn]);}};
    async function prepare(type='normal',_options,dryRun){
        if(dryRun)return;clear();if(disposed||['quiet','impersonate'].includes(type))return;
        const c=getContext(),metadata=c.chatMetadata;if(!metadata||!c.chat?.length||!c.setExtensionPrompt)return;
        const chat=['swipe','regenerate'].includes(type)&&!c.chat.at(-1).is_user?c.chat.slice(0,-1):c.chat;
        const signatures=messageSignatures(chat),token=generation;
        const current=()=>!disposed&&token===generation&&getContext().chatMetadata===metadata&&JSON.stringify(messageSignatures(getContext().chat||[]).slice(0,signatures.length))===JSON.stringify(signatures);
        try{
            const revisions=await revisionsFor(signatures),legacy=chat.some(isMemoryHidden)?await revisionsFor(messageSignatures(chat,true)):null;
            const state=replayJournal(reconcileJournal(metadata[JOURNAL_KEY],revisions,legacy).journal);
            if(!current())return;const text=buildStoryPhonePrompt(state,c,getSettings(),chat);if(text)output.set(text,current);
        }catch(e){onError(e);}
    }
    if(first?.setExtensionPrompt&&bus?.on){
        if(types.GENERATION_AFTER_COMMANDS){listen('GENERATION_STARTED',(type,o,dry)=>{if(!dry)clear();});listen('GENERATION_AFTER_COMMANDS',prepare);}else listen('GENERATION_STARTED',prepare);
        for(const n of ['GENERATION_ENDED','GENERATION_STOPPED','CHAT_CHANGED','MESSAGE_EDITED','MESSAGE_DELETED','MESSAGE_SWIPED','GROUP_WRAPPER_FINISHED'])listen(n,clear);
    }
    return {prepare,destroy(){clear();disposed=true;output.destroy();for(const[n,fn]of hooks)bus.removeListener?.(n,fn);}};
}
