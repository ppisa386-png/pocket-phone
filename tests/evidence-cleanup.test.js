// Evidence-requirement cleanup: markers and assessments no longer need quotes,
// while archival evidence stays verified and all source ids keep working.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPhoneMemory } from '../src/memory.js';
import { createPhoneService } from '../src/phone.js';
import { storyAnnotations } from '../src/story-phone.js';
import { dailyUsed } from '../src/daily-core.js';
import { squareUsed } from '../src/square-core.js';
import { applyAssessment } from '../src/assets.js';
import { JOURNAL_KEY } from '../src/journal.js';
import { normalizeSettings } from '../src/config.js';

const marker = (tag, row) => `<!--${tag}:${JSON.stringify(row)}-->`;

function fixture(chat) {
    const bus = new EventEmitter();
    const c = { chatId: 'clean', name1: 'Sam', name2: 'Alex', characterId: 0, characters: [{ name: 'Alex', avatar: 'alex.png' }],
        chat: [...chat], chatMetadata: {}, saveMetadata: async () => {}, onlineStatus: 'connected', eventSource: bus,
        event_types: Object.fromEntries(['CHAT_CHANGED', 'MESSAGE_DELETED', 'MESSAGE_EDITED', 'GENERATION_STARTED', 'GENERATION_ENDED'].map(n => [n, n])) };
    const settings = normalizeSettings({ retries: 0, proactiveEnabled: false });
    const memory = createPhoneMemory({ getContext: () => c });
    const phone = createPhoneService({ memory, getContext: () => c, getSettings: () => settings });
    return { c, settings, memory, phone, state: async () => (await memory.read()).state, close() { phone.destroy(); memory.destroy(); } };
}

test('narrative SMS markers import without evidence quotes; same-floor items keep independent ids and order', async () => {
    const f = fixture([
        { mes: '2026-09-02 19:30\n开场。', is_user: false },
        { mes: 'Sam 发来短信：“晚上见”。随后又发来：“路上小心”。'
            + marker('durian-contact', { sender: 'Alex', recipient: 'user', name: 'Alex', kind: 'sms', text: '晚上见', read: false })
            + marker('durian-contact', { sender: 'Alex', recipient: 'user', name: 'Alex', kind: 'sms', text: '路上小心', read: false }), is_user: false },
    ]);
    try {
        await f.memory.read();
        const state = await f.state();
        const messages = Object.values(state.messages);
        assert.equal(messages.length, 2);
        assert.deepEqual(messages.map(m => m.text), ['晚上见', '路上小心']);
        assert.notEqual(messages[0].id, messages[1].id, 'same-floor markers keep distinct record ids');
        assert.ok(state.contacts['card:alex.png'], 'the contact is created from the same evidence-free markers');
        const ids = f.c.chatMetadata[JOURNAL_KEY].events.filter(e => e.id.startsWith('story-phone:')).map(e => e.id);
        assert.equal(new Set(ids).size, 2, 'each marker keeps its own revision-bound journal id');
    } finally { f.close(); }
});

test('archival markers with evidence keep strict verification: a mismatched quote is still dropped', () => {
    const message = { mes: '完全无关的正文。' + marker('durian-contact', { sender: 'Alex', recipient: 'user', name: 'Alex', kind: 'sms', text: '晚上见', evidence: '这是一段并不存在的原句。' }), is_user: false };
    assert.deepEqual(storyAnnotations(message, 'durian-contact'), []);
    const messageMoney = { mes: '没有这笔消费的一天。' + marker('durian-money', { kind: 'expense', name: '咖啡', amount: 5, evidence: '虚构的结账原句。' }), is_user: false };
    assert.deepEqual(storyAnnotations(messageMoney, 'durian-money'), []);
});

test('durian-money without evidence imports with a position-based id and amount-in-prose grounding', async () => {
    const f = fixture([
        { mes: '日期：2026-01-01\n开场。', is_user: false },
        { mes: 'Sam 花5美元买了咖啡。' + marker('durian-money', { kind: 'expense', name: '咖啡', amount: 5 }), is_user: false },
    ]);
    try {
        await f.memory.read();
        const events = Object.values((await f.state()).assets).filter(e => e.type === 'story_event');
        assert.equal(events.length, 1);
        assert.equal(events[0].name, '咖啡');
        const money = f.c.chatMetadata[JOURNAL_KEY].events.flatMap(e => e.changes.filter(ch => ch.collection === 'assets' && ch.value?.type === 'story_event').map(ch => ch.key));
        assert.ok(money.some(id => /^money:.+:pos0:/.test(id)), 'evidence-free markers are identified by revision plus floor position');
        // A declared amount that the prose never wrote is still refused.
        const f2 = fixture([{ mes: '日期：2026-01-01\n开场。', is_user: false }, { mes: '安静的一天。' + marker('durian-money', { kind: 'expense', name: '咖啡', amount: 5 }), is_user: false }]);
        try {
            await f2.memory.read();
            assert.equal(Object.values((await f2.state()).assets).filter(e => e.type === 'story_event').length, 0);
        } finally { f2.close(); }
    } finally { f.close(); }
});

