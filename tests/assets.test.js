import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPhoneMemory } from '../src/memory.js';
import { createPhoneService } from '../src/phone.js';
import { createAssets, applyAssessment } from '../src/assets.js';
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
const initial = (date = '2026-01-01', balance = 1000) => ({ date, initial: { balance, holdings: [], jobs: [{ name: '咖啡师', monthlySalary: 3100 }] } });
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
        assert.match(f.prompt(),/"balanceUSD":1035/); assert.match(f.prompt(),/"availableUSD":1035/);
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

test('memory date can initialize but stale or mismatching evidence cannot; real date is never a fallback', () => {
    const args = { chat: [{ mes: '没有日期的剧情。' }], index: 0, revision: 'a', memoryText: '日期：1999-03-02\n当前记忆。' };
    const data = { ...initial('1999-03-02'), dateEvidence: '日期：1999-03-02' };
    assert.equal(applyAssessment({ assets: {} }, data, args).at(-1).value.lastDay, day('1999-03-02'));
    assert.throws(() => applyAssessment({ assets: {} }, { ...data, date: '1999-03-03' }, args));
    assert.throws(() => applyAssessment({ assets: {} }, data, { ...args, memoryText: '' }));
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
