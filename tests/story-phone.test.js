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
 const f=setup();try{f.context.chat.push(...Array.from({length:3},()=>({mes:'A reply.',is_user:false})));await f.bridge.prepare();assert.match(f.prompts[STORY_PHONE_KEY].value,/每五条有效角色正文一次/);assert.match(f.prompts[STORY_PHONE_KEY].value,/无需证明取得号码/);assert.equal(f.prompts[STORY_PHONE_KEY].filter(),true);await f.phone.checkIncoming();assert.equal(f.requests(),0);await f.bridge.prepare('quiet');assert.equal(f.prompts[STORY_PHONE_KEY].value,'');f.settings.proactiveEnabled=false;await f.bridge.prepare();assert.match(f.prompts[STORY_PHONE_KEY].value,/主动联系已关闭/);}finally{f.close();}
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
  const opportunity=(n+3)%5===0;
  assert.equal(prompt.includes('本轮是每五条'),opportunity);
  if(opportunity)assert.match(prompt,/可无人联系，也可多人/);

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
 const result=recentContactActivity(state,now,'a');assert.equal(result.recent.length,3);assert.ok(result.recent.every(m=>m.contactId==='a'));
 const text=JSON.stringify(result);assert.ok(!/PRIVATE|SECRET|createdAt|order|queued|failed/.test(text));
 assert.equal(recentContactActivity(state,now).recent.at(-1).medium,'call');
});

test('WhatsApp narration imports a completed exchange in order without outreach or a model and follows its revision',async()=>{
 const f=setup();
 const make=(sender,text,evidence)=>({platform:'whatsapp',sender,recipient:sender==='user'?'Alex':'user',action:sender==='user'?'sent':'received',kind:'text',text,evidence});
 const floor=rows=>({mes:rows.map(r=>r.evidence).join('\n')+rows.map(r=>'<!--durian-message:'+JSON.stringify(r)+'-->').join('')});
 const rows=()=>Object.values(f.phone.snapshot().whatsapp).filter(r=>r.type==='message');
 try{
  f.context.extensionSettings={personal_pocket_phone:{proactiveEnabled:false}};
  const a=make('user','Ready?','Sam sent Alex “Ready?” on WhatsApp.'),b=make('Alex','Yes.','Alex replied on WhatsApp: Yes.'),c=make('Alex','See you.','Alex sent a second WhatsApp: See you.');
  f.context.chat.push(floor([a,b,c]));await f.memory.read();
  assert.deepEqual(rows().map(r=>[r.text,r.role,r.status,r.read]),[['Ready?','user','sent',true],['Yes.','assistant','received',false],['See you.','assistant','received',false]]);
  assert.equal(new Set(rows().map(r=>r.accountId)).size,1);
  await f.memory.read();assert.equal(rows().length,3);
  f.context.chat.push(floor([make('user','Ready?','Sam remembered sending “Ready?” yesterday.'),make('user','Hi','Sam was about to send “Hi”.'),make('user','invented','Sam set the phone down.')]));
  await f.memory.read();assert.equal(rows().length,3);
  f.context.chat.push(floor([make('user','Ready?','Sam sent “Ready?” again on WhatsApp.')]));await f.memory.read();assert.equal(rows().length,4);
  f.context.chat[f.context.chat.length-1]=floor([make('user','Later!','Sam sent “Later!” on WhatsApp.')]);await f.memory.read();assert.deepEqual(rows().map(r=>r.text),['Ready?','Yes.','See you.','Later!']);
  f.context.chat.length=1;await f.memory.read();assert.deepEqual(rows(),[]);assert.equal(f.requests(),0);
 }finally{f.close();}
});

test('a WhatsApp outreach and ordinary marker for the same delivery import once after save and reload',async()=>{
 const f=setup();try{
  const evidence='Alex sent Sam a WhatsApp message: Good morning.';
  const common={sender:'Alex',recipient:'user',text:'Good morning.',evidence};
  const regular='<!--durian-message:'+JSON.stringify({...common,platform:'whatsapp',kind:'text',action:'received'})+'-->';
  const outreach='<!--durian-outreach:'+JSON.stringify({...common,channel:'whatsapp',media:'text',motive:'greeting'})+'-->';
  f.context.chat.push(...Array.from({length:3},()=>({mes:'Another scene.'})),{mes:evidence+regular+outreach});
  await f.memory.read();const before=f.phone.snapshot();
  assert.equal(Object.values(before.whatsapp).filter(r=>r.type==='message').length,1);
  f.context.chatMetadata=JSON.parse(JSON.stringify(f.context.chatMetadata));await f.memory.read();
  assert.deepEqual(f.phone.snapshot().whatsapp,before.whatsapp);assert.equal(f.requests(),0);
 }finally{f.close();}
});

