import { renderBlockButton, renderBlockedList } from './block-controls.js?v=0.13.0';
import { isBlocked } from './contact-events.js?v=0.13.0';
import { icon } from './icons.js?v=0.13.0';
import { threadMessages, unreadMessages, messageParticipants } from './messages.js?v=0.13.0';
const smsEscape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const smsTime = value => new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
const replyLabels = { pending: '等待回复…', received: '已发送', failed: '回复获取失败', no_reply: '已发送 · 暂无回复', blocked: '已暂停接收回复' };
export function renderMessagesScreen(view, selectedContactId, picking, drafts) {
    const { contacts = {}, messages = {}, busy = false, error = '', errorKind = null, contactStatus = '' } = view ?? {};
    const retryHTML = error && errorKind === 'incoming' ? '<button type="button" class="pp-text-button" data-phone-check-incoming' + (busy ? ' disabled' : '') + '>重试主动联系检查</button>' : '';
    const errorHTML = retryHTML + (error ? '<div class="pp-call-error" role="alert">' + smsEscape(error) + '</div>' : '');
    if (picking === 'blocked') return '<div class="pp-sms-list"><div class="pp-phone-toolbar"><h2>短信黑名单</h2><button type="button" class="pp-text-button" data-sms-back>返回</button></div>' + renderBlockedList(view, 'messages') + '</div>';
    const participants = messageParticipants(view ?? {});
    const contact = participants[selectedContactId];
    if (contact) {
        const blocked = isBlocked(view, contact.id, 'messages');
        const thread = threadMessages(messages, contact.id);
        const latestUserId = thread.filter(message => message.role === 'user').at(-1)?.id;
        return '<div class="pp-sms-thread"><div class="pp-sms-heading"><button type="button" class="pp-icon-button" data-sms-back aria-label="返回短信列表">' + icon('back') + '</button><div><strong>' + smsEscape(contact.name) + '</strong><small>' + smsEscape(contact.number || (contact.receivedSMS ? '短信发件人' : contact.sourceKind === 'persona' ? '人设中的亲友' : '已交换号码')) + '</small></div>' + renderBlockButton(view, contact.id, 'messages') + '</div>' +
            '<div class="pp-sms-bubbles" aria-live="polite">' + (thread.length ? thread.map(message => '<div class="pp-sms-item" data-role="' + (message.role === 'user' ? 'user' : 'assistant') + '"><p class="pp-sms-bubble">' + smsEscape(message.text) + '</p><small>' + smsTime(message.createdAt) + (message.role === 'user' ? ' · ' + replyLabels[message.replyStatus] : '') + '</small>' +
                (message.id === latestUserId && message.replyStatus === 'failed' ? '<button type="button" class="pp-text-button" data-sms-retry="' + smsEscape(message.id) + '"' + (busy || blocked ? ' disabled' : '') + '>重试回复</button>' : '') + '</div>').join('') : '<p class="pp-sms-empty-thread">发送第一条短信</p>') + '</div>' +
            (busy ? '<p class="pp-phone-progress" role="status">正在处理，请稍候…</p>' : '') + errorHTML +
            (blocked ? '<p class="pp-footnote">此人的短信已被拉黑，取消后才能继续交流。</p>' : '') +
            '<form data-sms-form class="pp-sms-compose"><label for="pp-sms-input">短信内容</label><textarea id="pp-sms-input" data-sms-draft rows="2" maxlength="6000" placeholder="短信…"' + (busy || blocked ? ' disabled' : '') + '>' + smsEscape(drafts[contact.id] || '') + '</textarea><button type="submit" aria-label="发送短信"' + (busy || blocked ? ' disabled' : '') + '>发送</button></form></div>';
    }
    let entries = Object.values(picking ? contacts : participants);
    if (picking) entries.sort((a, b) => a.name.localeCompare(b.name));
    else entries = entries.filter(item => threadMessages(messages, item.id).length).sort((a, b) => threadMessages(messages, b.id).at(-1).createdAt - threadMessages(messages, a.id).at(-1).createdAt);
    return '<div class="pp-sms-list"><div class="pp-phone-toolbar"><h2>' + (picking ? '选择联系人' : '短信') + '</h2><button type="button" class="pp-text-button" ' + (picking ? 'data-sms-back' : 'data-sms-new') + '>' + (picking ? '取消' : '新建短信') + '</button>' + (picking ? '<button type="button" class="pp-text-button" data-sms-sync' + (busy ? ' disabled' : '') + '>新增联系人</button>' : '') + (!picking ? '<button type="button" class="pp-text-button" data-sms-blocklist>黑名单</button>' : '') + '</div>' +
        (busy ? '<p class="pp-phone-progress" role="status">正在处理，请稍候…</p>' : '') + errorHTML + (contactStatus && picking ? '<p class="pp-contact-status" role="status">' + smsEscape(contactStatus) + '</p>' : '') +
        (entries.length ? entries.map(item => {
            const last = threadMessages(messages, item.id).at(-1);
            const unread = unreadMessages(messages, item.id);
            return '<button type="button" class="pp-sms-row" data-sms-contact="' + smsEscape(item.id) + '"><span class="pp-contact-avatar">' + icon('person') + '</span><span class="pp-sms-row-text"><strong>' + smsEscape(item.name) + '</strong><small>' + smsEscape(picking ? (item.number || (item.sourceKind === 'persona' ? '人设中的亲友' : '已交换号码')) : last.text) + '</small></span>' + (unread && !picking ? '<span class="pp-unread-count">' + unread + '</span>' : '') + icon('chevron') + '</button>';
        }).join('') : '<div class="pp-empty"><h2>' + (picking ? '暂无联系人' : '暂无短信') + '</h2><p>' + (picking ? '点击「新增联系人」，从可见正文和你的人设中查找。' : '点击「新建短信」，选择联系人开始交流。') + '</p></div>') +
        '</div>';
}
