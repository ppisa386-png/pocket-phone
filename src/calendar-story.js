import { JOURNAL_KEY, messageSignatures, revisionsFor, reconcileJournal, replayJournal, isMemoryHidden } from './journal.js?v=1.2.57';
import { createNarrativePrompt } from './narrative-prompt.js?v=1.2.57';
import { readStoryClock } from './story-clock.js?v=1.2';
import { calendarDue, calendarPrompt, calendarSet } from './calendar-core.js?v=1.2.62';

export const CALENDAR_KEY = 'durian_phone_calendar';
export function createCalendarBridge({ getContext, getSettings, memory, onError = () => {} }) {
    const c = getContext(), bus = c?.eventSource, types = c?.event_types ?? c?.eventTypes ?? {}, hooks = [];
    const output = createNarrativePrompt({ getContext, key: CALENDAR_KEY, depth: 1 });
    let token = 0, pending = null, disposed = false;
    const clear = () => { token++; pending = null; output.clear(); };
    const listen = (name, fn) => { if (types[name] && bus?.on) { bus.on(types[name], fn); hooks.push([types[name], fn]); } };
    async function prepare(type = 'normal', _options, dry) {
        if (dry) return;
        clear();
        if (disposed || ['quiet', 'impersonate'].includes(type) || !getSettings().apps.calendar) return;
        const context = getContext(), metadata = context.chatMetadata, original = messageSignatures(context.chat || []);
        if (!metadata || !original.length) return;
        const chat = ['swipe', 'regenerate'].includes(type) && !context.chat.at(-1).is_user ? context.chat.slice(0, -1) : context.chat;
        const signatures = messageSignatures(chat), turn = token;
        const current = () => !disposed && token === turn && getSettings().apps.calendar && getContext().chatMetadata === metadata &&
            JSON.stringify(messageSignatures(getContext().chat || []).slice(0, signatures.length)) === JSON.stringify(signatures);
        try {
            const revisions = await revisionsFor(signatures), legacy = chat.some(isMemoryHidden) ? await revisionsFor(messageSignatures(chat, true)) : null;
            const state = replayJournal(reconcileJournal(metadata[JOURNAL_KEY], revisions, legacy).journal);
            if (!current()) return;
            const rows = calendarDue(state, readStoryClock(chat).day);
            if (!rows.length) return;
            const completionPrefix = type === 'continue' && !context.chat.at(-1).is_user ? signatures.slice(0, -1) : signatures;
            const receipt = { metadata, original, signatures, completionPrefix, rows, applied: false, turn };
            pending = receipt;
            output.set(calendarPrompt(rows), current, () => { if (pending === receipt) receipt.applied = true; });
        } catch (error) { onError(error); }
    }
    async function finish() {
        const receipt = pending;
        output.clear(); pending = null;
        if (!receipt?.applied || disposed || !getSettings().apps.calendar || getContext().chatMetadata !== receipt.metadata) return;
        const context = getContext(), signatures = messageSignatures(context.chat || []);
        // A failed/cancelled request or a switch cannot consume a reminder.
        if (JSON.stringify(signatures) === JSON.stringify(receipt.original) ||
            JSON.stringify(signatures.slice(0, receipt.completionPrefix.length)) !== JSON.stringify(receipt.completionPrefix) ||
            !context.chat.slice(receipt.completionPrefix.length).some(m => !m.is_user && !m.is_system && String(m.mes || '').trim())) return;
        const current = () => !disposed && token === receipt.turn && getSettings().apps.calendar && getContext().chatMetadata === receipt.metadata &&
            JSON.stringify(messageSignatures(getContext().chat || [])) === JSON.stringify(signatures);
        try {
            const view = await memory.read();
            if (!current() || !view.scope) return;
            const unique = [...new Map(receipt.rows.map(row => [row.receipt, row])).values()];
            const changes = unique.filter(row => !view.state.calendar?.[row.receipt]).map(row => calendarSet(row.receipt,
                { type: 'reminder', date: row.date, stage: row.stage, eventIds: receipt.rows.filter(r => r.receipt === row.receipt).map(r => r.id) }));
            if (!changes.length) return;
            const ticket = await memory.begin(view);
            if (current()) await memory.commit(ticket, changes);
        } catch (error) { onError(error); }
    }
    if (c?.setExtensionPrompt && bus?.on) {
        if (types.GENERATION_AFTER_COMMANDS) {
            listen('GENERATION_STARTED', (_t, _o, dry) => { if (!dry) clear(); });
            listen('GENERATION_AFTER_COMMANDS', prepare);
        } else listen('GENERATION_STARTED', prepare);
        listen('GENERATION_ENDED', finish);
        for (const name of ['GENERATION_STOPPED', 'CHAT_CHANGED', 'CHAT_LOADED', 'MESSAGE_DELETED', 'MESSAGE_EDITED', 'MESSAGE_SWIPED', 'GROUP_WRAPPER_FINISHED']) listen(name, clear);
    }
    return { prepare, finish, destroy() { clear(); disposed = true; output.destroy(); for (const [name, fn] of hooks) bus.removeListener?.(name, fn); } };
}
