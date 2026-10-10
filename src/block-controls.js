import { isBlocked } from './contact-events.js?v=0.16.2';
const blockEscape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export function renderBlockButton(state, id, channel) {
    const blocked = isBlocked(state, id, channel);
    return '<button type="button" class="pp-text-button pp-block-button" data-block-id="' + blockEscape(id) + '" data-block-channel="' + channel + '" data-block-value="' + !blocked + '">' +
        (blocked ? '取消拉黑' : '拉黑' + (channel === 'phone' ? '电话' : '短信')) + '</button>';
}
export function renderBlockedList(state, channel) {
    const entries = Object.entries(state.profiles ?? {}).filter(([key, value]) => key.startsWith('blocked:') && value[channel]);
    return entries.length ? entries.map(([, person]) => '<div class="pp-contact-row"><div><strong>' + blockEscape(person.name) + '</strong><small>已屏蔽' + (channel === 'phone' ? '电话' : '短信') + '</small></div>' + renderBlockButton(state, person.id, channel) + '</div>').join('') : '<div class="pp-empty"><h2>黑名单为空</h2></div>';
}
