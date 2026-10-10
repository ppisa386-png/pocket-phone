import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPhoneMemory } from '../src/memory.js';
import { createPhoneService } from '../src/phone.js';
import { threadMessages, unreadMessages } from '../src/messages.js';
import { normalizeSettings } from '../src/config.js';

const quote = 'Alex gives you his number: +1 212 555 0123.';
function setup() {
    const bus = new EventEmitter();
    const types = Object.fromEntries(['CHAT_CHANGED', 'MESSAGE_DELETED', 'MESSAGE_EDITED', 'GENERATION_STARTED', 'GENERATION_ENDED'].map(n => [n, n]));
    let requests = 0;
    let reply = () => '{"status":"reply","text":"Got your message."}';
    const context = { chatId: 'A', name1: 'Sam', name2: 'Alex', characterId: 0, characters: [{ name: 'Alex', avatar: 'alex.png' }],
        chat: [{ mes: quote, name: 'Alex' }], chatMetadata: {}, saveMetadata: async () => {}, onlineStatus: 'connected', eventSource: bus, event_types: types,
        async generateQuietPrompt(options) {
            requests++; bus.emit('GENERATION_STARTED', 'quiet');
            try {
                if (options.quietPrompt.includes('"contacts"')) return JSON.stringify({ contacts: [{ name: 'Alex', number: '+1 212 555 0123', user_has_number: true, evidence: quote }] });
                return await reply(options);
            } finally { bus.emit('GENERATION_ENDED', context.chat.length); }
        } };
    const memory = createPhoneMemory({ getContext: () => context });
    const settings = normalizeSettings({ retries: 1 });
    const service = createPhoneService({ memory, getContext: () => context, getSettings: () => settings });
    return { service, memory, context, settings, bus, requests: () => requests, reply: fn => { reply = fn; }, close() { service.destroy(); memory.destroy(); } };
}

test('SMS shares discovered phone contacts and sends, receives, persists and marks read', async () => {
    const f = setup(); await f.service.openMessages(); await f.service.scan(); assert.equal(f.requests(), 1);
    await f.service.open(); assert.equal(f.requests(), 1);
    const result = await f.service.sendMessage('card:alex.png', 'Hello');
    assert.equal(result.value.saved, true);
    const thread = threadMessages(f.service.snapshot().messages, 'card:alex.png');
    assert.deepEqual(thread.map(m => m.role), ['user', 'assistant']);
    assert.equal(thread[0].replyStatus, 'received');
    assert.equal(unreadMessages(f.service.snapshot().messages), 1);
    await f.service.markMessagesRead('card:alex.png');
    assert.equal(unreadMessages(f.service.snapshot().messages), 0);
    const stored = await f.memory.read(); assert.equal(Object.keys(stored.state.messages).length, 2);
    assert.equal(f.context.chat.length, 1);
    f.close();
});

test('failure and retry never duplicate the outgoing text or reply', async () => {
    const f = setup(); await f.service.openMessages(); await f.service.scan();
    f.reply(() => { throw new Error('offline'); });
    const before = f.requests(); const sent = await f.service.sendMessage('card:alex.png', 'Keep this');
    assert.equal(sent.value.saved, true); assert.equal(f.requests() - before, 2);
    let messages = Object.values(f.service.snapshot().messages);
    assert.equal(messages.length, 1); assert.equal(messages[0].replyStatus, 'failed');
    f.reply(() => '{"status":"reply","text":"Here"}');
    await f.service.retryMessage(messages[0].id);
    messages = Object.values(f.service.snapshot().messages);
    assert.equal(messages.length, 2); assert.equal(messages[0].replyStatus, 'received');
    await f.service.retryMessage(messages[0].id);
    assert.equal(Object.keys(f.service.snapshot().messages).length, 2);
    f.close();
});

test('no_reply does not invent incoming text and unknown numbers cannot receive SMS', async () => {
    const f = setup(); await f.service.openMessages(); await f.service.scan();
    f.reply(() => '{"status":"no_reply","text":""}');
    await f.service.sendMessage('card:alex.png', 'Hello');
    assert.equal(Object.values(f.service.snapshot().messages)[0].replyStatus, 'no_reply');
    assert.equal(Object.keys(f.service.snapshot().messages).length, 1);
    const before = f.requests(); const result = await f.service.sendMessage('unknown', 'Hello');
    assert.equal(result.ok, false); assert.equal(f.requests(), before);
    f.close();
});

