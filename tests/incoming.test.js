import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPhoneMemory } from '../src/memory.js';
import { createPhoneService } from '../src/phone.js';
import { normalizeSettings } from '../src/config.js';
import { incomingParticipant, validateIncoming, watchIncoming } from '../src/incoming.js';
import { buildContinuityPrompt } from '../src/continuity.js';

const evidence = 'Bea has Sam’s number and agrees to give it to Alex.';
const incoming = { status: 'ringing', can_obtain_number: true, route: 'mutual_contact', channel: 'Bea', evidence, reason: 'Confirm the meeting.' };
const tick = () => new Promise(resolve => setTimeout(resolve, 15));
function setup() {
    const bus = new EventEmitter();
    const types = Object.fromEntries(['CHAT_CHANGED', 'MESSAGE_DELETED', 'MESSAGE_EDITED', 'GENERATION_STARTED', 'GENERATION_ENDED', 'GENERATION_STOPPED', 'GROUP_WRAPPER_STARTED', 'GROUP_WRAPPER_FINISHED'].map(n => [n, n]));
    const context = { chatId: 'A', name1: 'Sam', name2: 'Alex', characterId: 0, characters: [{ name: 'Alex', avatar: 'alex.png' }],
        chat: [{ mes: evidence, name: 'Alex', is_user: false }], chatMetadata: {}, saveMetadata: async () => {}, onlineStatus: 'connected', eventSource: bus, event_types: types };
    let requests = 0, response = () => JSON.stringify(incoming);
    context.generateQuietPrompt = async options => {
        requests++; bus.emit('GENERATION_STARTED', 'quiet');
        try { return await response(options); } finally { bus.emit('GENERATION_ENDED', context.chat.length); }
    };
    const memory = createPhoneMemory({ getContext: () => context });
    const settings = normalizeSettings({ retries: 0 });
    const phone = createPhoneService({ memory, getContext: () => context, getSettings: () => settings });
    const watcher = watchIncoming({ getContext: () => context, phone });
    return { phone, memory, context, settings, bus, requests: () => requests, reply: fn => { response = fn; }, close: () => { watcher.destroy(); phone.destroy(); memory.destroy(); } };
}

test('incoming caller needs real quoted evidence and a verifiable acquisition channel', () => {
    assert.equal(validateIncoming({ status: 'none' }, []), null);
    assert.throws(() => validateIncoming({ ...incoming, evidence: 'An invented mutual friend knows the number.' }, [{ mes: evidence }]));
    assert.throws(() => validateIncoming({ ...incoming, channel: 'Someone else' }, [{ mes: evidence }]));
    assert.throws(() => validateIncoming({ ...incoming, can_obtain_number: false }, [{ mes: evidence }]));
    assert.throws(() => validateIncoming(incoming, [{ mes: evidence, is_system: true }]));
    assert.equal(validateIncoming(incoming, [{ mes: evidence }]).sourceIndex, 0);
});

test('incoming call rings silently until accepted and does not grant outgoing number access', async () => {
    const f = setup(); await f.phone.checkIncoming();
    const id = f.phone.snapshot().activeCallId;
    assert.equal(f.phone.snapshot().calls[id].status, 'ringing');
    assert.equal(f.phone.snapshot().calls[id].turns.length, 0);
    assert.equal(Object.keys(f.phone.snapshot().contacts).length, 0);
    await f.phone.dial('card:alex.png'); assert.equal(f.requests(), 1);
    f.reply(options => { assert.match(options.quietPrompt, /user 已点击接听/); return '{"status":"answered","text":"Are we still meeting?"}'; });
    await f.phone.answer();
    assert.equal(f.phone.snapshot().calls[id].status, 'connected');
    f.reply(() => '{"status":"answered","text":"See you then."}');
    await f.phone.say('Yes, at noon.'); await f.phone.hangup();
    const state = f.phone.snapshot();
    assert.equal(state.calls[id].turns.length, 3);
    assert.match(buildContinuityPrompt(state, { avatar: 'alex.png', name: 'Alex' }, { instruction: 'Remember' }), /noon/);
    assert.equal(buildContinuityPrompt(state, { avatar: 'bea.png', name: 'Bea' }, { instruction: 'Remember' }), '');
    assert.equal(Object.keys(state.contacts).length, 0);
    assert.equal(f.context.chat.length, 1);
    f.close();
});

test('decline has no model call or dialogue and same narrative cannot ring twice', async () => {
    const f = setup(); await f.phone.checkIncoming(); const id = f.phone.snapshot().activeCallId;
    await f.phone.decline(); await f.phone.checkIncoming();
    assert.equal(f.requests(), 1);
    assert.equal(f.phone.snapshot().calls[id].status, 'declined');
    assert.deepEqual(f.phone.snapshot().calls[id].turns, []);
    assert.equal(f.phone.snapshot().calls[id].read, true);
    f.close();
});

test('no-call results are cached; disabled app, blank prompt and offline do not request', async () => {
    const f = setup(); f.settings.apps.phone = false; await f.phone.checkIncoming();
    f.settings.apps.phone = true; const prompt = f.settings.prompts.incoming; f.settings.prompts.incoming = ''; await f.phone.checkIncoming();
    f.settings.prompts.incoming = prompt; f.context.onlineStatus = 'no_connection'; await f.phone.checkIncoming();
    assert.equal(f.requests(), 0);
    f.context.onlineStatus = 'connected'; f.reply(() => '{"status":"none"}');
    await f.phone.checkIncoming(); await f.phone.checkIncoming(); assert.equal(f.requests(), 1);
    assert.equal(Object.keys(f.phone.snapshot().calls).length, 0); f.close();
});

