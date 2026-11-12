import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPhoneMemory } from '../src/memory.js';
import { createPhoneService } from '../src/phone.js';
import { createAssets, applyAssessment, pendingAssessments, assessmentReferences, ASSET_ASSESSMENT_RULES, PENDING_ASSESSMENT_RULES } from '../src/assets.js';
import { cashBalance, assetRows } from '../src/assets-core.js';
import { buildAssetPrompt, importStoryAssets } from '../src/assets-story.js';
import { appendChange, revisionsFor, messageSignatures, replayJournal, reconcileJournal } from '../src/journal.js';
import { normalizeSettings } from '../src/config.js';

const ok = r => assert.equal(r?.ok, true, r?.error);
const marker = row => '<!--durian-money:' + JSON.stringify(row) + '-->';
const evaluation = date => ({ date, events: [], salaries: [], valuations: [], living: { total: 0, bookedIds: [] }, business: [] });

function setup(date = '2026-01-01') {
    const bus = new EventEmitter(); let reply = null, calls = 0;
    const c = { chatId: 'scope', powerUserSettings:{persona_description:'Sam 常住美国。'}, name1: 'Sam', characterId: 0, characters: [{ name: 'Alex', avatar: 'alex.png' }],
        chat: [{ mes: '日期：' + date + '\nSam 在咖啡馆工作。', is_user: false }], chatMetadata: {}, saveMetadata: async () => {},
        onlineStatus: 'connected', extensionPrompts: {}, setExtensionPrompt(k, v) { this.extensionPrompts[k] = v; },
        eventSource: bus, event_types: Object.fromEntries(['CHAT_CHANGED', 'GENERATION_STARTED', 'GENERATION_AFTER_COMMANDS', 'GENERATION_ENDED', 'MESSAGE_EDITED', 'MESSAGE_DELETED'].map(n => [n, n])),
        generateQuietPrompt: async o => { calls++; return typeof reply === 'function' ? reply() : JSON.stringify(reply); } };
    const settings = normalizeSettings({ retries: 3 }), memory = createPhoneMemory({ getContext: () => c }), phone = createPhoneService({ memory, getContext: () => c, getSettings: () => settings });
    const assets = createAssets({ memory, phone, getContext: () => c, getSettings: () => settings });
    return { c, settings, memory, phone, assets, count: () => calls, reply: r => reply = r,
        state: () => phone.snapshot(),
        async append(text, date = '') { c.chat.push({ mes: (date ? '日期：' + date + '\n' : '') + text, is_user: false }); await memory.read(); },
        close() { phone.destroy(); memory.destroy(); } };
}

test('narrative prompt defines the four ledger lanes and no longer audits every obtained item', () => {
    const f = setup(); try {
        const prompt = buildAssetPrompt(f.state(), f.settings);
        // The four lanes are stated positively, with the ledger framed as
        // finance rather than an inventory.
        assert.match(prompt, /只管理余额、固定资产、奢侈品、投资四个栏目/);
        assert.match(prompt, /现金收入与支出/);
        assert.match(prompt, /固定资产/);
        assert.match(prompt, /高定礼服及贵重收藏品/);
        assert.match(prompt, /investment 是金融投资、公司企业经营权益、商铺经营权益及电影分成、音乐版权、授权费等持续经济权益/);
        assert.match(prompt, /不盘点 user 获得、携带或拥有的全部物品/);
        assert.match(prompt, /正文完成后只核对上述四类变化/);
        assert.match(prompt, /普通零食、一般纪念品、普通耐用品等）不产生任何durian-money标记/);
        // Gifts obey the same three asset lanes instead of widening the scope.
        assert.match(prompt, /符合固定资产\/奢侈品\/投资三类范围的财产仍须记 asset/);
        assert.match(prompt, /普通物品即使是礼物也不登记/);
        // The broad per-item audit instruction is gone.
        assert.doesNotMatch(prompt, /正文完成后核对本次已取得物品/);
    } finally { f.close(); }
});

