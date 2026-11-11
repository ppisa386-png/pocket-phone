import { sameNamedPerson } from './names.js?v=1.2';

// A missing model annotation must not silently erase an explicitly sent X DM.
// Recovery is intentionally narrow: completed assistant prose, a named X thread,
// quoted message body, a successful send, and exactly one saved counterpart.
export function narratedXSentDms(message, state) {
    const prose = String(message?.mes || '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/<(think|thinking|analysis|script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '');
    if (!/(?:X(?:平台|\/Twitter)?|Twitter|推特)[^\n。！？]{0,100}(?:私信|DM|对话框)/i.test(prose)) return [];
    const threads = [...prose.matchAll(/(?:点开|打开|进入|切到|切回|切换到|选中)\s*[“「『"]([^”」』"\n]{1,100})[”」』"]\s*(?:的)?(?:对话框|私信|会话|聊天窗口|聊天)/g)];
    if (!threads.length) return [];
    const accounts = Object.values(state.x || {}).filter(a => a.type === 'account' && !a.blocked && a.inboundRequest !== 'declined');
    const result = [];
    for (const quote of prose.matchAll(/(?:打字(?:回复|发送)?|回复|输入|敲下|写下|键入)\s*(?:了|道|内容|消息)?\s*[:：，]?\s*【([^】]{1,6000})】/g)) {
        const text = quote[1].trim();
        if (!text) continue;
        const thread = threads.filter(t => t.index < quote.index && quote.index - (t.index + t[0].length) < 210).at(-1);
        if (!thread) continue;
        const label = thread[1].trim(), matches = accounts.filter(a =>
            sameNamedPerson(a, {name:label}) || String(a.handle || '').replace(/^@/, '').toLowerCase() === label.replace(/^@/, '').toLowerCase());
        if (matches.length !== 1) continue;
        const tail = prose.slice(quote.index + quote[0].length, quote.index + quote[0].length + 220);
        const send = /(?:点击(?:了)?|按下(?:了)?|点(?:下|了)?|按(?:了)?)\s*(?:[“「])?发送(?:键|按钮)?|发送成功|(?:私信.{0,12})?[“「]?已送达[”」]?/g.exec(tail);
        if (!send) continue;
        const before = tail.slice(Math.max(0, send.index - 16), send.index);
        if (/(?:并未|还没|尚未|没有|未能|无法|没|未|不曾|准备|打算|计划|差点|想要)\s*$/.test(before)) continue;
        const after = tail.slice(send.index + send[0].length, send.index + send[0].length + 35);
        if (/(?:发送失败|未送达|未发送|没发出去|发送不出去|撤回|取消发送)/.test(after)) continue;
        if (!result.some(row => row.accountId === matches[0].id && row.text === text))
            result.push({accountId:matches[0].id, name:matches[0].name, text});
    }
    return result;
}
