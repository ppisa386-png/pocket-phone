import test from 'node:test';
import assert from 'node:assert/strict';
import {appendChange,replayJournal,reconcileJournal} from '../src/journal.js';
import {storyAnnotations,buildStoryPhonePrompt} from '../src/story-phone.js';
import {normalizeSettings} from '../src/config.js';
import {businessPrompt,importBusiness,dmDealTask,dealDecision,initialHighRiskForRoll} from '../src/x-business.js';

const settings=normalizeSettings({proactiveEnabled:false}),off={...settings,apps:{...settings.apps,x:false}};
const offer={kind:'offer',brand:'Green Tea',project:'Spring tasting',terms:'一条体验推文，200元',text:'您好，想邀请您体验春茶并发一条推文，报酬200元。'};
const plan='plan:'+JSON.stringify(['green tea','spring tasting']);
const floor=(...rows)=>({mes:'品牌和我完成了这次沟通。'+rows.map(r=>'<!--durian-business:'+JSON.stringify({...r,evidence:'完成了这次沟通'})+'-->').join('')});
function sim(followers=1000){
    const chat=[{mes:'2026-01-01'}],rev=['r0'];
    let journal=appendChange(undefined,rev,[{collection:'x',key:'audience',value:{id:'audience',type:'audience',followers,initialFollowers:followers}},
        {collection:'x',key:'profile',value:{alias:'anon',requestsOpen:true}}]);
    return {chat,rev,get journal(){return journal},set journal(v){journal=v},state:()=>replayJournal(journal),
        push(msg=floor(),cfg=settings){chat.push(msg);rev.push('r'+chat.length);journal=importBusiness(journal,rev,chat,cfg,storyAnnotations).journal;},
        wait(n,cfg=settings){for(let i=0;i<n;i++)this.push(floor(),cfg);},
        invite(){this.wait(14);this.push(floor(offer,offer));},
        prompt(){return businessPrompt(this.state(),settings,chat,'真人名');}};
}
test('eligibility, fifteen effective floors, privacy, public post limit and quote inputs',()=>{
    const low=sim(999);low.invite();assert.equal(low.state().business[plan],undefined);
    const s=sim();s.push({is_user:true,mes:'hi'});s.push({mes:'<!--retry-->'});s.wait(13);s.push(floor(offer));
    assert.equal(s.state().business[plan],undefined);
    const state=s.state();for(let i=0;i<25;i++)state.x['p'+i]={type:'post',author:'user',text:'post_'+i+'_',metrics:{likes:i}};
    const prompt=buildStoryPhonePrompt(state,{name1:'真人名'},settings,s.chat);
    assert.match(prompt,/X专项商业邀约/);assert.match(prompt,/post_5_/);assert.doesNotMatch(prompt,/post_4_/);
    assert.match(prompt,/影响力提高/);s.push(floor(offer,offer));
    const p=s.state().business[plan],a=s.state().x[p.accountId];assert.equal(a.inboundRequest,'pending');assert.equal(a.identityKnown,false);
    assert.equal(p.status,'invited');assert.deepEqual(s.state().assets,{});
    assert.equal(Object.values(s.state().x).filter(v=>v.type==='message').length,1);
    assert.doesNotMatch(s.prompt(),/靠谱|tracking|隐藏商业风险/);
});
test('fixed draw survives reload, deleted invitation and reimport; same brand distinct project',()=>{
    const s=sim();s.invite();const mark=s.journal.businessDraws[plan],roll=s.journal.businessRolls[plan];
    s.journal=reconcileJournal(JSON.parse(JSON.stringify(s.journal)),s.rev.slice(0,-1)).journal;
    assert.equal(s.state().business[plan],undefined);s.chat.pop();s.rev.pop();s.push(floor(offer));
    assert.equal(s.journal.businessDraws[plan],mark);
    assert.equal(s.journal.businessRolls[plan],roll,'acceptance draw survives regeneration');
    const p=s.state().business[plan],a=s.state().x[p.accountId];
    s.journal=appendChange(s.journal,s.rev,[{collection:'x',key:a.id,value:{...a,dmAccepted:true,inboundRequest:'accepted'}}]);
    s.wait(14);s.push(floor({...offer,project:'Autumn tasting'}));assert.equal(Object.keys(s.journal.businessDraws).length,2);
});
test('invitation, refusal, investigation and ordinary-brand probability respect the final acceptance draw',()=>{
    for(const [actions,flag,status,risk,rate] of [
        [[],true,'invited',undefined,undefined],
        [['reject'],true,'declined',undefined,undefined],
        [['investigate','accept'],true,'active','tracking',100],
        [['accept'],false,'active',null,1]
    ]){
        const s=sim();s.invite();s.journal.businessDraws[plan]=flag;
        s.journal.businessRolls[plan]=65535;
        s.push(floor(...actions.map(kind=>({kind,id:plan}))));
        const p=s.state().business[plan];
        assert.equal(p.status,status);assert.equal(p.risk,risk);assert.equal(p.decisionRate,rate);
        if(actions.includes('investigate'))assert.equal(p.riskRate,100);
        assert.deepEqual(s.state().assets,{});
    }
});
test('risk cadence, minimum date, one loss, disabled pause, reversal and expiry without invented payment',()=>{
    const s=sim();s.invite();s.journal.businessDraws[plan]=true;s.push(floor({kind:'accept',id:plan}));
    assert.equal(s.state().business[plan].risk,'tracking');s.wait(9);
    assert.match(s.prompt(),/已过 0 天/);assert.equal(businessPrompt(s.state(),off,s.chat,'user'),'');
    const incident=floor({kind:'incident',id:plan,loss:140});
    s.push(incident);assert.equal(s.state().x.audience.followers,1000);
    s.wait(2,off);s.wait(8);assert.doesNotMatch(s.prompt(),/隐藏商业风险/);
    s.push({mes:'2026-01-04'});assert.match(s.prompt(),/已过 3 天/);assert.match(s.prompt(),/越近期/);
    const before=s.rev.length;s.push(incident);s.push(incident);assert.equal(s.state().x.audience.followers,860);
    assert.equal(s.state().business[plan].risk,'triggered');assert.deepEqual(s.state().assets,{});
    s.journal=reconcileJournal(s.journal,s.rev.slice(0,before)).journal;s.rev.length=s.chat.length=before;
    assert.equal(s.state().x.audience.followers,1000);s.push({mes:'2027-01-02\n'+incident.mes});
    assert.equal(s.state().business[plan].risk,'expired');assert.equal(s.state().x.audience.followers,1000);
});
test('disabled X pauses eligible counter; DM classification sees only this brand and no hidden state',()=>{
    const s=sim();s.wait(14);s.wait(3,off);s.push(floor(offer));const p=s.state().business[plan];
    assert.ok(p);assert.equal(dmDealTask(s.state(),'other'),'');assert.match(dmDealTask(s.state(),p.accountId),/不等于合作/);
    assert.deepEqual(dealDecision(p,'request',10,1,true),[]);
});
test('business import obeys closed stranger inbox, pending, declined and blocked states',()=>{
    for(const mode of ['closed','pending','declined','blocked']){
        const s=sim();
        const account={id:'brand',type:'account',name:offer.brand,inboundRequest:mode==='blocked'?null:mode,blocked:mode==='blocked'};
        const change=mode==='closed'?{key:'profile',value:{alias:'anon',requestsOpen:false}}:{key:'brand',value:account};
        s.journal=appendChange(s.journal,s.rev,[{...change,collection:'x'}]);s.invite();
        assert.equal(s.state().business[plan],undefined);assert.equal(s.journal.businessDraws,undefined);
    }
});

