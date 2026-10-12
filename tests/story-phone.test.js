import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createPhoneMemory} from '../src/memory.js';
import {createPhoneService} from '../src/phone.js';
import {createStoryPhoneBridge,STORY_PHONE_KEY} from '../src/story-phone.js';
import {normalizeSettings} from '../src/config.js';
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
test('marker-only, non-user communications, invented text and user-authored annotations do not become phone records',async()=>{
 const f=setup();try{
 const row={recipient:'user',name:'Alex',kind:'sms',text:'Hello'};
 f.context.chat.push(annotation({...row,recipient:'Bea'},'Alex texted Bea: Hello'),annotation(row,'A different scene without a message.'),{...annotation(row,'Alex texted Sam: Hello'),is_user:true},{mes:'<!--durian-contact:'+JSON.stringify({...row,evidence:'Alex texted Sam: Hello'})+'-->',is_user:false});await f.memory.read();assert.equal(Object.keys(f.phone.snapshot().messages).length,0);}finally{f.close();}
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
