import { recentContactActivity } from '../src/proactive-pacing.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createPhoneMemory} from '../src/memory.js';
import {createPhoneService} from '../src/phone.js';
import {createStoryPhoneBridge,STORY_PHONE_KEY,importStoryPhone} from '../src/story-phone.js';
import {JOURNAL_KEY,messageSignatures,revisionsFor,appendChange,replayJournal,eraseMessageFromJournal,reconcileJournal} from '../src/journal.js';
import {normalizeSettings} from '../src/config.js';
import {renderMessagesScreen} from '../src/messages-view.js';
import {messageParticipants} from '../src/messages.js';
const annotation=(row,prose)=>({mes:prose+'<!--durian-contact:'+JSON.stringify({...row,evidence:prose})+'-->',is_user:false,name:'Alex'});
function setup(){
 const bus=new EventEmitter(),prompts={},context={chatId:'story',characterId:0,name1:'Sam',name2:'Alex',characters:[{name:'Alex',avatar:'alex.png'}],chat:[{mes:'An ordinary evening.',is_user:false,name:'Alex'}],chatMetadata:{},saveMetadata:async()=>{},eventSource:bus,event_types:Object.fromEntries(['GENERATION_STARTED','GENERATION_AFTER_COMMANDS','GENERATION_ENDED','MESSAGE_DELETED','MESSAGE_EDITED','CHAT_CHANGED'].map(n=>[n,n])),setExtensionPrompt(k,value,_p,_d,_s,_r,filter){prompts[k]={value,filter};}};
 const settings=normalizeSettings({retries:0});let requests=0;context.generateQuietPrompt=async()=>{requests++;return '{"status":"reply","text":"Glad to hear from you."}';};
 const memory=createPhoneMemory({getContext:()=>context}),phone=createPhoneService({memory,getContext:()=>context,getSettings:()=>settings}),bridge=createStoryPhoneBridge({getContext:()=>context,getSettings:()=>settings});
 return {context,settings,memory,phone,bridge,prompts,bus,requests:()=>requests,close(){bridge.destroy();phone.destroy();memory.destroy();}};
}
test('narrative SMS imports locally once, grants reply access, survives reload and rolls back with its source',async()=>{
 const f=setup();try{const row={recipient:'user',name:'Alex',kind:'sms',text:'How was your day?'};f.context.chat.push(annotation(row,'Sam received a text from Alex: How was your day?'));await f.memory.read();assert.equal(f.requests(),0);let state=f.phone.snapshot();assert.equal(Object.keys(state.messages).length,1);assert.ok(state.contacts['card:alex.png']);await f.memory.read();assert.equal(Object.keys(f.phone.snapshot().messages).length,1);await f.phone.sendMessage('card:alex.png','Fine.');assert.equal(f.requests(),1);assert.equal(Object.keys(f.phone.snapshot().messages).length,3);
 f.context.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();assert.equal(Object.keys(f.phone.snapshot().messages).length,0);assert.equal(Object.keys(f.phone.snapshot().contacts).length,0);}finally{f.close();}
});
test('actual call outcomes stay in history and a narrative update changes the same call; deleting update restores it',async()=>{
 const f=setup();try{f.context.chat.push(annotation({recipient:'user',name:'Alex',kind:'call',status:'ringing'},'Alex called; the phone rang.'));await f.memory.read();const id=Object.keys(f.phone.snapshot().calls)[0];f.context.chat.push(annotation({recipient:'user',name:'Alex',kind:'call',status:'declined',call_id:id},'Sam declined Alex’s call.'));await f.memory.read();assert.equal(Object.keys(f.phone.snapshot().calls).length,1);assert.equal(f.phone.snapshot().calls[id].status,'declined');assert.equal(f.requests(),0);f.context.chat.pop();await f.memory.read();assert.equal(f.phone.snapshot().calls[id].status,'ringing');}finally{f.close();}
});
test('marker-only, non-user communications, absent evidence and user-authored annotations do not become phone records',async()=>{
 const f=setup();try{
 const row={recipient:'user',name:'Alex',kind:'sms',text:'Hello'};
 f.context.chat.push(annotation({...row,recipient:'Bea'},'Alex texted Bea: Hello'),{mes:'A different scene.<!--durian-contact:'+JSON.stringify({...row,evidence:'Alex texted Sam: Hello'})+'-->',is_user:false},{...annotation(row,'Alex texted Sam: Hello'),is_user:true},{mes:'<!--durian-contact:'+JSON.stringify({...row,evidence:'Alex texted Sam: Hello'})+'-->',is_user:false});await f.memory.read();assert.equal(Object.keys(f.phone.snapshot().messages).length,0);}finally{f.close();}
});
test('normal generation asks the main model to decide; no independent proactive request or forced followup',async()=>{
 const f=setup();try{f.context.chat.push({mes:'A second reply.',is_user:false});await f.bridge.prepare();assert.match(f.prompts[STORY_PHONE_KEY].value,/每三条角色正文一次/);assert.match(f.prompts[STORY_PHONE_KEY].value,/追求、听闻消息/);assert.equal(f.prompts[STORY_PHONE_KEY].filter(),true);await f.phone.checkIncoming();assert.equal(f.requests(),0);await f.bridge.prepare('quiet');assert.equal(f.prompts[STORY_PHONE_KEY].value,'');f.settings.proactiveEnabled=false;await f.bridge.prepare();assert.match(f.prompts[STORY_PHONE_KEY].value,/主动联系已关闭/);}finally{f.close();}
});

