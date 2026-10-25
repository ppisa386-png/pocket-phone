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


const terms='user 持有10%收益权；净收入扣除成本后分成；每月月底结算；2026-12-31到期。';
async function opened(withRight=false){const f=setup();f.settings.prompts.assetStory='用户自定义正文提示';f.settings.prompts.assetAssessment='用户自定义评估提示';f.reply({...initial(),initial:{balance:1000,jobs:[],holdings:withRight?[{name:'项目收益权',category:'investment',value:10000,details:terms}]:[]}});ok(await f.assets.update());return f;}
const holdingId='initial:holding:0';

test('economic rights: new rights across industries preserve contract details and have no invented cash',async()=>{
 const f=await opened();try{
 for(const name of ['音乐授权','项目分成','软件许可','专利收益']){
  const evidence='合同确认Sam取得'+name+'的10%持续收益权。';await f.append(evidence+marker({kind:'asset',name,category:'investment',details:terms,marketValue:null,amount:null,evidence}),'2026-01-02');
 }
 const holdings=assetRows(f.state(),'holding');assert.equal(holdings.length,4);assert.ok(holdings.every(h=>h.details===terms&&h.category==='investment'));assert.equal(cashBalance(f.state()),100000);assert.equal(f.count(),1);
 const prompt=buildAssetPrompt(f.state(),f.settings);assert.match(prompt,/用户自定义正文提示/);assert.match(prompt,/参与、署名、创作、制作、发行或成功不等于/);assert.ok(prompt.includes(terms));assert.match(prompt,/正文不估算收益/);
 f.reply({...evaluation('2026-01-02'),valuations:holdings.map(h=>({id:h.id,value:10000}))});ok(await f.assets.update());assert.ok(f.prompt().includes(terms));assert.match(f.prompt(),/用户自定义评估提示/);
 }finally{f.close();}
});

test('economic rights: one-time payment without retained rights creates only cash',async()=>{
 const f=await opened();try{
 const evidence='Sam收到一次性服务费500美元，不享有项目版权或未来分成。';await f.append(evidence+marker({kind:'income',name:'一次性服务费',amount:500,evidence}),'2026-01-02');
 assert.equal(cashBalance(f.state()),150000);assert.equal(assetRows(f.state(),'holding').length,0);
 await f.append('时间来到月底结算之后。','2026-02-01');f.reply(evaluation('2026-02-01'));ok(await f.assets.update());assert.equal(cashBalance(f.state()),150000);assert.equal(assetRows(f.state(),'holding').length,0);assert.match(f.prompt(),/一次性付款只记收入，不虚构后续收益/);
 }finally{f.close();}
});

test('economic rights: existing contract and new commercial performance reach each assessment',async()=>{
 const f=await opened(true);try{
 for(const [date,prose,income,value] of [['2026-02-01','项目销售强劲，月底合同结算条件已满足。',2000,50000],['2026-03-01','项目热度下降，本期合同结算条件已满足但收益显著减少。',100,5000]]){
  await f.append(prose,date);f.reply({...evaluation(date),valuations:[{id:holdingId,value}],business:[{id:holdingId,netIncome:income,bookedIds:[]}]});ok(await f.assets.update());assert.ok(f.prompt().includes(prose));assert.ok(f.prompt().includes(terms));
 }
 assert.equal(cashBalance(f.state()),310000);assert.equal(f.state().assets[holdingId].valueMinor,500000);assert.match(f.prompt(),/每次检查已有 investment/);assert.match(f.prompt(),/遇冷不自动产生现金亏损/);
 }finally{f.close();}
});

test('economic rights: unmet contract trigger yields no cash while valuation may change',async()=>{
 const f=await opened(true);try{
 await f.append('项目已发行，热度很高，但合同回本门槛未达到，尚无可支付分红。','2026-01-20');
 f.reply({...evaluation('2026-01-20'),valuations:[{id:holdingId,value:30000}],note:'回本门槛未达到，本期不结算分红。'});ok(await f.assets.update());assert.equal(cashBalance(f.state()),100000);assert.equal(f.state().assets[holdingId].valueMinor,3000000);assert.match(f.prompt(),/尚未触发、尚待结算、纯潜在或未来收益不得提前入账/);
 }finally{f.close();}
});

