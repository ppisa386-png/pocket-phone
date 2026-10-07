import { icon } from './icons.js?v=0.4.0';
import { threadMessages, unreadMessages } from './messages.js?v=0.4.0';
const smsEscape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const smsTime = value => new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
const replyLabels = { pending: '等待回复…', received: '已发送', failed: '回复获取失败', no_reply: '已发送 · 暂无回复' };
export function renderMessagesScreen(view, selectedContactId, picking, drafts) {
    const { contacts = {}, messages = {}, busy = false, error = '' } = view ?? {};
    const errorHTML = error ? '<div class="pp-call-error" role="alert">' + smsEscape(error) + '</div>' : '';
    const contact = contacts[selectedContactId];
    if (contact) {
        const thread = threadMessages(messages, contact.id);
        const latestUserId = thread.filter(message => message.role === 'user').at(-1)?.id;
        return '<div class="pp-sms-thread"><div class="pp-sms-heading"><button type="button" class="pp-icon-button" data-sms-back aria-label="返回短信列表">' + icon('back') + '</button><div><strong>' + smsEscape(contact.name) + '</strong><small>' + smsEscape(contact.number || '已交换号码') + '</small></div></div>' +
            '<div class="pp-sms-bubbles" aria-live="polite">' + (thread.length ? thread.map(message => '<div class="pp-sms-item" data-role="' + (message.role === 'user' ? 'user' : 'assistant') + '"><p class="pp-sms-bubble">' + smsEscape(message.text) + '</p><small>' + smsTime(message.createdAt) + (message.role === 'user' ? ' · ' + replyLabels[message.replyStatus] : '') + '</small>' +
                (message.id === latestUserId && message.replyStatus === 'failed' ? '<button type="button" class="pp-text-button" data-sms-retry="' + smsEscape(message.id) + '"' + (busy ? ' disabled' : '') + '>重试回复</button>' : '') + '</div>').join('') : '<p class="pp-sms-empty-thread">发送第一条短信</p>') + '</div>' +
            (busy ? '<p class="pp-phone-progress" role="status">正在处理，请稍候…</p>' : '') + errorHTML +
            '<form data-sms-form class="pp-sms-compose"><label for="pp-sms-input">短信内容</label><textarea id="pp-sms-input" data-sms-draft rows="2" maxlength="6000" placeholder="短信…"' + (busy ? ' disabled' : '') + '>' + smsEscape(drafts[contact.id] || '') + '</textarea><button type="submit" aria-label="发送短信"' + (busy ? ' disabled' : '') + '>发送</button></form></div>';
    }
    let entries = Object.values(contacts);
    if (picking) entries.sort((a, b) => a.name.localeCompare(b.name));
    else entries = entries.filter(item => threadMessages(messages, item.id).length).sort((a, b) => threadMessages(messages, b.id).at(-1).createdAt - threadMessages(messages, a.id).at(-1).createdAt);
    return '<div class="pp-sms-list"><div class="pp-phone-toolbar"><h2>' + (picking ? '选择联系人' : '短信') + '</h2><button type="button" class="pp-text-button" ' + (picking ? 'data-sms-back' : 'data-sms-new') + '>' + (picking ? '取消' : '新建短信') + '</button></div>' +
        (busy ? '<p class="pp-phone-progress" role="status">正在处理，请稍候…</p>' : '') + errorHTML +
        (entries.length ? entries.map(item => {
            const last = threadMessages(messages, item.id).at(-1);
            const unread = unreadMessages(messages, item.id);
            return '<button type="button" class="pp-sms-row" data-sms-contact="' + smsEscape(item.id) + '"><span class="pp-contact-avatar">' + icon('person') + '</span><span class="pp-sms-row-text"><strong>' + smsEscape(item.name) + '</strong><small>' + smsEscape(picking ? (item.number || '已交换号码') : last.text) + '</small></span>' + (unread && !picking ? '<span class="pp-unread-count">' + unread + '</span>' : '') + icon('chevron') + '</button>';
        }).join('') : '<div class="pp-empty"><h2>' + (picking ? '暂无联系人' : '暂无短信') + '</h2><p>' + (picking ? '需要先在正文中获得对方号码。' : '点击「新建短信」，选择联系人开始交流。') + '</p></div>') +
        (picking ? '<button type="button" class="pp-text-button pp-sms-refresh" data-sms-sync' + (busy ? ' disabled' : '') + '>刷新联系人</button>' : '') + '</div>';
}
