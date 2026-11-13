import {xStoryPrompt,xStoryChanges} from './x-story.js?v=1.2.55';
import { narratedXSentDms } from './x-narrative-dm.js?v=1.2.46';
import {businessPrompt,importBusiness} from './x-business.js?v=1.2.55';
import {availableChannels,outreachPrompt,socialContact} from './outreach.js?v=1.2.55';
import {wechatMomentsStoryPrompt} from './wechat-moments.js?v=1.2.49';
import {normalizeSettings,MODULE_KEY,PROMPTS} from './config.js?v=1.2.55';
import { recentContactActivity,recentPerConversation } from './proactive-pacing.js?v=1.2';
import { COMMUNICATION_LANGUAGE_RULE } from './communication-language.js?v=1.2';
import { smsReplyClassification } from './sms-context.js?v=1.2.50';
import { COMM_PLATFORMS, commKey, commRecordExists, commRecordPatch, commShownChange } from './comm-context.js?v=1.2.50';
import { storyTime, exactStoryTime } from './story-clock.js?v=1.2';
import { createNarrativePrompt } from './narrative-prompt.js?v=1.2';
import { JOURNAL_KEY, messageSignatures, revisionsFor, reconcileJournal, replayJournal, appendChange, isMemoryHidden } from './journal.js?v=1.2';
import { CHINESE_NAME_RULE, localizedPerson, sameNamedPerson } from './names.js?v=1.2';
import { effectiveReply, narrativeReplyCount } from './contact-policy.js?v=1.2';
import { isBlocked } from './contact-events.js?v=1.2';
import { financialEvidenceMatches } from './assets-policy.js?v=1.2';
import { sceneBackground } from './weather.js?v=1.2';
export const STORY_PHONE_KEY='durian_phone_story_events';
const norm=s=>String(s??'').normalize('NFKC').trim().toLowerCase();
const set=(collection,key,value)=>({collection,key,value});
const safe=value=>JSON.stringify(value).replace(/\{\{/g,'\\u007b\\u007b');
const evidenceText = value => String(value || '').normalize('NFKC')
    .replace(/&(?:quot|#34);/g,'"').replace(/&(?:apos|#39);/g,"'").replace(/&amp;/g,'&').replace(/&(?:nbsp|#160);/g,' ')
    .replace(/<[^>]*>/g,'').replace(/[\s*_`“”‘’"']/g,'');
export function storyAnnotations(message,tag){
    if(message?.is_user||(message?.is_system&&!isMemoryHidden(message)))return [];
    const text=String(message?.mes||'').replace(/```[\s\S]*?```/g,'').replace(/<(think|thinking|analysis|script|style)[^>]*>[\s\S]*?<\/\1>/gi,'');
    const prose=text.replace(/<!--[\s\S]*?-->/g,'');const result=[];
    let exactIndex=0,tagIndex=0;
    for(const m of text.matchAll(new RegExp('<!--\\s*'+tag+'\\s*:\\s*([\\s\\S]*?)-->','g'))){
        const position=tagIndex++;
        try{
            const row=JSON.parse(m[1]),quote=row?.evidence;
            // Evidence is optional: archival markers always carry it, so old floors
            // gate exactly as before and their per-floor ordinals never shift. New
            // markers may omit it and are trusted directly.
            if(quote!==undefined&&typeof quote!=='string')continue;
            const hasQuote=typeof quote==='string'&&quote.trim().length>=4;
            const exact=hasQuote&&prose.includes(quote.trim());
            if(tag==='durian-outreach'){
                // Old journal IDs counted exact matches only. Keep that sequence
                // intact when recovering a formerly skipped tag before a saved one.
                if(!hasQuote||exact||financialEvidenceMatches(prose,quote))
                    result.push({...row,prose,outreachKey:exact?String(exactIndex++):'excerpt:'+position});
            }else if(!hasQuote||exact||(['durian-money','durian-message'].includes(tag)&&financialEvidenceMatches(prose,quote))||
                (tag==='durian-contact'&&hasQuote&&evidenceText(prose).includes(evidenceText(quote)))){
                result.push({...row,prose});
            }
        }catch{/* Incomplete narrative metadata never creates an event. */}
    }
    return result;
}
// Narrative presentation markers for records that already exist on the phone.
// The prose summarized or mentioned an existing conversation entry; the marker
// only flips its shown flag. Hallucinated or cross-platform ids are ignored.
function shownAnnotations(message){
    if(message?.is_user||(message?.is_system&&!isMemoryHidden(message)))return [];
    const text=String(message?.mes||'').replace(/```[\s\S]*?```/g,'').replace(/<(think|thinking|analysis|script|style)[^>]*>[\s\S]*?<\/\1>/gi,'');
    const rows=[];
    for(const m of text.matchAll(/<!--\s*durian-message-shown\s*:\s*([\s\S]*?)-->/g)){
        try{
            const row=JSON.parse(m[1]);
            const platform=COMM_PLATFORMS.includes(row?.platform)?row.platform:null;
            const id=typeof row?.id==='string'&&row.id.trim()&&row.id.trim().length<=200?row.id.trim():null;
            if(platform&&id)rows.push({platform,id});
        }catch{/* Incomplete narrative metadata never creates an event. */}
    }
    return rows;
}
// Called only after a complete, stable narrative revision. Source-floor events
// are replayed alongside normal phone changes; no model call or prose rewrite.
export function importStoryPhone(raw,revisions,chat,context){
    let journal=raw,state=replayJournal(raw),changed=false;
    const settings=normalizeSettings(context.extensionSettings?.[MODULE_KEY]);
    let turn=0;
    for(let index=0;index<chat.length;index++){
        if(effectiveReply(chat[index]))turn++;
        const rows=storyAnnotations(chat[index],'durian-contact');
        for(const [n,row] of storyAnnotations(chat[index],'durian-outreach').entries()){
            const id='outreach:'+revisions[index]+':'+row.outreachKey;
            if(journal?.events.some(e=>e.id===id))continue;
            const allowed=effectiveReply(chat[index])&&turn%5===0&&settings.proactiveEnabled&&availableChannels(settings,state,context.name1).includes(row.channel)
                &&row.recipient==='user'&&typeof row.sender==='string'&&row.sender.trim()&&row.sender!==context.name1;
            let changes=[];
            if(allowed&&['sms','call'].includes(row.channel)){
                rows.push({...row,kind:row.channel,name:row.sender,status:'ringing',outreachId:id,shown:row.channel==='call'?true:row.shown});
                continue;
            }
            if(allowed&&typeof row.text==='string'&&row.text.trim())changes=socialContact(state,row,id,storyTime(chat.slice(0,index+1)),(Date.parse(chat[index].send_date)||Date.now())+n,context.name1);
            if(!changes.length)changes=[set('profiles','ignored:'+id,{ignored:true})];
            else{
                // Outreach creates real phone content. Arrival alone is not
                // presentation: mark unseen unless the prose actually read it.
                const message=changes.map(change=>change.value).find(value=>value?.type==='message');
                if(message)changes.push(...commRecordPatch(row.channel.startsWith('x_')?'x':row.channel,message.id,message.accountId,row.category,row.shown===true));
                else if(row.channel==='x_mention'){
                    const post=changes.map(change=>change.value).find(value=>value?.type==='post');
                    if(post)changes.push(...commRecordPatch('x',post.id,post.author,row.category,row.shown===true));
                }
            }
            journal=appendChange(journal,revisions.slice(0,index+1),changes,id);state=replayJournal(journal);changed=true;
        }
        const xRows=storyAnnotations(chat[index],'durian-x');
        const xEvent='narrative-x:'+revisions[index];
        const existingX=journal?.events.find(e=>e.id===xEvent);
        // v1.2.24 and earlier could reject a valid evidence-free published marker
        // but still journal an "ignored" tombstone. Revisit that floor on read,
        // without changing any successful imports, historical evidence-bearing
        // annotations, or deliberately disabled X operations.
        const recoverable=existingX?.changes.length===1 &&
            existingX.changes[0].collection==='profiles' &&
            existingX.changes[0].key==='ignored:'+xEvent &&
            existingX.changes[0].value?.ignored===true &&
            xRows.some(row=>row.action==='published'&&row.evidence===undefined);
        if(xRows.length&&effectiveReply(chat[index])&&(!existingX||recoverable)){
            const changes=settings.apps.x?xStoryChanges(state,xRows,chat,index,xEvent,context):[];
            if(existingX){
                if(changes.length){
                    journal=structuredClone(journal);
                    journal.events.find(e=>e.id===xEvent).changes=changes;
                    state=replayJournal(journal);changed=true;
                }
            }else{
                journal=appendChange(journal,revisions.slice(0,index+1),changes.length?changes:[set('profiles','ignored:'+xEvent,{ignored:true})],xEvent);
                state=replayJournal(journal);changed=true;
            }
        }
        const seenNormal=new Set();
        for(const [n,row] of storyAnnotations(chat[index],'durian-message').entries()){
            const id='narrative-message:'+revisions[index]+':'+n;
            if(journal?.events.some(e=>e.id===id))continue;
            const user=v=>typeof v==='string'&&v.trim()&&(norm(v)==='user'||norm(v)===norm(context.name1));
            const out=user(row.sender),other=out?row.recipient:row.sender;
            if(!['whatsapp','x'].includes(row.platform)||!effectiveReply(chat[index])||!!out===!!user(row.recipient)||typeof other!=='string'||!other.trim()||
                row.action!==(out?'sent':'received')||!['text','image','video','voice'].includes(row.kind)||
                (row.platform==='x'&&row.kind!=='text')||typeof row.text!=='string'||!row.text.trim())continue;
            // The prose may quote the message verbatim or faithfully summarize
            // it; the marker's text carries the complete content either way.
            // User boundaries stay: archival markers (with evidence) keep the
            // strict quote check and the recall/draft rejection, and no marker
            // may invent a message the narrative never described at all.
            if(typeof row.evidence==='string'){
                const actionText=row.evidence.replace(row.text,'');
                if(/回忆起|回想起|想起.{0,12}(?:昨天|先前|以前)|重读|引用旧|存为草稿|没有发送|还没发|准备发送|打算发送|想象着|\b(?:draft|unsent|recalled|reread|remembered|about to send)\b/i.test(actionText))continue;
                const body=evidenceText(row.text);
                if(!body||!evidenceText(row.prose).includes(body))continue;
            }
            const key=JSON.stringify([!!out,norm(other),row.text,row.evidence||'']);
            const duplicate=seenNormal.has(row.platform+':'+key)||(!out&&Object.values(state[row.platform]||{}).some(m=>m.type==='message'&&m.id?.startsWith('outreach:'+revisions[index]+':')&&m.text===row.text&&sameNamedPerson(state[row.platform][m.accountId],{name:other})));
            seenNormal.add(row.platform+':'+key);
            let changes=[];
            if(settings.apps[row.platform]&&!duplicate){
                const payload={...row,channel:row.platform==='x'?'x_dm':'whatsapp',sender:other.trim(),media:row.kind};
                changes=socialContact(state,payload,id,storyTime(chat.slice(0,index+1)),(Date.parse(chat[index].send_date)||Date.now())+n,context.name1,out?'user':'assistant');
                if(changes.length){
                    const message=changes.at(-1).value;
                    message.kind=row.kind;
                    message.origin='narrative';
                    // A message actually sent or received in this prose was
                    // already displayed. Never reintroduce it as unseen history.
                    if(row.platform==='x'){
                        const account=changes[0].value;
                        // Sending a DM establishes an outgoing conversation; a
                        // later narrative reply should not be blocked as a new
                        // stranger request. Do not reveal an anonymous identity.
                        if(out)account.dmAccepted=true;
                        if(!state.x?.[account.id]&&state.x?.profile?.alias!==context.name1)
                            account.identityKnown=false;
                    }
                    changes.push(...commRecordPatch(row.platform,id,message.accountId,row.category,out?true:row.shown===false?false:true));
                }
            }
            journal=appendChange(journal,revisions.slice(0,index+1),changes.length?changes:[set('profiles','ignored:'+id,{ignored:true})],id);
            state=replayJournal(journal);changed=true;
        }
        // Recover an unannotated but unambiguously sent X DM from this very
        // assistant floor. A matching native durian-message import takes priority.
        // No inferred recipient, no unquoted body, no new model request.
        if(settings.apps.x&&effectiveReply(chat[index])){
            for(const [n,row] of narratedXSentDms(chat[index],state).entries()){
                const id='narrative-x-sent:'+revisions[index]+':'+n;
                if(journal?.events.some(e=>e.id===id))continue;
                const duplicate=Object.values(state.x||{}).some(m=>m.type==='message'&&m.role==='user'&&
                    m.accountId===row.accountId&&m.text===row.text&&
                    (m.id?.startsWith('narrative-message:'+revisions[index]+':')||
                     m.id?.startsWith('narrative-x-sent:'+revisions[index]+':')));
                if(duplicate)continue;
                const changes=socialContact(state,{channel:'x_dm',sender:row.name,accountId:row.accountId,
                    media:'text',text:row.text},id,storyTime(chat.slice(0,index+1)),
                    (Date.parse(chat[index].send_date)||Date.now())+n,context.name1,'user');
                if(changes.length!==2)continue;
                changes[0].value.dmAccepted=true;
                changes[1].value.origin='narrative';
                changes.push(...commRecordPatch('x',id,row.accountId,null,true,state));
                journal=appendChange(journal,revisions.slice(0,index+1),changes,id);
                state=replayJournal(journal);changed=true;
            }
        }
        for(let n=0;n<rows.length;n++){
            const row=rows[n],eventId=row.outreachId||'story-phone:'+revisions[index]+':'+n;
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
            // The complete text comes from the marker; the prose may present it
            // verbatim or as a faithful summary. Archival markers keep the
            // strict quote check; new markers stay bound to real narrative sends.
            if(outgoing&&row.kind==='sms'){
                if(typeof row.text!=='string'||!row.text.trim())continue;
                if(typeof row.evidence==='string'){
                    const body=evidenceText(row.text);
                    if(!body||!evidenceText(row.prose).includes(body))continue;
                }
            }
            const identity=localizedPerson(row,context,Object.values(state.contacts));
            const matches=(context.characters||[]).map((c,i)=>({c,i})).filter(({c})=>sameNamedPerson(c,identity));
            if(matches.length>1)continue;
            const matched=matches[0],known=Object.values(state.contacts).find(c=>sameNamedPerson(c,identity));
            const id=known?.id||(matched?.c.avatar?'card:'+matched.c.avatar:'name:'+norm(identity.name));
            const participant={id,name:identity.name,aliases:identity.aliases,characterId:matched?.i??null};
            if(settings.apps[row.kind==='sms'?'messages':'phone']===false||isBlocked(state,id,row.kind==='sms'?'messages':'phone')){journal=appendChange(journal,revisions.slice(0,index+1),[set('profiles','ignored:'+eventId,{ignored:true})],eventId);state=replayJournal(journal);changed=true;continue;}
            const recordId=eventId,now=(Number(new Date(chat[index].send_date))||Date.now())+n,clock=storyTime(chat.slice(0,index+1));
            const number=typeof row.number==='string'&&row.prose.replace(/\D/g,'').includes(row.number.replace(/\D/g,''))&&/\d{5}/.test(row.number.replace(/\D/g,''))?row.number.trim():known?.number||null;
            const acquisition={route:outgoing?'sent_contact':'received_contact',reason:outgoing?'正文中实际发出通信':'正文中实际收到通信',evidence:row.evidence,sourceIndex:index};
            const changes=[];
            if(row.kind==='sms'){
                // The narrative can show the sender/notification without quoting
                // the complete message twice. The valid contact tag carries it.
                if(typeof row.text!=='string'||!row.text.trim()||row.text.length>6000)continue;
                changes.push(set('messages',recordId,{id:recordId,contactId:id,participant,name:participant.name,role:outgoing?'user':'assistant',text:row.text.trim(),proactive:incoming,replyable:row.replyable!==false,origin:'narrative',createdAt:now,storyTime:clock,read:outgoing||row.read===true,...(outgoing?{replyStatus:'sent'}:{}),acquisition}));
                changes.push(...commRecordPatch('sms',recordId,id,row.category||row.sms_category,outgoing?true:row.outreachId?row.shown===true:row.shown));
            }else{
                if(!['ringing','missed','declined','connected','ended'].includes(row.status))continue;
                const previous=row.call_id?state.calls[row.call_id]:null;
                if(row.call_id&&(!previous||previous.contactId!==id))continue;
                const callId=previous?.id||recordId;
                const turns=(Array.isArray(row.turns)?row.turns:[]).filter(t=>['user','assistant'].includes(t.role)&&typeof t.text==='string'&&t.text.trim()&&row.prose.includes(t.text.trim())).slice(0,30).map(t=>({role:t.role,text:t.text.trim().slice(0,6000),storyTime:clock}));
                changes.push(set('calls',callId,{...(previous||{}),id:callId,contactId:id,participant,name:participant.name,number,direction:previous?.direction||(outgoing?'outgoing':'incoming'),storyTime:previous?.storyTime||clock,status:row.status,turns:[...(previous?.turns||[]),...(['connected','ended'].includes(row.status)?turns:[])],createdAt:previous?.createdAt||now,read:row.status==='connected'||row.status==='ended'||row.status==='declined',origin:'narrative',revision:revisions[index],acquisition}));
                changes.push(...commRecordPatch('call',callId,id,row.category,row.shown));
            }
            // Actual user-involved communication permits a normal return call/reply.
            // Withheld caller ID is recorded but does not grant return access.
            if(!state.contacts[id]&&row.replyable!==false)changes.unshift(set('contacts',id,{...participant,number,sourceKind:outgoing?'sent':'received',sourceIndex:index,evidence:row.evidence}));
            journal=appendChange(journal,revisions.slice(0,index+1),changes,eventId);state=replayJournal(journal);changed=true;
        }
        // Presentation markers for records the prose just summarized or mentioned.
        // Bound to this floor's revision: edits and rollbacks restore the flag.
        for(const [n,shown] of shownAnnotations(chat[index]).entries()){
            const eventId='story-shown:'+revisions[index]+':'+n;
            if(journal?.events.some(e=>e.id===eventId))continue;
            if(!commRecordExists(state,shown.platform,shown.id)){
                journal=appendChange(journal,revisions.slice(0,index+1),[set('profiles','ignored:'+eventId,{ignored:true})],eventId);state=replayJournal(journal);changed=true;continue;
            }
            const change=commShownChange(state,shown.platform,shown.id);
            if(!change)continue; // Already shown; a repeated marker stays silent.
            journal=appendChange(journal,revisions.slice(0,index+1),[change],eventId);state=replayJournal(journal);changed=true;
        }
    }
    const business=importBusiness(journal,revisions,chat,settings,storyAnnotations);
    return {journal:business.journal,changed:changed||business.changed};
}
export function buildStoryPhonePrompt(state,context,settings,chat){
    const channels={phone:!!settings.apps.phone,messages:!!settings.apps.messages};
    const hasChannels=availableChannels(settings,state,context.name1).length>0;
    const business=businessPrompt(state,settings,chat,context.name1,context.chatMetadata?.[JOURNAL_KEY]?.businessDraws);
    const x=settings.apps.x?xStoryPrompt(state,exactStoryTime(chat)):'';
    const moments=settings.apps.wechat?wechatMomentsStoryPrompt(state,context,chat):'';
    // Shared scene background: location tag rules and current weather go to the
    // narrative model with every normal generation, independent of phone channels.
    const scene=sceneBackground(state,chat,settings);
    // When the shared notification block is present, X reuses its read/shown
    // and notification rules. X-only setups still receive the full rules.
    const xDm=settings.apps.x?'\n【X 私信文尾同步是必需步骤】只要本楼明确描写 user 在 X 私信对话框输入回复、点击发送并显示已发出/已送达，即使场景随后切换到其他事件，也必须在正文末尾逐条输出 durian-message 标记；正文的【消息原文】不是标记，不能代替它。'+(hasChannels?'':'X 私信与其他通信使用同一已展示/未展示记录机制；其手机 read 状态独立表示 user 是否已在 X 私信页打开阅读，不得把 shown:false 直接称作未读。')+'X 私信正文仍遵守既有规则，不进入通用正文通信历史。只有本楼小说正文实际写出 user 在 X/Twitter 私信中发送或收到的一条新消息，且不是手机里已经保存的历史记录时，才在文尾逐条附 <!--durian-message:{"platform":"x","action":"sent或received（相对user）","sender":"user或对方账号名称","recipient":"对方账号名称或user","accountId":"已知X账号准确ID，未知省略","kind":"text","text":"实际已经发送或收到的完整私信内容","category":"A或B，实际约定、合作或待办填B","shown":false}-->。'+(hasChannels?'':'只有本楼明确写出user实际阅读消息时，正文才可呈现收到的私信内容；只出现通知时正文不透露内容，标记仍保存全文。')+'user实际发送的内容按已发送处理；不得将准备发、草稿、回忆、查询既有私信或对方未实际发送的回复标为新消息，不替user发消息；已经存于X里的消息只在本楼确实引用/展示时用durian-message-shown 标记对应记录ID，不要再次创建。商业邀约已经用durian-business offer、主动联系已经用durian-outreach记录时，不再为同一条私信加durian-message。除真实发信和收信外无消息则不标记。' : '';
    if(!hasChannels)return x+xDm+moments+business+(scene?'\n'+scene:'');
    const due=(narrativeReplyCount(chat)+1)%5===0;
    const contacts=Object.values(state.contacts).map(c=>({id:c.id,name:c.name}));
    const blocked=Object.entries(state.profiles).filter(([id,p])=>id.startsWith('blocked:')&&(p.phone||p.messages)).map(([id,p])=>({id:id.slice(8),phone:!!p.phone,messages:!!p.messages}));
    const group=context.groups?.find(g=>String(g.id)===String(context.groupId));
    const actors=(context.characters||[]).filter((c,i)=>i===Number(context.characterId)||group?.members?.includes(c.avatar));
    const calls=recentPerConversation(Object.values(state.calls).filter(c=>['ringing','connected'].includes(c.status)).sort((a,b)=>a.createdAt-b.createdAt),c=>c.contactId).slice(-10).map(c=>({id:c.id,name:c.name,status:c.status}));
    const whatsapp=settings.apps.whatsapp?'\nWhatsApp普通正文通信只记录实际发生的新发送或接收，不必制造剧情或回应。无论第几楼、是否开启主动联系，按本楼发生顺序逐条附 <!--durian-message:{"platform":"whatsapp","action":"sent或received（相对user）","sender":"user或对方姓名","recipient":"对方姓名或user","accountId":"已知账号ID，未知省略","kind":"text/image/video/voice","text":"完整已发送内容或实际媒体描述","category":"可选A或B：日常闲聊为A，约定/待办/持续请求/情感纠纷或仍在发展的具体事件为B","shown":false}-->。user实际发出的消息可在正文呈现或忠实概述；收到消息的阅读、通知与全文保存遵循下方共用规则。user发出的内容必须是user实际发出的消息，不能借标记补写user没发过的消息。回忆、引用、输入中、打算发送、手机里已有的消息都不重记。主动邀约已用durian-outreach标记的同一条消息不再标记。记录不触发自动回复。':'';
    // Built-in notification guidance is already included in full below.
    const outreachInstruction=settings.prompts.outreach===PROMPTS.outreach.text
        ?'根据近期剧情与人物性格选择合适渠道，允许零人或多人。不为通知创造动机。不替 user 回复。':settings.prompts.outreach;
    return x+xDm+moments+whatsapp+(business?business+'\n':'')+CHINESE_NAME_RULE+outreachInstruction+'\n'+'\n只有本楼确有新消息到达，或这是相应未读消息首次获得正文通知机会时，才可以自然写一次铃声、震动、亮屏等通知；可以完全不提。旧消息即使手机仍显示未读、正文仍未展示，也不能在后续楼层反复写提示音、亮屏、未读数或「还有消息没看」等提醒。每条独立新到达的消息才可重新触发一次通知。下方近期通信活动是历史往来元数据，不是最新未读列表，不能单凭它写新提醒。通知不得仅凭消息抵达就写出完整消息、摘要、主题、隐含意思或user的理解与反应。只有剧情实际描写user打开手机并看到/听到内容，才可在正文呈现内容；不要为了交代通知擅自替user查看手机或打断原本情节。新消息的全文及必要译文完整写入本楼末尾的隐藏标记；仅有通知时标记shown:false，实际展示正文内容时才shown:true。看到通知或发送者名字不等于已阅读内容；来电铃响不等于已接听。短信、WhatsApp、微信和 X 私信的 read 是手机阅读状态，shown 是小说正文展示状态，两者独立。read=true 表示 user 已在小手机对应私信页打开并阅读，即使 shown=false 也不得称为未读、刚收到，或要求 user 再次打开阅读；read=false 才表示手机尚未阅读，但也不自动代表消息刚刚到达。此规则同样适用于本轮主动联系和普通新消息。'+outreachPrompt(settings,state,context.name1,due,exactStoryTime(chat))+'\n近期电话短信活动：'+safe(recentContactActivity(state,chat))+
        '\n这是 user 个人的手机。短信与电话标签只记录本轮正文中 user 实际发送或收到的短信、拨出或接到的电话。user 发出的短信也要逐条记录，不能只保存对方回复。完全忽略其他人物之间的通信：即使 user 目睹、听说或叙述视角切换到 char，也不能存进 user 手机。sender/recipient 必须如实填写实际双方，不能为了导入把第三方改成 user。不记录想象、回忆、未来打算、草稿或已在手机发生的旧消息。user 发出的短信必须实际发送且正文已写出（完整原文或忠实概述），标记的 text 保存该消息完整内容，不能借标记补写 user 没发过的消息。无通信不输出标签。号码数字未写出则省略，不能编造。关闭或拉黑渠道不可收到新联系。'+
        '\n当前身份及状态（数据）：'+safe({user:context.name1,characters:actors.map(c=>({name:c.name,id:'card:'+c.avatar})),contacts,blocked,calls})+
        '\n按本轮实际通信发生顺序，每条短信及通话状态在正文末尾附不可见 HTML 注释（不是代码块）：<!--durian-contact:{"sender":"实际发送者：user 或对方真实姓名","recipient":"实际接收者：user 或对方真实姓名","name":"与 user 通信的对方真实姓名","kind":"sms 或 call","text":"仅 sms：实际发送或收到的完整短信原文；通知未读时只放在此标记里","read":false,"shown":false,"status":"仅 call：ringing/missed/declined/connected/ended","call_id":"仅更新上述既有通话时填该 id；新来电省略","turns":[{"role":"user 或 assistant","text":"仅接通电话：正文中实际说出的逐字对白，可为空"}],"replyable":true}-->。短信与通话可附 category（旧写法 sms_category 仍可用）：A=日常问候/闲聊/生活分享/即时状态，B=约定/待办/持续请求/情感纠纷或仍在发展的具体事件；按语义和上下文，同一具体事项尽量同类，不按长短、问号或回复状态判断。短信仅有声音、震动、亮屏等通知时shown:false；正文实际阅读到内容才shown:true。接通通话后的真实对白才可写入turns；仅响铃记录ringing。短信一条一注释，不抄回旧记录。隐藏号码不可回拨时 replyable:false。不要输出来源校验、手机规则等技术说明给读者。内容语言遵循酒馆预设。'+
        '\n正文实际阅读、展示或谈及手机里已有的某条通信的具体内容（短信、电话、WhatsApp、微信、Snapchat、X 私信/评论/公开互动）后，在本楼末尾附 <!--durian-message-shown:{"platform":"渠道代码 sms/call/whatsapp/wechat/snapchat/x","id":"通信历史资料中给出的准确记录ID"}-->，每条一条。这仅登记展示状态，不修改任何消息；仅有通知声、震动或未查看内容时不加该标记。不确定记录ID就省略，不要编造ID。已展示过的记录不重复标记。'+(scene?'\n'+scene:'')+COMMUNICATION_LANGUAGE_RULE;
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
        const chat=['swipe','regenerate','continue'].includes(type)&&!c.chat.at(-1).is_user?c.chat.slice(0,-1):c.chat;
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
