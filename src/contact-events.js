import { isMemoryHidden } from './journal.js?v=0.13.0';
export const eventKey = id => 'contactEvent:' + id;
export const isBlocked = (state, id, channel) => state.profiles?.['blocked:' + id]?.[channel] === true;

export function eventDirective(data, chat, policy) {
    const action = data.event_action || 'none';
    if (!['none', 'start', 'continue', 'wait', 'end'].includes(action)) throw new Error('联系事件判断格式不正确。');
    if (action === 'start') {
        if (!policy.eventsEnabled || data.event_requires_response !== true || typeof data.event_evidence !== 'string' ||
            data.event_evidence.trim().length < 8 || typeof data.event_reason !== 'string' || !data.event_reason.trim()) throw new Error('联系事件缺少实际剧情依据。');
        const index = chat.findIndex((message, i) => i > policy.eventSinceIndex && (!message.is_system || isMemoryHidden(message)) && String(message.mes ?? '').includes(data.event_evidence));
        if (index < 0) throw new Error('联系事件的依据不在当前有效剧情中。');
        return { action, evidence: data.event_evidence, reason: data.event_reason.slice(0, 1000), sourceIndex: index };
    }
    if (['continue', 'wait', 'end'].includes(action) && !policy.event) throw new Error('当前没有可延续的联系事件。');
    return { action: policy.event && action === 'none' ? 'end' : action };
}

export function eventChange(previous, directive, participant, revision) {
    if (directive.action === 'start') return { id: crypto.randomUUID(), participant, active: true,
        evidence: directive.evidence, reason: directive.reason, sourceIndex: directive.sourceIndex, revision };
    if (!previous) return null;
    return { ...previous, active: !['end', 'none'].includes(directive.action) };
}

// A normal telephone/SMS reply can recognize an event in the user's own words
// without making another API call or automatically generating a second response.
export function communicationEvent(data, previous, participant, userText, sourceIndex) {
    if (data.event_action === 'end' && previous) return { ...previous, active: false };
    if (data.event_action !== 'start' || data.event_requires_response !== true || !userText ||
        typeof data.event_evidence !== 'string' || data.event_evidence.trim().length < 4 || !userText.includes(data.event_evidence) ||
        typeof data.event_reason !== 'string' || !data.event_reason.trim()) return null;
    return { id: crypto.randomUUID(), participant, active: true, evidence: data.event_evidence,
        reason: data.event_reason.slice(0, 1000), sourceIndex, origin: 'communication' };
}
