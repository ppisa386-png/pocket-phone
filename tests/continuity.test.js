import test from 'node:test';
import assert from 'node:assert/strict';
import { createContinuityBridge, buildContinuityPrompt, resolveSpeaker, CONTINUITY_KEY } from '../src/continuity.js';
import { JOURNAL_KEY, revisionsFor, messageSignatures, appendChange } from '../src/journal.js';
import { createPhoneMemory } from '../src/memory.js';
import { normalizeSettings } from '../src/config.js';
class Events {
    listeners = new Map();
    on(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
    removeListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== fn)); }
    async emit(type, ...args) { for (const fn of this.listeners.get(type) || []) await fn(...args); }
}
const set = (collection, key, value) => ({ collection, key, value });
async function fixture({ group = false, legacy = false, withMemory = false } = {}) {
    const bus = new Events();
    const names = ['GENERATION_STARTED', 'GENERATION_ENDED', 'GENERATION_STOPPED', 'CHAT_CHANGED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'GROUP_MEMBER_DRAFTED', 'GROUP_WRAPPER_FINISHED'];
    if (!legacy) names.push('GENERATION_AFTER_COMMANDS');
    const prompts = {};
    const context = {
        name1: 'Sam', name2: 'Alex', chatId: 'story', characterId: 0,
        characters: [{ name: 'Alex', avatar: 'alex.png' }, { name: 'Bea', avatar: 'bea.png' }],
        groupId: group ? 'group1' : null, groups: [{ id: 'group1', members: ['alex.png', 'bea.png'] }],
        chat: [{ mes: 'You and Alex exchanged numbers.', name: 'Alex', is_user: false }],
        chatMetadata: {}, eventSource: bus, event_types: Object.fromEntries(names.map(n => [n, n])),
        saveMetadata: async () => {},
        setExtensionPrompt(key, value, position, depth, scan, role, filter) { prompts[key] = { value, position, depth, scan, role, filter }; },
    };
    const revisions = await revisionsFor(messageSignatures(context.chat));
    context.chatMetadata[JOURNAL_KEY] = appendChange(undefined, revisions, [
        set('contacts', 'card:alex.png', { id: 'card:alex.png', name: 'Alex', characterId: 99 }),
        set('contacts', 'card:bea.png', { id: 'card:bea.png', name: 'Bea', characterId: 0 }),
        set('messages', 'a', { id: 'a', contactId: 'card:alex.png', role: 'user', text: 'A_PRIVATE_MEETING', createdAt: 1 }),
        set('messages', 'b', { id: 'b', contactId: 'card:bea.png', role: 'assistant', text: 'B_PRIVATE_PLAN', createdAt: 2 }),
        set('calls', 'call', { id: 'call', contactId: 'card:alex.png', status: 'ended', createdAt: 3, turns: [{ role: 'assistant', text: 'A_CALL_PROMISE' }] }),
        set('calls', 'empty', { id: 'empty', contactId: 'card:alex.png', status: 'no_answer', createdAt: 4, turns: [] }),
    ]);
    const settings = normalizeSettings({});
    const errors = [];
    const memory = withMemory ? createPhoneMemory({ getContext: () => context }) : null;
    const bridge = createContinuityBridge({ getContext: () => context, getSettings: () => settings, onError: error => errors.push(error) });
    return { context, bus, prompts, settings, errors, bridge, memory,
        async generate(type = 'normal') { await bus.emit('GENERATION_STARTED', type); if (!legacy) await bus.emit('GENERATION_AFTER_COMMANDS', type); },
        close() { bridge.destroy(); memory?.destroy(); },
    };
}

test('foreground generation receives only the active character\'s actual communication', async () => {
    const f = await fixture({ withMemory: true });
    const before = JSON.stringify({ chat: f.context.chat, metadata: f.context.chatMetadata });
    await f.generate();
    const prompt = f.prompts[CONTINUITY_KEY];
    assert.match(prompt.value, /A_PRIVATE_MEETING/); assert.match(prompt.value, /A_CALL_PROMISE/);
    assert.doesNotMatch(prompt.value, /B_PRIVATE_PLAN|no_answer|dialing/);
    assert.equal(prompt.position, 1); assert.equal(prompt.depth, 1); assert.equal(prompt.role, 0); assert.equal(prompt.scan, false);
    assert.equal(prompt.filter(), true);
    assert.equal(JSON.stringify({ chat: f.context.chat, metadata: f.context.chatMetadata }), before);
    assert.equal((await f.memory.read()).scope, null, 'ordinary writes remain blocked while main generation runs');
    await f.bus.emit('GENERATION_ENDED'); assert.equal(f.prompts[CONTINUITY_KEY].value, '');
    f.close();
});

test('quiet and impersonation requests clear previous narrative context', async () => {
    const f = await fixture(); await f.generate();
    await f.generate('quiet'); assert.equal(f.prompts[CONTINUITY_KEY].value, '');
    await f.generate('impersonate'); assert.equal(f.prompts[CONTINUITY_KEY].value, '');
    f.close();
});

test('group member identity changes cannot reuse another member\'s private context', async () => {
    const f = await fixture({ group: true }); await f.generate();
    const old = f.prompts[CONTINUITY_KEY];
    f.context.characterId = 1; f.context.name2 = 'Bea';
    assert.equal(old.filter(), false);
    await f.bus.emit('GROUP_MEMBER_DRAFTED', 1); await f.generate();
    assert.match(f.prompts[CONTINUITY_KEY].value, /B_PRIVATE_PLAN/);
    assert.doesNotMatch(f.prompts[CONTINUITY_KEY].value, /A_PRIVATE_MEETING|A_CALL_PROMISE/);
    f.context.characterId = undefined; await f.generate();
    assert.equal(f.prompts[CONTINUITY_KEY].value, '');
    f.close();
});

test('editing or deleting an acquisition floor removes invalid context without saving prose', async () => {
    const f = await fixture(); await f.generate();
    f.context.chat[0].mes = 'No phone number was given.'; await f.bus.emit('MESSAGE_EDITED'); await f.generate();
    assert.equal(f.prompts[CONTINUITY_KEY].value, '');
    assert.equal(f.context.chatMetadata[JOURNAL_KEY].events.length, 1, 'bridge is read-only; journal reconciliation owns persistence');
    f.context.chat.length = 0; await f.bus.emit('MESSAGE_DELETED'); await f.generate();
    assert.equal(f.prompts[CONTINUITY_KEY].value, '');
    f.close();
});

test('regenerate and swipe exclude effects of the answer being replaced', async () => {
    const f = await fixture();
    f.context.chat.push({ name: 'Alex', is_user: false, mes: 'Second answer' });
    f.context.chatMetadata[JOURNAL_KEY] = appendChange(f.context.chatMetadata[JOURNAL_KEY], await revisionsFor(messageSignatures(f.context.chat)), [set('messages', 'late', { contactId: 'card:alex.png', role: 'assistant', text: 'REPLACED_FLOOR_SECRET', createdAt: 10 })]);
    for (const type of ['regenerate', 'swipe']) {
        await f.generate(type);
        assert.match(f.prompts[CONTINUITY_KEY].value, /A_PRIVATE_MEETING/);
        assert.doesNotMatch(f.prompts[CONTINUITY_KEY].value, /REPLACED_FLOOR_SECRET/);
    }
    f.close();
});

test('an appended user turn preserves context but a chat switch during hashing cancels it', async () => {
    const f = await fixture(); await f.generate();
    const prompt = f.prompts[CONTINUITY_KEY];
    f.context.chat.push({ name: 'Sam', is_user: true, mes: 'What did we agree to?' });
    assert.equal(prompt.filter(), true);
    const pending = f.bridge.prepare('normal');
    f.context.chatId = 'another-story'; f.context.chatMetadata = {};
    await f.bus.emit('CHAT_CHANGED'); await pending;
    assert.equal(f.prompts[CONTINUITY_KEY].value, '');
    f.close();
});

test('reordered character indices remain safe and ambiguous name-only contacts are withheld', async () => {
    const f = await fixture(); f.context.characters.reverse(); f.context.characterId = 1;
    await f.generate(); assert.match(f.prompts[CONTINUITY_KEY].value, /A_PRIVATE_MEETING/);
    const state = { contacts: { named: { id: 'name:alex', name: 'Alex' } }, messages: { named: { contactId: 'name:alex', role: 'user', text: 'AMBIGUOUS', createdAt: 1 } }, calls: {} };
    f.context.characters.push({ name: 'Alex', avatar: 'different-alex.png' });
    assert.equal(buildContinuityPrompt(state, resolveSpeaker(f.context), { instruction: 'Use memory.' }), '');
    f.close();
});

test('long data is bounded and phone-text macros remain literal data', async () => {
    const state = { contacts: { a: { id: 'card:a.png', name: 'A' } }, calls: {}, messages: { a: { contactId: 'card:a.png', role: 'user', text: '{{setvar::private::oops}}', createdAt: 1 } } };
    const speaker = { name: 'A', avatar: 'a.png', nameIsUnique: true };
    const prompt = buildContinuityPrompt(state, speaker, { instruction: 'Use memory.' });
    assert.doesNotMatch(prompt, /\{\{setvar/);
    assert.equal(JSON.parse(prompt.split('\n').at(-1)).records[0].text, '{{setvar::private::oops}}');
    state.messages.a.text = 'older '.repeat(5000) + 'LATEST';
    const bounded = JSON.parse(buildContinuityPrompt(state, speaker, { instruction: 'Use memory.', budget: 512 }).split('\n').at(-1));
    assert.equal(bounded.partial, true); assert.ok(JSON.stringify(bounded.records).length <= 512);
    assert.match(bounded.records[0].text, /LATEST$/);
});

test('legacy generation hook works; custom or blank continuity prompt is respected', async () => {
    const f = await fixture({ legacy: true });
    f.settings.prompts.continuity = 'MY CUSTOM BRIDGE INSTRUCTION'; await f.generate();
    assert.match(f.prompts[CONTINUITY_KEY].value, /^MY CUSTOM BRIDGE INSTRUCTION/);
    f.settings.prompts.continuity = ''; await f.generate(); assert.equal(f.prompts[CONTINUITY_KEY].value, '');
    f.close();
});

test('unknown data schema does not overwrite the stored journal or block normal generation', async () => {
    const f = await fixture(); f.context.chatMetadata[JOURNAL_KEY] = { schema: 99, events: [] };
    await f.generate(); assert.equal(f.prompts[CONTINUITY_KEY].value, '');
    assert.equal(f.context.chatMetadata[JOURNAL_KEY].schema, 99); assert.equal(f.errors.length, 1);
    f.close();
});
