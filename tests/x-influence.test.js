import test from 'node:test';
import assert from 'node:assert/strict';
import {dateDay} from '../src/story-clock.js';
import {settleInfluence,brandImpact} from '../src/x-influence.js';
import {pageEdits,pageFields} from '../src/x-edit.js';
const first=dateDay('2026-06-01');
const story=day=>[{mes:'2026-06-'+String(day).padStart(2,'0')+'\nSam won a public award.'}];
const initial=()=>({x:{profile:{alias:'Moon'},p:{id:'p',type:'post',author:'user',text:'Story',postedAtStory:{day:first}}}});
const effect=(gained,lost)=>({postId:'p',gained,lost,likes:230,reposts:15,replies:12});
const apply=(s,chat,effects)=>{for(const row of settleInfluence(s,chat,effects,1000))s.x[row.key]=row.value;return s.x.audience.followers;};
test('ordinary positive, zero or negative impact is assessed once',()=>{
 for(const n of [-30,-1,0,1,180]){
  const s=initial(),e=effect(Math.max(n,0),Math.max(-n,0));assert.equal(apply(s,story(1),[e]),1000+n);
  assert.equal(apply(s,story(1),[e]),1000+n);
 }
});
test('seven-day decay has stable signed daily deltas, catch-up is bounded even across a time jump',()=>{
 for(const sign of [-1,1]){
  const s=initial(),e=effect(sign===1?96:16,sign===1?16:96);
  let prev=1000,last=Infinity;
  for(let day=1;day<=8;day++){
   const priorImpact=s.x['impact:post:p']?.total||0,total=apply(s,story(day),[e]),step=s.x['impact:post:p'].total-priorImpact,delta=Math.abs(step);
   assert.ok(delta<=last);assert.equal(day===8?delta:Math.sign(step),day===8?0:sign);
   assert.equal(apply(s,story(day),[e]),total);last=delta;prev=total;
  }
  assert.equal(s.x['impact:post:p'].settled,7);assert.equal(s.x['impact:post:p'].expired,true);
  const jump=initial();apply(jump,story(1),[e]);assert.equal(apply(jump,story(14),[]),prev);
  const later=apply(jump,story(14),[e]);assert.equal(later,prev);
 }
});
test('unidentified private and unknown post IDs cannot alter the audience; brand loss is settled only once',()=>{
 const s=initial();assert.throws(()=>apply(s,story(1),[{...effect(200,0),postId:'invented'}]));
 const brand=brandImpact('deal',first,20,0,true);s.x[brand.id]=brand;
 assert.equal(apply(s,story(1),[]),1000);assert.ok(apply(s,story(2),[])<1000);
});
test('independent new public progress can reverse daily net direction; total cannot go below zero',()=>{
 const s=initial();apply(s,story(1),[effect(0,70)]);
 s.x.q={id:'q',type:'post',author:'user',text:'Public response',postedAtStory:{day:first+1}};
 assert.ok(apply(s,story(2),[{...effect(500,50),postId:'q'}])>1000);
 assert.ok(s.x['impact:post:q']);const low=initial();assert.equal(apply(low,story(1),[effect(0,99999)]),0);
});
test('editor only saves fields from the selected page, keeps hidden media and other threads private',()=>{
 const s={x:{a:{id:'a',type:'account',name:'A',inboundRequest:'pending'},m:{id:'m',type:'message',accountId:'a',text:'hello'},h:{id:'h',type:'message',accountId:'a',kind:'image',text:'secret'},n:{id:'n',type:'message',accountId:'b',text:'other'}}};
 const scope={tab:'messages',accountId:'a'},fields=pageFields(s,scope);assert.deepEqual(fields.map(f=>f.id),['m']);
 const edit={...fields[0],before:'hello',value:'hi'};
 assert.equal(pageEdits(s,scope,[edit])[0].value.text,'hi');assert.throws(()=>pageEdits(s,scope,[{...edit,id:'n'}]));assert.throws(()=>pageEdits(s,scope,[{...edit,before:'stale'}]));
});

test('inactivity rounds separately per seven complete story days, never before a first post or without a known date',()=>{
 const s=initial();s.x.audience={id:'audience',type:'audience',initialFollowers:10000,followers:10000};
 for(const [d,total] of [[7,10000],[8,9900],[15,9801],[22,9703],[22,9703]])assert.equal(apply(s,story(d),[]),total);
 const jump=initial();jump.x.audience={id:'audience',type:'audience',initialFollowers:10000,followers:10000};
 assert.equal(apply(jump,story(22),[]),9703);
 const none=initial();delete none.x.p;assert.equal(apply(none,story(22),[]),1000);
 const tiny=initial();tiny.x.audience={initialFollowers:49,followers:49};assert.equal(apply(tiny,story(22),[]),49);
});

test('two new posts about the same person retain their own high or low data at any follower count',()=>{
 for(const followers of [3,5000000]){
  const s=initial();
  s.x.audience={id:'audience',type:'audience',initialFollowers:followers,followers};
  s.x.q={...s.x.p,id:'q'};
  const hot={postId:'p',likes:1500000000,reposts:23000,replies:900,gained:12000,lost:6};
  const quiet={postId:'q',likes:1,reposts:0,replies:0,gained:1,lost:0};
  assert.equal(apply(s,story(1),[hot,quiet]),followers+11995);
  assert.equal(s.x.p.metrics.likes,hot.likes);assert.equal(s.x.q.metrics.likes,1);
  assert.equal(apply(s,story(1),[quiet,hot]),followers+11995);
 }
});
