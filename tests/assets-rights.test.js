// Responses below are controlled fixtures: these tests verify transport and ledger behavior,
// not a live model's ability to infer ownership or interpret a contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPhoneMemory } from '../src/memory.js';
import { createPhoneService } from '../src/phone.js';
import { createAssets } from '../src/assets.js';
import { createSnapchat } from '../src/snapchat.js';
import { createAmazon } from '../src/amazon.js';
import { cashBalance, assetRows } from '../src/assets-core.js';
import { createAssetPanel } from '../src/assets-view.js';
import { dateDay } from '../src/story-clock.js';
import { buildAssetPrompt } from '../src/assets-story.js';
import { normalizeSettings } from '../src/config.js';
const ok = r => assert.equal(r?.ok,true,r?.error);
const initial = (date='2026-01-01')=>({date,initial:{balance:1000,holdings:[],jobs:[]}});
function setup(date = '2026-01-01') {
    const bus = new EventEmitter(); let reply = initial(date), calls = 0, prompt = '';
    const c = { chatId: 'money', name1: 'Sam', characterId: 0, characters: [{ name: 'Alex', avatar: 'alex.png' }],
        chat: [{ mes: '日期：' + date + '\nSam 在咖啡馆工作。', is_user: false }], chatMetadata: {}, saveMetadata: async () => {},
        onlineStatus: 'connected', extensionPrompts: {}, setExtensionPrompt(k, v) { this.extensionPrompts[k] = v; },
        eventSource: bus, event_types: Object.fromEntries(['CHAT_CHANGED', 'GENERATION_STARTED', 'GENERATION_AFTER_COMMANDS', 'GENERATION_ENDED', 'MESSAGE_EDITED', 'MESSAGE_DELETED'].map(n => [n, n])),
        generateQuietPrompt: async o => { calls++; prompt = o.quietPrompt; return typeof reply === 'function' ? reply() : JSON.stringify(reply); } };
    const settings = normalizeSettings({ retries: 3 }), memory = createPhoneMemory({ getContext: () => c }), phone = createPhoneService({ memory, getContext: () => c, getSettings: () => settings });
    const args = { memory, phone, getContext: () => c, getSettings: () => settings };
    return { c, bus, settings, memory, phone, assets: createAssets(args), snap: createSnapchat(args), shop: createAmazon(args),
        state: () => phone.snapshot(), reply: r => reply = r, count: () => calls, prompt: () => prompt,
        async append(text, date = '') { c.chat.push({ mes: (date ? '日期：' + date + '\n' : '') + text, is_user: false }); await memory.read(); },
        close() { phone.destroy(); memory.destroy(); } };
}
const marker = row => '<!--durian-money:' + JSON.stringify(row) + '-->';
const evaluation = date => ({ date, events: [], salaries: [], valuations: [], living: { total: 0, bookedIds: [] }, business: [] });



const id='initial:holding:0';
const originalTerms='user持有项目10%收益权，按净收入分成。';
async function opened(value=10000,rights={sharePercent:10}){const f=setup();f.reply({...initial(),initial:{balance:1000,jobs:[],holdings:[{name:'项目收益权',category:'investment',value,details:originalTerms,rights}]}});ok(await f.assets.update());return f;}
const amendment=(evidence,extra={})=>({kind:'asset',name:'项目收益权',action:'amend',holdingId:id,details:'user保留5%收益权，其余权利已转让。',rights:{sharePercent:5},evidence,...extra});
const row=(from,to,netIncome=100)=>({id,from,to,netIncome,bookedIds:[]});

test('unknown initial valuation persists, renders pending, and can be valued later without changing cash',async()=>{
 const f=await opened(null);try{
 assert.equal(f.state().assets[id].valueMinor,null);assert.equal(cashBalance(f.state()),100000);
 const p=createAssetPanel({adapter:{},getView:f.state,redraw(){},notice(){}});await p.action('tab','investment');assert.match(p.html(),/待估值/);assert.doesNotMatch(p.html(),/NaN/);
 const reload=createPhoneMemory({getContext:()=>f.c});assert.equal((await reload.read()).state.assets[id].valueMinor,null);reload.destroy();
 await f.append('权益价值仍未知，但本期确定取得100美元净收益。','2026-01-11');f.reply({...evaluation('2026-01-11'),business:[{id,netIncome:100,bookedIds:[]}]});ok(await f.assets.update());assert.equal(cashBalance(f.state()),110000);
 await f.append('市场资料足以确定正常估值。','2026-01-12');f.reply({...evaluation('2026-01-12'),valuations:[{id,value:2500}]});ok(await f.assets.update());assert.equal(f.state().assets[id].valueMinor,250000);
 await f.append('后来没有新的估值依据。','2026-01-13');f.reply({...evaluation('2026-01-13'),valuations:[{id,value:null}]});ok(await f.assets.update());assert.equal(f.state().assets[id].valueMinor,250000);assert.equal(cashBalance(f.state()),110000);
 }finally{f.close();}
});

