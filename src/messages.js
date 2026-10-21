export function validateSMS(data) {
    if (!['reply', 'no_reply'].includes(data.status) || typeof data.text !== 'string' ||
        (data.status === 'reply' && !data.text.trim())) throw new Error('短信回复格式不正确，请重试。');
    return { status: data.status, text: data.text.trim() };
}
export function threadMessages(messages, contactId) {
    // replayJournal supplies occurrence order, independent of wall/story clocks.
    return Object.values(messages ?? {}).filter(message => message.contactId === contactId);
}
export function unreadMessages(messages, contactId = null) {
    return Object.values(messages ?? {}).filter(message => message.role === 'assistant' && !message.read && (!contactId || message.contactId === contactId)).length;
}

// A received SMS may supply a return address for this thread only. One-way
// notifications remain readable but cannot grant communication access.
export function messageParticipants(state) {
    const participants = { ...(state.contacts ?? {}) };
    for (const message of Object.values(state.messages ?? {})) {
        if (message.proactive && message.role === 'assistant' && message.participant?.id === message.contactId && !state.contacts?.[message.contactId]) {
            const replyable = message.replyable !== false;
            if (!participants[message.contactId] || (participants[message.contactId].replyable === false && replyable)) {
                participants[message.contactId] = { ...message.participant, number: null, receivedSMS: true, replyable };
            }
        }
    }
    return participants;
}
