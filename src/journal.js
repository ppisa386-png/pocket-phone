// Small, chat-local event journal. It stores phone changes, never a copy of prose.
export const JOURNAL_KEY = 'durian_phone_history';
export const COLLECTIONS = ['profiles', 'contacts', 'calls', 'messages', 'snapchat', 'x', 'orders', 'assets'];
const SCHEMA = 1;
const EMPTY_REVISION = 'root';
const copy = value => JSON.parse(JSON.stringify(value));
const record = value => value && typeof value === 'object' && !Array.isArray(value);

export function messageSignatures(chat) {
    return chat.map(message => JSON.stringify([
        String(message.mes ?? ''), String(message.name ?? ''), Boolean(message.is_user),
        Boolean(message.is_system), message.send_date ?? null, message.swipe_id ?? null,
    ]));
}

export async function revisionsFor(signatures) {
    const encoder = new TextEncoder();
    const revisions = [];
    let previous = EMPTY_REVISION;
    for (const signature of signatures) {
        const hash = await crypto.subtle.digest('SHA-256', encoder.encode(previous + '\n' + signature));
        previous = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
        revisions.push(previous);
    }
    return revisions;
}

function validateChanges(changes) {
    if (!Array.isArray(changes) || !changes.length) throw new Error('手机记录缺少变更内容。');
    for (const change of changes) {
        if (!record(change) || !COLLECTIONS.includes(change.collection) || typeof change.key !== 'string' || !change.key.length ||
            ['__proto__', 'constructor', 'prototype'].includes(change.key) || !(change.value === null || record(change.value))) {
            throw new Error('手机记录格式不正确，原数据已保留。');
        }
    }
}

export function readJournal(raw) {
    if (raw === undefined) return { schema: SCHEMA, events: [] };
    if (!record(raw) || raw.schema !== SCHEMA || !Array.isArray(raw.events)) {
        throw new Error('暂时无法读取此聊天的手机记录，原数据已保留。');
    }
    const ids = new Set();
    for (const event of raw.events) {
        if (!record(event) || typeof event.id !== 'string' || !event.id || ids.has(event.id) ||
            !record(event.source) || !Number.isInteger(event.source.index) || event.source.index < 0 ||
            typeof event.source.revision !== 'string') throw new Error('手机记录来源不完整，原数据已保留。');
        ids.add(event.id);
        validateChanges(event.changes);
    }
    return copy(raw);
}

export function reconcileJournal(raw, revisions) {
    const journal = readJournal(raw);
    const before = journal.events.length;
    // A chained revision binds an event to its entire narrative prefix, not just
    // its floor number. Editing an earlier floor invalidates later changes too.
    journal.events = journal.events.filter(event => revisions[event.source.index] === event.source.revision);
    return { journal, removed: before - journal.events.length };
}

export function appendChange(journal, revisions, changes, id = crypto.randomUUID()) {
    if (!revisions.length) throw new Error('请先开始一段聊天。');
    validateChanges(changes);
    const next = readJournal(journal);
    if (next.events.some(event => event.id === id)) return next; // Safe retry of the same operation.
    next.events.push({ id, source: { index: revisions.length - 1, revision: revisions.at(-1) }, changes: copy(changes) });
    return next;
}

export function replayJournal(journal) {
    const maps = Object.fromEntries(COLLECTIONS.map(name => [name, new Map()]));
    for (const event of readJournal(journal).events) {
        for (const change of event.changes) {
            if (change.value === null) maps[change.collection].delete(change.key);
            else maps[change.collection].set(change.key, copy(change.value));
        }
    }
    return Object.fromEntries(COLLECTIONS.map(name => [name, Object.fromEntries(maps[name])]));
}