test('confirmed research reveals initial 100% or 1% without cancelling risk',()=>{
 for(const flag of [true,false]){
  const s=sim();s.invite();s.journal.businessDraws[plan]=flag;
  s.push(floor({kind:'investigate',id:plan,findings:flag?'产品安全投诉记录与样品不符':'资质与订单反馈均正常'}));
  const p=s.state().business[plan];
  assert.equal(p.investigated,true);assert.equal(p.riskRate,flag?100:1);
  assert.match(p.findings,flag?/样品不符/:/资质与订单/);
  assert.equal(p.status,'invited');
  assert.doesNotMatch(s.prompt(),/隐藏商业风险/);
 }
});

test('successful precautions reduce high-risk only before signing, then draw at remaining rate',()=>{
 const s=sim();s.invite();s.journal.businessDraws[plan]=true;s.journal.businessRolls[plan]=32768;
 s.push(floor({kind:'mitigate',id:plan,measure:'仅提出审查要求',reduction:80}));
 assert.equal(s.state().business[plan].riskRate,undefined,'no mitigation without investigation');
 s.push(floor({kind:'investigate',id:plan,findings:'发现伪造产品说明'}));
 assert.equal(s.state().business[plan].riskRate,100);
 s.push(floor({kind:'mitigate',id:plan,measure:'完成第三方产品检验',reduction:40,riskRate:60}));
 assert.equal(s.state().business[plan].riskRate,60);
 s.push(floor({kind:'mitigate',id:plan,measure:'完成第三方产品检验',reduction:40}));
 assert.equal(s.state().business[plan].mitigations.length,1,'same measure cannot repeatedly reduce risk');
 s.push(floor({kind:'mitigate',id:plan,measure:'品牌实际公开纠正误导材料',reduction:30}));
 assert.equal(s.state().business[plan].riskRate,30);
 s.push(floor({kind:'accept',id:plan}));
 assert.equal(s.state().business[plan].decisionRate,30);
 assert.equal(s.state().business[plan].risk,null,'frozen draw 32768 is above 30%');
 s.push(floor({kind:'mitigate',id:plan,measure:'签约后才解决问题',reduction:30}));
 assert.equal(s.state().business[plan].decisionRate,30,'risk no longer changes after formal start');
 assert.equal(s.state().business[plan].riskRate,30);
});

