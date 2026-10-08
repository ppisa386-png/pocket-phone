// Cooldowns count user narrative turns, never wall-clock time or group speakers.
export const narrativeTurn = chat => chat.filter(message => message.is_user && !message.is_system).length;

export function contactPolicy(state, chat, settings, contactId = null) {
    const turn = narrativeTurn(chat);
    const gates = [state.profiles.contactGate, state.profiles['contactGate:' + contactId]].filter(Boolean);
    const lastCheck = state.profiles.proactiveScan;
    const intervalFor = gate => gate.unanswered ? Math.max(settings.contactInterval, settings.unansweredInterval) : settings.contactInterval;
    const elapsed = gates.length ? Math.min(...gates.map(gate => turn - gate.turn)) : Infinity;
    const interval = gates.length ? Math.max(...gates.map(intervalFor)) : settings.contactInterval;
    const restricted = gates.some(gate => turn - gate.turn < intervalFor(gate));
    // Optional exceptions still have a hard minimum. No character can bypass it.
    const allowed = settings.proactiveEnabled && (!restricted || (settings.contactExceptions && elapsed >= 2)) &&
        (!lastCheck || turn - lastCheck.turn >= 2);
    return { turn, allowed, restricted, interval, sinceIndex: Math.max(-1, ...gates.map(gate => gate.sourceIndex)) };
}

export function validateProactive(data, chat, policy, channels, validateAcquisition) {
    if (data.status === 'none') return null;
    const medium = data.status === 'ringing' ? 'phone' : data.status === 'message' ? 'messages' : null;
    if (!medium || !channels[medium]) throw new Error('主动联系渠道不可用。');
    const acquisition = validateAcquisition({ ...data, status: 'ringing' }, chat);
    const kinds = ['commitment', 'new_information', 'urgent_question', 'emergency', 'established_persistence'];
    if (!kinds.includes(data.reason_kind) || typeof data.reason_evidence !== 'string' || data.reason_evidence.trim().length < 8) {
        throw new Error('主动联系缺少具体事件依据。');
    }
    // Each new contact needs a new, post-contact story event. Rephrasing the same
    // reason or changing channels cannot reuse old evidence to restart a barrage.
    if (policy.usedReasons?.includes(data.reason_evidence.trim())) return null;
    const eventIndex = chat.findIndex((message, i) => i > policy.sinceIndex && !message.is_system && String(message.mes ?? '').includes(data.reason_evidence));
    if (eventIndex < 0) throw new Error('主动联系没有新的有效剧情依据。');
    const exception = ['emergency', 'established_persistence'].includes(data.reason_kind);
    if (policy.restricted && !exception) return null;
    if (medium === 'phone' && data.requires_live_conversation !== true) return null;
    if (medium === 'messages' && (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 6000)) throw new Error('主动短信内容格式不正确。');
    return { medium, acquisition, reasonKind: data.reason_kind, reasonEvidence: data.reason_evidence, eventIndex,
        text: medium === 'messages' ? data.text.trim() : null };
}