test('unknown new holding and ownership classification do not block unrelated expenses or assessment',async()=>{
 const f=await opened();try{
 const evidence='Sam获得另一项目持续收益权，价值未知。';await f.append(evidence+marker({kind:'asset',name:'新项目权益',category:'investment',details:'保留15%收益权',evidence}),'2026-01-02');
 const cost='Sam以100美元买入另一项权益。';await f.append(cost+marker({kind:'expense',name:'购入权益',amount:100,details:'独立授权权利',evidence:cost}),'2026-01-03');const e=assetRows(f.state(),'story_event').find(e=>e.name==='购入权益');
 f.reply({...evaluation('2026-01-03'),ownership:[{eventId:e.id,category:'investment',value:null}]});ok(await f.assets.update());assert.equal(cashBalance(f.state()),90000);assert.equal(assetRows(f.state(),'holding').filter(h=>h.valueMinor===null).length,2);assert.equal(f.state().assets['holding:'+e.id].details,'独立授权权利');
 }finally{f.close();}
});

test('partial rights amendment preserves acquisition/cost/history, invalidates obsolete valuation and rolls back',async()=>{
 const f=await opened();try{
 const before=structuredClone(f.state().assets[id]);const evidence='Sam转让部分项目权益，保留比例从10%变成5%。';await f.append(evidence+marker(amendment(evidence)),'2026-01-11');
 const h=f.state().assets[id];assert.equal(h.startDay,before.startDay);assert.equal(h.purchaseMinor,before.purchaseMinor);assert.equal(h.active,true);assert.equal(h.rights.sharePercent,5);assert.equal(h.valueMinor,null);assert.equal(h.termsHistory.length,2);assert.equal(h.termsHistory[0].rights.sharePercent,10);assert.equal(h.termsHistory[1].fromDay,dateDay('2026-01-11'));assert.equal(cashBalance(f.state()),100000);
 await f.memory.read();assert.equal(f.state().assets[id].termsHistory.length,2);
 f.c.chat.pop();await f.memory.read();assert.deepEqual(f.state().assets[id],before);
 }finally{f.close();}
});

test('manual amendment requires real new prose and works through the assessment interface',async()=>{
 const f=await opened();try{
 const evidence='双方修改合同，Sam保留5%收益权，期限至2026年12月31日。';await f.append(evidence,'2026-01-11');
 f.reply({...evaluation('2026-01-11'),events:[amendment(evidence,{sourceIndex:1,rights:{sharePercent:5,expiresOn:'2026-12-31'}})]});ok(await f.assets.update());assert.equal(f.state().assets[id].rights.expiresOn,'2026-12-31');assert.equal(f.state().assets[id].startDay,dateDay('2026-01-01'));assert.equal(cashBalance(f.state()),100000);
 }finally{f.close();}
});

test('invalid rights amendments are atomic, cannot rewrite settled past or use acquire to overwrite a holding',async()=>{
 const f=await opened();try{
 const evidence='Sam修改项目合同。';await f.append(evidence,'2026-01-11');const before=structuredClone(f.state().assets);
 for(const patch of [{holdingId:'foreign'},{date:'2025-12-01'},{category:'fixed'},{rights:{sharePercent:0}},{rights:{sharePercent:101}},{rights:{expiresOn:'bad-date'}},{rights:{expiresOn:'2026-01-03'}},{details:''},{action:'acquire',category:'investment'}]){
 f.reply({...evaluation('2026-01-11'),events:[amendment(evidence,{sourceIndex:1,...patch})]});assert.equal((await f.assets.update()).ok,false,JSON.stringify(patch));assert.deepEqual(f.state().assets,before);
 }
 }finally{f.close();}
});