test('clean merchants retain 1% risk, while high-risk mitigation uses its precise final chance',()=>{
 const p={id:plan,status:'invited',investigated:false,terms:'一条推广'};
 for(const ticket of [0,655,656,65535]){
  const c=dealDecision(p,'accept',15,120,false,null,{},ticket);
  assert.equal(c[0].value.decisionRate,1);
  assert.equal(c[0].value.risk,ticket<1*65536/100?'tracking':null);
 }
 const inspected=dealDecision(p,'investigate',14,120,false,null,{findings:'审核通过'})[0].value;
 assert.equal(inspected.riskRate,1);
 assert.equal(dealDecision(inspected,'mitigate',14,120,false,null,{measure:'审查',reduction:1}).length,0);
 const bad=dealDecision(p,'investigate',14,120,true,null,{findings:'存疑'})[0].value;
 const improved=dealDecision(bad,'mitigate',14,120,true,null,{measure:'赔偿担保已签署',reduction:25})[0].value;
 assert.equal(improved.riskRate,75);
 assert.equal(dealDecision(improved,'accept',15,120,true,null,{},49151)[0].value.risk,'tracking');
 assert.equal(dealDecision(improved,'accept',15,120,true,null,{},49152)[0].value.risk,null);
});

test('initial advertiser flag is drawn at 30% and does not silently revert to 50%',()=>{
 const cutoff=30*65536/100;
 assert.equal(initialHighRiskForRoll(Math.ceil(cutoff)-1),true);
 assert.equal(initialHighRiskForRoll(Math.ceil(cutoff)),false);
 const riskyCount=Array.from({length:65536},(_,i)=>i).filter(initialHighRiskForRoll).length;
 assert.ok(Math.abs(riskyCount/65536-0.30)<1/65536,'Uint16 outcomes map to 30%');
});
