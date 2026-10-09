import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createPhoneMemory} from '../src/memory.js';
import {createPhoneService} from '../src/phone.js';
import {createSnapchat,snapItems,snapExpired,snapAmount,snapUnread} from '../src/snapchat.js';
import {normalizeSettings} from '../src/config.js';
import {buildContinuityPrompt} from '../src/continuity.js';

function setup() {
 const bus=new EventEmitter();let response={},calls=0,lastPrompt='';
 const context={chatId:'snap',name1:'Sam',name2:'Alex',characterId:0,characters:[{name:'Alex',avatar:'alex.png'}],chat:[{name:'Alex',mes:'We meet.'}],chatMetadata:{},saveMetadata:async()=>{},onlineStatus:'connected',eventSource:bus,event_types:Object.fromEntries(['CHAT_CHANGED','MESSAGE_DELETED','MESSAGE_EDITED','GENERATION_STARTED','GENERATION_ENDED'].map(x=>[x,x])),generateQuietPrompt:async options=>{calls++;lastPrompt=options.quietPrompt;return typeof response==='function'?await response(options):JSON.stringify(response);}};
 const settings=normalizeSettings({retries:0});const memory=createPhoneMemory({getContext:()=>context});const phone=createPhoneService({memory,getContext:()=>context,getSettings:()=>settings});const snap=createSnapchat({memory,phone,getContext:()=>context,getSettings:()=>settings});
 return {snap,memory,phone,settings,context,bus,state:()=>phone.snapshot(),count:()=>calls,prompt:()=>lastPrompt,reply:value=>{response=value;},close(){phone.destroy();memory.destroy();}};
}
async function friend(f,alias='Moon') {
 assert.equal((await f.snap.saveProfile({alias,currency:'USD'})).ok,true);
 f.reply({accounts:[{name:'Alex',handle:'alex',has_account:true,invitation:'incoming'}]});assert.equal((await f.snap.discover()).ok,true);
 const a=snapItems(f.state(),'account')[0];assert.equal((await f.snap.accept(a.id,true)).ok,true);return a.id;
}
const ok=result=>assert.equal(result.ok,true,result.error);

test('opening does not request; discovery deduplicates; unaccepted and blocked accounts cannot interact',async()=>{
 const f=setup();await f.snap.open();assert.equal(f.count(),0);
 f.reply({accounts:[{name:'Alex',handle:'alex',has_account:true},{name:'Other',handle:'alex',has_account:true},{name:'Ghost',handle:'ghost',has_account:false}]});ok(await f.snap.discover());
 assert.equal(snapItems(f.state(),'account').length,1);const a=snapItems(f.state(),'account')[0];
 assert.equal((await f.snap.send(a.id,'text','hello')).ok,false);assert.equal(f.count(),1);
 f.reply({status:'friends'});ok(await f.snap.invite(a.id));ok(await f.snap.block(a.id,true));assert.equal((await f.snap.call(a.id,'voice')).ok,false);assert.equal((await f.snap.transfer(a.id,'5','USD','')).ok,false);assert.equal(f.count(),2);f.close();
});

test('aliases stay private until explicit disclosure; rename never erases recognition',async()=>{
 const f=setup();const id=await friend(f);assert.equal(f.state().snapchat[id].identityKnown,false);
 f.reply({status:'reply',text:'Hello Moon',kind:'voice'});ok(await f.snap.send(id,'text','Hi'));assert.match(f.prompt(),/不知道这个账号是谁/);assert.equal(snapUnread(f.state()),1);
 const speaker={name:'Alex',avatar:'alex.png',nameIsUnique:true};assert.equal(buildContinuityPrompt(f.state(),speaker,{instruction:'Remember'}),'');
 ok(await f.snap.markRead(id));assert.equal(snapUnread(f.state()),0);ok(await f.snap.reveal(id));ok(await f.snap.saveProfile({alias:'New name',currency:'USD'}));assert.equal(f.state().snapchat[id].identityKnown,true);
 assert.match(buildContinuityPrompt(f.state(),speaker,{instruction:'Remember'}),/Hello Moon/);assert.equal(buildContinuityPrompt(f.state(),{name:'Bea',avatar:'bea.png',nameIsUnique:true},{instruction:'Remember'}),'');f.close();
});

test('failed reply retries the same sent message once; all media remain text',async()=>{
 const f=setup();const id=await friend(f);f.reply(()=>{throw new Error('offline');});assert.equal((await f.snap.send(id,'image','A photo of a beach')).ok,false);
 let messages=snapItems(f.state(),'message');assert.equal(messages.length,1);assert.equal(messages[0].status,'failed');
 f.reply({status:'reply',kind:'video',text:'A short wave at the camera'});ok(await f.snap.retryMessage(messages[0].id));assert.equal(snapItems(f.state(),'message').length,2);assert.equal((await f.snap.retryMessage(messages[0].id)).ok,false);f.close();
});

test('voice and video calls enforce separate prompt boundaries and one active call',async()=>{
 const f=setup();const id=await friend(f);f.reply({status:'answered',text:'Hello'});ok(await f.snap.call(id,'voice'));assert.match(f.prompt(),/只允许听觉/);const c=snapItems(f.state(),'call')[0];
 assert.equal((await f.snap.call(id,'video')).ok,false);ok(await f.snap.call(id,'voice','Can you hear?',c.id));assert.equal(f.state().snapchat[c.id].turns.length,3);ok(await f.snap.hangup(c.id));ok(await f.snap.call(id,'video'));assert.match(f.prompt(),/镜头内画面与声音/);ok(await f.snap.block(id,true));assert.equal(snapItems(f.state(),'call').some(c=>c.status==='connected'),false);f.close();
});

