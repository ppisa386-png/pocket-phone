import { JOURNAL_KEY, messageSignatures, revisionsFor, reconcileJournal, appendChange, replayJournal } from './journal.js?v=0.5.0';

const EVENTS = ['CHAT_CHANGED', 'CHAT_LOADED', 'CHAT_RENAMED', 'MESSAGE_SENT', 'MESSAGE_RECEIVED',
    'MESSAGE_EDITED', 'MESSAGE_UPDATED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'MESSAGE_SWIPE_DELETED',
    'GENERATION_ENDED', 'GENERATION_STOPPED'];

function chatScope(context) {
    const id = context?.getCurrentChatId?.() ?? context?.chatId;
    if (id === undefined || id === null || id === '' || !Array.isArray(context.chat) || !context.chatMetadata ||
        typeof context.saveMetadata !== 'function') return null;
    const owner = context.groupId != null ? ['group', context.groupId] :
        ['character', context.characters?.[context.characterId]?.avatar ?? context.characterId ?? 'current'];
    return JSON.stringify([...owner, id]);
}

export function createPhoneMemory({ getContext, onError = () => {}, onRollback = () => {} }) {
    let queue = Promise.resolve();
    let disposed = false;
    let active = null;
    let generating = false;
    let generation = 0;
    let lastError = '';
    const listeners = new Set();
    const tickets = new WeakMap();
    const context = getContext();
    const bus = context?.eventSource;
    const types = context?.event_types ?? context?.eventTypes ?? {};
    const subscriptions = [];

    function notify() {
        const value = { scope: active?.scope ?? null, state: replayJournal(active?.journal) };
        for (const listener of listeners) listener(structuredClone(value));
    }
    function sameChat(snapshot) {
        const now = getContext();
        return !disposed && chatScope(now) === snapshot.scope && now.chatMetadata === snapshot.metadata &&
            JSON.stringify(messageSignatures(now.chat)) === JSON.stringify(snapshot.signatures);
    }
    async function save(snapshot, journal) {
        if (!sameChat(snapshot)) throw new Error('聊天已变化，本次手机操作已取消。');
        const previous = snapshot.metadata[JOURNAL_KEY];
        snapshot.metadata[JOURNAL_KEY] = journal;
        try { await snapshot.context.saveMetadata(); }
        catch (error) {
            if (snapshot.metadata[JOURNAL_KEY] === journal) {
                if (previous === undefined) delete snapshot.metadata[JOURNAL_KEY];
                else snapshot.metadata[JOURNAL_KEY] = previous;
            }
            throw new Error('手机记录保存失败，请稍后重试。', { cause: error });
        }
    }
    async function sync() {
        const current = getContext();
        const scope = chatScope(current);
        if (!scope) { active = null; notify(); return null; }
        const snapshot = { scope, metadata: current.chatMetadata, context: current, signatures: messageSignatures(current.chat) };
        // Do not persist a transient streaming revision. Final generation events
        // reconcile it; phone actions are blocked until that point.
        if (generating || (current.streamingProcessor && !current.streamingProcessor.isFinished)) {
            if (active?.scope !== scope || active?.metadata !== snapshot.metadata) { active = null; notify(); }
            return null;
        }
        snapshot.revisions = await revisionsFor(snapshot.signatures);
        if (!sameChat(snapshot)) return null;
        const { journal, removed } = reconcileJournal(snapshot.metadata[JOURNAL_KEY], snapshot.revisions);
        if (removed) await save(snapshot, journal);
        if (!sameChat(snapshot)) return null;
        snapshot.journal = journal;
        active = snapshot;
        notify();
        if (removed) onRollback(removed);
        return snapshot;
    }
    function schedule(work) {
        const result = queue.then(() => {
            if (disposed) throw new Error('手机记录服务已关闭。');
            return work();
        });
        queue = result.catch(() => {});
        return result;
    }
    function refresh() { return schedule(sync); }
    function backgroundRefresh() {
        refresh().then(() => { lastError = ''; }).catch(error => {
            // Never expose the previous chat's state after an unreadable switch.
            active = null; notify();
            if (lastError !== error.message) { lastError = error.message; onError(error); }
        });
    }
    function listen(name, handler) {
        if (types[name] && typeof bus?.on === 'function') {
            bus.on(types[name], handler); subscriptions.push([types[name], handler]);
        }
    }
    for (const name of EVENTS) listen(name, () => {
        // Invalidate in-flight model results even if the user later restores the
        // same text/swipe, or switches away and back before the request finishes.
        if (name !== 'GENERATION_ENDED' || generating) generation++;
        if (name === 'GENERATION_ENDED' || name === 'GENERATION_STOPPED' || name === 'CHAT_CHANGED') generating = false;
        backgroundRefresh();
    });
    listen('GENERATION_STARTED', type => { if (type !== 'quiet') { generating = true; generation++; } });
    backgroundRefresh();

    return {
        refresh,
        epoch: () => generation,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        read() { return schedule(async () => { const snapshot = await sync(); return { scope: snapshot?.scope ?? null, state: replayJournal(snapshot?.journal), revision: snapshot?.revisions.at(-1) ?? null }; }); },
        begin() {
            return schedule(async () => {
                const snapshot = await sync();
                if (!snapshot?.revisions.length) throw new Error('请先打开聊天，并等待正文生成完成。');
                const ticket = {};
                tickets.set(ticket, { scope: snapshot.scope, metadata: snapshot.metadata, revision: snapshot.revisions.at(-1), generation });
                return ticket;
            });
        },
        commit(ticket, changes, operationId) {
            return this.commitBatch(ticket, [{ changes, id: operationId }]);
        },
        commitBatch(ticket, batches) {
            return schedule(async () => {
                const basis = tickets.get(ticket);
                const snapshot = await sync();
                if (!basis || !snapshot || basis.scope !== snapshot.scope || basis.metadata !== snapshot.metadata ||
                    basis.revision !== snapshot.revisions.at(-1) || basis.generation !== generation) {
                    throw new Error('聊天已变化，本次手机操作已取消。');
                }
                let next = snapshot.journal;
                for (const batch of batches) {
                    const index = batch.sourceIndex ?? snapshot.revisions.length - 1;
                    if (!Number.isInteger(index) || index < 0 || index >= snapshot.revisions.length) throw new Error('记录来源楼层无效。');
                    next = appendChange(next, snapshot.revisions.slice(0, index + 1), batch.changes, batch.id);
                }
                await save(snapshot, next);
                tickets.delete(ticket);
                if (sameChat(snapshot)) { active = { ...snapshot, journal: next }; notify(); }
                return replayJournal(next);
            });
        },
        destroy() {
            disposed = true;
            for (const [type, handler] of subscriptions) {
                if (typeof bus?.removeListener === 'function') bus.removeListener(type, handler);
                else bus?.off?.(type, handler);
            }
            listeners.clear(); active = null;
        },
    };
}