test('assessment events without evidence settle, and already-settled floors stay barred by source number', () => {
    const chat = [{ mes: '日期：2026-01-01' }, { mes: '日期：2026-01-02\nSam 花了9美元买文具。' }];
    const persona = 'Sam 常住美国。';
    const settled = applyAssessment({ assets: {} }, { residence: { region: 'US', currency: 'USD' }, date: '2026-01-01', initial: { balance: 1000, holdings: [], jobs: [] } },
        { chat: chat.slice(0, 1), index: 0, revision: 'a', persona });
    const original = { assets: Object.fromEntries(settled.filter(c => c.collection === 'assets').map(c => [c.key, c.value])) };
    const second = applyAssessment(original, { date: '2026-01-02', events: [{ kind: 'expense', name: '文具', amount: 9, sourceIndex: 1 }], salaries: [], valuations: [], living: { total: 0, bookedIds: [] }, business: [] },
        { chat, index: 1, revision: 'b', persona });
    const cash = second.filter(c => c.value?.type === 'cash_transaction');
    assert.equal(cash.length, 1);
    assert.equal(cash[0].value.deltaMinor, -900);
    const third = applyAssessment(original, { date: '2026-01-02', events: [{ kind: 'expense', name: '旧事重提', amount: 5, sourceIndex: 0 }], salaries: [], valuations: [], living: { total: 0, bookedIds: [] }, business: [] },
        { chat, index: 1, revision: 'b', persona });
    assert.equal(third.filter(c => c.value?.type === 'cash_transaction' && c.value.memo === '旧事重提').length, 0, 'settled floors cannot be re-charged');
});

test('durian-daily-used and durian-square-used work without evidence quotes', () => {
    const chat = [{ mes: '2026-03-01 12:00\n正文。', is_user: false }];
    const article = { id: 'a1', selected: true, selectedIndex: 0, type: 'article', editionId: 'e1' };
    const dailyChat = [...chat, { mes: 'Alex 读了报道。' + marker('durian-daily-used', { id: 'a1', used: true }), is_user: false }];
    assert.equal(dailyUsed(article, dailyChat), true);
    const post = { id: 'p1', publication: { selected: true, selectedIndex: 0, editionId: 'e1' } };
    const squareChat = [...chat, { mes: 'Alex 读了帖子。' + marker('durian-square-used', { id: 'p1', used: true }), is_user: false }];
    assert.equal(squareUsed(post, squareChat), true);
});

test('saved evidence-era default prompts migrate to the cleaned defaults; custom text is kept', () => {
    const oldContact = '点击新增联系人时，先结合当前剧情、角色设定及可用记忆判断电话是否仍可使用。亲友不能仅凭关系自动加入，已死亡或丧尸化且失去通信能力等应排除；普通暂时未接电话不等于永久不可联系。识别已实际交付的私人号码及地点座机、临时电话和分机，数字仅被叙述而未列出时用 null。地点电话按有依据的区域或机构命名，不冒充目标人物的私人号码，不编造区域名。引用原文验证获取资格，不从社媒或摘要凭空授予号码。';
    const oldSquare = '广场混合普通网友的日常、吐槽、见闻和校园资讯、新闻媒体、机构公告、品牌活动、兴趣或赛事报道，遵循世界观、地域、年代和语言预设。不同账号各有口吻；不编造重大剧情事件，不泄露私事，不使用 user 或既有剧情 NPC 作为公众账号作者。涉及具体剧情人物时遵循公开依据；没有合适内容可留空。';
    const migrated = normalizeSettings({ prompts: { contacts: oldContact, xSquare: oldSquare } });
    assert.doesNotMatch(migrated.prompts.contacts, /引用原文/);
    assert.doesNotMatch(migrated.prompts.xSquare, /公开依据/);
    const custom = normalizeSettings({ prompts: { contacts: '我的自定义联系人提示词，引用原文验证获取资格。' } });
    assert.equal(custom.prompts.contacts, '我的自定义联系人提示词，引用原文验证获取资格。', 'user-customized prompts are never overwritten');
    const fresh = normalizeSettings({ prompts: { contacts: '我的自定义联系人提示词，引用原文验证获取资格。' } });
    assert.equal(fresh.prompts.contacts, custom.prompts.contacts);
});
