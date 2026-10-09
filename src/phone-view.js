import { renderBlockButton, renderBlockedList } from './block-controls.js?v=0.14.0';
import { icon } from './icons.js?v=0.14.0';
const phoneEscape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const statuses = { dialing: '正在拨号', connected: '通话中', ended: '已结束', interrupted: '已中断', ringing: '来电中', answering: '正在接听', missed: '未接来电', declined: '对方拒接', no_answer: '无人接听' };
const callStatus = call => call.direction === 'incoming' && call.status === 'declined' ? '已拒接' : statuses[call.status];
export function renderPhoneScreen(view, tab, selectedCallId, draft) {
    const { contacts = {}, calls = {}, busy = false, error = '', errorKind = null, contactStatus = '' } = view ?? {};
    const errorHTML = error ? '<div class="pp-call-error" role="alert">' + phoneEscape(error) + '</div>' : '';
    const call = calls[selectedCallId];
    if (call) {
        const live = ['connected', 'dialing', 'answering'].includes(call.status);
        const waitingReply = ['dialing', 'answering'].includes(call.status) || call.turns.at(-1)?.role === 'user';
        return '<div class="pp-call-page"><button type="button" class="pp-text-button" data-phone-list>返回通话记录</button>' +
            '<div class="pp-call-heading"><span class="pp-contact-avatar">' + icon('person') + '</span><h2>' + phoneEscape(call.name) + '</h2>' + (call.number ? '<p>' + phoneEscape(call.number) + '</p>' : '') + '<small role="status">' + (busy && live ? '等待对方回应…' : callStatus(call)) + '</small>' + renderBlockButton(view, call.contactId, 'phone') + '</div>' +
            '<div class="pp-call-transcript" aria-live="polite">' + call.turns.map(turn => '<div class="pp-call-turn" data-role="' + (turn.role === 'user' ? 'user' : 'assistant') + '"><small>' + phoneEscape(turn.role === 'user' ? '我' : call.name) + '</small><p>' + phoneEscape(turn.text) + '</p></div>').join('') + '</div>' + errorHTML +
            (error && live && waitingReply ? '<button type="button" class="pp-call-retry" data-phone-retry' + (busy ? ' disabled' : '') + '>重试回应</button>' : '') +
            (call.status === 'connected' ? '<form class="pp-call-compose" data-phone-form><label for="pp-call-input">说话内容</label><textarea id="pp-call-input" data-phone-draft rows="2" maxlength="6000" placeholder="你在电话里说…">' + phoneEscape(draft) + '</textarea><button type="submit"' + (busy || waitingReply ? ' disabled' : '') + '>发送</button></form>' : '') +
            (call.status === 'ringing' ? '<div class="pp-incoming-actions"><button type="button" class="pp-answer" data-phone-answer' + (busy ? ' disabled' : '') + '>接听</button><button type="button" class="pp-hangup" data-phone-decline' + (busy ? ' disabled' : '') + '>拒接</button></div>' : '') +
            (live ? '<button type="button" class="pp-hangup" data-phone-hangup aria-label="挂断电话">' + icon('phone') + '<span>挂断</span></button>' : '') + '</div>';
    }
    const sortedCalls = Object.values(calls).sort((a, b) => b.createdAt - a.createdAt);
    const sortedContacts = Object.values(contacts).sort((a, b) => a.name.localeCompare(b.name));
    let rows = '';
    if (tab === 'blocked') rows = renderBlockedList(view, 'phone');
    else if (tab === 'contacts') rows = sortedContacts.map(contact => '<div class="pp-contact-row"><span class="pp-contact-avatar">' + icon('person') + '</span><div><strong>' + phoneEscape(contact.name) + '</strong>' + (contact.number ? '<small>' + phoneEscape(contact.number) + '</small>' : '') + '</div><button type="button" data-phone-dial="' + phoneEscape(contact.id) + '" class="pp-dial-contact" aria-label="拨打 ' + phoneEscape(contact.name) + '"' + (busy ? ' disabled' : '') + '>' + icon('phone') + '</button>' + renderBlockButton(view, contact.id, 'phone') + '</div>').join('');
    else rows = sortedCalls.map(item => '<button type="button" class="pp-call-row" data-phone-record="' + phoneEscape(item.id) + '"><span class="pp-contact-avatar">' + icon('phone') + '</span><span><strong>' + phoneEscape(item.name) + '</strong><small>' + (item.direction === 'incoming' ? '来电' : '拨出') + ' · ' + callStatus(item) + '</small></span><time>' + new Date(item.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) + '</time>' + icon('chevron') + '</button>').join('');
    return '<div class="pp-phone-app"><div class="pp-phone-toolbar"><h2>' + (tab === 'blocked' ? '电话黑名单' : tab === 'contacts' ? '联系人' : '最近通话') + '</h2>' + (tab === 'contacts' ? '<button type="button" class="pp-text-button" data-phone-sync' + (busy ? ' disabled' : '') + '>新增联系人</button>' : '') + '</div>' +
        (error && errorKind === 'incoming' ? '<button type="button" class="pp-text-button" data-phone-check-incoming' + (busy ? ' disabled' : '') + '>重试</button>' : '') +
        (busy ? '<p class="pp-phone-progress" role="status">正在处理，请稍候…</p>' : '') + errorHTML + (contactStatus && tab === 'contacts' ? '<p class="pp-contact-status" role="status">' + phoneEscape(contactStatus) + '</p>' : '') +
        '<div class="pp-phone-list">' + (rows || '<div class="pp-empty"><h2>' + (tab === 'contacts' ? '暂无联系人' : '暂无通话记录') + '</h2><p>' + (tab === 'contacts' ? '点击「新增联系人」添加。' : '选择联系人拨打电话。') + '</p></div>') + '</div><nav class="pp-phone-tabs" aria-label="电话页面">' +
        [['history', '电话', 'phone'], ['contacts', '联系人', 'person'], ['blocked', '黑名单', 'person']].map(([id, label, glyph]) => '<button type="button" data-phone-tab="' + id + '" aria-pressed="' + (tab === id) + '">' + icon(glyph) + '<span>' + label + '</span></button>').join('') + '</nav></div>';
}