test('foreground completion triggers once, quiet requests and stopped or unchanged runs do not loop', async () => {
    const f = setup();
    f.bus.emit('GENERATION_STARTED', 'normal'); f.bus.emit('GENERATION_ENDED'); await tick(); assert.equal(f.requests(), 0);
    f.bus.emit('GENERATION_STARTED', 'normal'); f.context.chat.push({ mes: 'Alex decides to check the meeting.', name: 'Alex', is_user: false });
    f.bus.emit('GENERATION_ENDED');
    for (let i = 0; i < 20 && !f.phone.snapshot().activeCallId; i++) await tick();
    assert.equal(f.requests(), 1); assert.ok(f.phone.snapshot().activeCallId);
    await tick(); assert.equal(f.requests(), 1);
    await f.phone.decline();
    f.bus.emit('GENERATION_STARTED', 'normal'); f.context.chat.push({ mes: 'partial', name: 'Alex' }); f.bus.emit('GENERATION_ENDED'); f.bus.emit('GENERATION_STOPPED');
    await tick(); assert.equal(f.requests(), 1); f.close();
});

test('pending ignored call becomes missed when narrative advances, without another request', async () => {
    const f = setup(); await f.phone.checkIncoming(); const id = f.phone.snapshot().activeCallId;
    f.context.chat.push({ mes: 'Later.', name: 'Alex' }); await f.phone.checkIncoming();
    assert.equal(f.phone.snapshot().calls[id].status, 'missed'); assert.equal(f.requests(), 1);
    await f.phone.markCallsRead(); assert.equal(f.phone.snapshot().calls[id].read, true); f.close();
});

test('reload turns unhandled ringing into missed history and does not replay caller speech', async () => {
    const f = setup(); await f.phone.checkIncoming(); const id = f.phone.snapshot().activeCallId;
    const reloaded = createPhoneService({ memory: f.memory, getContext: () => f.context, getSettings: () => f.settings });
    f.reply(() => '{"contacts":[]}'); await reloaded.open();
    assert.equal(reloaded.snapshot().calls[id].status, 'missed');
    assert.deepEqual(reloaded.snapshot().calls[id].turns, []); reloaded.destroy(); f.close();
});

test('answer failures can retry without duplicate greeting and hangup discards late response', async () => {
    const f = setup(); await f.phone.checkIncoming(); const id = f.phone.snapshot().activeCallId;
    f.reply(() => { throw new Error('offline'); }); await f.phone.answer();
    assert.equal(f.phone.snapshot().calls[id].status, 'answering');
    f.reply(() => '{"status":"answered","text":"Hello"}'); await f.phone.retry();
    assert.equal(f.phone.snapshot().calls[id].turns.length, 1);
    let finish, started; const ready = new Promise(resolve => { started = resolve; });
    f.reply(() => { started(); return new Promise(resolve => { finish = resolve; }); });
    const pending = f.phone.say('Hi'); await ready; await f.phone.hangup(); finish('{"status":"answered","text":"late"}'); await pending;
    assert.equal(f.phone.snapshot().calls[id].status, 'ended'); assert.equal(f.phone.snapshot().calls[id].turns.length, 2); f.close();
});

test('source deletion and chat switching discard inbound records and in-flight results', async () => {
    const f = setup(); await f.phone.checkIncoming();
    f.context.chat[0].mes = 'No one knows Sam’s number.'; f.bus.emit('MESSAGE_EDITED'); await f.memory.read();
    assert.equal(Object.keys(f.phone.snapshot().calls).length, 0);
    f.context.chat[0].mes = evidence;
    let finish, started; const ready = new Promise(resolve => { started = resolve; });
    f.reply(() => { started(); return new Promise(resolve => { finish = resolve; }); });
    const pending = f.phone.checkIncoming(); await ready;
    f.context.chatId = 'B'; f.context.chatMetadata = {}; f.bus.emit('CHAT_CHANGED');
    finish(JSON.stringify(incoming)); await pending; await f.memory.read();
    assert.equal(Object.keys(f.phone.snapshot().calls).length, 0); f.close();
});

test('group picks actual last member by stable identity; waits until wrapper completion', async () => {
    const f = setup(); f.context.groupId = 'g'; f.context.groups = [{ id: 'g', members: ['alex.png'] }];
    assert.equal(incomingParticipant(f.context).id, 'card:alex.png');
    f.context.characters.push({ name: 'Alex', avatar: 'other.png' });
    f.context.groups[0].members.push('other.png'); assert.equal(incomingParticipant(f.context), null);
    f.context.chat[0].original_avatar = 'alex.png'; assert.equal(incomingParticipant(f.context).characterId, 0);
    f.bus.emit('GROUP_WRAPPER_STARTED', { type: 'normal' }); f.bus.emit('GENERATION_STARTED', 'normal');
    f.context.chat.push({ mes: 'Alex decides to call.', name: 'Alex', original_avatar: 'alex.png' }); f.bus.emit('GENERATION_ENDED');
    await tick(); assert.equal(f.requests(), 0);
    f.context.characterId = undefined;
    f.reply(options => { assert.equal(options.forceChId, 0); return JSON.stringify(incoming); });
    f.bus.emit('GROUP_WRAPPER_FINISHED', { type: 'normal' });
    for (let i = 0; i < 20 && !f.phone.snapshot().activeCallId; i++) await tick();
    assert.equal(f.requests(), 1); assert.equal(f.phone.snapshot().calls[f.phone.snapshot().activeCallId].name, 'Alex'); f.close();
});