test('snacks, pretzels, chips and ordinary souvenirs produce no asset events when unmarked', async () => {
    const f = setup('2026-01-01'); try {
        f.reply({ residence:{region:'US',currency:'USD',evidence:'Sam 常住美国。'}, date:'2026-01-01', initial: { balance: 1000, holdings: [], jobs: [{ name: '咖啡师', monthlySalary: 3100 }] } });
        ok(await f.assets.update());
        await f.append('Sam 买了椒盐卷饼和薯片当零食，又买了一枚普通纪念品冰箱贴，顺手拿了些普通日用品。', '2026-01-02');
        const state = f.state();
        // No narrative marker, no event, no holding, and the plain cash expense
        // only reaches the ledger through the living-cost settlement rule.
        assert.equal(assetRows(state, 'story_event').length, 0);
        assert.equal(assetRows(state, 'holding').length, 0);
        const before = assetRows(state, 'cash_transaction').length;
        f.reply({ ...evaluation('2026-01-02'), living: { total: 12, bookedIds: [] } });
        ok(await f.assets.update());
        assert.equal(assetRows(f.state(), 'holding').length, 0, 'no asset rows for ordinary items');
        assert.equal(assetRows(f.state(), 'cash_transaction').length, before + 1, 'only the living-cost summary moves cash');
        assert.equal(f.state().assets.wallet.settlement.livingTotalMinor, 1200);
    } finally { f.close(); }
});

test('a mis-marked plain item is safely excluded without blocking valid entries or creating a holding', async () => {
    const f = setup('2026-01-01'); try {
        f.reply({ residence:{region:'US',currency:'USD',evidence:'Sam 常住美国。'}, date:'2026-01-01', initial: { balance: 1000, holdings: [], jobs: [{ name: '咖啡师', monthlySalary: 3100 }] } });
        ok(await f.assets.update());
        // The model mis-marks a plain souvenir as an asset and also leaves a
        // valid unpaid income fact pending.
        await f.append('Sam 在集市买到纪念品杯垫。' + marker({ kind: 'asset', name: '纪念品杯垫', amount: null }) + ' tavern 打给 Sam 40 美元的小费。' + marker({ kind: 'income', name: '小费', amount: null }), '2026-01-02');
        const pending = pendingAssessments(f.state());
        assert.equal(pending.length, 2);
        const souvenir = pending.find(p => p.name === '纪念品杯垫'), tip = pending.find(p => p.name === '小费');
        assert.deepEqual(souvenir.needs, ['category']);
        assert.deepEqual(tip.needs, ['amount']);
        // One update resolves both: the plain item is excluded, the tip is paid.
        f.reply({ ...evaluation('2026-01-02'), events: [
            { ref: souvenir.ref, category: 'exclude' },
            { ref: tip.ref, amount: 40, date: '2026-01-02' },
        ], living: { total: 0, bookedIds: [] } });
        ok(await f.assets.update());
        const state = f.state();
        assert.equal(assetRows(state, 'holding').length, 0, 'no holding for the excluded item');
        const souvenirEvent = state.assets[souvenir.id];
        assert.equal(souvenirEvent.processed, true);
        assert.equal(souvenirEvent.excludedFromAssets, true, 'the event stays logged with its source floor');
        assert.equal(cashBalance(state), 104000, 'opening 100000 + the valid 40 tip; no payday has elapsed');
        // The exclusion is one entry in the ledger history, not a mass cancel.
        assert.ok(state.assets.wallet.settlement, 'the settlement completed');
    } finally { f.close(); }
});

test('excluded pending rows roll back with their floor and cannot be re-acquired silently', async () => {
    const f = setup('2026-01-01'); try {
        f.reply({ residence:{region:'US',currency:'USD',evidence:'Sam 常住美国。'}, date:'2026-01-01', initial: { balance: 1000, holdings: [], jobs: [{ name: '咖啡师', monthlySalary: 3100 }] } });
        ok(await f.assets.update());
        await f.append('Sam 买了纪念品杯垫。' + marker({ kind: 'asset', name: '纪念品杯垫', amount: null }), '2026-01-02');
        const pending = pendingAssessments(f.state());
        f.reply({ ...evaluation('2026-01-02'), events: [{ ref: pending[0].ref, category: 'exclude' }], living: { total: 0, bookedIds: [] } });
        ok(await f.assets.update());
        const excluded = f.state().assets[pending[0].id];
        assert.equal(excluded.excludedFromAssets, true);
        // Deleting the source floor removes the event with its floor.
        f.c.chat.pop(); await f.memory.read();
        assert.equal(f.state().assets[pending[0].id], undefined, 'rollback restores the earlier state');
        // Re-importing the same floor is allowed again after rollback.
        await f.append('Sam 买了纪念品杯垫。' + marker({ kind: 'asset', name: '纪念品杯垫', amount: null }), '2026-01-02');
        assert.equal(pendingAssessments(f.state()).length, 1, 'the pending row returns and must be resolved again');
    } finally { f.close(); }
});

