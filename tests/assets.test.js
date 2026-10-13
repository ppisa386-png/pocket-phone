import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPhoneMemory } from '../src/memory.js';
import { createPhoneService } from '../src/phone.js';
import { createAssets, applyAssessment } from '../src/assets.js';
import { createSnapchat } from '../src/snapchat.js';
import { createAmazon } from '../src/amazon.js';
import { cashBalance, reservedCash, assetRows, salaryPayments, requireCash, recentCash, debtEpisode } from '../src/assets-core.js';
import { applyAssetChanges } from '../src/assets-events.js';
import { buildAssetPrompt, createAssetBridge, ASSETS_KEY } from '../src/assets-story.js';
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
