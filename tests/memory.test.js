import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { JOURNAL_KEY, messageSignatures, revisionsFor, readJournal, reconcileJournal, appendChange, replayJournal } from '../src/journal.js';
import { createPhoneMemory } from '../src/memory.js';
const message = (i, text = '剧情 ' + i) => ({ mes: text, name: 'Alex', is_user: false, send_date: i, swipe_id: 0 });
const rev = chat => revisionsFor(messageSignatures(chat));
const change = (key, value, collection = 'contacts') => [{ collection, key, value }];

function fixture() {
    const bus = new EventEmitter();
    const names = ['CHAT_CHANGED', 'CHAT_LOADED', 'MESSAGE_SENT', 'MESSAGE_RECEIVED', 'MESSAGE_EDITED', 'MESSAGE_UPDATED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'GENERATION_STARTED', 'GENERATION_ENDED', 'GENERATION_STOPPED'];
    const event_types = Object.fromEntries(names.map(name => [name, name]));
    let saves = 0;
    const contexts = {};
    function make(id, extra = {}) {
        return contexts[id] = { chatId: id, characterId: 0, characters: [{ avatar: 'alex.png' }], chat: [message(1)], chatMetadata: {},
            saveMetadata: async () => { saves++; }, eventSource: bus, event_types, ...extra };
    }
    let current = make('A');
    const errors = [];
    const memory = createPhoneMemory({ getContext: () => current, onError: error => errors.push(error) });
    return { bus, memory, contexts, errors, saves: () => saves, current: () => current,
        switch(id, extra) { current = contexts[id] ?? make(id, extra); bus.emit('CHAT_CHANGED'); },
        async put(key, value, collection) { return memory.commit(await memory.begin(), change(key, value, collection)); },
    };
}

test('200 to 100 floors rolls back records and restores earlier values', async () => {
    const chat = Array.from({ length: 200 }, (_, i) => message(i));
    const revisions = await rev(chat);
    let journal = appendChange(undefined, revisions.slice(0, 80), change('alex', { name: 'Alex', number: '123' }), 'contact');
    journal = appendChange(journal, revisions.slice(0, 100), change('sms1', { text: '保留' }, 'messages'), 'sms100');
    journal = appendChange(journal, revisions.slice(0, 150), change('alex', { name: 'Alex', number: '456' }), 'edit');
    journal = appendChange(journal, revisions, change('sms2', { text: '删除' }, 'messages'), 'sms200');
    const result = reconcileJournal(journal, revisions.slice(0, 100));
    const state = replayJournal(result.journal);
    assert.equal(result.removed, 2);
    assert.equal(state.contacts.alex.number, '123');
    assert.deepEqual(Object.keys(state.messages), ['sms1']);
    assert.equal(result.journal.events.length, 2);
});

test('editing earlier text invalidates later records even at the same floor count', async () => {
    const chat = [message(1), message(2), message(3)];
    const revisions = await rev(chat);
    let journal = appendChange(undefined, revisions.slice(0, 1), change('early', { number: '111' }));
    journal = appendChange(journal, revisions, change('late', { number: '222' }));
    chat[1].mes = '另一条剧情';
    const result = reconcileJournal(journal, await rev(chat));
    assert.equal(result.removed, 1);
    assert.deepEqual(Object.keys(replayJournal(result.journal).contacts), ['early']);
});

test('swipe revision and replacement message identity invalidate even identical text', async () => {
    const chat = [message(1)];
    const journal = appendChange(undefined, await rev(chat), change('a', { number: '1' }));
    chat[0].swipe_id = 1;
    assert.equal(reconcileJournal(journal, await rev(chat)).removed, 1);
    chat[0] = message(2, '剧情 1');
    assert.equal(reconcileJournal(journal, await rev(chat)).removed, 1);
});

test('ordinary append and cosmetic message metadata keep valid records', async () => {
    const chat = [message(1)];
    const journal = appendChange(undefined, await rev(chat), change('a', { number: '1' }));
    chat[0].extra = { token_count: 50, display_text: 'pretty' };
    chat.push(message(2));
    assert.equal(reconcileJournal(journal, await rev(chat)).removed, 0);
});

test('deletion is reversible by narrative rollback; duplicate operations stay singular', async () => {
    const revisions = await rev([message(1), message(2)]);
    let journal = appendChange(undefined, revisions.slice(0, 1), change('a', { number: '1' }), 'create');
    journal = appendChange(journal, revisions, change('a', null), 'remove');
    journal = appendChange(journal, revisions, change('a', null), 'remove');
    assert.equal(journal.events.length, 2);
    assert.deepEqual(replayJournal(journal).contacts, {});
    assert.equal(replayJournal(reconcileJournal(journal, revisions.slice(0, 1)).journal).contacts.a.number, '1');
});

test('unsupported or malformed journal is preserved instead of silently reset', () => {
    const future = { schema: 8, events: [{ valuable: 'data' }] };
    assert.throws(() => readJournal(future), /原数据已保留/);
    assert.equal(future.events[0].valuable, 'data');
    assert.throws(() => appendChange(undefined, ['hash'], change('__proto__', {})), /格式/);
});

test('chat isolation, reload and group chat persistence use chat metadata only', async () => {
    const f = fixture();
    await f.put('alex', { number: '1' });
    assert.ok(f.contexts.A.chatMetadata[JOURNAL_KEY]);
    f.switch('B', { groupId: 'group1' });
    assert.deepEqual((await f.memory.read()).state.contacts, {});
    await f.put('bea', { number: '2' });
    f.switch('A');
    assert.deepEqual(Object.keys((await f.memory.read()).state.contacts), ['alex']);
    f.memory.destroy();
    const restored = createPhoneMemory({ getContext: () => f.current() });
    assert.equal((await restored.read()).state.contacts.alex.number, '1');
    restored.destroy();
});

test('deleting floors automatically prunes saved phone history and does not resurrect on append', async () => {
    const f = fixture();
    await f.put('early', { number: '1' });
    f.current().chat.push(message(2));
    await f.put('late', { number: '2' });
    // Observe the event-driven reconciliation without calling read()/refresh().
    const pruned = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Deletion event did not reconcile metadata')), 1000);
        const unsubscribe = f.memory.subscribe(({ state }) => {
            if (state.contacts.early && !state.contacts.late) { clearTimeout(timeout); unsubscribe(); resolve(); }
        });
    });
    f.current().chat.pop(); f.bus.emit('MESSAGE_DELETED');
    await pruned;
    assert.equal(f.current().chatMetadata[JOURNAL_KEY].events.length, 1);
    assert.deepEqual(Object.keys((await f.memory.read()).state.contacts), ['early']);
    assert.equal(f.current().chatMetadata[JOURNAL_KEY].events.length, 1);
    f.current().chat.push(message(2));
    assert.deepEqual(Object.keys((await f.memory.read()).state.contacts), ['early']);
    f.memory.destroy();
});