test('the four lanes still register: homes, cars, gifted jewelry, handbags, equity, film and music rights', async () => {
    const f = setup('2026-01-01'); try {
        f.reply({ residence:{region:'US',currency:'USD',evidence:'Sam 常住美国。'}, date:'2026-01-01', initial: { balance: 300000, holdings: [], jobs: [{ name: '咖啡师', monthlySalary: 3100 }] } });
        ok(await f.assets.update());
        await f.append('Sam 花 200000 美元买下公寓。' + marker({ kind: 'expense', name: '公寓', category: 'fixed', amount: 200000, currency: 'USD' })
            + ' 又花 30000 美元买了一辆轿车。' + marker({ kind: 'expense', name: '轿车', category: 'fixed', amount: 30000, currency: 'USD' })
            + ' 朋友买下钻石项链送给 Sam。' + marker({ kind: 'asset', name: '钻石项链', category: 'luxury', amount: null })
            + ' Sam 自己花 1200 美元买了一只品牌手袋。' + marker({ kind: 'expense', name: '品牌手袋', category: 'luxury', amount: 1200, currency: 'USD' })
            + ' Sam 出资 5000 美元购得咖啡馆 10% 股权。' + marker({ kind: 'expense', name: '咖啡馆股权', category: 'investment', amount: 5000, currency: 'USD', details: '10% 股权' })
            + ' 制片方授予 Sam 5% 电影票房分成。' + marker({ kind: 'asset', name: '电影票房分成', category: 'investment', amount: null, details: '5% 票房分成，按季度结算' })
            + ' Sam 取得歌曲版税与授权收益权。' + marker({ kind: 'asset', name: '歌曲版权收益', category: 'investment', amount: null, details: '版税与授权收益，按发行结算' }), '2026-01-02');
        const state = f.state();
        const holdings = assetRows(state, 'holding');
        assert.deepEqual(holdings.map(h => [h.name, h.category]).sort(),
            [['公寓', 'fixed'], ['轿车', 'fixed'], ['钻石项链', 'luxury'], ['品牌手袋', 'luxury'], ['咖啡馆股权', 'investment'], ['电影票房分成', 'investment'], ['歌曲版权收益', 'investment']].sort());
        // Purchases debit cash once; the gifted necklace debits nothing.
        const cash = assetRows(state, 'cash_transaction');
        assert.equal(cash.length, 4, 'four real payments: apartment, car, handbag, equity');
        assert.equal(cashBalance(state), (300000 - 200000 - 30000 - 1200 - 5000) * 100, 'gifted jewelry never moves cash');
    } finally { f.close(); }
});

test('one-click backfill and pending handling obey the same four-lane scope', () => {
    // The manual assessment defines the same scope as the narrative markers:
    // backfill only finds the four kinds of change, gifts obey the three asset
    // lanes, and out-of-scope pending items are excluded, not ignored wholesale.
    assert.match(ASSET_ASSESSMENT_RULES, /按正文标记相同的四类范围检查并补登记/);
    assert.match(ASSET_ASSESSMENT_RULES, /普通物品、零食、纪念品和一般耐用品不属于补漏范围/);
    assert.match(ASSET_ASSESSMENT_RULES, /符合三类资产范围的财产用kind:asset/);
    assert.match(ASSET_ASSESSMENT_RULES, /不因是礼物就放宽范围/);
    assert.match(PENDING_ASSESSMENT_RULES, /category:"exclude"/);
    assert.match(PENDING_ASSESSMENT_RULES, /不得跳过该事项，也不得把有效收支批量忽略/);
});
