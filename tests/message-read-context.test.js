import test from 'node:test';
import assert from 'node:assert/strict';
import {appendChange,replayJournal,reconcileJournal,messageSignatures,revisionsFor} from '../src/journal.js';
import {importStoryPhone,buildStoryPhonePrompt} from '../src/story-phone.js';
import {buildContinuityPrompt} from '../src/continuity.js';
import {normalizeSettings} from '../src/config.js';
import {syncCommContext} from '../src/comm-context.js';
import {outreachPrompt} from '../src/outreach.js';
const set=(collection,key,value)=>({collection,key,value});
const context={name1:'Sam',name2:'Alex',characterId:0,characters:[{name:'Alex',avatar:'alex.png'}]};
const marker=(platform,id)=>'<!--durian-message-read:'+JSON.stringify({platform,id})+'-->';

test('read receipts update actual incoming records once and roll back without treating legacy presentation as reading',async()=>{
 const apps=['sms','whatsapp','wechat','snapchat','x'];
 const chat=[{mes:'2026-11-14 09:00 消息已送达。'},{mes:'Sam 阅读了手机消息。'+apps.map(app=>marker(app,'incoming')).join('')+marker('sms','incoming')+marker('sms','outgoing')+marker('sms','future')+marker('sms','missing')+marker('call','call')},{mes:'2026-11-14 10:00'}];
 const rev=await revisionsFor(messageSignatures(chat));
 const changes=apps.map(app=>set(app==='sms'?'messages':app,'incoming',{id:'incoming',type:'message',accountId:'a',contactId:'a',role:'assistant',text:app+' body',read:false}));
 changes.push(set('messages','outgoing',{id:'outgoing',role:'user',text:'own words',read:false}),set('calls','call',{id:'call',turns:[],read:false}));
 let journal=appendChange(undefined,rev.slice(0,1),changes);
 journal=appendChange(journal,rev,[set('messages','future',{id:'future',role:'assistant',text:'later',read:false})]);
 journal=importStoryPhone(journal,rev,chat,context).journal;
 let state=replayJournal(syncCommContext(journal,rev,chat).journal);
 for(const app of apps)assert.equal(state[app==='sms'?'messages':app].incoming.read,true,app);
 assert.equal(state.messages.future.read,false);assert.equal(state.messages.outgoing.read,false);assert.equal(state.calls.call.read,false);
 assert.equal(journal.events.filter(e=>e.id.startsWith('story-read:')).length,5);
 assert.equal(importStoryPhone(journal,rev,chat,context).changed,false);
 const rolled=replayJournal(reconcileJournal(journal,rev.slice(0,1)).journal);
 for(const app of apps)assert.equal(rolled[app==='sms'?'messages':app].incoming.read,false,app+' rollback');
 const legacy=[chat[0],{mes:'Alex 提到了消息。<!--durian-message-shown:{"platform":"sms","id":"incoming"}-->'}];
 const legacyRev=await revisionsFor(messageSignatures(legacy));
 const legacyState=replayJournal(importStoryPhone(reconcileJournal(journal,rev.slice(0,1)).journal,legacyRev,legacy,context).journal);
 assert.equal(legacyState.messages.incoming.read,false);
});

test('new narrative message markers honor explicit read values for SMS, WhatsApp and X',async()=>{
 for(const read of [false,true]){
  const chat=[{mes:'Sam 的手机消息。<!--durian-contact:'+JSON.stringify({sender:'Alex',recipient:'user',name:'Alex',kind:'sms',text:'sms body',read})+'-->'+['whatsapp','x'].map(platform=>'<!--durian-message:'+JSON.stringify({platform,action:'received',sender:'Alex',recipient:'user',kind:'text',text:platform+' body',read})+'-->').join('')}];
  const rev=await revisionsFor(messageSignatures(chat));
  const state=replayJournal(importStoryPhone(undefined,rev,chat,context).journal);
  for(const app of ['messages','whatsapp','x']){
   const records=Object.values(state[app]).filter(r=>r.role==='assistant');assert.equal(records.length,1);assert.equal(records[0].read,read,app);
  }
 }
});

test('communication prompt uses platform-wide chat and call-turn quotas with independent read status',()=>{
 const state={contacts:{a:{id:'a',name:'Alex'},b:{id:'b',name:'Bea'}},messages:{},calls:{},wechat:{},whatsapp:{},snapchat:{},x:{},profiles:{},commContext:{}};
 for(const who of ['a','b']){
  for(const app of ['whatsapp','wechat','snapchat'])state[app][who]={id:who,type:'account',name:who,identityKnown:false};
  for(let i=0;i<26;i++){
   const id=who+i,role=i%2?'assistant':'user';
   state.messages[id]={id,contactId:who,role,text:'sms'+id,read:i===23,createdAt:i,storyTime:{date:'2026-11-14',time:'09:00'}};
   state.commContext['sms:'+id]={shown:i%2===0,noticeMentioned:true};
   for(const app of ['whatsapp','wechat','snapchat']){
    state[app][id]={id,type:'message',accountId:who,role,text:app+id,read:i===23,createdAt:i,storyTime:{date:'2026-11-14',time:'09:00'}};
    state.commContext[app+':'+id]={shown:i%2===0,noticeMentioned:true};
   }
   state.calls[id]={id,contactId:who,status:'ended',createdAt:i,storyTime:{date:'2026-11-14',time:'09:00'},turns:Array.from({length:15},(_,n)=>({role:n%2?'assistant':'user',text:'turn'+n}))};
  }
 }
 const before=structuredClone(state);
 const text=buildContinuityPrompt(state,{name:'Alex'},{instruction:'参考',allParticipants:true,budget:500000,currentStoryTime:{date:'2026-11-14',time:'10:00'}});
 assert.doesNotMatch(text,/shown|已展示|未展示|sceneScope/);
 const records=JSON.parse(text.split('\n').at(-2)).records;
 for(const platform of ['sms','whatsapp','wechat','snapchat']){
  const all=records.filter(r=>r.platform===platform);
  assert.equal(all.length,platform==='snapchat'?40:20,platform+' platform limit');
  for(const who of ['a','b']){
   const rows=all.filter(r=>r.conversation===who);
   const start=platform==='snapchat'?6:16;
   assert.deepEqual(rows.map(r=>r.recordId),Array.from({length:26-start},(_,i)=>who+(i+start)));
   assert.equal(rows.find(r=>r.recordId===who+'23').read,true,'read status survives shared quota');
   assert.equal(rows.find(r=>r.recordId===who+'22').read,undefined,'outgoing has no receiver read flag');
   assert.equal(rows.find(r=>r.recordId===who+'21').read,false,'incoming unread survives');
  }
 }
 const calls=records.filter(r=>r.platform==='call'&&r.kind==='call-turn');
 assert.equal(calls.length,20,'multiple calls and contacts share exactly 20 turns');
 assert.ok(calls.every(r=>r.text.startsWith('turn')&&!('turns' in r)));
 assert.equal(calls.filter(r=>r.recordId==='b25').length,15);
 assert.equal(calls.filter(r=>r.recordId==='a25').length,5);
 assert.deepEqual(state,before);
 const settings=normalizeSettings({apps:{x:false}});
 for(const prompt of [buildStoryPhonePrompt(state,context,settings,[]),outreachPrompt(settings,state,'Sam',true,null)]){
  assert.doesNotMatch(prompt,/shown|已展示|未展示/);
  assert.match(prompt,/read/);assert.match(prompt,/除非剧情需要，否则不用主动提起，不要求一定展示/);
 }
});
