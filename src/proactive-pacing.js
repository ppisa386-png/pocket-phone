import { exactStoryTime } from './story-clock.js?v=1.1.29';
import { smsForAI } from './sms-context.js?v=1.1.29';

// Input is oldest-first. Apply the same per-thread cap to communication
// facts and to the lighter timing metadata sent to the narrative model.
export function recentPerConversation(records,key){
    const counts=new Map();
    return [...records].reverse().filter(row=>{
        const k=key(row),n=counts.get(k)||0;counts.set(k,n+1);return n<3;
    }).reverse();
}
// Only timing/direction metadata: no expired message text, excerpts or topic summaries.
export function recentContactActivity(state, chat, contactId = null) {
    const now = exactStoryTime(chat);
    const messages = smsForAI(state, contactId, now).filter(m => !['queued','failed'].includes(m.replyStatus)).map(m => ({
        contactId:m.contactId, name:m.name, medium:'sms', direction:m.role === 'user' ? 'outgoing' : 'incoming', storyTime:m.storyTime || null, order:m.createdAt || 0,
    }));
    const calls = Object.values(state.calls || {}).filter(c => contactId == null || c.contactId === contactId).map(c => ({
        contactId:c.contactId, name:c.name, medium:'call', direction:c.direction, status:c.status, storyTime:c.storyTime || null, order:c.createdAt || 0,
    }));
    return { now, recent:recentPerConversation([...messages,...calls].sort((a,b)=>a.order-b.order),r=>r.medium+':'+r.contactId).slice(-8).map(({order,...record})=>record) };
}
