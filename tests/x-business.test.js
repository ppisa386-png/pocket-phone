import test from 'node:test';
import assert from 'node:assert/strict';
import {appendChange,replayJournal,reconcileJournal} from '../src/journal.js';
import {storyAnnotations,buildStoryPhonePrompt} from '../src/story-phone.js';
import {normalizeSettings} from '../src/config.js';
import {businessPrompt,importBusiness,dmDealTask,dealDecision} from '../src/x-business.js';

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
    const s=sim();s.invite();const mark=s.journal.businessDraws[plan];
    s.journal=reconcileJournal(JSON.parse(JSON.stringify(s.journal)),s.rev.slice(0,-1)).journal;
    assert.equal(s.state().business[plan],undefined);s.chat.pop();s.rev.pop();s.push(floor(offer));
    assert.equal(s.journal.businessDraws[plan],mark);
    const p=s.state().business[plan],a=s.state().x[p.accountId];
    s.journal=appendChange(s.journal,s.rev,[{collection:'x',key:a.id,value:{...a,dmAccepted:true,inboundRequest:'accepted'}}]);
    s.wait(14);s.push(floor({...offer,project:'Autumn tasting'}));assert.equal(Object.keys(s.journal.businessDraws).length,2);
});
test('request acceptance, refusal, genuine investigation and reliable projects do not start risk',()=>{
    for(const [actions,mark,status] of [[[],true,'invited'],[['reject'],true,'declined'],[['investigate','accept'],true,'active'],[['accept'],false,'active']]){
        const s=sim();s.invite();s.journal.businessDraws[plan]=mark;s.push(floor(...actions.map(kind=>({kind,id:plan}))));
        const p=s.state().business[plan];assert.equal(p.status,status);assert.notEqual(p.risk,'tracking');
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