test('blocked narrative contact is not revived after unblocking; incomplete streaming never writes',async()=>{
 const f=setup();try{
 await f.memory.read();await f.memory.commit(await f.memory.begin(),[{collection:'profiles',key:'blocked:card:alex.png',value:{messages:true}}]);
 f.bus.emit('GENERATION_STARTED','normal');f.context.chat.push(annotation({recipient:'user',name:'Alex',kind:'sms',text:'Hi Sam'},'Alex sent Sam: Hi Sam'));await f.memory.read();assert.equal(Object.keys(f.phone.snapshot().messages).length,0);
 f.bus.emit('GENERATION_ENDED');await f.memory.read();assert.equal(Object.keys(f.phone.snapshot().messages).length,0);await f.memory.commit(await f.memory.begin(),[{collection:'profiles',key:'blocked:card:alex.png',value:{messages:false}}]);await f.memory.read();assert.equal(Object.keys(f.phone.snapshot().messages).length,0);
 }finally{f.close();}
});

test('numeric invalid sender metadata cannot prevent other phone data from loading',async()=>{
 const f=setup();try{f.context.chat.push(annotation({recipient:'user',name:42,kind:'sms',text:'Hi Sam'},'Alex sent Sam: Hi Sam'));const view=await f.memory.read();assert.ok(view.scope);assert.equal(Object.keys(view.state.messages).length,0);}finally{f.close();}
});

test('a new narrative call becomes active after the preceding call has ended',async()=>{
 const f=setup();try{
 f.context.chat.push(annotation({recipient:'user',name:'Alex',kind:'call',status:'ringing'},'Alex called; the phone rang.'));await f.memory.read();const first=f.phone.snapshot().activeCallId;
 f.context.chat.push(annotation({recipient:'user',name:'Alex',kind:'call',status:'ended',call_id:first},'Sam finished the call with Alex.'));await f.memory.read();
 f.context.chat.push(annotation({recipient:'user',name:'Alex',kind:'call',status:'ringing'},'Later, Alex called again.'));await f.memory.read();const state=f.phone.snapshot();assert.notEqual(state.activeCallId,first);assert.equal(state.calls[state.activeCallId].status,'ringing');
 }finally{f.close();}
});


