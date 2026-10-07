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
