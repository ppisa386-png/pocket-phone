import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createPhoneMemory} from '../src/memory.js';
import {createPhoneService} from '../src/phone.js';
import {createX,xItems,xUnread} from '../src/x.js';
import {normalizeSettings} from '../src/config.js';
import {buildContinuityPrompt} from '../src/continuity.js';

function setup(){
 const bus=new EventEmitter();let response={},count=0,lastPrompt='';
 const context={chatId:'x-test',name1:'Sam',name2:'Alex',characterId:0,characters:[{name:'Alex',avatar:'alex.png'}],chat:[{mes:'Alex uses X.',name:'Alex'}],chatMetadata:{},saveMetadata:async()=>{},onlineStatus:'connected',eventSource:bus,event_types:Object.fromEntries(['CHAT_CHANGED','MESSAGE_DELETED','MESSAGE_EDITED','GENERATION_STARTED','GENERATION_ENDED'].map(x=>[x,x])),generateQuietPrompt:async o=>{count++;lastPrompt=o.quietPrompt;return typeof response==='function'?response(o):JSON.stringify(response);}};
 const settings=normalizeSettings({retries:0});const memory=createPhoneMemory({getContext:()=>context});const phone=createPhoneService({memory,getContext:()=>context,getSettings:()=>settings});const x=createX({memory,phone,getContext:()=>context,getSettings:()=>settings});
 return {x,memory,phone,context,settings,bus,state:()=>phone.snapshot(),reply:r=>{response=r;},count:()=>count,prompt:()=>lastPrompt,close(){phone.destroy();memory.destroy();}};
}
const ok=r=>assert.equal(r?.ok,true,r?.error);
async function account(f,policy='requests'){
 ok(await f.x.saveProfile({alias:'Moon',bio:'Music'}));
 f.reply({accounts:[{name:'Alex',handle:'alex',has_account:true,dm_policy:policy}]});const r=await f.x.discover('Alex');ok(r);return r.value.ids[0];
}

test('X opens locally; account search deduplicates and never imports phone or Snapchat contacts',async()=>{
 const f=setup();await f.x.open();assert.equal(f.count(),0);const id=await account(f);ok(await f.x.discover('Alex'));assert.equal(xItems(f.state(),'account').length,1);assert.equal(Object.keys(f.state().contacts).length,0);assert.equal(Object.keys(f.state().snapchat).length,0);
 const before=f.count();ok(await f.x.follow(id,true));ok(await f.x.publish('Hello world'));const p=xItems(f.state(),'post')[0];ok(await f.x.react(p.id,'liked'));ok(await f.x.react(p.id,'reposted'));assert.equal(f.count(),before);assert.equal(f.state().x[p.id].reposted,true);f.close();
});

test('X anonymous private replies stay scoped; failed messages retry once; rename preserves disclosure',async()=>{
 const f=setup(),id=await account(f,'open');f.reply(()=>{throw Error('offline');});assert.equal((await f.x.send(id,'Hi')).ok,false);let m=xItems(f.state(),'message')[0];assert.equal(m.status,'failed');
 f.reply({status:'reply',text:'Hello Moon'});ok(await f.x.retryMessage(m.id));assert.equal(xItems(f.state(),'message').length,2);assert.match(f.prompt(),/不知道此网名是谁/);assert.equal(xUnread(f.state()),1);
 const speaker={name:'Alex',avatar:'alex.png',nameIsUnique:true};assert.equal(buildContinuityPrompt(f.state(),speaker,{instruction:'Remember'}),'');
 ok(await f.x.markRead(id));assert.equal(xUnread(f.state()),0);ok(await f.x.reveal(id));ok(await f.x.saveProfile({alias:'New alias',bio:''}));assert.equal(f.state().x[id].identityKnown,true);
 assert.match(buildContinuityPrompt(f.state(),speaker,{instruction:'Remember'}),/Hello Moon/);assert.equal(buildContinuityPrompt(f.state(),{name:'Bea',avatar:'bea.png',nameIsUnique:true},{instruction:'Remember'}),'');f.close();
});

test('closed and blocked X accounts cannot receive messages; pending requests do not invent replies',async()=>{
 const f=setup(),id=await account(f,'closed');let before=f.count();assert.equal((await f.x.send(id,'Hi')).ok,false);assert.equal((await f.x.reveal(id)).ok,false);assert.equal(f.count(),before);f.close();
 const g=setup(),other=await account(g);g.reply({status:'request',text:''});ok(await g.x.send(other,'Hello'));assert.equal(xItems(g.state(),'message').length,1);assert.equal(xItems(g.state(),'message')[0].status,'request');ok(await g.x.block(other,true));before=g.count();assert.equal((await g.x.send(other,'Again')).ok,false);assert.equal(g.count(),before);g.close();
});

test('feed respects following, block and post IDs; public comments keep user aliases',async()=>{
 const f=setup(),id=await account(f);ok(await f.x.follow(id,true));ok(await f.x.publish('A new song'));const own=xItems(f.state(),'post')[0];
 f.reply({posts:[{accountId:id,text:'A public concert'},{name:'Intruder',handle:'other',text:'Unfollowed'}],replies:[{postId:own.id,accountId:id,text:'Sounds good'},{postId:'not-real',accountId:id,text:'Wrong post'}]});ok(await f.x.refresh(true));assert.equal(xItems(f.state(),'post').length,2);assert.equal(xItems(f.state(),'account').length,1);assert.equal(xItems(f.state(),'comment').length,1);assert.equal(xUnread(f.state()),1);ok(await f.x.markPostRead(own.id));assert.equal(xUnread(f.state()),0);
 const post=xItems(f.state(),'post').find(p=>p.author===id);f.reply({text:'See you there'});ok(await f.x.comment(post.id,'When?'));assert.equal(xItems(f.state(),'comment').length,3);assert.match(f.prompt(),/不知道此网名是谁/);assert.equal(xItems(f.state(),'comment').find(c=>c.author==='user').alias,'Moon');
 ok(await f.x.block(id,true));const n=f.count();assert.equal((await f.x.comment(post.id,'Again')).ok,false);assert.equal(f.count(),n);f.close();
});

test('X state and in-flight output roll back after deleting narrative or switching chats',async()=>{
 const f=setup(),id=await account(f,'open');f.context.chat.push({mes:'Later.'});await f.memory.read();ok(await f.x.follow(id,true));ok(await f.x.publish('Later post'));
 let finish,start;const ready=new Promise(r=>start=r);f.reply(()=>{start();return new Promise(r=>finish=r);});const sending=f.x.send(id,'Wait');await ready;
 f.context.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();finish('{"status":"reply","text":"late"}');assert.equal((await sending).ok,false);assert.equal(xItems(f.state(),'message').length,0);assert.equal(xItems(f.state(),'post').length,0);assert.equal(f.state().x[id].following,false);
 f.context.chatId='another';f.context.chatMetadata={};f.bus.emit('CHAT_CHANGED');await f.memory.read();assert.equal(Object.keys(f.state().x).length,0);f.close();
});

test('disabling X prevents even local changes without disabling Snapchat',async()=>{
 const f=setup();f.settings.apps.x=false;assert.equal((await f.x.publish('No')).ok,false);assert.equal(xItems(f.state(),'post').length,0);assert.equal(f.settings.apps.snapchat,true);assert.equal(f.count(),0);f.close();
});
