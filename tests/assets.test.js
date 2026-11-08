import { createAssetPanel } from '../src/assets-view.js';
import { ownershipRecoveryProse } from '../src/assets-recovery.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPhoneMemory } from '../src/memory.js';
import { createPhoneService } from '../src/phone.js';
import { createAssets, applyAssessment, assessmentReferences } from '../src/assets.js';
import { createSnapchat } from '../src/snapchat.js';
import { createAmazon } from '../src/amazon.js';
import { cashBalance, reservedCash, assetRows, salaryPayments, requireCash, recentCash, debtEpisode } from '../src/assets-core.js';
import { applyAssetChanges, applyFinancialEvent, validateFinancialEvent } from '../src/assets-events.js';
import { buildAssetPrompt, createAssetBridge, importStoryAssets, ASSETS_KEY } from '../src/assets-story.js';
import { appendChange, revisionsFor, messageSignatures, replayJournal } from '../src/journal.js';
import { normalizeSettings } from '../src/config.js';
import { dateDay } from '../src/story-clock.js';
const day = dateDay;
const ok = r => assert.equal(r?.ok, true, r?.error);
const initial = (date = '2026-01-01', balance = 1000) => ({ residence:{region:'US',currency:'USD',evidence:'Sam 常住美国。'}, date, initial: { balance, holdings: [], jobs: [{ name: '咖啡师', monthlySalary: 3100 }] } });
function setup(date = '2026-01-01') {
    const bus = new EventEmitter(); let reply = initial(date), calls = 0, prompt = '';
    const c = { chatId: 'money', powerUserSettings:{persona_description:'Sam 常住美国。'}, name1: 'Sam', characterId: 0, characters: [{ name: 'Alex', avatar: 'alex.png' }],
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

const dressFact = '朋友刷自己的卡付清红色礼服和金色高跟鞋，交给Sam带走。';
const watchFact = '朋友结账后，Sam戴上获赠的玫瑰金钻石女表，朋友戴上他自己的黑色男表。';
const giftRows = () => [
    { sourceIndex: 1, evidence: dressFact, name: '红色礼服', category: 'luxury', kind: 'asset', owner: 'user', amount: null, marketValue: 2000 },
    { sourceIndex: 1, evidence: dressFact, name: '金色高跟鞋', category: 'luxury', kind: 'asset', owner: 'user', amount: null, marketValue: null },
    { sourceIndex: 2, evidence: watchFact, name: '玫瑰金钻石女表', category: 'luxury', kind: 'asset', owner: 'user', amount: null, marketValue: 10000 },
];
async function missedLegacyGifts(f) {
    f.reply({ ...initial(), initial: { balance: 1000, jobs: [], holdings: [{name:'旧钻戒',category:'luxury',value:5000}] } });
    ok(await f.assets.update()); await f.append(dressFact, '2026-01-02'); await f.append(watchFact, '2026-01-02');
    f.reply(evaluation('2026-01-02')); ok(await f.assets.update());
    const ticket = await f.memory.begin(), wallet = {...f.state().assets.wallet}; delete wallet.ownershipAuditVersion;
    await f.memory.commit(ticket,[{collection:'assets',key:'wallet',value:wallet}]);
}

test('missing annotations: manual new-prose gift capture coexists with old valuation and living costs', async () => {
    const f=setup(); try {
        f.reply({...initial(),initial:{balance:1000,jobs:[],holdings:[{name:'旧钻戒',category:'luxury',value:null}]}}); ok(await f.assets.update());
        await f.append(dressFact,'2026-01-02'); await f.append(watchFact,'2026-01-02');
        const old=assetRows(f.state(),'holding')[0];
        f.reply({...evaluation('2026-01-02'),events:giftRows(),valuations:[{id:old.id,value:5000}],living:{total:10,bookedIds:[]}});
        ok(await f.assets.update()); assert.equal(assetRows(f.state(),'holding').length,4);
        assert.equal(cashBalance(f.state()),99000); assert.equal(f.state().assets[old.id].valueMinor,500000);
        assert.equal(assetRows(f.state(),'cash_transaction').length,1);
        assert.match(f.prompt(),/即使正文没有durian-money注释/);
        const payload=JSON.parse(f.prompt().split('账本与待核对资料：')[1].split('\n')[0]);
        assert.equal(payload.newProse,undefined);assert.deepEqual([payload.unsettledFromIndex,payload.throughIndex],[1,2]);
        const calls=f.count(); assert.equal((await f.assets.update()).ok,false); assert.equal(f.count(),calls);
        f.c.chat.pop(); await f.memory.read(); assert.equal(assetRows(f.state(),'holding').length,1);
        assert.equal(cashBalance(f.state()),100000);
    } finally { f.close(); }
});

test('legacy same-floor audit adds missed gifts once without rerolling balance, prices or settlement',async()=>{
    const f=setup();try{
        await missedLegacyGifts(f); const before=structuredClone(f.state().assets.wallet), cash=structuredClone(assetRows(f.state(),'cash_transaction'));
        const panel=createAssetPanel({adapter:{assets:f.assets},getView:f.state,redraw(){},notice(){}});
        assert.doesNotMatch(panel.html(),/data-asset-action="update" disabled/);
        const duplicate={...giftRows()[0],name:'旧钻戒',marketValue:1}; f.reply({recoveredAssets:[...giftRows(),duplicate]});
        const result=await f.assets.update();ok(result);assert.equal(result.value.repaired,true);
        assert.equal(assetRows(f.state(),'holding').length,4);assert.equal(cashBalance(f.state()),100000);
        assert.equal(assetRows(f.state(),'holding').find(h=>h.name==='旧钻戒').valueMinor,500000);
        assert.deepEqual(assetRows(f.state(),'cash_transaction'),cash);
        assert.deepEqual(f.state().assets.wallet,{...before,ownershipAuditVersion:1});
        assert.match(f.prompt(),/ownershipRecoveryFloors/);assert.match(panel.html(),/data-asset-action="update" disabled/);
        const calls=f.count();assert.equal((await f.assets.update()).ok,false);assert.equal(f.count(),calls);
        await f.memory.read();assert.equal(assetRows(f.state(),'holding').length,4);
        f.c.chat.pop();await f.memory.read();assert.equal(assetRows(f.state(),'holding').length,1);
    }finally{f.close();}
});

test('legacy audit errors keep retry available but cannot change money or existing holdings',async()=>{
    const f=setup();try{
        await missedLegacyGifts(f);const before=structuredClone(f.state().assets);
        for(const data of [
            {}, {recoveredAssets:giftRows(),living:{total:50,bookedIds:[]}},
            {recoveredAssets:giftRows(),valuations:[{id:'initial:holding:0',value:1}]},
            {recoveredAssets:[{...giftRows()[0],owner:'friend'}]},
            {recoveredAssets:[{...giftRows()[0],amount:2000}]},
            {recoveredAssets:[{...giftRows()[0],category:'investment'}]},
            {recoveredAssets:[{...giftRows()[0],sourceIndex:999}]},
        ]) {f.reply(data);assert.equal((await f.assets.update()).ok,false);assert.deepEqual(f.state().assets,before);}
        f.reply({recoveredAssets:giftRows()});ok(await f.assets.update());
    }finally{f.close();}
});

test('legacy audit can share the next assessment; old cash remains barred, new life costs settle',async()=>{
    const f=setup();try{
        await missedLegacyGifts(f);await f.append('继续旅行。','2026-01-03');
        f.reply({...evaluation('2026-01-03'),recoveredAssets:giftRows(),events:[{kind:'expense',name:'重扣旧购物',sourceIndex:1,amount:50}],living:{total:10,bookedIds:[]}});
        ok(await f.assets.update());assert.equal(assetRows(f.state(),'holding').length,4);assert.equal(cashBalance(f.state()),99000);
        assert.equal(f.state().assets.wallet.skippedUnverified,1);assert.equal(f.state().assets.wallet.lastDay,day('2026-01-03'));
        await f.append('次日。','2026-01-04');f.reply(evaluation('2026-01-04'));ok(await f.assets.update());
        assert.equal(assetRows(f.state(),'holding').length,4);assert.doesNotMatch(f.prompt(),/"ownershipRecoveryProse":/);
    }finally{f.close();}
});

test('ownership audit excludes unknown-time, pre-opening, system and user text; bounded to twenty prose floors',()=>{
    const state={assets:{wallet:{startDay:day('2026-01-01'),lastIndex:30}}};
    const chat=[{mes:'无日期'}, {mes:'日期：2025-12-01\n旧物'}, {mes:'日期：2026-01-01\n计划',is_user:true}, {mes:'系统',is_system:true},
        ...Array.from({length:27},(_,n)=>({mes:'日期：2026-01-02\n第'+n+'条正文'}))];
    const rows=ownershipRecoveryProse(state,chat);assert.equal(rows.length,20);assert.equal(rows[0].index,11);assert.equal(rows.at(-1).index,30);
    assert.deepEqual(ownershipRecoveryProse({assets:{wallet:{...state.assets.wallet,ownershipAuditVersion:1}}},chat),[]);
});

test('each narrative floor can import gift markers immediately, without a separate model request',async()=>{
    const f=setup();try{
        ok(await f.assets.update()); const calls=f.count();
        const rows=giftRows();await f.append(dressFact+marker({...rows[0],marketValue:null})+marker(rows[1]),'2026-01-02');
        assert.equal(assetRows(f.state(),'holding').length,2);
        await f.append(watchFact+marker({...rows[2],marketValue:null}),'2026-01-02');
        assert.equal(assetRows(f.state(),'holding').length,3);assert.equal(cashBalance(f.state()),100000);assert.equal(f.count(),calls);
        const prompt=buildAssetPrompt(f.state(),f.settings);assert.match(prompt,/付款人是他人而漏记/);assert.match(prompt,/每项追加独立/);
    }finally{f.close();}
});

test('first ledger snapshot uses the visible scene date instead of an independently guessed model date', async () => {
    const f = setup('2026-10-18'); try {
        f.c.chat[0].mes = '<calendar>2026年10月18日 周日 0:05</calendar>';
        f.reply(initial('2026-10-17'));
        ok(await f.assets.update());
        assert.equal(f.state().assets.wallet.startDay, day('2026-10-18'));
        assert.equal(f.state().assets.wallet.lastDay, day('2026-10-18'));
        assert.equal(cashBalance(f.state()), 100000);
        assert.equal(f.count(), 1);
        assert.match(f.prompt(), /本次评估日期固定为 2026-10-18/);
        assert.match(f.prompt(), /"assessmentDate":"2026-10-18"/);
        assert.match(f.prompt(), /"elapsedDays":0/);
        assert.equal((await f.assets.update()).ok, false);
        assert.equal(f.count(), 1);
    } finally { f.close(); }
});

test('known scene date need not be echoed; elapsed interval and transaction labels use the local anchor', async () => {
    const f = setup(); try {
        const first = initial(); delete first.date; f.reply(first);
        ok(await f.assets.update());
        await f.append('继续生活。', '2026-01-11');
        const next = { ...evaluation(), living: { total: 100, bookedIds: [] } }; delete next.date; f.reply(next);
        ok(await f.assets.update());
        assert.equal(cashBalance(f.state()), 90000);
        assert.equal(f.state().assets.wallet.lastDay, day('2026-01-11'));
        assert.match(f.prompt(), /"from":"2026-01-01"/);
        assert.match(f.prompt(), /"assessmentDate":"2026-01-11"/);
        assert.match(f.prompt(), /"elapsedDays":10/);
        assert.ok(JSON.stringify(assetRows(f.state(), 'cash_transaction')).includes('2026-01-01 至 2026-01-11'));
        f.c.chat.pop(); await f.memory.read();
        assert.equal(cashBalance(f.state()), 100000);
        assert.equal(f.state().assets.wallet.lastDay, day('2026-01-01'));
    } finally { f.close(); }
});

test('conflicting settlement period reports both dates and commits no money or lock', async () => {
    const f = setup(); try {
        ok(await f.assets.update()); await f.append('继续生活。', '2026-02-01');
        const before = structuredClone(f.state().assets);
        f.reply({ ...evaluation('2026-01-11'), living: { total: 100, bookedIds: [] } });
        const result = await f.assets.update();
        assert.equal(result.ok, false);
        assert.match(result.error, /正文日期为 2026-02-01.*模型返回 2026-01-11/);
        assert.deepEqual(f.state().assets, before); assert.equal(f.count(), 2);
        f.reply(evaluation('2026-02-01')); ok(await f.assets.update());
        assert.equal(f.count(), 3);
    } finally { f.close(); }
});

test('missing dates without a scene anchor cannot initialize or fall back to wall time', () => {
    const data = initial(); delete data.date;
    assert.throws(() => applyAssessment({ assets: {} }, data, { chat: [{ mes: '继续生活。' }], index: 0, revision: 'a' }), /剧情日期/);
});

test('distinct purchases in one prose sentence are each booked once', async () => {
    const f = setup(); try {
        ok(await f.assets.update());
        const evidence = 'Sam 买水花了5美元，又买面包花了8美元。';
        const water = { kind: 'expense', name: '水', amount: 5, evidence };
        const bread = { kind: 'expense', name: '面包', amount: 8, evidence };
        await f.append(evidence + marker(water) + marker(bread) + marker(water), '2026-01-02');
        assert.equal(cashBalance(f.state()), 98700);
        await f.memory.read(); assert.equal(cashBalance(f.state()), 98700);
        f.c.chat.pop(); await f.memory.read(); assert.equal(cashBalance(f.state()), 100000);
    } finally { f.close(); }
});

test('manual assessment recovers distinct purchases sharing one evidence sentence', async () => {
    const f = setup(); try {
        ok(await f.assets.update());
        const evidence = 'Sam 买水花了5美元，又买面包花了8美元。';
        await f.append(evidence, '2026-01-02');
        const events = [
            { sourceIndex: 1, evidence, kind: 'expense', name: '水', amount: 5 },
            { sourceIndex: 1, evidence, kind: 'expense', name: '面包', amount: 8 },
        ];
        f.reply({ ...evaluation('2026-01-02'), events });
        ok(await f.assets.update());
        assert.equal(cashBalance(f.state()), 98700);
        assert.equal(assetRows(f.state(), 'cash_transaction').length, 2);
        await f.memory.read(); assert.equal(cashBalance(f.state()), 98700);
        f.c.chat.pop(); await f.memory.read(); assert.equal(cashBalance(f.state()), 100000);
    } finally { f.close(); }
});

test('manual assessment supplements a recorded sentence without rebooking its existing purchase', async () => {
    const f = setup(); try {
        ok(await f.assets.update());
        const evidence = 'Sam 买水花了5美元，又买面包花了8美元。';
        const water = { kind: 'expense', name: '水', amount: 5, evidence };
        await f.append(evidence + marker(water), '2026-01-02');
        f.reply({ ...evaluation('2026-01-02'), events: [{ ...water, sourceIndex: 1 }] });
        assert.equal((await f.assets.update()).ok, false);
        assert.equal(cashBalance(f.state()), 99500);
        f.reply({ ...evaluation('2026-01-02'), events: [{ ...water, sourceIndex: 1, name: '面包', amount: 8 }] });
        ok(await f.assets.update()); assert.equal(cashBalance(f.state()), 98700);
    } finally { f.close(); }
});

test('selling a known holding without repeating its category removes ownership and credits once', async () => {
    const f = setup(); try {
        f.reply({ ...initial(), initial: { balance: 1000, jobs: [], holdings: [{ name: '腕表', category: 'luxury', value: 500 }] } });
        ok(await f.assets.update());
        const sale = { kind: 'income', name: '售出腕表', amount: 300, action: 'dispose', holdingId: 'initial:holding:0', evidence: 'Sam 卖出腕表，收到300美元。' };
        await f.append(sale.evidence + marker(sale), '2026-01-02');
        assert.equal(cashBalance(f.state()), 130000);
        assert.equal(f.state().assets['initial:holding:0'].active, false);
        await f.memory.read(); assert.equal(cashBalance(f.state()), 130000);
        f.c.chat.pop(); await f.memory.read();
        assert.equal(cashBalance(f.state()), 100000);
        assert.equal(f.state().assets['initial:holding:0'].active, true);
    } finally { f.close(); }
});

test('a second sale of an already disposed holding cannot add cash during assessment', async () => {
    const f = setup(); try {
        f.reply({ ...initial(), initial: { balance: 1000, jobs: [], holdings: [{ name: '腕表', category: 'luxury', value: 500 }] } });
        ok(await f.assets.update());
        const sale = { kind: 'income', name: '售出腕表', amount: 300, action: 'dispose', holdingId: 'initial:holding:0', evidence: 'Sam 卖出腕表，收到300美元。' };
        await f.append(sale.evidence + marker(sale), '2026-01-02');
        await f.append('Sam 再次确认已经收到卖表的300美元。', '2026-01-03');
        f.reply({ ...evaluation('2026-01-03'), events: [{ ...sale, sourceIndex: 2, evidence: 'Sam 再次确认已经收到卖表的300美元。' }] });
        assert.equal((await f.assets.update()).ok, false);
        assert.equal(cashBalance(f.state()), 130000);
        assert.equal(f.state().assets.wallet.lastDay, day('2026-01-01'));
    } finally { f.close(); }
});

test('old single-sentence event IDs migrate without charging the saved event again', async () => {
    const evidence='Sam 买水花了5美元，又买面包花了8美元。';
    const water={kind:'expense',name:'水',amount:5,evidence}, bread={kind:'expense',name:'面包',amount:8,evidence};
    const chat=[{mes:'2026-01-01'},{mes:evidence+marker(water)+marker(bread)}];
    const rev=await revisionsFor(messageSignatures(chat));
    let journal=appendChange(undefined,rev.slice(0,1),[{collection:'assets',key:'wallet',value:{id:'wallet',type:'wallet',openingMinor:100000,included:[],lastIndex:0}}]);
    const id='money:'+rev[1]+':'+evidence;
    journal=appendChange(journal,rev,applyFinancialEvent(replayJournal(journal),validateFinancialEvent(water,id,1)),id);
    const imported=importStoryAssets(journal,rev,chat);
    assert.equal(cashBalance(replayJournal(imported.journal)),98700);
    assert.equal(assetRows(replayJournal(imported.journal),'cash_transaction').length,2);
    assert.equal(importStoryAssets(imported.journal,rev,chat).changed,false);
});

test('Amazon receives actual available balance even after more than thirty ledger entries', async () => {
    const f=setup(); try {
        ok(await f.assets.update());
        await f.memory.commit(await f.memory.begin(),Array.from({length:35},(_,i)=>({collection:'assets',key:'extra:'+i,value:{id:'extra:'+i,type:'cash_transaction',currency:'USD',deltaMinor:100}})));
        f.reply({products:[]}); ok(await f.shop.search('外套'));
        assert.match(f.prompt(),/"balance":1035/); assert.match(f.prompt(),/"available":1035/);
        assert.doesNotMatch(f.prompt(),/extra:34/,'raw recent transactions are not mistaken for wealth');
    } finally { f.close(); }
});

test('blocked pending transfer can be cancelled without model calls or debiting cash', async () => {
    const f = setup(); try {
        ok(await f.assets.update());
        await f.memory.commit(await f.memory.begin(), [{collection:'snapchat',key:'friend',value:{id:'friend',type:'account',name:'Alex',friend:'friends',blocked:false}}]);
        const sent = await f.snap.transfer('friend', '50', 'USD', '午餐'); ok(sent);
        ok(await f.snap.block('friend', true)); const calls = f.count();
        assert.equal((await f.snap.settle(sent.value, true)).ok, false);
        ok(await f.snap.settle(sent.value, false));
        assert.equal(reservedCash(f.state()), 0); assert.equal(cashBalance(f.state()), 100000); assert.equal(f.count(), calls);
        assert.equal((await f.snap.settle(sent.value, false)).ok, false);
    } finally { f.close(); }
});

test('opening is free; initialization is one call, persisted lock disallows reroll; deletion restores update eligibility', async () => {
    const f = setup(); try {
        await f.assets.open(); assert.equal(f.count(), 0); ok(await f.assets.update()); assert.equal(f.count(), 1); assert.equal(cashBalance(f.state()), 100000);
        assert.equal((await f.assets.update()).ok, false); assert.equal(f.count(), 1);
        await f.append('十天后继续生活。', '2026-01-11'); f.reply({ ...evaluation('2026-01-11'), living: { total: 100, bookedIds: [] } });
        ok(await f.assets.update()); assert.equal(cashBalance(f.state()), 90000);
        f.c.chat.pop(); f.bus.emit('MESSAGE_DELETED'); await f.memory.read(); assert.equal(cashBalance(f.state()), 100000);
        await f.append('另一条剧情。', '2026-01-11'); ok(await f.assets.update()); assert.equal(f.count(), 3);
    } finally { f.close(); }
});

test('explicit narrative expense is immediate, unknown amount awaits evaluation; paid cost deducted from living total', async () => {
    const f = setup(); try {
        ok(await f.assets.update()); const e = { kind: 'expense', name: '饮用水', amount: 5, evidence: 'Sam 买水花了5美元。' };
        await f.append(e.evidence + marker(e), '2026-01-02'); assert.equal(cashBalance(f.state()), 99500); const calls = f.count();
        await f.memory.read(); assert.equal(cashBalance(f.state()), 99500); assert.equal(f.count(), calls);
        const unknown = { kind: 'expense', name: '午饭', amount: null, evidence: 'Sam 付钱吃了午饭。' };
        await f.append(unknown.evidence + marker(unknown), '2026-01-11');
        const pending = assetRows(f.state(), 'story_event').find(x => !x.processed), paid = assetRows(f.state(), 'cash_transaction')[0];
        f.reply({ ...evaluation('2026-01-11'), events: [{ id: pending.id, amount: 10 }], living: { total: 100, bookedIds: [paid.id, 'cash:' + pending.id] } });
        ok(await f.assets.update()); assert.equal(cashBalance(f.state()), 90000, 'total living cost $100, not $115');
    } finally { f.close(); }
});

test('salary pays all intervening fifteenths and prorates opening employment; fixed salary never rerolled', async () => {
    const f = setup(); try {
        ok(await f.assets.update()); await f.append('春天。', '2026-04-18'); f.reply(evaluation('2026-04-18')); ok(await f.assets.update());
        const wages = assetRows(f.state(), 'cash_transaction').filter(t => t.source === 'salary');
        assert.deepEqual(wages.map(t => t.payDate), ['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15']);
        assert.equal(wages[0].deltaMinor, 140000); assert.equal(cashBalance(f.state()), 1170000);
        await f.append('继续。', '2026-04-19'); f.reply({ ...evaluation('2026-04-19'), salaries: [{ id: 'initial:job:0', monthlySalary: 5000 }] });
        assert.equal((await f.assets.update()).ok, false); assert.equal(cashBalance(f.state()), 1170000);
    } finally { f.close(); }
});

test('promotion and termination split salary periods, with no pay after termination', async () => {
    const f = setup('2026-01-15'); try {
        ok(await f.assets.update());
        const row = { kind: 'job', name: '咖啡馆店长', action: 'change', jobId: 'initial:job:0', monthlySalary: 6200, evidence: 'Sam 升任店长，月薪6200美元。' };
        await f.append(row.evidence + marker(row), '2026-02-01'); const job = assetRows(f.state(), 'job').find(j => j.endDay == null);
        const end = { kind: 'job', name: '咖啡馆店长', action: 'end', jobId: job.id, evidence: 'Sam 今天正式离职。' };
        await f.append(end.evidence + marker(end), '2026-02-10');
        await f.append('到了三月。', '2026-03-16'); f.reply(evaluation('2026-03-16')); ok(await f.assets.update());
        const pay = assetRows(f.state(), 'cash_transaction').filter(t => t.source === 'salary');
        assert.equal(pay.length, 1); assert.equal(pay[0].deltaMinor, 350000, '17 days old salary + 9 days new salary');
    } finally { f.close(); }
});

test('new job without salary is fixed on update; missed job facts are evidence-backed', async () => {
    const f = setup('2026-01-15'); try {
        f.reply({ ...initial('2026-01-15'), initial: { balance: 1000, holdings: [], jobs: [] } }); ok(await f.assets.update());
        const row = { kind: 'job', name: '理发师', evidence: 'Sam 今天入职理发店。' };
        await f.append(row.evidence + marker(row), '2026-01-20');
        const job = assetRows(f.state(), 'job')[0]; assert.equal(job.monthlyMinor, null);
        f.reply({ ...evaluation('2026-01-20'), salaries: [{ id: job.id, monthlySalary: 3100 }] }); ok(await f.assets.update());
        await f.append('发薪日到了。', '2026-02-15'); f.reply(evaluation('2026-02-15')); ok(await f.assets.update());
        assert.equal(cashBalance(f.state()), 360000);
    } finally { f.close(); }
});

test('explicit payday and app payroll cannot pay the same wage twice in either order', async () => {
    const f = setup('2026-01-15'); try {
        ok(await f.assets.update());
        const row = { kind: 'income', name: '工资', amount: 3100, salaryEmployer: 'initial:job:0', payDate: '2026-02-15', evidence: 'Sam 收到工资3100美元。' };
        await f.append(row.evidence + marker(row), '2026-02-15'); f.reply(evaluation('2026-02-15')); ok(await f.assets.update()); assert.equal(cashBalance(f.state()), 410000);
        await f.append('Sam 确认刚收到工资3100美元。' + marker({ ...row, evidence: 'Sam 确认刚收到工资3100美元。' }));
        assert.equal(cashBalance(f.state()), 410000);
    } finally { f.close(); }
});

test('two-year leap and leap-year proration are deterministic and not limited to one month', () => {
    const state = { assets: { wallet: { startDay: day('2024-01-15') }, job: { id: 'job', type: 'job', employer: 'job', name: '工作', monthlyMinor: 10000, startDay: day('2024-01-15'), endDay: null } } };
    const payments = salaryPayments(state, day('2026-01-15')); assert.equal(payments.length, 24); assert.equal(payments.reduce((s, c) => s + c.value.deltaMinor, 0), 240000);
    applyAssetChanges(state, payments); assert.equal(salaryPayments(state, day('2026-01-15')).length, 0);
});

test('investment market value is not cash, business cash and booked revenue settle once', async () => {
    const f = setup(); try {
        f.reply({ ...initial(), initial: { balance: 1000, jobs: [], holdings: [{ name: '店铺', category: 'investment', value: 10000 }, { name: '股票', category: 'investment', value: 500 }] } }); ok(await f.assets.update());
        const income = { kind: 'income', name: '营业收入', amount: 50, evidence: 'Sam 收到营业收入50美元。' };
        await f.append(income.evidence + marker(income), '2026-01-11'); const t = assetRows(f.state(), 'cash_transaction')[0];
        f.reply({ ...evaluation('2026-01-11'), valuations: [{ id: 'initial:holding:1', value: 1000 }], business: [{ id: 'initial:holding:0', netIncome: 200, bookedIds: [t.id] }] });
        ok(await f.assets.update()); assert.equal(cashBalance(f.state()), 120000); assert.equal(f.state().assets['initial:holding:1'].valueMinor, 100000);
    } finally { f.close(); }
});

test('debt prompt is consumed only by an evidenced scene and deletion restores it', async () => {
    const f = setup(); try {
        f.reply(initial('2026-01-01', -100)); ok(await f.assets.update());
        const episode = debtEpisode(f.state()); assert.ok(episode);
        assert.match(buildAssetPrompt(f.state(), f.settings), /适当时机/);
        const text = '房东提醒了Sam逾期的房租。'; await f.append(text + '<!--durian-debt:' + JSON.stringify({ id: episode, evidence: text }) + '-->');
        assert.doesNotMatch(buildAssetPrompt(f.state(), f.settings), /适当时机/); assert.equal(cashBalance(f.state()), -10000);
        f.c.chat.pop(); f.bus.emit('MESSAGE_DELETED'); await f.memory.read(); assert.match(buildAssetPrompt(f.state(), f.settings), /适当时机/);
    } finally { f.close(); }
});

test('Snapchat reserves pending payments, rejects insufficient cash, credits incoming and releases declined funds', async () => {
    const f = setup(); try {
        ok(await f.assets.update()); const ticket = await f.memory.begin(); await f.memory.commit(ticket, [{ collection: 'snapchat', key: 'friend', value: { id: 'friend', type: 'account', name: 'Alex', friend: 'friends' } }]);
        const a = await f.snap.transfer('friend', '700', 'USD', ''); ok(a); assert.equal(reservedCash(f.state()), 70000);
        assert.equal((await f.snap.transfer('friend', '400', 'USD', '')).ok, false); const before = f.count(); ok(await f.snap.settle(a.value, false)); assert.equal(f.count(), before); assert.equal(reservedCash(f.state()), 0);
        const b = await f.snap.transfer('friend', '700', 'USD', ''); ok(b); f.reply({ status: 'accepted' }); ok(await f.snap.settle(b.value)); assert.equal(cashBalance(f.state()), 30000);
        const t = await f.memory.begin(); await f.memory.commit(t, [{ collection: 'snapchat', key: 'incoming', value: { id: 'incoming', type: 'transfer', accountId: 'friend', direction: 'incoming', status: 'pending', amountMinor: 2500, currency: 'USD' } }]);
        ok(await f.snap.settle('incoming')); assert.equal(cashBalance(f.state()), 32500); assert.equal((await f.snap.settle('incoming')).ok, false);
    } finally { f.close(); }
});

test('Amazon checkout checks funds, books once, registers self luxury, and rollback restores cart and cash', async () => {
    const f = setup(); try {
        ok(await f.assets.update()); f.reply({ products: [{ name: '手袋', brand: '品牌', luxury: true, price: 600, currency: 'USD' }] }); ok(await f.shop.search('手袋'));
        const p = Object.values(f.state().orders).find(p => p.type === 'product'); ok(await f.shop.add(p.id, '', 2)); const before = f.count(); assert.equal((await f.shop.checkout()).ok, false); assert.equal(f.count(), before);
        ok(await f.shop.remove(f.state().orders.cart.items[0].id)); ok(await f.shop.add(p.id, '', 1)); await f.append('准备购物。', '2026-01-02'); ok(await f.shop.checkout());
        assert.equal(cashBalance(f.state()), 40000); assert.equal(assetRows(f.state(), 'holding').length, 1);
        f.c.chat.pop(); f.bus.emit('MESSAGE_DELETED'); await f.memory.read(); assert.equal(cashBalance(f.state()), 100000); assert.equal(f.state().orders.cart.items.length, 1); assert.equal(assetRows(f.state(), 'holding').length, 0);
    } finally { f.close(); }
});

test('failure makes one model attempt, no partial write; chat change discards late assessment', async () => {
    const f = setup(); try {
        f.reply({ date: 'invalid' }); assert.equal((await f.assets.update()).ok, false); assert.equal(f.count(), 1); assert.equal(f.state().assets.wallet, undefined);
        let finish, start; const started = new Promise(r => start = r); f.reply(() => { start(); return new Promise(r => finish = r); });
        const pending = f.assets.update(); await started; f.c.chatId = 'other'; f.c.chatMetadata = {}; f.bus.emit('CHAT_CHANGED'); await f.memory.read(); finish(JSON.stringify(initial()));
        assert.equal((await pending).ok, false); assert.equal(f.state().assets.wallet, undefined);
    } finally { f.close(); }
});

test('without a scene clock the model date initializes and later model dates are trusted', () => {
    const args = { chat: [{ mes: '没有日期的剧情。' }], index: 0, revision: 'a', memoryText: '日期：1999-03-02\n当前记忆。' };
    assert.equal(applyAssessment({ assets: {} }, initial('1999-03-02'), {...args,persona:'Sam 常住美国。'}).at(-1).value.lastDay, day('1999-03-02'));
    const later = applyAssessment({ assets: {} }, initial('1999-03-03'), args);
    assert.equal(later.at(-1).value.lastDay, day('1999-03-03'));
});

test('narrative prompt is each normal turn, absent for quiet/impersonate/disabled app and cleared afterwards', async () => {
    const f = setup(), bridge = createAssetBridge({ getContext: () => f.c, getSettings: () => f.settings }); try {
        ok(await f.assets.update()); await bridge.prepare(); assert.match(f.c.extensionPrompts[ASSETS_KEY], /\$1,000.00/); assert.match(f.c.extensionPrompts[ASSETS_KEY], /不估价/);
        await bridge.prepare('quiet'); assert.equal(f.c.extensionPrompts[ASSETS_KEY], ''); await bridge.prepare('impersonate'); assert.equal(f.c.extensionPrompts[ASSETS_KEY], '');
        f.settings.apps.assets = false; await bridge.prepare(); assert.equal(f.c.extensionPrompts[ASSETS_KEY], ''); assert.equal((await f.assets.update()).ok, false);
    } finally { bridge.destroy(); f.close(); }
});

test('user/system/thinking/code annotations and invented amounts cannot alter balance; only six cash rows are exposed', async () => {
    const f = setup(); try {
        ok(await f.assets.update()); const row = { kind: 'expense', name: '消费', amount: 5, evidence: 'Sam 花了5美元。' }, text = row.evidence + marker(row);
        f.c.chat.push({ mes: text, is_user: true }, { mes: text, is_system: true }, { mes: '<think>' + text + '</think>' }, { mes: '```\n' + text + '\n```' }); await f.memory.read(); assert.equal(cashBalance(f.state()), 100000);
        await f.append('Sam 花了50美元。' + marker({ ...row, evidence: 'Sam 花了50美元。' })); assert.equal(cashBalance(f.state()), 100000);
        for (let i = 0; i < 8; i++) await f.append(text + i);
        assert.equal(recentCash(f.state()).length, 6); assert.equal(assetRows(f.state(), 'cash_transaction').length, 8);
    } finally { f.close(); }
});

test('pre-existing cash is absorbed into the opening snapshot and cannot be counted again', async () => {
    const f = setup(); try {
        await f.memory.read(); const ticket = await f.memory.begin();
        await f.memory.commit(ticket, [{ collection: 'assets', key: 'old-transfer', value: { id: 'old-transfer', type: 'cash_transaction', currency: 'USD', deltaMinor: 20000, source: 'snapcash' } }]);
        ok(await f.assets.update()); assert.equal(cashBalance(f.state()), 100000);
        await f.append('又过一天。', '2026-01-02'); f.reply(evaluation('2026-01-02')); ok(await f.assets.update()); assert.equal(cashBalance(f.state()), 100000);
    } finally { f.close(); }
});

test('unclassified purchases can become assets without another debit; discounts do not set market value', async () => {
    const f = setup(); try {
        ok(await f.assets.update()); const row = { kind: 'expense', name: '古董腕表', amount: 100, evidence: 'Sam 折扣购买腕表花了100美元。' };
        await f.append(row.evidence + marker(row), '2026-01-02'); const event = assetRows(f.state(), 'story_event')[0];
        f.reply({ ...evaluation('2026-01-02'), ownership: [{ eventId: event.id, category: 'luxury', value: 500 }] }); ok(await f.assets.update());
        assert.equal(cashBalance(f.state()), 90000); assert.equal(assetRows(f.state(), 'holding')[0].valueMinor, 50000);
        await f.append('又一天。', '2026-01-03'); f.reply({ ...evaluation('2026-01-03'), valuations: [{ id: 'holding:' + event.id, value: 800 }] });
        assert.equal((await f.assets.update()).ok, false, 'fixed luxury value cannot reroll'); assert.equal(assetRows(f.state(), 'holding')[0].valueMinor, 50000);
    } finally { f.close(); }
});

test('salary without payday attribution remains pending, then links to the automatic payday once', async () => {
    const f = setup('2026-01-15'); try {
        ok(await f.assets.update()); const row = { kind: 'income', name: '本月工资', amount: 3100, evidence: 'Sam 收到本月工资3100美元。' };
        await f.append(row.evidence + marker(row), '2026-02-15'); assert.equal(cashBalance(f.state()), 100000);
        const event = assetRows(f.state(), 'story_event')[0];
        f.reply({ ...evaluation('2026-02-15'), events: [{ id: event.id, salaryEmployer: 'initial:job:0', payDate: '2026-02-15' }] }); ok(await f.assets.update());
        assert.equal(cashBalance(f.state()), 410000);
    } finally { f.close(); }
});

test('already reconciled expense cannot reduce a future living estimate; invalid result is atomic', async () => {
    const f = setup(); try {
        ok(await f.assets.update()); const row = { kind: 'expense', name: '午饭', amount: 10, evidence: 'Sam 午饭花了10美元。' };
        await f.append(row.evidence + marker(row), '2026-01-02'); const tx = assetRows(f.state(), 'cash_transaction')[0];
        f.reply({ ...evaluation('2026-01-02'), living: { total: 10, bookedIds: [tx.id] } }); ok(await f.assets.update());
        await f.append('又过一天。', '2026-01-03'); f.reply({ ...evaluation('2026-01-03'), living: { total: 20, bookedIds: [tx.id] } });
        assert.equal((await f.assets.update()).ok, false); assert.equal(cashBalance(f.state()), 99000);
    } finally { f.close(); }
});

test('no narrative time elapsed means no invented operating income or living charge; save failure does not lock', async () => {
    const f = setup(); try {
        ok(await f.assets.update()); await f.append('仍然是同一天。');
        f.reply({ ...evaluation('2026-01-01'), living: { total: 10, bookedIds: [] } }); assert.equal((await f.assets.update()).ok, false);
        const revision = f.state().assets.wallet.revision; f.reply(evaluation('2026-01-01')); f.c.saveMetadata = async () => { throw Error('disk'); };
        assert.equal((await f.assets.update()).ok, false); assert.equal(f.state().assets.wallet.revision, revision);
        f.c.saveMetadata = async () => {}; ok(await f.assets.update());
    } finally { f.close(); }
});

test('asset update accepts a single JSON in reasoning/markdown wrappers, one request and correct initialization contract',async()=>{
 const f=setup();try{
  f.reply(()=>'<think>{"example":"not the result"}</think>\n评估结果：\n```json\n'+JSON.stringify(initial())+'\n```\n');
  ok(await f.assets.update());assert.equal(f.count(),1);assert.equal(cashBalance(f.state()),100000);
  assert.match(f.prompt(),/本次首次建账：只使用首次格式/);
  await f.append('Another day.','2026-01-02');f.reply(()=>'<content>'+JSON.stringify(evaluation('2026-01-02'))+'</content>');
  ok(await f.assets.update());assert.equal(f.count(),2);assert.match(f.prompt(),/本次已有账本：只使用后续格式/);
 }finally{f.close();}
});

test('truncated or ambiguous asset JSON never changes wallet and never silently retries',async()=>{
 const f=setup();try{
  for(const text of [JSON.stringify(initial()).slice(0,-1),JSON.stringify(initial())+'\n'+JSON.stringify(initial()),'这里没有账本 JSON']){
   f.reply(()=>text);const before=f.count();const result=await f.assets.update();
   assert.equal(result.ok,false);assert.match(result.error,/格式不正确/);assert.equal(f.count(),before+1);assert.equal(cashBalance(f.state()),null);
  }
 }finally{f.close();}
});

test('asset errors include transport, stage and amount field but never persist raw replies',async()=>{
 const f=setup(), errors=[]; f.phone.destroy();
 const phone=createPhoneService({memory:f.memory,getContext:()=>f.c,getSettings:()=>f.settings,onError:e=>errors.push(e)});
 const assets=createAssets({memory:f.memory,phone,getContext:()=>f.c,getSettings:()=>f.settings});
 try {
  f.reply(()=>'<content>{"date":"2026-01-01","initial":');
  let result=await assets.update();
  assert.equal(result.ok,false);assert.equal(result.code,'MODEL_JSON_TRUNCATED');
  assert.match(errors.at(-1).diagnostic,/跟随酒馆.*解析返回格式.*本次请求次数：1/);
  f.reply({...initial(),initial:{balance:'$1,000 secret-scene',holdings:[],jobs:[]}});
  result=await assets.update();assert.equal(result.code,'ASSET_MONEY_INVALID');
  assert.match(result.error,/initial.balance/);assert.match(errors.at(-1).diagnostic,/校验业务数据/);
  assert.match(errors.at(-1).diagnostic,/收到类型：string/);
  assert.ok(!JSON.stringify(errors.map(e=>({message:e.message,diagnostic:e.diagnostic}))).includes('secret-scene'));
  assert.equal(phone.snapshot().assets.wallet,undefined);assert.equal(f.count(),2);
  f.reply(()=>{throw Error('network failed');});
  await assets.update();assert.match(errors.at(-1).diagnostic,/失败阶段：请求模型/);assert.equal(f.count(),3);
  f.reply(initial());ok(await assets.update());assert.equal(cashBalance(phone.snapshot()),100000);
 } finally {phone.destroy();f.memory.destroy();}
});

test('wrapped asset JSON preserves quoted annotation text and rejects unsafe amount formats atomically',async()=>{
 const f=setup();try{
  const data={...initial(),note:'literal <analysis> is text'};
  f.reply(()=>'<content>'+JSON.stringify(data)+'</content>');
  ok(await f.assets.update());assert.equal(f.state().assets.wallet.note,data.note);
  await f.append('Another day.','2026-01-02');
  f.reply({...evaluation('2026-01-02'),living:{total:'1,000',bookedIds:[]}});
  const result=await f.assets.update();assert.equal(result.ok,false);assert.match(result.error,/living.total/);
  assert.equal(cashBalance(f.state()),100000);assert.equal(f.count(),2);
 }finally{f.close();}
});


test('month leap resolves four pending short references, deducts living once and persists a transparent settlement', async () => {
 const f=setup('2026-05-12');try{
  f.reply({residence:{region:'US',currency:'USD',evidence:'Sam 常住美国。'},initial:{balance:12000,holdings:[],jobs:[{name:'文学作者',monthlySalary:4500}]}});ok(await f.assets.update());
  const rows=['餐费','交通费','酒店费','日用品'].map(name=>({kind:'expense',name,evidence:'Sam支付了'+name+'。'}));
  await f.append(rows.map(r=>r.evidence+marker(r)).join('\n'),'2026-05-20');
  await f.append('【2026年5月20日 09:30 星期三 至 2026年6月24日 19:40 星期三|旅行结束】');
  const refs=assessmentReferences(f.state());assert.equal(refs.length,4);
  const result={...evaluation('2026-06-24'),events:refs.map(r=>({id:r.ref,amount:100})),living:{total:2000,bookedIds:refs.map(r=>r.ref)}};
  f.reply(result);ok(await f.assets.update());
  assert.match(f.prompt(),/完整经过 43 天/);assert.match(f.prompt(),/offsetReferences/);
  const summary=f.state().assets.wallet.settlement;
  assert.equal(summary.days,43);assert.equal(summary.livingPaidMinor,40000);assert.equal(summary.livingAddedMinor,160000);
  assert.equal(summary.salaryAddedMinor,495000);assert.equal(summary.incomeAddedMinor,495000);assert.equal(summary.expenseAddedMinor,200000);
  assert.equal(summary.netChangeMinor,295000);assert.equal(cashBalance(f.state()),1495000);
  const panel=createAssetPanel({adapter:{},getView:()=>f.state(),redraw(){},notice(){}});
  assert.match(panel.html(),/上次结算明细/);
  assert.doesNotMatch(panel.html(),/43 天/); // 结算明细默认折叠，不占首屏
  await panel.action('ledger');
  const opened=panel.html();
  assert.match(opened,/aria-expanded="true"/);assert.match(opened,/43 天/);assert.match(opened,/本次补扣生活费/);assert.match(opened,/\$1,600.00/);
  await panel.action('tab','fixed');await panel.action('tab','cash');
  assert.match(panel.html(),/43 天/); // 展开状态在界面重绘后保持
  await f.memory.read();assert.deepEqual(f.state().assets.wallet.settlement,summary);
  assert.equal((await f.assets.update()).ok,false);assert.equal(cashBalance(f.state()),1495000);
  f.c.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();
  assert.equal(f.state().assets.wallet.lastDay,day('2026-05-12'));assert.equal(f.state().assets.wallet.settlement,null);assert.equal(cashBalance(f.state()),1200000);
 }finally{f.close();}
});

test('event ID, cash ID and short ref for one expense count only once within living total',async()=>{
 const f=setup();try{ok(await f.assets.update());const e={kind:'expense',name:'午饭',amount:10,evidence:'Sam午饭花了10美元。'};
 await f.append(e.evidence+marker(e),'2026-01-02');const tx=assetRows(f.state(),'cash_transaction')[0];
 f.reply({...evaluation('2026-01-02'),living:{total:100,bookedIds:['C1',tx.eventId,tx.id]}});ok(await f.assets.update());
 assert.equal(cashBalance(f.state()),90000);assert.equal(f.state().assets.wallet.settlement.livingPaidMinor,1000);
 assert.equal(f.state().assets.wallet.settlement.netChangeMinor,-9000);
 }finally{f.close();}
});

test('invalid offset diagnostics distinguish unknown, income, previous settlement and cross-total duplicates atomically',async()=>{
 const f=setup();try{f.reply({...initial(),initial:{balance:1000,jobs:[],holdings:[{name:'店铺',category:'investment',value:100}]}});ok(await f.assets.update());
 const rows=[{kind:'expense',name:'开销',amount:10,evidence:'Sam花了10美元。'},{kind:'income',name:'收入',amount:20,evidence:'Sam收到20美元。'}];
 await f.append(rows.map(r=>r.evidence+marker(r)).join('\n'),'2026-01-02');const before=structuredClone(f.state().assets);
 for(const [refs,pattern] of [[['missing'],/未找到对应/],[['C2'],/只能抵扣支出/],[['initial:holding:0'],/未找到对应/]]){
 f.reply({...evaluation('2026-01-02'),living:{total:10,bookedIds:refs}});const r=await f.assets.update();assert.equal(r.ok,false);assert.match(r.error,pattern);assert.deepEqual(f.state().assets,before);}
 f.reply({...evaluation('2026-01-02'),living:{total:10,bookedIds:['C1']},business:[{id:'initial:holding:0',netIncome:20,bookedIds:['C1']}]});
 let r=await f.assets.update();assert.equal(r.ok,false);assert.match(r.error,/其他结算项目/);assert.deepEqual(f.state().assets,before);
 f.reply({...evaluation('2026-01-02'),living:{total:10,bookedIds:['C1']}});ok(await f.assets.update());
 const old=assetRows(f.state(),'cash_transaction').find(t=>t.deltaMinor<0);await f.append('次日','2026-01-03');
 assert.equal(assessmentReferences(f.state()).length,0);f.reply({...evaluation('2026-01-03'),living:{total:10,bookedIds:[old.id]}});
 r=await f.assets.update();assert.equal(r.ok,false);assert.match(r.error,/以前的结算/);
 }finally{f.close();}
});

test('elapsed period cannot silently skip missing living estimate, explicit zero still saves',async()=>{
 const f=setup();try{ok(await f.assets.update());await f.append('费用由他人承担','2026-02-01');
 const before=structuredClone(f.state().assets);const result=evaluation('2026-02-01');delete result.living;f.reply(result);
 const r=await f.assets.update();assert.equal(r.ok,false);assert.match(r.error,/缺少本期生活开销/);assert.deepEqual(f.state().assets,before);
 f.reply(evaluation('2026-02-01'));ok(await f.assets.update());assert.equal(f.state().assets.wallet.settlement.livingTotalMinor,0);
 }finally{f.close();}
});

test('short offsets cannot create a payment from an unresolved or noncash event',async()=>{
 const f=setup();try{ok(await f.assets.update());const row={kind:'asset',name:'获赠权益',category:'investment',evidence:'Sam获赠权益。'};
 await f.append(row.evidence+marker(row),'2026-01-02');const e=assetRows(f.state(),'story_event')[0],before=structuredClone(f.state().assets);
 f.reply({...evaluation('2026-01-02'),living:{total:10,bookedIds:[e.id]}});assert.equal((await f.assets.update()).ok,false);assert.deepEqual(f.state().assets,before);
 }finally{f.close();}
});

test('luxury gifts with excerpt evidence import before assessment, keep unknown value and rollback',async()=>{
 const f=setup();try{
  ok(await f.assets.update());
  const first='她选好了红宝石色高定礼服和金色手包';
  const last='他刷卡付账说：“这枚卡地亚钻戒送给你，现在就戴上。”';
  const text=first+'。随后他们又看了首饰柜台。'+last;
  await f.append(text+marker({kind:'asset',name:'红宝石色高定礼服、鞋包与卡地亚钻戒',category:'luxury',amount:null,date:'2026-01-02',evidence:first+'……'+last,details:'由朋友买单赠送给user'}),'2026-01-02');
  const holdings=assetRows(f.state(),'holding');assert.equal(holdings.length,1);assert.equal(holdings[0].category,'luxury');assert.equal(holdings[0].valueMinor,null);assert.equal(cashBalance(f.state()),100000);
  const panel=createAssetPanel({adapter:{},getView:f.state,redraw(){},notice(){}});await panel.action('tab','luxury');assert.match(panel.html(),/卡地亚钻戒/);assert.match(panel.html(),/待估值/);
  await f.memory.read();assert.equal(assetRows(f.state(),'holding').length,1);assert.equal(f.count(),1,'import has no model call');
  f.reply(evaluation('2026-01-02'));ok(await f.assets.update());assert.equal(assetRows(f.state(),'holding').length,1);assert.equal(cashBalance(f.state()),100000);
  f.c.chat.pop();await f.memory.read();assert.equal(assetRows(f.state(),'holding').length,0);assert.equal(cashBalance(f.state()),100000);
 }finally{f.close();}
});

test('classification repair excludes tools without deleting cash, values or ownership and rolls back',async()=>{
 const f=setup();try{
  const first=initial();first.initial.holdings=[{name:'常备撬棍及日常工具',category:'fixed',value:85},{name:'卡地亚钻戒',category:'fixed',value:4200}];f.reply(first);ok(await f.assets.update());
  await f.append('买咖啡花了5美元。'+marker({kind:'expense',name:'咖啡',amount:5,evidence:'买咖啡花了5美元。'}),'2026-01-02');
  const before=structuredClone(f.state()), hs=assetRows(before,'holding');
  f.reply({...evaluation('2026-01-02'),classifications:[{id:hs[0].id,category:'exclude',reason:'普通日常工具不是大件资产'},{id:hs[1].id,category:'luxury',reason:'名牌钻戒属于奢侈品'}]});ok(await f.assets.update());
  const after=f.state();assert.equal(cashBalance(after),cashBalance(before));assert.deepEqual(assetRows(after,'cash_transaction'),assetRows(before,'cash_transaction'));
  assert.equal(after.assets[hs[0].id].active,true);assert.equal(after.assets[hs[0].id].valueMinor,8500);assert.equal(after.assets[hs[0].id].excludedFromAssets,true);
  assert.equal(after.assets[hs[1].id].category,'luxury');assert.equal(after.assets[hs[1].id].valueMinor,420000);
  const panel=createAssetPanel({adapter:{},getView:f.state,redraw(){},notice(){}});await panel.action('tab','fixed');assert.doesNotMatch(panel.html(),/撬棍|卡地亚/);await panel.action('tab','luxury');assert.match(panel.html(),/卡地亚/);
  f.c.chat.pop();await f.memory.read();assert.equal(f.state().assets[hs[0].id].excludedFromAssets,undefined);assert.equal(f.state().assets[hs[1].id].category,'fixed');
 }finally{f.close();}
});

test('invalid classification IDs, duplicates and investment targets fail atomically',()=>{
 const d=day('2026-01-01'), original={assets:{wallet:{id:'wallet',type:'wallet',ownershipAuditVersion:1,openingMinor:100000,lastDay:d,lastIndex:0},tool:{id:'tool',type:'holding',category:'fixed',name:'工具',valueMinor:8500,active:true},right:{id:'right',type:'holding',category:'investment',name:'版权',active:true}}};
 const args={chat:[{mes:'日期：2026-01-01'},{mes:'日期：2026-01-02'}],index:1,revision:'next'};
 for(const rows of [[{id:'no',category:'exclude'}],[{id:'right',category:'exclude'}],[{id:'tool',category:'investment'}],[{id:'tool',category:'exclude'},{id:'tool',category:'fixed'}]]){
  const copy=structuredClone(original);assert.throws(()=>applyAssessment(original,{...evaluation('2026-01-02'),classifications:rows},args),/分类修正无效/);assert.deepEqual(original,copy);
 }
});

test('one-click valuation of an existing gift needs no new prose or cash transaction',async()=>{
 const f=setup();try{
  const first=initial();first.initial.holdings=[{name:'12.5克拉枕形切割铂金钻戒',category:'luxury',value:null}];f.reply(first);ok(await f.assets.update());
  await f.append('继续生活。','2026-01-02');const h=assetRows(f.state(),'holding')[0];const before=cashBalance(f.state());
  f.reply({...evaluation('2026-01-02'),valuations:[{id:h.id,value:125000}]});ok(await f.assets.update());
  assert.equal(f.state().assets[h.id].valueMinor,12500000);assert.equal(cashBalance(f.state()),before);
  assert.match(f.prompt(),/无需正文写明价格/);assert.match(f.prompt(),/不是新增 events/);
  f.c.chat.pop();await f.memory.read();assert.equal(f.state().assets[h.id].valueMinor,null);
 }finally{f.close();}
});

test('events anchored to already-settled floors are skipped while valid valuation and living expense settle',async()=>{
 const f=setup();try{
  const first=initial();first.initial.holdings=[{name:'钻戒',category:'luxury',value:null}];f.reply(first);ok(await f.assets.update());
  await f.append('今天继续生活。','2026-01-11');const h=assetRows(f.state(),'holding')[0];
  f.reply({...evaluation('2026-01-11'),events:[{kind:'expense',name:'重扣旧购物',amount:9,sourceIndex:0}],valuations:[{id:h.id,value:5000}],living:{total:100,bookedIds:[]}});
  ok(await f.assets.update());assert.equal(f.state().assets[h.id].valueMinor,500000);assert.equal(cashBalance(f.state()),90000);assert.equal(f.state().assets.wallet.skippedUnverified,1);
  assert.equal(assetRows(f.state(),'cash_transaction').some(t=>t.memo==='重扣旧购物'),false);
  const panel=createAssetPanel({adapter:{},getView:f.state,redraw(){},notice(){}});assert.match(panel.html(),/跳过 1 条/);
  f.c.chat.pop();await f.memory.read();assert.equal(f.state().assets[h.id].valueMinor,null);assert.equal(cashBalance(f.state()),100000);
 }finally{f.close();}
});

test('Chinese persona and narrative resolve local money, independent of language, nationality or travel',async()=>{
 for(const [region,currency,evidence,price] of [
  ['CN','CNY','Sam 常住中国上海，在当地工作。',3.25],
  ['JP','JPY','Sam 在日本东京长期生活。',325],
  ['HK','HKD','Sam 常住香港。',3.25],
  ['KW','KWD','Sam 常住科威特。',3.251]
 ]) {
  const f=setup();try{
   f.c.powerUserSettings.persona_description=region==='JP'?'Sam 是中国籍，最近去北京旅行。':evidence;
   if(region==='JP')f.c.chat[0].mes+='\n'+evidence;
   f.reply({...initial(),residence:{region,currency,evidence},currency});
   ok(await f.assets.update());assert.equal(f.count(),1);assert.equal(f.state().assets.wallet.currency,currency);
   assert.match(f.prompt(),/正文语言/);assert.equal(f.prompt().includes(evidence),region!=='JP');
   const scale=region==='JP'?1:region==='KW'?1000:100;
   assert.equal(cashBalance(f.state()),1000*scale);
   await f.append('Sam 短期去别国旅游。她支付了'+price+'。'+marker({kind:'expense',name:'饮料',currency,amount:price,evidence:'她支付了'+price+'。'}),'2026-01-02');
   assert.equal(cashBalance(f.state()),1000*scale-Math.round(price*scale));
   f.reply({...evaluation('2026-01-02'),residence:null});ok(await f.assets.update());assert.equal(f.state().assets.wallet.currency,currency);
   f.reply({products:[{name:'水杯',price:String(price),currency}]});ok(await f.shop.search('水杯'));
   const item=Object.values(f.state().orders).find(r=>r.type==='product');ok(await f.shop.add(item.id,'',1));ok(await f.shop.checkout());
   assert.equal(cashBalance(f.state()),1000*scale-2*Math.round(price*scale));
  }finally{f.close();}
 }
});

test('wrong region/currency pairs cannot open a wallet; declared homes are trusted',async()=>{
 for(const home of [null,{region:'JP',currency:'CNY'}]){
  const f=setup();try{f.c.powerUserSettings.persona_description='Sam 使用中文。Sam 正在日本旅游。';f.reply({...initial(),residence:home});assert.equal((await f.assets.update()).ok,false);assert.equal(f.state().assets.wallet,undefined);}finally{f.close();}
 }
 const f=setup();try{f.c.powerUserSettings.persona_description='Sam 使用中文。Sam 正在日本旅游。';f.reply({...initial(),residence:{region:'JP',currency:'JPY'}});ok(await f.assets.update());assert.equal(f.state().assets.wallet.currency,'JPY');}finally{f.close();}
});

test('legacy USD migration quotes the pair, converts atomically using a user rate and rolls back with its floor',async()=>{
 const f=setup();try{
  ok(await f.assets.update());const original={...f.state().assets.wallet};delete original.currency;delete original.region;
  await f.memory.commit(await f.memory.begin(),[{collection:'assets',key:'wallet',value:original}]);
  f.c.powerUserSettings.persona_description='Sam 已经搬到日本并在东京定居。';
  await f.append('Sam 开始在东京生活。','2026-01-02');
  f.reply({residence:{region:'JP',currency:'JPY',evidence:f.c.powerUserSettings.persona_description},currency:'JPY'});
  const proposal=await f.assets.update();ok(proposal);assert.equal(proposal.value.switchFrom,'USD');assert.equal(proposal.value.switchTo,'JPY');
  assert.equal(cashBalance(f.state()),100000);
  assert.equal((await f.assets.convert('0')).ok,false);assert.equal(cashBalance(f.state()),100000);
  const calls=f.count();ok(await f.assets.convert('150'));assert.equal(f.count(),calls);assert.equal(cashBalance(f.state()),150000);
  assert.equal(assetRows(f.state(),'job')[0].monthlyMinor,465000);assert.equal(f.state().assets.wallet.currency,'JPY');
  f.c.chat.pop();await f.memory.read();assert.equal(cashBalance(f.state()),100000);assert.equal(f.state().assets.wallet.currency,undefined);
 }finally{f.close();}
});

test('residence combines persona and everyday school geography without requiring a country-name sentence',async()=>{
 for(const [place,region,currency] of [['南加州','US','USD'],['关东地区','JP','JPY'],['苏格兰','GB','GBP']]){
  const f=setup();try{
   f.c.powerUserSettings.persona_description='Nationality: '+(region==='US'?'美国':'其他')+'\nIdentity: 高中毕业班学生';
   f.c.chat[0].mes='日期：2026-01-01\n'+place+'的清晨。\n你走进学校，开始高三开学第一天。';
   f.reply({...initial(),residence:{place,region,currency,evidence:['Identity: 高中毕业班学生',place+'的清晨。你走进学校，开始高三开学第一天。']}});
   const n=f.count();ok(await f.assets.update());assert.equal(f.count(),n+1);assert.equal(f.state().assets.wallet.currency,currency);
   assert.match(f.prompt(),/place允许填写推断出的真实地区/);assert.doesNotMatch(f.prompt(),/residenceContext/);
  }finally{f.close();}
 }
});
test('residence resolution validates only the region/currency pair and a non-language place',async()=>{
 const {resolveResidence}=await import('../src/currency.js');
 const persona='Nationality: 美国\nIdentity: 高中毕业班学生';
 const prose=[{text:'<p>南加州的清晨。</p>你走进学校。'},{text:'这里是你上学的地方。'}];
 assert.deepEqual(resolveResidence({region:'US',currency:'USD',place:'南加州',evidence:['Nationality: 美国','南加州的清晨。']},persona,prose),{region:'US',currency:'USD'});
 assert.deepEqual(resolveResidence({region:'US',currency:'USD',place:'南加州',inferred:true},persona,prose),{region:'US',currency:'USD'});
 assert.deepEqual(resolveResidence({region:'JP',currency:'JPY',place:'东京',evidence:'不存在的原句'},persona,prose),{region:'JP',currency:'JPY'});
 assert.throws(()=>resolveResidence({region:'US',currency:'CNY',place:'南加州'},persona,prose),/币种不匹配/);
 assert.throws(()=>resolveResidence({region:'US',currency:'USD',place:'中文'},persona,prose),/语言名称/);
});

for(const mode of ['id','ref','source'])test('API estimates an actual expense with no narrative number after several floors via '+mode,async()=>{
 const f=setup();try{
  f.reply({...initial(),initial:{balance:80,holdings:[],jobs:[]}});ok(await f.assets.update());
  const fact='Sam 支付了当天的午餐费用。';await f.append(fact+marker({kind:'expense',name:'午餐',amount:null,evidence:fact}),'2026-01-02');
  const event=assetRows(f.state(),'story_event').find(e=>!e.processed);
  for(let i=0;i<5;i++)await f.append('下午的学习继续。');
  f.reply(evaluation('2026-01-02'));const failed=await f.assets.update();assert.equal(failed.ok,false);assert.equal(failed.code,'ASSET_PENDING_UNRESOLVED');assert.equal(cashBalance(f.state()),8000);
  const item=mode==='id'?{id:event.id}:mode==='ref'?{ref:'P1'}:{kind:'expense',name:'午餐',sourceIndex:event.sourceIndex,evidence:fact};
  f.reply({...evaluation('2026-01-02'),events:[{...item,amount:15}],living:{total:15,bookedIds:['P1']}});
  const before=f.count();ok(await f.assets.update());assert.equal(f.count(),before+1);assert.equal(cashBalance(f.state()),6500);assert.equal(assetRows(f.state(),'story_event').filter(e=>!e.processed).length,0);
  assert.equal(assetRows(f.state(),'cash_transaction').filter(t=>t.eventId===event.id).length,1);assert.match(f.prompt(),/pendingAssessments/);assert.match(f.prompt(),/不要求正文后来补数字/);assert.ok(f.prompt().includes(fact));
  assert.equal((await f.assets.update()).ok,false);assert.equal(cashBalance(f.state()),6500);
  f.c.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();assert.equal(cashBalance(f.state()),8000);assert.equal(assetRows(f.state(),'story_event').filter(e=>!e.processed).length,1);
 }finally{f.close();}
});
test('pending salary and new job monthly salary are estimated together without narrative numbers',async()=>{
 const f=setup('2026-01-15');try{
  f.reply({...initial('2026-01-15'),initial:{balance:80,holdings:[],jobs:[]}});ok(await f.assets.update());
  await f.append('Sam 开始新工作并领到工资。'+marker({kind:'job',name:'服务员',action:'start',evidence:'Sam 开始新工作并领到工资。'})+marker({kind:'income',name:'工资',amount:null,evidence:'Sam 开始新工作并领到工资。'}),'2026-02-15');
  const job=assetRows(f.state(),'story_event').find(e=>e.kind==='job'),salary=assetRows(f.state(),'story_event').find(e=>e.salary);
  f.reply({...evaluation('2026-02-15'),events:[{id:salary.id,amount:100,salaryEmployer:'job:'+job.id,payDate:'2026-02-15'}],salaries:[{id:'job:'+job.id,monthlySalary:3000}]});
  ok(await f.assets.update());assert.equal(assetRows(f.state(),'story_event').filter(e=>!e.processed).length,0);assert.equal(assetRows(f.state(),'job')[0].monthlyMinor,300000);
 }finally{f.close();}
});

function residenceBridge(f, floors, identity={hostChatId:'money'}) {
 const previous=globalThis.qqj_v3_public_bridge_v1;
 let reads=0;
 globalThis.qqj_v3_public_bridge_v1={getSnapshot(){reads++;return {status:'ready',identity,memory:{status:'ready',floors}};}};
 return {reads:()=>reads,close(){globalThis.qqj_v3_public_bridge_v1=previous;}};
}
test('established home ignores missing and invalid repeat evidence and persona changes while settling unknown expenses',async()=>{
 const f=setup();try{
  f.reply({...initial(),initial:{balance:80,holdings:[],jobs:[]}});ok(await f.assets.update());
  f.c.powerUserSettings.persona_description='新的人设描述，没有居住地。';
  assert.equal(f.assets.needsResidenceCheck(f.state().assets.wallet),false);
  const calls=f.count();assert.equal((await f.assets.update()).ok,false);assert.equal(f.count(),calls);
  for(const residence of [null,{region:'US',currency:'USD',evidence:'并不存在的常住地依据'},{region:'JP',currency:'CNY',evidence:'错误地区币种'}]){
   const fact='Sam付了午餐费。';await f.append(fact+marker({kind:'expense',name:'午餐',amount:null,evidence:fact}),'2026-01-02');
   f.reply({...evaluation('2026-01-02'),residence,events:[{ref:'P1',amount:10}],living:{total:0,bookedIds:[]}});
   ok(await f.assets.update());assert.equal(f.state().assets.wallet.region,'US');assert.equal(f.state().assets.wallet.currency,'USD');
  }
  assert.equal(cashBalance(f.state()),5000);assert.match(f.prompt(),/不重新核实人设/);assert.doesNotMatch(f.prompt(),/residenceContext/);
  assert.doesNotMatch(buildAssetPrompt(f.state(),f.settings),/expenseSummaryIndices|residenceChange/);
 }finally{f.close();}
});
test('only new expense floor summaries are read for completed relocation, conversion and rollback',async()=>{
 const f=setup();let bridge;try{
  f.reply({...initial(),initial:{balance:80,holdings:[],jobs:[]}});ok(await f.assets.update());
  await f.append('朋友已经移居英国。','2026-01-02');
  const fact='Sam已经搬到东京定居，并支付了搬家费用。';await f.append(fact+marker({kind:'expense',name:'搬家费',amount:null,evidence:fact}));
  const i=f.c.chat.length-1;
  bridge=residenceBridge(f,[{messageIndex:0,summary:'OLD_HOME_SUMMARY'},{messageIndex:1,summary:'NON_EXPENSE_SUMMARY'},{messageIndex:i,summary:fact},{messageIndex:i+1,summary:'FUTURE_SUMMARY'}]);
  f.reply({residenceChange:{sourceIndex:i,subject:'user',status:'completed',region:'JP',currency:'JPY',place:'东京',evidence:fact},currency:'JPY'});
  const calls=f.count(),r=await f.assets.update();ok(r);assert.equal(r.value.switchTo,'JPY');assert.equal(f.count(),calls+1);assert.equal(bridge.reads(),1);
  assert.equal(cashBalance(f.state()),8000);assert.doesNotMatch(f.prompt(),/FUTURE_SUMMARY/);assert.match(f.prompt(),/NON_EXPENSE_SUMMARY/);assert.match(f.prompt(),/expenseSummaryIndices/);
  ok(await f.assets.convert('150'));assert.equal(cashBalance(f.state()),12000);assert.equal(f.state().assets.wallet.region,'JP');
  f.c.chat.pop();await f.memory.read();assert.equal(f.state().assets.wallet.region,'US');assert.equal(cashBalance(f.state()),8000);
 }finally{bridge?.close();f.close();}
});
test('unavailable, disabled and cross-chat summaries never block the existing currency',async()=>{
 for(const mode of ['stale','missing','disabled']){
  const f=setup();let bridge;try{
   f.reply({...initial(),initial:{balance:80,holdings:[],jobs:[]}});ok(await f.assets.update());
   const fact='Sam已经搬到东京定居并支付搬家费。';await f.append(fact+marker({kind:'expense',name:'搬家费',amount:null,evidence:fact}),'2026-01-02');
   bridge=residenceBridge(f,mode==='missing'?[]:[{messageIndex:1,summary:fact}],{hostChatId:mode==='stale'?'other-chat':'money'});
   if(mode==='disabled')f.settings.api.memorySource='none';
   f.reply({...evaluation('2026-01-02'),events:[{ref:'P1',amount:10}],residenceChange:{sourceIndex:1,subject:'user',status:'completed',region:'JP',currency:'JPY',place:'东京',evidence:fact}});
   ok(await f.assets.update());assert.equal(cashBalance(f.state()),7000);assert.equal(f.state().assets.wallet.region,'US');assert.match(f.prompt(),/"expenseSummaryIndices":\[\]/);
  }finally{bridge?.close();f.close();}
 }
});
test('a declared completed user migration with a real expense floor proposes the switch; other subjects keep the home',async()=>{
 for(const [fact,subject] of [
  ['Sam去东京旅行，支付了餐费。','user'],
  ['Sam计划搬到东京定居，支付了餐费。','user'],
  ['Sam已搬到东京定居，支付了餐费。','user'],
  ['朋友搬到东京定居，Sam支付了餐费。','friend']
 ]){
  const f=setup();let bridge;try{
   f.reply({...initial(),initial:{balance:80,holdings:[],jobs:[]}});ok(await f.assets.update());
   await f.append(fact+marker({kind:'expense',name:'餐费',amount:null,evidence:fact}),'2026-01-02');bridge=residenceBridge(f,[{messageIndex:1,summary:fact}]);
   f.reply({...evaluation('2026-01-02'),events:[{ref:'P1',amount:10}],residenceChange:{sourceIndex:1,subject,status:'completed',region:'JP',currency:'JPY',place:'东京'}});
   const r=await f.assets.update();ok(r);
   if(subject==='user'){assert.equal(r.value.switchFrom,'USD');assert.equal(r.value.switchTo,'JPY');assert.equal(f.state().assets.wallet.region,'US');}
   else{assert.equal(f.state().assets.wallet.region,'US');assert.equal(cashBalance(f.state()),7000);}
  }finally{bridge?.close();f.close();}
 }
});
test('completed same-currency move inferred from an expense summary updates the region without conversion',async()=>{
 const f=setup();let bridge;try{
  f.c.powerUserSettings.persona_description='Sam常住德国。';f.reply({residence:{region:'DE',currency:'EUR',evidence:'Sam常住德国。'},initial:{balance:80,holdings:[],jobs:[]}});ok(await f.assets.update());
  const fact='Sam结束德国生活，如今以巴黎为永久居所，支付了租金。';await f.append(fact+marker({kind:'expense',name:'租金',amount:null,evidence:fact}),'2026-01-02');bridge=residenceBridge(f,[{messageIndex:1,summary:fact}]);
  f.reply({...evaluation('2026-01-02'),events:[{ref:'P1',amount:10}],residenceChange:{sourceIndex:1,subject:'user',status:'completed',region:'FR',currency:'EUR',place:'巴黎',evidence:fact}});
  const r=await f.assets.update();ok(r);assert.equal(r.value.switchTo,undefined);assert.equal(f.state().assets.wallet.region,'FR');assert.equal(cashBalance(f.state()),7000);
 }finally{bridge?.close();f.close();}
});

test('legacy actual wage on a non-payday settles without inventing a job even if the model omits the known receipt',async()=>{
 const f=setup('2024-09-02');try{
  f.reply({...initial('2024-09-02'),initial:{balance:80,holdings:[],jobs:[]}});ok(await f.assets.update());
  const fact='Sam工作三小时后领到超市兼职工资48美元。';await f.append(fact+marker({kind:'income',name:'超市兼职工资',amount:48,currency:'USD',date:'2024-09-02',salaryEmployer:'超市',payDate:'2024-09-02',evidence:fact}));
  assert.equal(cashBalance(f.state()),8000);assert.equal(assetRows(f.state(),'story_event').filter(e=>!e.processed).length,1);
  for(let i=0;i<3;i++)await f.append('Sam继续当天的生活。');
  f.reply(evaluation('2024-09-02'));const calls=f.count();ok(await f.assets.update());assert.equal(f.count(),calls+1);
  assert.equal(cashBalance(f.state()),12800);assert.equal(assetRows(f.state(),'job').length,0);assert.equal(assetRows(f.state(),'story_event').filter(e=>!e.processed).length,0);
  const receipt=assetRows(f.state(),'cash_transaction').find(t=>t.memo==='超市兼职工资');assert.equal(receipt.deltaMinor,4800);assert.equal(receipt.salaryMode,'one_off');assert.equal(receipt.payDate,null);
  assert.equal((await f.assets.update()).ok,false);await f.memory.read();assert.equal(cashBalance(f.state()),12800);
  f.c.chat.pop();await f.memory.read();assert.equal(cashBalance(f.state()),8000);assert.equal(assetRows(f.state(),'story_event').filter(e=>!e.processed).length,1);
 }finally{f.close();}
});
test('unknown one-off wage is assessed once and never creates a recurring monthly job',async()=>{
 const f=setup('2024-09-02');try{
  f.reply({...initial('2024-09-02'),initial:{balance:80,holdings:[],jobs:[]}});ok(await f.assets.update());
  const fact='Sam收到了三小时兼职的报酬。';await f.append(fact+marker({kind:'income',name:'兼职工资',amount:null,evidence:fact}));
  f.reply({...evaluation('2024-09-02'),events:[{ref:'E1',salaryMode:'one_off',amount:48}]});ok(await f.assets.update());assert.equal(cashBalance(f.state()),12800);assert.equal(assetRows(f.state(),'job').length,0);
  assert.match(f.prompt(),/不能从三小时或一日收入臆推固定月薪/);assert.match(f.prompt(),/salaryMode:one_off/);
  await f.append('Sam继续生活。','2024-10-15');f.reply(evaluation('2024-10-15'));ok(await f.assets.update());assert.equal(cashBalance(f.state()),12800);assert.equal(assetRows(f.state(),'cash_transaction').filter(t=>t.source==='salary').length,0);
 }finally{f.close();}
});
test('one-off wages alongside a monthly job remain separate while scheduled payday still pays exactly once',async()=>{
 const f=setup('2026-01-15');try{
  ok(await f.assets.update());const fact='Sam临时帮忙，领到另一份兼职工资48美元。';await f.append(fact+marker({kind:'income',name:'临时兼职工资',amount:48,evidence:fact}),'2026-02-02');
  assert.equal(cashBalance(f.state()),100000);f.reply({...evaluation('2026-02-02'),events:[{ref:'E1',salaryMode:'one_off',amount:999}]});ok(await f.assets.update());assert.equal(cashBalance(f.state()),104800,'known 48 cannot be overwritten by model 999');
  await f.append('Sam收到咖啡馆固定月薪3100美元。'+marker({kind:'income',name:'固定月薪',amount:3100,salaryMode:'scheduled',salaryEmployer:'initial:job:0',payDate:'2026-02-15',evidence:'Sam收到咖啡馆固定月薪3100美元。'}),'2026-02-15');
  f.reply(evaluation('2026-02-15'));ok(await f.assets.update());assert.equal(cashBalance(f.state()),414800);assert.equal(assetRows(f.state(),'job').length,1);
 }finally{f.close();}
});
test('explicit one-off prose receipt posts on its actual date and initial snapshot absorbs pre-opening wages',async()=>{
 const f=setup('2024-09-02');try{
  f.reply({...initial('2024-09-02'),initial:{balance:80,holdings:[],jobs:[]}});ok(await f.assets.update());
  const fact='Sam领到日结工资48美元。';await f.append(fact+marker({kind:'income',name:'日结工资',salaryMode:'one_off',amount:48,evidence:fact}));assert.equal(cashBalance(f.state()),12800);await f.memory.read();assert.equal(cashBalance(f.state()),12800);
  assert.match(buildAssetPrompt(f.state(),f.settings),/一次性报酬用income、salaryMode:one_off/);
 }finally{f.close();}
 const g=setup('2024-09-02');try{
  const fact='Sam领到日结工资48美元。';await g.append(fact+marker({kind:'income',name:'日结工资',currency:'USD',salaryMode:'one_off',amount:48,evidence:fact}));
  g.reply({...initial('2024-09-02'),initial:{balance:128,holdings:[],jobs:[]}});ok(await g.assets.update());assert.equal(cashBalance(g.state()),12800);assert.equal(assetRows(g.state(),'job').length,0);
 }finally{g.close();}
});

test('initial residence accepts environmental inference without a literal country or city name',async()=>{
 for(const [region,currency,text,reason] of [
  ['CN','CNY','林晓和王芳放学后回到小区，晚饭后讨论高考志愿。','人物姓名、学校升学制度与日常社区生活共同指向中国。'],
  ['JP','JPY','佐藤葵穿着水手服去社团活动，放学后到便利店买饭团。','人物姓名、学校社团与生活环境共同指向日本。'],
  ['US','USD','Emily在高中参加返校节筹备，放学后乘黄色校车回家。','高中返校节和校车等日常环境支持美国背景，正文语言不参与判断。']
 ]){
  const f=setup();try{
   f.c.powerUserSettings.persona_description='user是一名高中生。';f.c.chat=[{mes:'日期：2026-01-01\n'+text}];
   f.reply({...initial(),residence:{region,currency,place:region,inferred:true,reason}});ok(await f.assets.update());assert.equal(f.state().assets.wallet.currency,currency);assert.equal(f.count(),1);
  }finally{f.close();}
 }
});
test('initial residence uses host context without appending a private narrative window',async()=>{
 const f=setup();try{
  f.c.powerUserSettings.persona_description='';f.c.chat=[{mes:'日期：2026-01-01\nSam常住美国。'}];
  for(let i=0;i<12;i++)f.c.chat.push({mes:'最近正文'+i+'：林晓回到小区准备高考。'},{mes:'用户回复'+i,is_user:true});
  // Current host context determines which narrative is available, not a local ten-floor window.
  f.reply({...initial(),residence:{region:'CN',currency:'CNY',place:'中国',inferred:true,reason:'近期人物、生活和高考环境共同指向中国。'}});ok(await f.assets.update());assert.equal(f.state().assets.wallet.region,'CN');assert.doesNotMatch(f.prompt(),/最近正文0|用户回复0|residenceContext/);
 }finally{f.close();}
});
test('inference needs no explanation; only the region/currency pair is enforced',async()=>{
 const {resolveResidence}=await import('../src/currency.js');
 assert.deepEqual(resolveResidence({region:'JP',currency:'JPY',inferred:true},'学生',[],{allowInference:true}),{region:'JP',currency:'JPY'});
 assert.deepEqual(resolveResidence({region:'JP',currency:'JPY',inferred:true,reason:'学校环境'},'学生',[],{allowInference:true}),{region:'JP',currency:'JPY'});
 assert.throws(()=>resolveResidence({region:'JP',currency:'CNY',inferred:true,reason:'学校环境'},'学生',[],{allowInference:true}));
 assert.deepEqual(resolveResidence({region:'JP',currency:'JPY'},'学生',[]),{region:'JP',currency:'JPY'});
});

test('shared currentLocation ships with the assessment payload as background only and never moves the residence currency',async()=>{
 const f=setup();try{
  f.reply({...initial()});ok(await f.assets.update());
  let payload=JSON.parse(f.prompt().split('账本与待核对资料：')[1].split('\n')[0]);
  assert.equal(payload.currentLocation,null);
  assert.match(f.prompt(),/currentLocation 只是共享当前位置/);
  assert.match(f.prompt(),/旅行、出差、短期停留不改变常住地，不据此换币/);
  f.c.chat.push({mes:'2026-01-02 10:00\nSam is traveling in Tokyo.<!--durian-location:{"city":"东京"}-->',is_user:false});
  await f.memory.read();
  f.reply(evaluation('2026-01-02'));ok(await f.assets.update());
  payload=JSON.parse(f.prompt().split('账本与待核对资料：')[1].split('\n')[0]);
  assert.equal(payload.currentLocation,'东京');
  assert.equal(payload.currency,'USD');
  assert.equal(payload.previousResidence,'US');
  assert.equal(f.state().assets.wallet.currency,'USD');
  assert.equal(f.state().assets.wallet.region,'US');
 }finally{f.close();}
});