test('late operation rejected after chat switch away and back, and after narrative change', async () => {
    const f = fixture();
    const ticket = await f.memory.begin();
    f.switch('B'); f.switch('A');
    await assert.rejects(f.memory.commit(ticket, change('a', {})), /聊天已变化/);
    const edited = await f.memory.begin();
    f.current().chat[0].mes = 'edited';
    await assert.rejects(f.memory.commit(edited, change('a', {})), /聊天已变化/);
    assert.equal(f.saves(), 0);
    f.memory.destroy();
});

test('no chat and active generation cannot accept phone records', async () => {
    const f = fixture();
    f.bus.emit('GENERATION_STARTED');
    await assert.rejects(f.memory.begin(), /等待正文/);
    f.bus.emit('GENERATION_ENDED');
    await f.put('a', {});
    f.current().chatId = undefined;
    await assert.rejects(f.memory.begin(), /等待正文/);
    assert.equal((await f.memory.read()).scope, null);
    f.memory.destroy();
});

test('empty reads do not write, and failed saves preserve previous metadata', async () => {
    const f = fixture();
    await f.memory.read(); await f.memory.read();
    assert.equal(f.saves(), 0);
    f.current().chatMetadata.other_plugin = { untouched: true };
    f.current().saveMetadata = async () => { throw new Error('disk'); };
    await assert.rejects(f.put('a', {}), /保存失败/);
    assert.equal(f.current().chatMetadata[JOURNAL_KEY], undefined);
    assert.deepEqual(f.current().chatMetadata.other_plugin, { untouched: true });
    f.memory.destroy();
});

test('chat state cannot leak after loading a newer unsupported journal', async () => {
    const f = fixture();
    await f.put('a', {});
    f.switch('B');
    f.current().chatMetadata[JOURNAL_KEY] = { schema: 99, events: [] };
    await assert.rejects(f.memory.read(), /原数据已保留/);
    assert.equal(f.current().chatMetadata[JOURNAL_KEY].schema, 99);
    f.memory.destroy();
});

test('host dry-run previews do not lock phone records without an end event', async()=>{
 const f=fixture();f.bus.emit('GENERATION_STARTED','normal',{},true);
 await f.put('preview-safe',{});assert.ok((await f.memory.read()).scope);f.memory.destroy();
});

test('stopped, aborted, and completed-event stream objects do not cause a permanent lock',async()=>{
 const f=fixture();f.current().streamingProcessor={isFinished:false,isStopped:true};await f.put('stopped',{});
 f.current().streamingProcessor={isFinished:false,abortController:{signal:{aborted:true}}};await f.put('aborted',{});
 f.current().streamingProcessor={isFinished:false,isStopped:false};await assert.rejects(f.memory.begin(),/等待正文/);
 f.bus.emit('GENERATION_ENDED');await f.put('ended',{});
 f.bus.emit('GENERATION_STARTED','normal');await assert.rejects(f.memory.begin(),/等待正文/);
 f.bus.emit('GENERATION_STOPPED');await f.put('stopped-event',{});f.memory.destroy();
});