const xFloor=(prose,...rows)=>({mes:prose+'\n'+rows.map(r=>'<!--durian-x:'+JSON.stringify(r)+'-->').join('\n')});
test('narrative X publishes an image and original text under the alias, threads evidenced replies and rolls back without requests',async()=>{
 const f=setup();
 try{
  const apps=Object.fromEntries(Object.keys(f.settings.apps).map(k=>[k,k==='x']));
  f.context.extensionSettings={personal_pocket_phone:{apps,proactiveEnabled:false}};
  Object.assign(f.settings,{apps,proactiveEnabled:false});
  await f.memory.read();
  await f.memory.commit(await f.memory.begin(),[{collection:'x',key:'profile',value:{id:'profile',type:'profile',alias:'Moon'}}]);
  await f.bridge.prepare();assert.match(f.prompts[STORY_PHONE_KEY].value,/<!--durian-x:/);
  const evidence='19:23 Sam posted on X: “Evening!”',imageDescription='a moon over the lake';
  const reply={name:'Alex',text:'So quiet.',evidence:'Alex replied: “So quiet.”'};
  const row={action:'published',author:'user',text:'Evening!',time:'19:23',evidence,imageDescription,replies:[reply,reply,{...reply,text:'Never written'}]};
  f.context.chat.push(xFloor(['2026-09-02 19:30',evidence,imageDescription,reply.evidence].join('\n'),row,row));
  const readX=async()=>(await f.memory.read()).state.x;
  let x=await readX();
  const records=(x,type)=>Object.values(x).filter(r=>r.type===type);
  const [post]=records(x,'post'),[comment]=records(x,'comment');
  assert.equal(records(x,'post').length,1);assert.equal(records(x,'comment').length,1);
  assert.deepEqual([post.author,post.alias,post.text,post.imageDescription,post.sourceIndex],['user','Moon','Evening!',imageDescription,1]);
  assert.deepEqual(post.storyTime,{date:'2026-09-02',time:'19:23',precision:'scene'});assert.ok(Number.isInteger(post.postedAtStory.day));
  assert.deepEqual([comment.postId,x[comment.author].name,comment.text],[post.id,'Alex','So quiet.']);
  const {createXPanel}=await import('../src/x-view.js');
  const panel=createXPanel({adapter:{userName:()=>f.context.name1},getView:()=>({x}),redraw(){},notice(){}});
  await panel.action('profile');assert.match(panel.html(),/Evening!/);assert.match(panel.html(),/配图.*a moon over the lake/);assert.match(panel.html(),/2026-09-02 19:23/);
  await panel.action('comments',post.id);assert.match(panel.html(),/Alex：<\/strong>So quiet\./);
  f.context.chatMetadata=JSON.parse(JSON.stringify(f.context.chatMetadata));assert.deepEqual(await readX(),x);
  const later={action:'reply',postId:post.id,name:'Alex',text:'Back again.',evidence:'Alex replied: Back again.'};
  f.context.chat.push(xFloor(later.evidence,later,{...later,postId:'missing'}));x=await readX();
  assert.deepEqual(records(x,'comment').map(c=>[c.postId,c.author,c.text]),[[post.id,comment.author,'So quiet.'],[post.id,comment.author,'Back again.']]);
  f.context.chat.pop();assert.equal(records(await readX(),'comment').length,1);
  const imageOnly={action:'published',author:'user',evidence:'Sam published a photograph.',imageDescription};
  f.context.chat[1]=xFloor(imageOnly.evidence+' '+imageDescription,imageOnly);x=await readX();
  assert.equal(records(x,'post').length,1);assert.equal(records(x,'post')[0].text,'');assert.equal(records(x,'comment').length,0);
  assert.equal(x[post.id],undefined);f.context.chat.pop();assert.equal(records(await readX(),'post').length,0);
  assert.equal(f.requests(),0);
 }finally{f.close();}
});

test('X imports only evidenced user posts from completed narrative and respects the app switch',async()=>{
 const f=setup();
 try{
  const row={author:'user',action:'published',text:'Hello!',evidence:'Sam published on X: Hello!'};
  const floor=xFloor(row.evidence,row);
  const draft={...row,evidence:'Sam was about to post: Hello!'};
  f.context.chat.push({...floor,is_user:true},{...floor,is_system:true},xFloor(draft.evidence,draft),
   xFloor(row.evidence,{...row,author:'Alex'},{...row,text:'invented'},{...row,imageDescription:'unwritten'}),
   xFloor('No public action.',row));
  assert.deepEqual((await f.memory.read()).state.x,{});
  f.context.extensionSettings={personal_pocket_phone:{apps:{x:false}}};
  f.context.chat.push(floor);await f.memory.read();
  f.context.extensionSettings.personal_pocket_phone.apps.x=true;
  assert.deepEqual((await f.memory.read()).state.x,{});
  f.bus.emit('GENERATION_STARTED','normal');f.context.chat.push(floor);await f.memory.read();
  assert.equal(f.context.chatMetadata[JOURNAL_KEY].events.some(e=>e.source.index===f.context.chat.length-1),false);
  f.bus.emit('GENERATION_ENDED');assert.equal(Object.values((await f.memory.read()).state.x).filter(r=>r.type==='post').length,1);
 }finally{f.close();}
});