test('narrative notification imports full SMS metadata without repeating text in prose and rolls back',async()=>{
 const f=setup();try{
 const evidence='坐在对面的朋友看见手机亮起，屏幕上显示了发件人的名字。';
 const text='我在商场遇到了一点问题，你方便时能给我打个电话吗？';
 f.bus.emit('GENERATION_STARTED','normal');f.context.chat.push(annotation({recipient:'user',name:'伊芙',kind:'sms',text,read:false,status:'',turns:[],replyable:true},evidence));await f.memory.read();assert.equal(Object.keys(f.phone.snapshot().messages).length,0);
 f.bus.emit('GENERATION_ENDED');await f.memory.read();let messages=Object.values(f.phone.snapshot().messages);assert.equal(messages.length,1);assert.equal(messages[0].text,text);assert.equal(messages[0].name,'伊芙');assert.ok(f.phone.snapshot().contacts['name:伊芙']);assert.equal(f.requests(),0);
 await f.phone.openMessages();await f.memory.read();assert.equal(Object.keys(f.phone.snapshot().messages).length,1);
 f.context.chat.pop();await f.memory.read();assert.equal(Object.keys(f.phone.snapshot().messages).length,0);
 }finally{f.close();}
});

test('formatted evidence supports SMS and incoming calls when opening phone later',async()=>{
 const f=setup();try{
 f.context.chat.push({mes:'**伊芙** 发来了短信。<!--durian-contact:'+JSON.stringify({recipient:'user',name:'伊芙',kind:'sms',evidence:'伊芙 发来了短信。',text:'今晚见。'})+'-->',is_user:false});
 f.context.chat.push({mes:'**伊芙** 打来了电话。<!--durian-contact:'+JSON.stringify({recipient:'user',name:'伊芙',kind:'call',status:'missed',evidence:'伊芙 打来了电话。'})+'-->',is_user:false});
 await f.phone.openMessages();await f.phone.open();assert.equal(Object.keys(f.phone.snapshot().messages).length,1);const calls=Object.values(f.phone.snapshot().calls);assert.equal(calls.length,1);assert.equal(calls[0].name,'伊芙');assert.equal(calls[0].status,'missed');assert.equal(f.requests(),0);
 }finally{f.close();}
});


test('both directions in one floor import in order; third-party endpoints and invented outgoing text are rejected',async()=>{
 const f=setup();try{
 const prose='Sam received a text from Alex: Are you free? Sam sent Alex: After lunch. Bea sent Alex: My private news.';
 const rows=[
  {sender:'Alex',recipient:'user',name:'Alex',kind:'sms',text:'Are you free?'},
  {sender:'user',recipient:'Alex',name:'Alex',kind:'sms',text:'After lunch.'},
  {sender:'Bea',recipient:'Alex',name:'Bea',kind:'sms',text:'My private news.'},
  {sender:'Bea',recipient:'user',name:'Alex',kind:'sms',text:'wrong counterpart'},
  {sender:'user',recipient:'Alex',name:'Alex',kind:'sms',text:'NEVER SAID THIS'},
 ];
 f.context.chat.push({is_user:false,send_date:'2024-01-01T00:00:00Z',mes:'<calendar>2020年5月4日 09:15 星期一</calendar>'+prose+rows.map(row=>'<!--durian-contact:'+JSON.stringify({...row,evidence:prose})+'-->').join('')});
 await f.memory.read();const messages=Object.values(f.phone.snapshot().messages).sort((a,b)=>a.createdAt-b.createdAt);
 assert.deepEqual(messages.map(m=>[m.role,m.text]),[['assistant','Are you free?'],['user','After lunch.']]);
 assert.equal(messages[1].replyStatus,'sent');assert.equal(messages[0].storyTime.time,'09:15');assert.equal(f.requests(),0);
 await f.memory.read();assert.equal(Object.keys(f.phone.snapshot().messages).length,2);
 f.context.chat.pop();await f.memory.read();assert.equal(Object.keys(f.phone.snapshot().messages).length,0);
 }finally{f.close();}
});

