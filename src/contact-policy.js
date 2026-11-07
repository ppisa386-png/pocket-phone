import { isMemoryHidden } from './journal.js?v=1.1.29';
// Count narrative replies for the shared outreach opportunity.
export function effectiveReply(message) {
    if (!message || message.is_user || message.isPhoneMessage || message.isGaigaiPrompt || message.isGaigaiData ||
        message.extra?.type || (message.role && message.role !== 'assistant') ||
        (message.is_system && !isMemoryHidden(message))) return false;
    const prose = String(message.mes ?? '').replace(/<!--[\s\S]*?(?:-->|$)/g,'')
        .replace(/<(think|thinking|analysis|script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,'');
    return !!prose.trim();
}
export const narrativeReplyCount = chat => chat.filter(effectiveReply).length;
export const narrativeTurn = chat => chat.filter(message => message.is_user && (!message.is_system || isMemoryHidden(message))).length;
