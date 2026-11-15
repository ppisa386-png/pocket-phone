import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContinuityPrompt} from '../src/continuity.js';
import {xPublicHistoryRecords} from '../src/x-history.js';
import {xUserReplyChain} from '../src/x-comments.js';

const now={date:'2026-11-15',time:'12:00'};
const at=(date='2026-11-15',time='10:00')=>({date,time});
const make=()=>({contacts:{},messages:{},calls:{},whatsapp:{},wechat:{},x:{profile:{id:'profile',type:'profile',alias:'Moon'}},commContext:{}});
const person={name:'Alex',avatar:'alex.png',nameIsUnique:true};
const full=(s,clock=now,opts={})=>buildContinuityPrompt(s,person,{instruction:'延续事实',allParticipants:true,budget:300000,currentStoryTime:clock,...opts});
const rows=(s,clock=now,opts={})=>{const p=full(s,clock,opts);return p?JSON.parse(p.split('\n').at(-2)).records:[];};
const contact=(s,id)=>s.contacts[id]={id,name:id};
const account=(s,id)=>s.x[id]={id,type:'account',name:id,handle:'@'+id,identityKnown:false};
const msg=(id,role='user',time='10:00',extra={})=>({id,role,text:'original:'+id,
 createdAt:Date.parse('2026-11-15T'+time+':00Z'),storyTime:at('2026-11-15',time),...extra});

test('SMS latest 20 are shared across three contacts and both directions',()=>{
 const s=make();['A','B','C'].forEach(c=>contact(s,c));
 for(let i=0;i<45;i++){
  const id='sms'+i;
  s.messages[id]=msg(id,i%2?'assistant':'user','10:'+String(i).padStart(2,'0'),{contactId:['A','B','C'][i%3]});
 }
 const selected=rows(s).filter(r=>r.platform==='sms');
 assert.deepEqual(selected.map(r=>r.recordId),Array.from({length:20},(_,i)=>'sms'+(i+25)));
 assert.equal(selected.filter(r=>r.speaker==='user').length,10);
 assert.equal(new Set(selected.map(r=>r.conversation)).size,3);
 assert.ok(selected.every(r=>r.sender&&r.recipient));
});

test('SMS, WhatsApp, WeChat, X DMs have independent shared quotas and read fields',()=>{
 const s=make();contact(s,'A');account(s,'A');account(s,'B');
 for(const app of ['whatsapp','wechat'])for(const id of ['A','B'])s[app][id]={id,type:'account',name:id,identityKnown:false};
 for(let i=0;i<32;i++){
  const id='m'+i,time='10:'+String(i).padStart(2,'0'),role=i%2?'assistant':'user';
  s.messages[id]=msg(id,role,time,{contactId:'A'});
  for(const app of ['whatsapp','wechat','x']){
   const mid=app+id;
   s[app][mid]=msg(mid,role,time,{type:'message',accountId:i%3?'A':'B',status:'sent',read:i%4===1});
  }
 }
 s.x.pending=msg('pending','user','11:00',{type:'message',accountId:'A',status:'pending'});
 s.whatsapp.failed=msg('failed','user','11:00',{type:'message',accountId:'A',status:'failed'});
 const all=rows(s);
 for(const app of ['sms','whatsapp','wechat','x']){
  const selected=all.filter(r=>r.platform===app);
  assert.equal(selected.length,20,app);
  assert.deepEqual(selected.map(r=>r.storyTime.time),Array.from({length:20},(_,i)=>'10:'+(i+12)));
  assert.ok(selected.every(r=>!['pending','failed'].includes(r.recordId)));
 }
 const dm=all.filter(r=>r.platform==='x');
 assert.ok(dm.some(r=>r.read===true)&&dm.some(r=>r.read===false));
 assert.ok(dm.every(r=>r.identityKnown===false&&r.boundary&&r.sender&&r.recipient));
});

