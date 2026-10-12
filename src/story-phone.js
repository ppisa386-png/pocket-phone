import { JOURNAL_KEY, messageSignatures, revisionsFor, reconcileJournal, replayJournal, appendChange, isMemoryHidden } from './journal.js?v=0.20.2';
import { CHINESE_NAME_RULE, localizedPerson, sameNamedPerson } from './names.js?v=0.20.2';
import { narrativeReplyCount } from './contact-policy.js?v=0.20.2';
import { isBlocked } from './contact-events.js?v=0.20.2';
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
        try{const row=JSON.parse(m[1]);if(typeof row.evidence==='string'&&row.evidence.trim().length>=4&&(prose.includes(row.evidence.trim())||(tag==='durian-contact'&&evidenceText(row.evidence).length>=4&&evidenceText(prose).includes(evidenceText(row.evidence)))))result.push({...row,prose});}catch{/* Incomplete narrative metadata never creates an event. */}
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
            if(journal?.events.some(e=>e.id===eventId))continue;
            if(row.recipient!=='user'||!['sms','call'].includes(row.kind)||(typeof row.name!=='string'||!row.name.trim())||row.name.length>100||norm(row.name)===norm(context.name1))continue;
            const identity=localizedPerson(row,context,Object.values(state.contacts));
            const matches=(context.characters||[]).map((c,i)=>({c,i})).filter(({c})=>sameNamedPerson(c,identity));
            if(matches.length>1)continue;
            const matched=matches[0],known=Object.values(state.contacts).find(c=>sameNamedPerson(c,identity));
            const id=known?.id||(matched?.c.avatar?'card:'+matched.c.avatar:'name:'+norm(identity.name));
            const participant={id,name:identity.name,aliases:identity.aliases,characterId:matched?.i??null};
            if(isBlocked(state,id,row.kind==='sms'?'messages':'phone')){journal=appendChange(journal,revisions.slice(0,index+1),[set('profiles','ignored:'+eventId,{ignored:true})],eventId);state=replayJournal(journal);changed=true;continue;}
            const recordId=eventId,now=Number(new Date(chat[index].send_date))||Date.now()+n;
            const number=typeof row.number==='string'&&row.prose.replace(/\D/g,'').includes(row.number.replace(/\D/g,''))&&/\d{5}/.test(row.number.replace(/\D/g,''))?row.number.trim():known?.number||null;
            const acquisition={route:'received_contact',reason:'正文中实际收到通信',evidence:row.evidence,sourceIndex:index};
            const changes=[];
            if(row.kind==='sms'){
                // The narrative can show the sender/notification without quoting
                // the complete message twice. The valid contact tag carries it.
                if(typeof row.text!=='string'||!row.text.trim()||row.text.length>6000)continue;
                changes.push(set('messages',recordId,{id:recordId,contactId:id,participant,name:participant.name,role:'assistant',text:row.text.trim(),proactive:true,origin:'narrative',createdAt:now,read:row.read===true,acquisition}));
            }else{
                if(!['ringing','missed','declined','connected','ended'].includes(row.status))continue;
                const previous=row.call_id?state.calls[row.call_id]:null;
                if(row.call_id&&(!previous||previous.contactId!==id))continue;
                const callId=previous?.id||recordId;
                const turns=(Array.isArray(row.turns)?row.turns:[]).filter(t=>['user','assistant'].includes(t.role)&&typeof t.text==='string'&&t.text.trim()&&row.prose.includes(t.text.trim())).slice(0,30).map(t=>({role:t.role,text:t.text.trim().slice(0,6000)}));
                changes.push(set('calls',callId,{...(previous||{}),id:callId,contactId:id,participant,name:participant.name,number,direction:'incoming',status:row.status,turns:[...(previous?.turns||[]),...(['connected','ended'].includes(row.status)?turns:[])],createdAt:previous?.createdAt||now,read:row.status==='connected'||row.status==='ended'||row.status==='declined',origin:'narrative',revision:revisions[index],acquisition}));
            }
            // A received, identifiable number permits a normal return call/reply.
            // Withheld caller ID is recorded but does not grant return access.
            if(!state.contacts[id]&&row.replyable!==false)changes.unshift(set('contacts',id,{...participant,number,sourceKind:'received',sourceIndex:index,evidence:row.evidence}));
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
        '\n主动联系开关：'+settings.proactiveEnabled+'；可用渠道：'+safe(channels)+'。'+(settings.proactiveEnabled?(due?'本次到达每三条角色正文一次的考虑时机，请结合人物动机判断是否安排合理的来电/短信；可以没有，不是必须发生。':'本次不额外催生主动联系；若剧情本来自然发生通信或延续既有通话，正常描写并记录。'):'主动联系已关闭，不额外安排主动来电或短信。')+
        '\n来电/短信的动机和取得 user 号码的途径由正文 AI 结合完整人设、关系、记忆及场景判断。不限情侣、异地、亲友；追求、听闻消息想打听、事务或普通分享也可以。已有正常联系或剧情中合理可获得号码即可，不强制逐字写过交换号码或预先成为手机联系人；也不能让完全没有途径的人凭空知道号码。不要求危机，不用恋人标签强制联系；同场、忙碌、失联等由剧情判断。来电接听、拒接、未接或继续通话由正文依当前扮演规则推进，手机只记已经写出的事实。'+
        '\n仅记录实际到达 user 的通信，不记录 NPC 相互通信、想象、回忆、未来打算、草稿或已在手机发生的旧消息。正文必须出现收到短信/查看手机的事实或来电事实，短信全文可只放在同步标记的 text 中；无通信不输出标签。号码数字未写出则省略，不能编造。关闭或拉黑渠道不可收到新联系。'+
        '\n当前身份及状态（数据）：'+safe({user:context.name1,characters:actors.map(c=>({name:c.name,id:'card:'+c.avatar})),contacts,blocked,calls})+
        '\n每个实际发生的来电/短信，在正文末尾附不可见 HTML 注释（不是代码块）：<!--durian-contact:{"recipient":"user","name":"对方真实姓名","kind":"sms 或 call","evidence":"本次正文中确实收到该通信的连续逐字原句","text":"仅 sms：实际收到的完整短信内容，正文可只描写通知或发件人，不必重复全文","read":false,"status":"仅 call：ringing/missed/declined/connected/ended","call_id":"仅更新上述既有通话时填该 id；新来电省略","turns":[{"role":"user 或 assistant","text":"仅接通电话：正文中实际说出的逐字对白，可为空"}],"replyable":true}-->。短信一条一注释，不抄回旧记录。隐藏号码不可回拨时 replyable:false。不要输出来源校验、手机规则等技术说明给读者。内容语言遵循酒馆预设。';
}
export function createStoryPhoneBridge({getContext,getSettings,onError=()=>{}}){
    const first=getContext(),bus=first?.eventSource,types=first?.event_types??first?.eventTypes??{},hooks=[];
    let generation=0,disposed=false;
    const clear=()=>{generation++;getContext()?.setExtensionPrompt?.(STORY_PHONE_KEY,'',1,0,false,0);};
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
            if(!current())return;const text=buildStoryPhonePrompt(state,c,getSettings(),chat);if(text)c.setExtensionPrompt(STORY_PHONE_KEY,text,1,0,false,0,current);
        }catch(e){onError(e);}
    }
    if(first?.setExtensionPrompt&&bus?.on){
        if(types.GENERATION_AFTER_COMMANDS){listen('GENERATION_STARTED',(type,o,dry)=>{if(!dry)clear();});listen('GENERATION_AFTER_COMMANDS',prepare);}else listen('GENERATION_STARTED',prepare);
        for(const n of ['GENERATION_ENDED','GENERATION_STOPPED','CHAT_CHANGED','MESSAGE_EDITED','MESSAGE_DELETED','MESSAGE_SWIPED','GROUP_WRAPPER_FINISHED'])listen(n,clear);
    }
    return {prepare,destroy(){clear();disposed=true;for(const[n,fn]of hooks)bus.removeListener?.(n,fn);}};
}