test('non-replyable narrative SMS remains readable without granting a return address',async()=>{
 const f=setup();try{
 f.context.chat.push(annotation({sender:'Alex',recipient:'user',name:'Alex',kind:'sms',text:'Read only notice.',replyable:false},'Sam received a one-way text from Alex; no reply address was available.'));
 await f.memory.read();const id='card:alex.png',state=f.phone.snapshot();
 assert.equal(Object.values(state.messages).length,1);assert.equal(state.contacts[id],undefined);
 assert.equal(messageParticipants(state)[id].replyable,false);
 const html=renderMessagesScreen(state,id,false,{});
 assert.match(html,/Read only notice\./);assert.match(html,/<textarea[^>]*disabled/);assert.match(html,/没有可用的回复地址/);
 for(const send of [()=>f.phone.sendMessage(id,'Reply'),()=>f.phone.queueMessage(id,'Reply'),()=>f.phone.flushMessages(id,'Reply')])assert.equal((await send()).ok,false);
 assert.equal(f.requests(),0);assert.equal(Object.values(f.phone.snapshot().messages).length,1);
 const reload=createPhoneMemory({getContext:()=>f.context});try{assert.equal(messageParticipants((await reload.read()).state)[id].replyable,false);}finally{reload.destroy();}
 f.context.chat.push(annotation({sender:'Alex',recipient:'user',name:'Alex',kind:'sms',text:'You can reply now.',replyable:true},'Sam received a normal replyable text from Alex.'));
 await f.memory.read();assert.ok(f.phone.snapshot().contacts[id]);assert.equal((await f.phone.sendMessage(id,'Now I can reply.')).ok,true);assert.equal(f.requests(),1);
 f.context.chat.pop();await f.memory.read();assert.equal(f.phone.snapshot().contacts[id],undefined);assert.equal(messageParticipants(f.phone.snapshot())[id].replyable,false);
 assert.equal((await f.phone.sendMessage(id,'Not available again')).ok,false);assert.equal(f.requests(),1);
 }finally{f.close();}
});

test('a one-way narrative SMS does not revoke an independently acquired contact',async()=>{
 const f=setup();try{
 const id='card:alex.png';await f.memory.read();await f.memory.commit(await f.memory.begin(),[{collection:'contacts',key:id,value:{id,name:'Alex',number:'+1 212 555 0123'}}]);
 f.context.chat.push(annotation({sender:'Alex',recipient:'user',name:'Alex',kind:'sms',text:'Notice.',replyable:false},'Sam received a one-way notice from Alex.'));
 await f.memory.read();assert.equal(messageParticipants(f.phone.snapshot())[id].number,'+1 212 555 0123');
 assert.equal((await f.phone.sendMessage(id,'Sent to the known number.')).ok,true);assert.equal(f.requests(),1);
 }finally{f.close();}
});