test('each call turns entry counts once across calls; missed status consumes zero turn quota',()=>{
 const s=make();['A','B','C'].forEach(c=>contact(s,c));
 for(const [i,n] of [8,9,12].entries()){
  const id='call'+i;
  s.calls[id]={id,contactId:['A','B','C'][i],status:'ended',
   storyTime:at('2026-11-15','10:0'+i),createdAt:i,
   turns:Array.from({length:n},(_,j)=>({role:j%2?'user':'assistant',text:id+':'+j}))};
 }
 s.calls.missed={id:'missed',contactId:'B',status:'missed',
  storyTime:at('2026-11-15','11:00'),turns:[]};
 const selected=rows(s);
 const turns=selected.filter(r=>r.platform==='call'&&r.kind==='call-turn');
 assert.equal(turns.length,20);
 assert.deepEqual(turns.map(r=>r.text),[
  ...Array.from({length:8},(_,j)=>'call1:'+(j+1)),
  ...Array.from({length:12},(_,j)=>'call2:'+j)]);
 assert.equal(selected.filter(r=>r.kind==='call-status').length,1);
 assert.equal(selected.find(r=>r.kind==='call-status').recordId,'missed');
 assert.ok(turns.every(r=>!('turns' in r)&&r.speaker&&r.recordId&&Number.isInteger(r.turnIndex)));
});

test('voice and video share twenty turns in each social app, independent from ordinary phone',()=>{
 const s=make();contact(s,'A');account(s,'A');
 for(const app of ['wechat','whatsapp']){
  s[app].A={id:'A',type:'account',name:'A',identityKnown:false};
  for(let i=0;i<2;i++){
   const id=app+'-call'+i;
   s[app][id]={id,type:'call',accountId:'A',status:'ended',mode:i?'video':'voice',
    storyTime:at('2026-11-15','10:0'+i),createdAt:i,
    turns:Array.from({length:15},(_,j)=>({role:'assistant',text:id+':'+j}))};
  }
 }
 s.calls.p={id:'p',contactId:'A',status:'ended',storyTime:at('2026-11-15','11:00'),
  turns:Array.from({length:20},(_,i)=>({role:'assistant',text:'phone:'+i}))};
 const actual=rows(s);
 for(const app of ['wechat','whatsapp']){
  const calls=actual.filter(r=>r.platform===app&&r.kind==='call-turn');
  assert.equal(calls.length,20,app);
  assert.equal(calls.filter(r=>r.mode==='voice').length,5);
  assert.equal(calls.filter(r=>r.mode==='video').length,15);
 }
 assert.equal(actual.filter(r=>r.platform==='call'&&r.kind==='call-turn').length,20);
});

test('X public history shares twenty total slots across posts, replies and actions',()=>{
 const s=make();account(s,'NPC');
 for(let i=0;i<5;i++){
  s.x['post'+i]={id:'post'+i,type:'post',author:'user',text:'POST:'+i,imageDescription:'IMAGE:'+i,
   storyTime:at('2026-11-15','10:0'+i)};
 }
 s.x.root={id:'root',type:'post',author:'NPC',text:'NPC ROOT',storyTime:at('2026-11-14','09:00')};
 for(let i=0;i<5;i++){
  s.x['reply'+i]={id:'reply'+i,type:'comment',postId:'root',author:'user',text:'REPLY:'+i,
   storyTime:at('2026-11-15','10:0'+(i+5))};
 }
 const actions=['follow','unfollow','like','unlike','repost','unrepost'];
 for(let i=0;i<20;i++)s.x['event'+i]={id:'event'+i,type:'public-history',action:actions[i%6],
  accountId:'NPC',targetId:'NPC',slot:'follow',storyTime:at('2026-11-15','10:'+(i+10)),createdAt:i};
 const events=rows(s).filter(r=>r.platform==='x-public');
 assert.equal(events.length,20);
 assert.ok(events.every(r=>r.eventId.startsWith('action:')));
 assert.equal(events[0].action,'follow');assert.equal(events.at(-1).recordId,'event19');
});