test('story creation and expiry cost no requests; feeds accept only friends and shared map locations',async()=>{
 const f=setup();const id=await friend(f);const before=f.count();ok(await f.snap.publish('image','Sunset'));const story=snapItems(f.state(),'story')[0];assert.equal(snapExpired(story,story.createdAt+86400000),true);assert.equal(snapExpired(story,story.createdAt+86399999),false);assert.equal(f.count(),before);
 f.reply({items:[{accountId:id,text:'Trip',kind:'image'},{accountId:'unknown',text:'Secret'}]});ok(await f.snap.refresh('stories'));assert.equal(snapItems(f.state(),'story').length,2);
 f.reply({items:[{accountId:id,text:'At the park',place:'Park',shared:true},{accountId:id,text:'Private home',shared:false},{accountId:'unknown',text:'Secret',shared:true},{name:'Tourist',place:'London',text:'Public event',shared:true}]});ok(await f.snap.refresh('map'));assert.equal(snapItems(f.state(),'location').length,2);
 const n=f.count();ok(await f.snap.comment(story.id,'My own comment'));assert.equal(f.count(),n,'does not impersonate user as the author');f.close();
});

test('Snapcash uses integer minor units, settles once and rolls ledger and transfer back together',async()=>{
 assert.equal(snapAmount('0.10'),10);assert.throws(()=>snapAmount('1.001'));assert.throws(()=>snapAmount('-1'));assert.throws(()=>snapAmount('NaN'));
 const f=setup();const id=await friend(f);f.context.chat.push({mes:'We go shopping.'});await f.memory.read();const result=await f.snap.transfer(id,'12.30','USD','Lunch');ok(result);assert.equal(Object.keys(f.state().assets).length,0);
 f.reply({status:'accepted'});ok(await f.snap.settle(result.value));assert.equal(Object.values(f.state().assets)[0].deltaMinor,-1230);assert.equal((await f.snap.settle(result.value)).ok,false);assert.equal(Object.keys(f.state().assets).length,1);
 f.context.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();assert.equal(Object.keys(f.state().assets).length,0);assert.equal(snapItems(f.state(),'transfer').length,0);assert.equal(snapItems(f.state(),'account').length,1);f.close();
});

test('incoming cash requires user acceptance; declining never creates asset credit',async()=>{
 const f=setup();const id=await friend(f);f.reply({status:'reply',text:'For you',transfer:{amount:'25',currency:'USD',memo:'Gift'}});ok(await f.snap.send(id,'text','Hello'));let t=snapItems(f.state(),'transfer')[0];assert.equal(Object.keys(f.state().assets).length,0);ok(await f.snap.settle(t.id,false));assert.equal(Object.keys(f.state().assets).length,0);
 ok(await f.snap.send(id,'text','Thanks'));t=snapItems(f.state(),'transfer').find(t=>t.status==='pending');ok(await f.snap.settle(t.id));assert.equal(Object.values(f.state().assets)[0].deltaMinor,2500);f.close();
});

test('deleted narrative rejects late Snapchat output and rolls every app trace back',async()=>{
 const f=setup();const id=await friend(f);f.context.chat.push({mes:'At night.'});await f.memory.read();let finish,start;const started=new Promise(r=>start=r);f.reply(()=>{start();return new Promise(r=>finish=r);});const pending=f.snap.send(id,'text','Wait');await started;
 f.context.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();finish('{"status":"reply","text":"Too late"}');assert.equal((await pending).ok,false);assert.equal(snapItems(f.state(),'message').length,0);
 f.context.chat[0].mes='New timeline';f.bus.emit('MESSAGE_EDITED');await f.memory.read();assert.equal(Object.keys(f.state().snapchat).length,0);f.close();
});

test('deleting only the settlement floor restores pending transfer and removes its ledger',async()=>{
 const f=setup();const id=await friend(f);const t=await f.snap.transfer(id,'5','USD','');ok(t);
 f.context.chat.push({mes:'Later that afternoon.'});await f.memory.read();f.reply({status:'accepted'});ok(await f.snap.settle(t.value));
 f.context.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();assert.equal(f.state().snapchat[t.value].status,'pending');assert.equal(Object.keys(f.state().assets).length,0);f.close();
});

test('independent Snapchat context selects the target and states the anonymous identity boundary',async()=>{
 const {buildApiContext}=await import('../src/api-context.js');
 const context={name1:'Sam',name2:'Wrong person',characterId:1,characters:[{name:'Alex',avatar:'alex.png',description:'Alex likes music.'},{name:'Wrong person',avatar:'other.png'}],chat:[],powerUserSettings:{persona_description:'Sam is a student.'}};
 const messages=await buildApiContext(context,'Reply',{id:'card:alex.png',name:'Alex',channel:'snapchat',alias:'Moon',identityKnown:false},{historyLimit:10});
 const prompt=messages.map(m=>m.content).join('\n');assert.match(prompt,/Alex likes music/);assert.match(prompt,/对方真实身份尚未确认/);assert.match(prompt,/Moon/);assert.doesNotMatch(prompt,/"name":"Wrong person"/);
});
