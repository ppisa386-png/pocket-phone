export function validateSMS(data) {
    if (!['reply', 'no_reply'].includes(data.status) || typeof data.text !== 'string' ||
        (data.status === 'reply' && !data.text.trim())) throw new Error('短信回复格式不正确，请重试。');
    return { status: data.status, text: data.text.trim() };
}
export function threadMessages(messages, contactId) {
    return Object.values(messages ?? {}).filter(message => message.contactId === contactId).sort((a, b) => a.createdAt - b.createdAt);
}
export function unreadMessages(messages, contactId = null) {
    return Object.values(messages ?? {}).filter(message => message.role === 'assistant' && !message.read && (!contactId || message.contactId === contactId)).length;
}

// A received SMS supplies a return address for this thread only. It does not
// unlock telephone dialing or add an unearned number to the contact directory.
export function messageParticipants(state) {
    const participants = { ...(state.contacts ?? {}) };
    for (const message of Object.values(state.messages ?? {})) {
        if (message.proactive && message.role === 'assistant' && message.participant?.id === message.contactId && !participants[message.contactId]) {
            participants[message.contactId] = { ...message.participant, number: null, receivedSMS: true };
        }
    }
    return participants;
}