test('a current user reply carries complete ancestors despite an old original post',()=>{
 const s=make();['A','B','C'].forEach(id=>account(s,id));
 s.x.post={id:'post',type:'post',author:'A',text:'A ORIGINAL',imageDescription:'ORIGINAL PHOTO',
  storyTime:at('2026-10-01','09:00')};
 s.x.ancestor={id:'ancestor',type:'comment',postId:'post',author:'B',text:'B COMMENT',
  storyTime:at('2026-10-01','09:01')};
 s.x.child={id:'child',type:'comment',postId:'post',author:'C',text:'C REPLY',
  replyTo:'ancestor',storyTime:at('2026-10-01','09:02')};
 s.x.mine={id:'mine',type:'comment',postId:'post',author:'user',text:'USER REPLY',
  replyTo:'child',storyTime:at('2026-11-15','10:00')};
 s.x.unrelated={id:'unrelated',type:'comment',postId:'post',author:'B',text:'OTHER COMMENT',
  storyTime:at('2026-11-15','09:00')};
 const chain=xUserReplyChain(s,'mine');
 assert.deepEqual(chain.comments.map(c=>c.id),['ancestor','child','mine']);
 assert.deepEqual(chain.comments.map(c=>c.replyTo),[null,'ancestor','child']);
 const events=rows(s).filter(r=>r.platform==='x-public');
 assert.equal(events.length,1);
 assert.equal(events[0].post.text,'A ORIGINAL');
 assert.equal(events[0].post.imageDescription,'ORIGINAL PHOTO');
 assert.deepEqual(events[0].comments.map(c=>c.text),['B COMMENT','C REPLY','USER REPLY']);
 assert.doesNotMatch(JSON.stringify(events),/OTHER COMMENT/);
});

test('opposite actions survive coalesced home activity; history never consumes the queue',()=>{
 const s=make();account(s,'A');
 s.x.queue={id:'queue',type:'public-activity',slot:'follow',targetId:'A',
  accountId:'A',action:'unfollow',shown:false,storyTime:at('2026-11-15','10:01')};
 s.x.first={id:'first',type:'public-history',sourceActivityId:'queue',accountId:'A',
  action:'follow',storyTime:at('2026-11-15','10:00')};
 s.x.second={id:'second',type:'public-history',sourceActivityId:'queue',accountId:'A',
  action:'unfollow',storyTime:at('2026-11-15','10:01')};
 assert.deepEqual(xPublicHistoryRecords(s,now).map(e=>e.data.action),['follow','unfollow']);
 assert.equal(s.x.queue.shown,false);
});

test('strict story time: 168-hour boundary, date-only, future, unknown and rollback',()=>{
 const s=make();contact(s,'A');
 for(const [id,stamp] of [['edge',at('2026-11-08','12:00')],
  ['old',at('2026-11-08','11:59')],['date',at('2026-11-09','')],
  ['oldDate',at('2026-11-08','')],['future',at('2026-11-16','10:00')],['unknown',at('','')]])
  s.messages[id]={id,contactId:'A',role:'user',text:id,storyTime:stamp};
 assert.deepEqual(new Set(rows(s).map(r=>r.recordId)),new Set(['edge','date']));
 assert.deepEqual(rows(s,{date:'invalid',time:'12:00'}),[]);
 const before=structuredClone(s);rows(s,{date:'2026-11-10',time:'12:00'});
 assert.deepEqual(s,before);
});

test('context budget leaves oversized messages and entire X parent chain out intact',()=>{
 const s=make();contact(s,'A');account(s,'B');
 s.messages.large=msg('large','assistant','10:00',{contactId:'A',text:'OVERLONG'+('x'.repeat(7000))});
 s.messages.short=msg('short','user','11:00',{contactId:'A',text:'SHORT'});
 s.x.post={id:'post',type:'post',author:'B',text:'ROOT '+('z'.repeat(3000)),
  storyTime:at('2026-11-14','10:00')};
 s.x.reply={id:'reply',type:'comment',postId:'post',author:'user',
  text:'REPLY TEXT',storyTime:at('2026-11-15','11:30')};
 const data=JSON.parse(full(s,now,{budget:1600}).split('\n').at(-2));
 assert.equal(data.partial,true);
 assert.ok(data.records.some(r=>r.text==='SHORT'));
 assert.ok(data.records.every(r=>!r.text?.includes('OVERLONG')));
 assert.doesNotMatch(JSON.stringify(data.records),/REPLY TEXT/);
 assert.equal(s.messages.large.text.length,7008);
});