test('SMS generation only includes the recipient\'s private communications', async () => {
    const f = setup(); await f.service.openMessages(); await f.service.scan();
    await f.memory.commit(await f.memory.begin(), [{ collection: 'messages', key: 'other', value: { id: 'other', contactId: 'someone-else', text: 'PRIVATE_OTHER_PERSON', role: 'assistant', read: false, createdAt: 1 } }]);
    f.reply(options => {
        assert.match(options.quietPrompt, /当前渠道：短信/);
        assert.match(options.quietPrompt, /内容语言严格跟随酒馆预设/);
        assert.doesNotMatch(options.quietPrompt, /PRIVATE_OTHER_PERSON/);
        return '{"status":"reply","text":"Hello"}';
    });
    await f.service.sendMessage('card:alex.png', 'Hello');
    await f.service.markMessagesRead('card:alex.png');
    assert.equal(f.service.snapshot().messages.other.read, false);
    f.close();
});

test('late reply cannot enter a different chat; concurrent send is not duplicated', async () => {
    const f = setup(); await f.service.openMessages(); await f.service.scan();
    let resolveReply, started;
    const start = new Promise(resolve => { started = resolve; });
    f.reply(() => { started(); return new Promise(resolve => { resolveReply = resolve; }); });
    const pending = f.service.sendMessage('card:alex.png', 'Hello'); await start;
    const duplicate = await f.service.sendMessage('card:alex.png', 'Hello');
    assert.equal(duplicate.skipped, true);
    assert.equal(Object.keys(f.service.snapshot().messages).length, 1);
    f.context.chatId = 'B'; f.context.chatMetadata = {}; f.bus.emit('CHAT_CHANGED');
    resolveReply('{"status":"reply","text":"Late"}'); await pending; await f.memory.read();
    assert.equal(Object.keys(f.service.snapshot().messages).length, 0);
    f.close();
});

test('deleting the sending floor removes SMS but retains earlier acquired contact', async () => {
    const f = setup(); await f.service.openMessages(); await f.service.scan();
    f.context.chat.push({ mes: 'Later that day.' });
    await f.service.sendMessage('card:alex.png', 'Hello');
    f.context.chat.pop(); f.bus.emit('MESSAGE_DELETED'); await f.memory.read();
    assert.equal(Object.keys(f.service.snapshot().messages).length, 0);
    assert.equal(Object.keys(f.service.snapshot().contacts).length, 1);
    f.close();
});

test('reopening recovers interrupted requests without automatically paying for another reply', async () => {
    const f = setup(); await f.service.openMessages(); await f.service.scan();
    await f.memory.commit(await f.memory.begin(), [{ collection: 'messages', key: 'interrupted', value: { id: 'interrupted', role: 'user', contactId: 'card:alex.png', text: 'Hello', createdAt: 1, replyStatus: 'pending', read: true } }]);
    const before = f.requests(); await f.service.openMessages();
    assert.equal(f.service.snapshot().messages.interrupted.replyStatus, 'failed');
    assert.equal(f.requests(), before);
    f.close();
});

test('SMS pencil and reroll replace only selected char text and roll back on deleted floor',async()=>{
 const f=setup();try{await f.service.scan();await f.service.sendMessage('card:alex.png','First');await f.service.sendMessage('card:alex.png','Second');const original=f.service.snapshot();const replies=threadMessages(original.messages,'card:alex.png').filter(m=>m.role==='assistant');
 f.context.chat.push({mes:'Edit now.'});await f.memory.read();const count=f.requests();assert.equal((await f.service.editMessage(replies[0].id,'Edited')).ok,true);assert.equal(f.requests(),count);
 f.reply(async()=>JSON.stringify({text:'Rerolled'}));assert.equal((await f.service.rerollMessage(replies[0].id)).ok,true);const state=f.service.snapshot();assert.equal(state.messages[replies[0].id].text,'Rerolled');assert.deepEqual(state.messages[replies[1].id],original.messages[replies[1].id]);assert.equal(Object.keys(state.messages).length,4);
 f.context.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();assert.equal(f.service.snapshot().messages[replies[0].id].text,replies[0].text);
 }finally{f.close();}
});
