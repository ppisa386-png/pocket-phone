import { exactStoryTime } from './story-clock.js?v=1.1.12';
import { smsForAI } from './sms-context.js?v=1.1.13';

// Only timing/direction metadata: no expired message text, excerpts or topic summaries.
export function recentContactActivity(state, chat, contactId = null) {
    const now = exactStoryTime(chat);
    const messages = smsForAI(state, contactId, now).filter(m => !['queued','failed'].includes(m.replyStatus)).map(m => ({
        contactId:m.contactId, name:m.name, medium:'sms', direction:m.role === 'user' ? 'outgoing' : 'incoming', storyTime:m.storyTime || null, order:m.createdAt || 0,
    }));
    const calls = Object.values(state.calls || {}).filter(c => contactId == null || c.contactId === contactId).map(c => ({
        contactId:c.contactId, name:c.name, medium:'call', direction:c.direction, status:c.status, storyTime:c.storyTime || null, order:c.createdAt || 0,
    }));
    return { now, recent:[...messages,...calls].sort((a,b) => a.order-b.order).slice(-8).map(({order,...record})=>record) };
}
