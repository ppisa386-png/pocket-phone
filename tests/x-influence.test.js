import test from 'node:test';
import assert from 'node:assert/strict';
import {dateDay} from '../src/story-clock.js';
import {settleInfluence,brandImpact} from '../src/x-influence.js';
import {pageEdits,pageFields} from '../src/x-edit.js';
const first=dateDay('2026-06-01');
const story=day=>[{mes:'2026-06-'+String(day).padStart(2,'0')+'\nSam won a public award.'}];
const initial=()=>({x:{profile:{alias:'Moon'},p:{id:'p',type:'post',author:'user',text:'Story',postedAtStory:{day:first}}}});
const effect=(gained,lost,mode='long')=>({sourceId:'post:p',mode,gained,lost,basis:'曝光和受众反应'});
const apply=(s,chat,effects)=>{for(const row of settleInfluence(s,chat,'Sam',{initialFollowers:1000,effects}))s.x[row.key]=row.value;return s.x.audience.followers;};
test('ordinary positive, zero or negative impact is assessed once',()=>{
 for(const n of [-2,-1,0,1,2]){
  const s=initial(),e=effect(Math.max(n,0),Math.max(-n,0),'ordinary');assert.equal(apply(s,story(1),[e]),1000+n);
  assert.equal(apply(s,story(2),[e]),1000+n);
 }
});
test('seven-day decay has stable signed daily deltas, catch-up is bounded even across a time jump',()=>{
 for(const sign of [-1,1]){
  const s=initial(),e=effect(sign===1?96:16,sign===1?16:96);
  let prev=1000,last=Infinity;
  for(let day=1;day<=8;day++){
   const total=apply(s,story(day),[e]),delta=Math.abs(total-prev);
   assert.ok(delta<=last);assert.equal(day===8?delta:Math.sign(total-prev),day===8?0:sign);
   assert.equal(apply(s,story(day),[e]),total);last=delta;prev=total;
  }
  assert.equal(s.x['impact:post:p'].settled,7);assert.equal(s.x['impact:post:p'].expired,true);
  const jump=initial();apply(jump,story(1),[e]);assert.equal(apply(jump,story(14),[]),prev);
  const late=initial();assert.equal(apply(late,story(8),[e]),1000);
 }
});
test('unknown story time, anonymous real-world fame, prior credits and brand incident do not duplicate growth',()=>{
 const s=initial(),e={...effect(20,1),sourceId:'story:0',evidence:'Sam won a public award.',public:true};
 assert.equal(apply(s,story(1),[e]),1000);s.x.audience.credited={'post:p':30};
 assert.equal(apply(s,story(1),[effect(99,0)]),1000);
 const chat=[{mes:'2026-06-01\nThe press publicly identified Moon as Sam.'},...story(2)];
 assert.equal(apply(s,chat,[{...e,sourceId:'story:1',identityFloor:0,identityEvidence:'publicly identified Moon as Sam'}]),1019);
 const after=apply(s,[{mes:'No calendar here.'}],[]);assert.equal(after,1019);
 const b=brandImpact('p',first,25,0,true);s.x[b.id]=b;s.x.profile.alias='Sam';
 assert.equal(apply(s,story(1),[e]),1019);assert.equal(s.x['impact:story:0'],undefined);
});
test('independent new public progress can reverse daily net direction; total cannot go below zero',()=>{
 const s=initial();apply(s,story(1),[effect(0,70)]);
 s.x.q={id:'q',type:'post',author:'user',text:'Public response',postedAtStory:{day:first+1}};
 assert.ok(apply(s,story(2),[{...effect(500,50),sourceId:'post:q'}])>1000);
 assert.ok(s.x['impact:post:q']);const low=initial();assert.equal(apply(low,story(1),[effect(0,99999)]),0);
});
test('editor only saves fields from the selected page, keeps hidden media and other threads private',()=>{
 const s={x:{a:{id:'a',type:'account',name:'A',inboundRequest:'pending'},m:{id:'m',type:'message',accountId:'a',text:'hello'},h:{id:'h',type:'message',accountId:'a',kind:'image',text:'secret'},n:{id:'n',type:'message',accountId:'b',text:'other'}}};
 const scope={tab:'messages',accountId:'a'},fields=pageFields(s,scope);assert.deepEqual(fields.map(f=>f.id),['m']);
 const edit={...fields[0],before:'hello',value:'hi'};
 assert.equal(pageEdits(s,scope,[edit])[0].value.text,'hi');assert.throws(()=>pageEdits(s,scope,[{...edit,id:'n'}]));assert.throws(()=>pageEdits(s,scope,[{...edit,before:'stale'}]));
});