test('legacy one-way SMS migrates all saved versions without overwriting edits or known numbers',async()=>{
 const f=setup();try{
 const contactId='card:alex.png';
 f.context.chat.push(annotation({sender:'Alex',recipient:'user',name:'Alex',kind:'sms',text:'Original notice.',replyable:false},'Sam received a one-way notice from Alex.'));
 const sourceRevisions=await revisionsFor(messageSignatures(f.context.chat));
 let legacy=importStoryPhone(undefined,sourceRevisions,f.context.chat,f.context).journal;
 const message=Object.values(replayJournal(legacy).messages)[0];
 for(const event of legacy.events)for(const change of event.changes)if(change.value?.id===message.id)delete change.value.replyable;
 f.context.chat.push({mes:'Sam reads the notice later.',is_user:false});
 const revisions=await revisionsFor(messageSignatures(f.context.chat));
 legacy=appendChange(legacy,revisions,[{collection:'messages',key:message.id,value:{...message,text:'Edited notice.',read:true,replyable:undefined}}]);
 f.context.chatMetadata[JOURNAL_KEY]=legacy;
 await f.memory.read();let state=f.phone.snapshot();
 assert.equal(state.messages[message.id].text,'Edited notice.');assert.equal(state.messages[message.id].read,true);
 assert.equal(messageParticipants(state)[contactId].replyable,false);
 assert.equal((await f.phone.sendMessage(contactId,'Cannot reply')).ok,false);assert.equal(f.requests(),0);
 f.context.chat.pop();await f.memory.read();state=f.phone.snapshot();
 assert.equal(state.messages[message.id].text,'Original notice.');assert.equal(state.messages[message.id].replyable,false);
 await f.memory.commit(await f.memory.begin(),[{collection:'contacts',key:contactId,value:{id:contactId,name:'Alex',number:'+1 212 555 0123'}}]);
 assert.equal((await f.phone.sendMessage(contactId,'Use known number')).ok,true);assert.equal(f.requests(),1);
 f.context.chat.pop();await f.memory.read();assert.equal(Object.values(f.phone.snapshot().messages).length,0);
 }finally{f.close();}
});

test('legacy one-way migration preserves permanent erasure and ignores absent or changed source',async()=>{
 const chat=[annotation({sender:'Alex',recipient:'user',name:'Alex',kind:'sms',text:'Notice.',replyable:false},'Sam received a one-way notice from Alex.')];
 const context={name1:'Sam',characters:[{name:'Alex',avatar:'alex.png'}]},revisions=await revisionsFor(messageSignatures(chat));
 const legacy=importStoryPhone(undefined,revisions,chat,context).journal;
 const id=Object.keys(replayJournal(legacy).messages)[0];
 for(const event of legacy.events)for(const change of event.changes)if(change.value?.id===id)delete change.value.replyable;
 const erased=eraseMessageFromJournal(legacy,id),checked=importStoryPhone(erased,revisions,chat,context);
 assert.equal(checked.changed,false);assert.equal(replayJournal(checked.journal).messages[id],undefined);
 const noSource=importStoryPhone(legacy,[],[],context);assert.equal(noSource.changed,false);
 chat[0]={mes:'A different scene.',is_user:false};const changedRevisions=await revisionsFor(messageSignatures(chat));
 const reconciled=reconcileJournal(legacy,changedRevisions).journal;
 assert.equal(Object.values(replayJournal(importStoryPhone(reconciled,changedRevisions,chat,context).journal).messages).length,0);
});


test('missed call history acknowledgement waits silently during narrative and succeeds after it ends',async()=>{
 const f=setup();try{
 f.context.chat.push(annotation({recipient:'user',name:'Alex',kind:'call',status:'missed'},'Sam missed a call from Alex.'));
 f.context.chat.push(annotation({recipient:'user',name:'Alex',kind:'sms',text:'Hello',read:false},'Sam received a text from Alex.'));
 await f.memory.read();const id=Object.keys(f.phone.snapshot().calls)[0],sms=Object.values(f.phone.snapshot().messages)[0];
 f.bus.emit('GENERATION_STARTED','normal');
 await assert.doesNotReject(f.phone.markCallsRead());await assert.doesNotReject(f.phone.markMessagesRead(sms.contactId));
 assert.equal(f.phone.snapshot().calls[id].read,false);assert.equal(f.phone.snapshot().messages[sms.id].read,false);
 await assert.rejects(f.memory.begin(),e=>e.code==='GENERATING','real writes remain blocked');
 f.bus.emit('GENERATION_ENDED');await f.phone.open();await f.phone.markCallsRead();await f.phone.markMessagesRead(sms.contactId);
 assert.equal(f.phone.snapshot().calls[id].read,true);assert.equal(f.phone.snapshot().calls[id].status,'missed');assert.equal(f.phone.snapshot().messages[sms.id].read,true);assert.equal(f.requests(),0);
 }finally{f.close();}
});

