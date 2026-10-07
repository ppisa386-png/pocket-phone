import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPhoneMemory } from '../src/memory.js';
import { createPhoneService, validateContacts, parseJSON } from '../src/phone.js';
import { normalizeSettings } from '../src/config.js';

const quote = 'Alex gives you his number: +1 212 555 0123.';
function setup() {
    const bus = new EventEmitter();
    const types = Object.fromEntries(['CHAT_CHANGED', 'MESSAGE_DELETED', 'MESSAGE_EDITED', 'GENERATION_STARTED', 'GENERATION_ENDED'].map(n => [n, n]));
    let requests = 0;
    let response = () => JSON.stringify({ contacts: [{ name: 'Alex', number: '+1 212 555 0123', user_has_number: true, evidence: quote }] });
    const context = { chatId: 'A', name1: 'Sam', name2: 'Alex', characterId: 0, characters: [{ name: 'Alex', avatar: 'alex.png' }],
        chat: [{ mes: quote, name: 'Alex' }], chatMetadata: {}, saveMetadata: async () => {}, onlineStatus: 'connected', eventSource: bus, event_types: types,
        async generateQuietPrompt(options) {
            requests++; bus.emit('GENERATION_STARTED', 'quiet');
            try { return await response(options); } finally { bus.emit('GENERATION_ENDED', context.chat.length); }
        } };
    const memory = createPhoneMemory({ getContext: () => context });
    const settings = normalizeSettings({ retries: 0 });
    const phone = createPhoneService({ memory, getContext: () => context, getSettings: () => settings });
    return { phone, memory, context, settings, bus, requests: () => requests, reply: fn => { response = fn; }, close: () => { phone.destroy(); memory.destroy(); } };
}

test('contact evidence and digits are checked; implicit exchange stays numberless', () => {
    const chat = [{ mes: quote }, { mes: 'You and Bea exchange phone numbers.' }];
    const result = validateContacts({ contacts: [
        { name: 'Alex', number: '999999', evidence: quote, user_has_number: true },
        { name: 'Alex', number: null, evidence: 'invented evidence', user_has_number: true },
        { name: 'Alex', number: '+1 212 555 0123', evidence: quote, user_has_number: false },
        { name: 'Bea', number: null, evidence: chat[1].mes, user_has_number: true },
    ] }, chat, { name1: 'Sam' });
    assert.equal(result.length, 1); assert.equal(result[0].number, null); assert.equal(result[0].sourceIndex, 1);
    assert.throws(() => parseJSON('nonsense'));
});

test('scan, outgoing call, text reply, hangup and history work with quiet generation events', async () => {
    const f = setup();
    await f.phone.open();
    const contact = Object.values(f.phone.snapshot().contacts)[0];
    assert.equal(contact.name, 'Alex');
    assert.equal(f.requests(), 1);
    await f.phone.open(); assert.equal(f.requests(), 1, 'unchanged narrative does not rescan');
    f.reply(options => {
        assert.equal(options.skipWIAN, false); assert.equal(options.quietToLoud, false);
        assert.match(options.quietPrompt, /不得描述表情/);
        return '{"status":"answered","text":"Hello?"}';
    });
    await f.phone.dial(contact.id);
    let call = f.phone.snapshot().calls[f.phone.snapshot().activeCallId];
    assert.equal(call.status, 'connected'); assert.equal(call.turns[0].text, 'Hello?');
    f.reply(() => '{"status":"answered","text":"I can hear you."}');
    await f.phone.say('Can you hear me?');
    call = f.phone.snapshot().calls[call.id];
    assert.deepEqual(call.turns.map(t => t.role), ['assistant', 'user', 'assistant']);
    await f.phone.hangup();
    assert.equal(f.phone.snapshot().calls[call.id].status, 'ended');
    assert.equal(f.context.chat.length, 1, 'does not insert fake narrative turns');
    f.close();
});

test('numbers are anchored to acquisition floor, not later scan floor', async () => {
    const f = setup(); f.context.chat.push({ mes: 'Later, you go home.' });
    await f.phone.open();
    f.context.chat.pop(); f.bus.emit('MESSAGE_DELETED'); await f.memory.read();
    assert.equal(Object.keys(f.phone.snapshot().contacts).length, 1);
    f.context.chat[0].mes = 'You ask Alex, but he refuses to give his number.';
    f.bus.emit('MESSAGE_EDITED'); await f.memory.read();
    assert.equal(Object.keys(f.phone.snapshot().contacts).length, 0);
    await f.phone.dial('card:alex.png');
    assert.match(f.phone.snapshot().error, /尚未获得/); assert.equal(f.requests(), 1);
    f.close();
});

test('failure respects retries; manual retry does not duplicate user speech', async () => {
    const f = setup(); await f.phone.open();
    f.reply(() => '{"status":"answered","text":"Hello"}'); await f.phone.dial('card:alex.png');
    f.settings.retries = 2;
    const before = f.requests(); f.reply(() => { throw new Error('offline'); });
    await f.phone.say('Are you there?');
    assert.equal(f.requests() - before, 3);
    f.reply(() => '{"status":"answered","text":"Yes"}'); await f.phone.retry();
    const call = f.phone.snapshot().calls[f.phone.snapshot().activeCallId];
    assert.equal(call.turns.filter(t => t.role === 'user').length, 1);
    f.close();
});

test('hangup discards a late call response', async () => {
    const f = setup(); await f.phone.open();
    let resolveResponse, started;
    const start = new Promise(r => { started = r; });
    f.reply(() => { started(); return new Promise(r => { resolveResponse = r; }); });
    const pending = f.phone.dial('card:alex.png'); await start;
    const id = f.phone.snapshot().activeCallId;
    await f.phone.hangup();
    resolveResponse('{"status":"answered","text":"too late"}'); await pending;
    assert.equal(f.phone.snapshot().calls[id].status, 'ended');
    assert.equal(f.phone.snapshot().calls[id].turns.length, 0);
    assert.equal(f.phone.snapshot().error, '');
    f.close();
});

test('offline connection explains the problem without creating fake contacts', async () => {
    const f = setup(); f.context.onlineStatus = 'no_connection';
    await f.phone.open();
    assert.match(f.phone.snapshot().error, /连接 API/);
    assert.equal(f.requests(), 0); assert.equal(Object.keys(f.phone.snapshot().contacts).length, 0);
    f.close();
});
