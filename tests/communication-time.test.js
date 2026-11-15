import test from 'node:test';
import assert from 'node:assert/strict';
import {communicationTime,withinCommunicationWeek,displayCommunicationTime} from '../src/communication-time.js';
import {buildContinuityPrompt} from '../src/continuity.js';
import {createChatPanel} from '../src/chat-view.js';
import {createXPanel} from '../src/x-view.js';
import {createSnapPanel} from '../src/snapchat-view.js';
import {createPhoneMemory} from '../src/memory.js';
const now={date:'2026-11-15',time:'12:00'};
const chat=[{mes:'2026-11-15 12:00'}];
const record=(date,time='12:00')=>({storyTime:{date,time}});

test('seven-day window uses full story timestamps including the boundary, without a device-clock fallback',()=>{
 for(const [date,time,expected] of [['2026-11-15','12:00',true],['2026-11-15','12:01',false],['2026-11-08','12:00',true],['2026-11-08','11:59',false],['2026-11-09','',true],['2026-11-08','',false],['2026-11-16','',false],['2026-02-30','12:00',false],['','12:00',false]])
  assert.equal(withinCommunicationWeek({date,time},now),expected,date+' '+time);
 assert.equal(withinCommunicationWeek(now,{}),false);
 assert.equal(communicationTime({createdAt:Date.now()}).date,'');
 assert.deepEqual(communicationTime({storyTime:{time:'10:30'}},{anchor:{date:'2026-11-14',time:'10:00',precision:'exact'}}),{date:'2026-11-14',time:'10:30',precision:'exact'});
 assert.equal(communicationTime(record('2026-11-01'),{sentAfterQueue:true,anchor:now}).date,now.date);
});

test('relative timestamps switch after 24 hours and use yesterday, day before, weekdays, then the full date',()=>{
 const cases=[['2026-11-15','10:30','10:30'],['2026-11-14','12:00','12:00'],['2026-11-14','11:59','昨天 11:59'],['2026-11-13','09:10','前天 09:10'],['2026-11-12','08:20','周四 08:20'],['2026-11-09','08:00','周一 08:00'],['2026-11-08','08:00','2026-11-08 08:00'],['2026-11-16','08:00','2026-11-16 08:00']];
 for(const [date,time,label] of cases)assert.equal(displayCommunicationTime(record(date,time),chat),label);
 assert.equal(displayCommunicationTime(record('2026-11-14',''),chat),'昨天');
 assert.equal(displayCommunicationTime(record('2026-11-14','09:00'),[]),'2026-11-14 09:00');
 assert.equal(displayCommunicationTime({createdAt:Date.now()},chat),'—');
 assert.equal(displayCommunicationTime(record('2026-11-13','09:10'),[{mes:'2026-11-14 08:00'}]),'09:10','date rollback recomputes labels');
});

test('narrative filters dates before selecting twenty records and does not lose a seven-day record to old A/B expiration',()=>{
 const state={contacts:{a:{id:'a',name:'Alex'}},calls:{},messages:{},commContext:{},whatsapp:{},wechat:{}};
 for(const platform of ['sms','whatsapp','wechat']){
  const collection=platform==='sms'?'messages':platform;
  if(platform!=='sms')state[collection].a={id:'a',type:'account',name:'Alex',identityKnown:true};
  for(let i=0;i<26;i++){
   const id=platform+i;
   state[collection][id]={id,type:'message',contactId:'a',accountId:'a',role:i%2?'user':'assistant',text:id,createdAt:i,...record('2026-11-12','12:00')};
   state.commContext[platform+':'+id]={expired:true,shown:true,category:'A',anchor:{date:'2026-11-12',time:'12:00'}};
  }
  for(const [id,stamp] of [['old',record('2026-11-08','11:59')],['future',record('2026-11-15','12:01')],['unknown',{}]])state[collection][id]={id,type:'message',contactId:'a',accountId:'a',role:'assistant',text:id,createdAt:9999,...stamp};
 }
 const before=structuredClone(state),text=buildContinuityPrompt(state,{name:'Alex'},{instruction:'参考',allParticipants:true,currentStoryTime:now,budget:100000});
 const rows=JSON.parse(text.split('\n').at(-2)).records;
 for(const platform of ['sms','whatsapp','wechat'])assert.deepEqual(rows.filter(r=>r.platform===platform).map(r=>r.recordId),Array.from({length:20},(_,i)=>platform+(i+6)));
 assert.ok(rows.every(r=>r.storyTime.date==='2026-11-12'&&r.storyTime.time==='12:00'&&r.storyDaysAgo===3));
 assert.deepEqual(state,before);
 assert.equal(buildContinuityPrompt(state,{name:'Alex'},{instruction:'参考',allParticipants:true,currentStoryTime:{date:'2026-11-23',time:'12:00'}}),'');
});

test('all social conversation views show relative dates and X retains a full machine-readable timestamp',async()=>{
 for(const app of ['wechat','whatsapp','snapchat','x']){
  const state={contacts:{},profiles:{},commContext:{},[app]:{profile:{alias:'Sam'},a:{id:'a',type:'account',name:'Alex',friend:'friends',dmAccepted:true},m:{id:'m',type:'message',accountId:'a',role:'assistant',kind:'text',text:'Date check',read:true,createdAt:1,...record('2026-11-13','09:10')}}};
  const opts={app,adapter:{userName:()=>'Sam',storyChat:()=>chat},getView:()=>state,redraw(){},notice(){}};
  const panel=app==='x'?createXPanel(opts):app==='snapchat'?createSnapPanel(opts):createChatPanel(opts);
  await panel.action('thread','a');
  const html=panel.html();assert.match(html,/前天 09:10/,app);
  if(app==='x')assert.match(html,/datetime="2026-11-13T09:10"/);
 }
});

test('message storage stamps actual sending time, preserves it on reads, and keeps fuzzy times unknown',async()=>{
 const context={chatId:'time-storage',characterId:0,chat:[{mes:'2026-11-12 09:10'}],chatMetadata:{},saveMetadata:async()=>{}};
 const memory=createPhoneMemory({getContext:()=>context});
 try{
  const queued={id:'draft',type:'message',accountId:'a',role:'user',text:'Hello',status:'queued'};
  await memory.commit(await memory.begin(),[{collection:'wechat',key:'draft',value:queued}]);
  context.chat.push({mes:'2026-11-14 15:20'});
  let state=(await memory.read()).state;
  await memory.commit(await memory.begin(),[{collection:'wechat',key:'draft',value:{...state.wechat.draft,status:'sent'}}]);
  state=(await memory.read()).state;assert.deepEqual(state.wechat.draft.storyTime,{date:'2026-11-14',time:'15:20',precision:'exact'});
  context.chat.push({mes:'2026-11-15 上午'});
  await memory.commit(await memory.begin(),[{collection:'wechat',key:'draft',value:{...state.wechat.draft,read:true}},{collection:'whatsapp',key:'reply',value:{id:'reply',type:'message',accountId:'a',role:'assistant',text:'Hello'}}]);
  state=(await memory.read()).state;assert.equal(state.wechat.draft.storyTime.time,'15:20');assert.deepEqual(state.whatsapp.reply.storyTime,{date:'2026-11-15',time:'',precision:'exact'});
 }finally{memory.destroy();}
});
