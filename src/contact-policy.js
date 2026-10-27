import { findProactiveEvidence } from './proactive-evidence.js?v=0.24.23';
import { isMemoryHidden } from './journal.js?v=0.24.23';
import { eventDirective } from './contact-events.js?v=0.24.23';
// Turn counts describe history only; they never throttle character decisions.
export const narrativeReplyCount = chat => chat.filter(message => !message.is_user && (!message.is_system || isMemoryHidden(message))).length;
export const narrativeTurn = chat => chat.filter(message => message.is_user && (!message.is_system || isMemoryHidden(message))).length;

export function contactPolicy(state, chat, settings, contactId = null) {
    const turn = narrativeTurn(chat);
    return { turn, allowed: settings.proactiveEnabled, sinceIndex: -1 };
}

export function validateProactive(data, chat, policy, channels, validateAcquisition, sources = []) {
    const directive = eventDirective(data, chat, policy);
    const followsEvent = ['start', 'continue'].includes(directive.action);
    if (data.status === 'none') return directive.action === 'none' ? null : { medium: null, directive };
    if (['wait', 'end'].includes(directive.action)) throw new Error('等待或结束事件时不能同时生成联系。');
    if (policy.eventOnly && !followsEvent) return null;
    const medium = data.status === 'ringing' ? 'phone' : data.status === 'message' ? 'messages' : null;
    if (!medium || !channels[medium]) throw new Error('主动联系渠道不可用。');
    const acquisition = validateAcquisition({ ...data, status: 'ringing' }, chat, sources);
    const kinds = ['commitment', 'new_information', 'urgent_question', 'emergency', 'established_persistence', 'character_motivation'];
    if (!kinds.includes(data.reason_kind) || typeof data.reason_evidence !== 'string' || data.reason_evidence.trim().length < 4) {
        throw new Error('主动联系缺少具体事件依据。');
    }
    const basis=findProactiveEvidence(data.reason_evidence,chat,sources,data.reason_source);
    const eventIndex=basis?.sourceIndex??-1;
    if (!basis && !(followsEvent && policy.event?.evidence === data.reason_evidence)) throw new Error('主动联系缺少有效剧情或人设依据。');
    if (medium === 'phone' && data.requires_live_conversation !== true) return null;
    if (medium === 'messages' && (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 6000)) throw new Error('主动短信内容格式不正确。');
    return { medium, directive, acquisition, reasonKind: data.reason_kind, reasonEvidence: data.reason_evidence, eventIndex,
        text: medium === 'messages' ? data.text.trim() : null };
}