test('changed terms require non-overlapping income segments; whole-period and overlapping totals are rejected',async()=>{
 const f=await opened();try{
 const evidence='Sam转让一部分权益，之后只保留5%分成。';await f.append(evidence+marker(amendment(evidence)),'2026-01-11');await f.append('月底结算。','2026-02-01');const before=structuredClone(f.state().assets);
 for(const business of [[{id,netIncome:900,bookedIds:[]}],[row('2026-01-01','2026-02-01')],[row('2026-01-01','2026-01-11'),row('2026-01-05','2026-01-11')]]){
 f.reply({...evaluation('2026-02-01'),business});assert.equal((await f.assets.update()).ok,false);assert.deepEqual(f.state().assets,before);
 }
 f.reply({...evaluation('2026-02-01'),business:[row('2026-01-01','2026-01-11',100),row('2026-01-11','2026-02-01',300)]});ok(await f.assets.update());assert.equal(cashBalance(f.state()),140000);assert.equal(assetRows(f.state(),'cash_transaction').filter(t=>t.source==='business').length,2);assert.match(f.prompt(),/settlementPeriods/);
 assert.equal((await f.assets.update()).ok,false);
 }finally{f.close();}
});

test('terminated holdings permit only the unsaved pre-termination segment and reject later-period revenue',async()=>{
 const f=await opened();try{
 const evidence='Sam将项目收益权全部转让。';await f.append(evidence+marker({kind:'asset',name:'项目收益权',action:'dispose',holdingId:id,evidence}),'2026-01-11');await f.append('月底结算。','2026-02-01');
 for(const business of [[{id,netIncome:100,bookedIds:[]}],[row('2026-01-11','2026-02-01')],[row('2025-12-01','2026-01-11')]]){f.reply({...evaluation('2026-02-01'),business});assert.equal((await f.assets.update()).ok,false);assert.equal(cashBalance(f.state()),100000);}
 f.reply({...evaluation('2026-02-01'),business:[row('2026-01-01','2026-01-11')]});ok(await f.assets.update());assert.equal(cashBalance(f.state()),110000);
 await f.append('完全终止后的下一月。','2026-03-01');const before=structuredClone(f.state().assets);f.reply({...evaluation('2026-03-01'),business:[{id,netIncome:100,bookedIds:[]}]});assert.equal((await f.assets.update()).ok,false);assert.deepEqual(f.state().assets,before);
 }finally{f.close();}
});

test('structured expiry includes its final day, closes next day without an API and rolls back',async()=>{
 const f=await opened(10000,{sharePercent:10,expiresOn:'2026-01-10'});try{
 await f.append('合同最后一天。','2026-01-10');assert.equal(f.state().assets[id].active,true);
 await f.append('翌日合同到期。','2026-01-11');assert.equal(f.state().assets[id].active,false);assert.equal(f.state().assets[id].endDay,dateDay('2026-01-11'));assert.equal(f.count(),1);
 f.c.chat.pop();await f.memory.read();assert.equal(f.state().assets[id].active,true);
 await f.append('来到月底。','2026-02-01');f.reply({...evaluation('2026-02-01'),business:[row('2026-01-01','2026-01-11',250)]});ok(await f.assets.update());assert.equal(cashBalance(f.state()),125000);assert.equal(f.state().assets[id].active,false);
 }finally{f.close();}
});

test('new mid-period holdings cannot receive income for time before acquisition',async()=>{
 const f=await opened();try{
 const evidence='Sam首次取得另一个项目权益。';await f.append(evidence+marker({kind:'asset',name:'新项目',category:'investment',evidence}),'2026-01-11');const newId=assetRows(f.state(),'holding').find(h=>h.name==='新项目').id;await f.append('月末。','2026-02-01');
 f.reply({...evaluation('2026-02-01'),business:[{id:newId,netIncome:100,bookedIds:[]}]});assert.equal((await f.assets.update()).ok,false);
 f.reply({...evaluation('2026-02-01'),business:[{id:newId,from:'2026-01-11',to:'2026-02-01',netIncome:100,bookedIds:[]}]});ok(await f.assets.update());assert.equal(cashBalance(f.state()),110000);
 }finally{f.close();}
});