test('automatic read acknowledgement still reports genuine save failures',async()=>{
 const f=setup();try{
 f.context.chat.push(annotation({recipient:'user',name:'Alex',kind:'call',status:'missed'},'Sam missed a call from Alex.'));await f.memory.read();
 f.context.saveMetadata=async()=>{throw Error('disk failure');};await assert.rejects(f.phone.markCallsRead(),/保存失败/);assert.equal(Object.values(f.phone.snapshot().calls)[0].read,false);
 }finally{f.close();}
});


test('quiet contact opportunities do not manufacture messages, calls, requests or later catch-up quotas',async()=>{
 const f=setup();try{
 for(let n=0;n<9;n++){
  f.context.chat.push({mes:'日期：2026-10-26 10:00\n继续当前场景，没有发生通信。',is_user:false});
  await f.memory.read();await f.bridge.prepare();const prompt=f.prompts[STORY_PHONE_KEY].value;
  assert.match(prompt,/连续多个考虑时机都无人联系也正常/);assert.match(prompt,/联系人多少不决定消息数量/);
  assert.match(prompt,/正常对话/);assert.match(prompt,/不要为绕过少打扰原则临时制造危机/);
 }
 assert.equal(Object.keys(f.phone.snapshot().messages).length,0);assert.equal(Object.keys(f.phone.snapshot().calls).length,0);assert.equal(f.requests(),0);
 }finally{f.close();}
});

test('narrative pacing sees actual communication metadata and loses it after source rollback',async()=>{
 const f=setup();try{
 f.context.chat.push(annotation({sender:'Alex',recipient:'user',name:'Alex',kind:'sms',text:'PRIVATE CONTENT'},'日期：2026-10-26 10:00\nAlex sent Sam a text.'));
 await f.memory.read();await f.bridge.prepare();let prompt=f.prompts[STORY_PHONE_KEY].value;
 assert.match(prompt,/"medium":"sms","direction":"incoming"/);assert.match(prompt,/"date":"2026-10-26","time":"10:00"/);
 assert.ok(!prompt.includes('PRIVATE CONTENT'));
 f.context.chat.pop();await f.memory.read();await f.bridge.prepare();prompt=f.prompts[STORY_PHONE_KEY].value;assert.match(prompt,/"recent":\[\]/);assert.equal(f.requests(),0);
 }finally{f.close();}
});

test('pacing metadata is bounded, contact-specific, and excludes expired text and unsent drafts',()=>{
 const now=[{mes:'日期：2026-10-26 12:00'}];
 const state={messages:{},calls:{},smsContext:{}};
 for(let n=0;n<12;n++)state.messages['m'+n]={id:'m'+n,contactId:'a',name:'A',role:n%2?'user':'assistant',text:'PRIVATE '+n,createdAt:n,storyTime:{date:'2026-10-26',time:'11:00'}};
 state.messages.other={id:'other',contactId:'b',name:'B',role:'assistant',text:'B SECRET',createdAt:30};
 state.messages.queued={id:'queued',contactId:'a',role:'user',replyStatus:'queued',createdAt:40};
 state.messages.failed={id:'failed',contactId:'a',role:'user',replyStatus:'failed',createdAt:50};
 state.messages.old={id:'old',contactId:'a',role:'assistant',text:'EXPIRED SECRET',createdAt:60};state.smsContext.old={category:'A',anchor:{date:'2026-10-20',time:'10:00'}};
 state.calls.call={id:'call',contactId:'b',name:'B',turns:[{text:'CALL SECRET'}],direction:'incoming',status:'missed',createdAt:70};
 const result=recentContactActivity(state,now,'a');assert.equal(result.recent.length,8);assert.ok(result.recent.every(m=>m.contactId==='a'));
 const text=JSON.stringify(result);assert.ok(!/PRIVATE|SECRET|createdAt|order|queued|failed/.test(text));
 assert.equal(recentContactActivity(state,now).recent.at(-1).medium,'call');
});