test('economic rights: valuation and cash are separate and already booked income/cost are deducted once',async()=>{
 const f=await opened(true);try{
 const income='Sam已收到项目分成400美元。',expense='Sam已支付项目成本100美元。';
 await f.append(income+marker({kind:'income',name:'项目分成',amount:400,evidence:income})+expense+marker({kind:'expense',name:'项目成本',amount:100,evidence:expense}),'2026-01-15');
 assert.equal(cashBalance(f.state()),130000);const bookedIds=assetRows(f.state(),'cash_transaction').map(t=>t.id);
 await f.append('月底结算：本期总净现金收益为1000美元，包含之前已收400和已付100。','2026-02-01');
 f.reply({...evaluation('2026-02-01'),valuations:[{id:holdingId,value:20000}],business:[{id:holdingId,netIncome:1000,bookedIds}]});ok(await f.assets.update());assert.equal(cashBalance(f.state()),200000);assert.equal(f.state().assets[holdingId].valueMinor,2000000);
 const calls=f.count();assert.equal((await f.assets.update()).ok,false);assert.equal(f.count(),calls);
 await f.append('下一结算期，原来那笔分成没有新付款。','2026-03-01');const before=structuredClone(f.state().assets);
 f.reply({...evaluation('2026-03-01'),business:[{id:holdingId,netIncome:1000,bookedIds}]});assert.equal((await f.assets.update()).ok,false);assert.deepEqual(f.state().assets,before);assert.match(f.prompt(),/不能先自行减去再让程序扣第二次/);
 }finally{f.close();}
});

test('economic rights: profession changes do not erase an existing right or its terms',async()=>{
 const f=await opened(true);try{
 await f.append('Sam已经转行为学生，但原合同的项目收益权仍然有效；月底取得分成。','2026-02-01');
 f.reply({...evaluation('2026-02-01'),business:[{id:holdingId,netIncome:200,bookedIds:[]}]});ok(await f.assets.update());assert.equal(cashBalance(f.state()),120000);assert.equal(f.state().assets[holdingId].details,terms);assert.equal(f.state().assets[holdingId].active,true);assert.match(f.prompt(),/职业变化不取消仍成立的权益/);
 }finally{f.close();}
});

test('economic rights: partial license payment preserves holding; explicit entire transfer ends it',async()=>{
 const f=await opened(true);try{
 const evidence='Sam收到仅限一次活动的非独占授权费300美元，保留原项目收益权。';await f.append(evidence+marker({kind:'income',name:'单次授权费',amount:300,evidence}),'2026-01-10');
 assert.equal(f.state().assets[holdingId].active,true);assert.equal(f.state().assets[holdingId].details,terms);
 const transfer='Sam将该项目收益权全部转让，收到1000美元，转让后不再享有该权利。';await f.append(transfer+marker({kind:'asset',name:'项目收益权',action:'dispose',holdingId,evidence:transfer})+marker({kind:'income',name:'收益权转让款',amount:1000,evidence:transfer}),'2026-01-20');
 assert.equal(f.state().assets[holdingId].active,false);assert.equal(cashBalance(f.state()),230000);
 await f.append('转让后的月底，无新收入。','2026-02-01');f.reply({...evaluation('2026-02-01'),note:'权利已全部转出，无转让后收益。'});ok(await f.assets.update());assert.equal(cashBalance(f.state()),230000);assert.match(f.prompt(),/部分授权\/转让或一次性收款不等于失去全部权利/);
 assert.match(f.prompt(),/action:amend/);assert.match(f.prompt(),/价值未知时/);
 }finally{f.close();}
});
