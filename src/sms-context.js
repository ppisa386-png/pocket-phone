import { commExpired, commKey, syncCommContext, commClassificationPlan, commClassificationChanges, commReplyClassification } from './comm-context.js?v=1.2.57';

// The SMS A/B timing mechanism is now a thin compatibility layer over the
// unified per-channel sidecar in comm-context.js. Old `smsContext` rows are
// migrated there on first sync; these exports keep every previous call site.
export const smsCategory = value => value === 'A' || value === 'B' ? value : null;
export const smsExpired = commExpired;

export function smsForAI(state, contactId, now) {
    return Object.values(state.messages || {}).filter(message =>
        (contactId == null || message.contactId === contactId) && message.replyStatus !== 'queued' &&
        !commExpired(state.commContext?.[commKey('sms', message.id)], now));
}

export function smsAIRecords(state, contactId, now) {
    return smsForAI(state,contactId,now).map(m => ({id:m.id,role:m.role,text:m.text,category:smsCategory(state.commContext?.[commKey('sms',m.id)]?.category)}));
}

export const syncSMSContext = syncCommContext;

export function smsClassificationPlan(state, contactId, now) {
    return commClassificationPlan(state, 'sms', contactId, now);
}

export const smsClassificationChanges = commClassificationChanges;

export function smsReplyClassification(id, contactId, category) {
    return commReplyClassification('sms', id, contactId, category);
}

// Old contact-event summaries must not become a back door for expired SMS.
// This only removes context, never declares the fictional matter resolved.
export function smsEventForAI(state, event, now) {
    if (!event || event.origin !== 'communication' || event.channel === 'phone') return event;
    // Linked message ids come from the communication path; the old evidence-quote
    // fallback is gone because new events carry no evidence text.
    const linked = Array.isArray(event.smsSourceIds) ? event.smsSourceIds : [];
    if (linked.length && linked.every(id => !state.messages?.[id] || commExpired(state.commContext?.[commKey('sms', id)], now))) return null;
    return event;
}