test('long generated holding IDs remain addressable by amendments',async()=>{
 const f=await opened();try{
 const evidence='Sam在合同里取得'+('带有明确地区范围的授权安排'.repeat(20))+'，享有收益。';await f.append(evidence+marker({kind:'asset',name:'长证据权益',category:'investment',evidence}),'2026-01-02');const h=assetRows(f.state(),'holding').find(h=>h.name==='长证据权益');assert.ok(h.id.length>180);
 const change='双方修改了长证据权益的合同。';await f.append(change+marker(amendment(change,{holdingId:h.id,name:h.name})),'2026-01-03');assert.equal(f.state().assets[h.id].rights.sharePercent,5);assert.equal(f.state().assets[h.id].startDay,dateDay('2026-01-02'));
 }finally{f.close();}
});

test('extending expiry before it ends preserves old/new segments and expires at the new date',async()=>{
 const f=await opened(10000,{sharePercent:10,expiresOn:'2026-01-10'});try{
 const evidence='合同延长到2026年1月20日，比例不变。';await f.append(evidence+marker(amendment(evidence,{details:originalTerms+'期限延至2026-01-20',rights:{expiresOn:'2026-01-20'}})),'2026-01-08');assert.equal(f.state().assets[id].rights.sharePercent,10);
 await f.append('月底。','2026-02-01');assert.equal(f.state().assets[id].endDay,dateDay('2026-01-21'));
 f.reply({...evaluation('2026-02-01'),business:[row('2026-01-01','2026-01-08',70),row('2026-01-08','2026-01-21',130)]});ok(await f.assets.update());assert.equal(cashBalance(f.state()),120000);
 }finally{f.close();}
});

test('same assessment applies a contract amendment before validating its income segments',async()=>{
 const f=await opened();try{
 const evidence='Sam修改合同，只保留5%收益权。';await f.append(evidence,'2026-01-11');await f.append('月底结算。','2026-02-01');
 const events=[amendment(evidence,{sourceIndex:1})], before=structuredClone(f.state().assets);
 f.reply({...evaluation('2026-02-01'),events,business:[{id,netIncome:150,bookedIds:[]}]});assert.equal((await f.assets.update()).ok,false);assert.deepEqual(f.state().assets,before);
 f.reply({...evaluation('2026-02-01'),events,business:[row('2026-01-01','2026-01-11',100),row('2026-01-11','2026-02-01',50)]});ok(await f.assets.update());assert.equal(cashBalance(f.state()),115000);assert.equal(f.state().assets[id].rights.sharePercent,5);
 f.c.chat.splice(1);await f.memory.read();assert.equal(cashBalance(f.state()),100000);assert.equal(f.state().assets[id].rights.sharePercent,10);
 }finally{f.close();}
});

test('settling an older unknown acquisition cost cannot resurrect a disposed right',async()=>{
 const f=await opened();try{
 const evidence='Sam买入另一项目权益，价格未说明。';await f.append(evidence+marker({kind:'expense',name:'购入的新权益',category:'investment',amount:null,evidence}),'2026-01-02');const e=assetRows(f.state(),'story_event').find(e=>e.name==='购入的新权益'),hid='holding:'+e.id;
 const sale='Sam已将新权益全部转出。';await f.append(sale+marker({kind:'asset',name:'购入的新权益',action:'dispose',holdingId:hid,evidence:sale}),'2026-01-03');
 f.reply({...evaluation('2026-01-03'),events:[{id:e.id,amount:100}]});ok(await f.assets.update());assert.equal(f.state().assets[hid].active,false);assert.equal(f.state().assets[hid].endDay,dateDay('2026-01-03'));assert.equal(cashBalance(f.state()),90000);
 }finally{f.close();}
});

test('settling original purchase after an amendment preserves the amended terms and unknown current valuation',async()=>{
 const f=await opened();try{
 const evidence='Sam买入一项收益权，实际支付金额暂未说明。';await f.append(evidence+marker({kind:'expense',name:'待核价权益',category:'investment',amount:null,details:'最初10%分成',evidence}),'2026-01-02');const e=assetRows(f.state(),'story_event').find(e=>e.name==='待核价权益'),hid='holding:'+e.id;
 const change='Sam转出一部分，仅保留5%。';await f.append(change+marker(amendment(change,{holdingId:hid})),'2026-01-03');
 f.reply({...evaluation('2026-01-03'),events:[{id:e.id,amount:100,marketValue:1000}]});ok(await f.assets.update());const h=f.state().assets[hid];assert.equal(h.rights.sharePercent,5);assert.equal(h.startDay,dateDay('2026-01-02'));assert.equal(h.valueMinor,null);assert.equal(h.purchaseMinor,10000);assert.equal(h.termsHistory.length,2);
 }finally{f.close();}
});
