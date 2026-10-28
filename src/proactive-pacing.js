import { exactStoryTime } from './story-clock.js?v=0.24.25';
import { smsForAI } from './sms-context.js?v=0.24.25';

export const PROACTIVE_PACING_RULE = '主动联系节奏：手机安静是正常结果，无消息不需要补偿。每三条角色正文一次只是可选考虑时机，不是发送周期或欠下的通知；连续多个考虑时机都无人联系也正常。'
    + '先看剧情实际经过多久、刚刚是否交流过、这次是否有不同于上次的具体动机。刚联系过、话题已结束、没有新进展时优先留白；不要把关心、想念、性格热情或人设中是朋友反复当作新理由。'
    + '联系人多少不决定消息数量，不轮流让好友报到，也不把同一提醒换人、换措辞或换电话/短信继续刷。普通问候未回应时优先等待，不把已读或未回复自动解释成催促理由。'
    + '日常可适时分享，不限紧急事务；user主动回复后的正常对话、约定确实到了时间或事件有新进展可自然继续，不能用等待规则禁止正常回应。不要为绕过少打扰原则临时制造危机、急事或新借口。'
    + '只根据角色可知信息和真实处境决定；近期联络元数据是作者安排节奏的参考，不能让任何角色得知他人的私聊。时间未知时不要臆测已隔很久，按可见剧情和已有记录保守判断。';

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
