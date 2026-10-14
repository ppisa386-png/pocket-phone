import { JOURNAL_KEY, messageSignatures, revisionsFor, reconcileJournal, replayJournal, appendChange, isMemoryHidden } from './journal.js?v=0.24.0';
import { storyAnnotations } from './story-phone.js?v=0.24.0';
import { readStoryClock } from './story-clock.js?v=0.24.0';
import { assetRows, assetSet, assetText, cashBalance, reservedCash, debtEpisode, dollars } from './assets-core.js?v=0.24.0';
import { validateFinancialEvent, applyFinancialEvent } from './assets-events.js?v=0.24.0';
import { createNarrativePrompt } from './narrative-prompt.js?v=0.24.0';

export const ASSETS_KEY = 'durian_phone_finances';
const safe = x => JSON.stringify(x).replace(/\{\{/g, '\\u007b\\u007b');
export function importStoryAssets(journal, revisions, chat) {
    let state = replayJournal(journal), changed = false;
    let clock = { day: null, hour: null };
    for (let index = 0; index < chat.length; index++) {
        clock = readStoryClock([chat[index]], clock);
        for (const row of storyAnnotations(chat[index], 'durian-money')) {
            const legacyId = 'money:' + revisions[index] + ':' + row.evidence.trim();
            const id = legacyId + ':' + JSON.stringify([row.kind, assetText(row.name), row.action || (row.kind === 'job' ? 'start' : 'acquire')]);
            const legacy = state.assets[legacyId];
            if (state.assets[id] || (legacy && legacy.kind === row.kind && legacy.name === assetText(row.name)) || state.assets.wallet?.lastIndex >= index) continue;
            // Existing app orders/transfers are already booked; prose must not
            // charge again when it merely acknowledges them.
            if (row.ref && (state.orders?.[row.ref] || state.snapchat?.[row.ref] || state.assets?.[row.ref])) continue;
            try {
                for (const key of ['amount', 'monthlySalary', 'marketValue']) if (row[key] != null) {
                    const normalized = row.prose.replace(/[,，]/g, '');
                    const amounts = [...normalized.matchAll(/(?<![\d.])-?\d+(?:\.\d+)?(?![\d.])/g)].map(m => Number(m[0]));
                    if (!amounts.includes(Number(row[key]))) throw Error('正文没有这个金额');
                }
                const event = validateFinancialEvent(row, id, index, clock.day);
                if (clock.day !== null && event.day !== null && event.day > clock.day) continue;
                const changes = applyFinancialEvent(state, event);
                journal = appendChange(journal, revisions.slice(0, index + 1), changes, id);
                state = replayJournal(journal); changed = true;
            } catch { /* Invalid/incomplete markers are handled by manual assessment. */ }
        }
        for (const row of storyAnnotations(chat[index], 'durian-debt')) {
            const episode = debtEpisode(state), id = 'handled:' + row.id;
            if (!episode || row.id !== episode || state.assets[id]) continue;
            journal = appendChange(journal, revisions.slice(0, index + 1), [assetSet({ id, type: 'debt_handled', evidence: row.evidence })], id);
            state = replayJournal(journal); changed = true;
        }
    }
    return { journal, changed };
}

export function buildAssetPrompt(state, settings) {
    if (!settings.apps.assets) return '';
    const balance = cashBalance(state), debt = debtEpisode(state);
    const holdings = assetRows(state, 'holding').filter(h => h.active !== false).map(({ id, name, category }) => ({ id, name, category }));
    const jobs = assetRows(state, 'job').filter(j => j.endDay == null).map(({ id, employer, name, monthlyMinor }) => ({ id, employer, name, monthlySalary: monthlyMinor == null ? null : monthlyMinor / 100 }));
    return settings.prompts.assetStory + '\n经济资料只供叙事参考，不表示其他人物知道私人余额：' + safe({
        balance: balance === null ? '尚未建账' : dollars(balance), reserved: dollars(reservedCash(state)),
        pending: assetRows(state, 'story_event').some(e => !e.processed), holdings, jobs,
        recentAppPayments: assetRows(state, 'cash_transaction').filter(t => ['amazon', 'snapcash', 'salary'].includes(t.source)).slice(-6).map(t => ({ id: t.orderId || t.transferId || t.id, name: t.memo, amount: t.deltaMinor / 100, payDate: t.payDate })),
    }) + '\n仅本次实际发生的 user 收支/资产/工作变化附隐藏注释，无事不写，不估价、不算盈亏：<!--durian-money:{"kind":"income/expense/asset/job","name":"事项或物品/工作名","amount":null,"date":"已知剧情日期 YYYY-MM-DD，未知省略","evidence":"本次正文逐字事实原句"}-->。金额仅正文明确美元数字，未知 null。财产增加可附 category:fixed/luxury/investment，正文明确正常价值才填 marketValue；出售附 action:dispose 与 holdingId；工作附 action:start/change/end、变动旧 jobId，明确月薪才填 monthlySalary。工资到账附 salaryEmployer 和 payDate 匹配上述工作。手机已支付的订单、转账和已发工资不要重复记录，必要时用 ref 引用其 id。赠品只记 asset 不记支出；计划、回忆、他人交易不记。不要代码块。' +
        (debt && !state.assets['handled:' + debt] ? '\n当前资金不足，可在符合居住/经营设定的适当时机写一次相关催款；没有自住房不代表一定租房，不强制新债务或重复扣钱。实际写出后附 <!--durian-debt:{"id":' + safe(debt) + ',"evidence":"本次催款逐字原句"}-->，未发生不标记。' : '');
}

export function createAssetBridge({ getContext, getSettings, onError = () => {} }) {
    const first = getContext(), bus = first?.eventSource, types = first?.event_types ?? first?.eventTypes ?? {}, hooks = [];
    let generation = 0, disposed = false;
    const output = createNarrativePrompt({getContext, key: ASSETS_KEY});
    const clear = () => { generation++; output.clear(); };
    const listen = (name, fn) => { if (types[name] && bus?.on) { bus.on(types[name], fn); hooks.push([types[name], fn]); } };
    async function prepare(type = 'normal', options, dryRun) {
        if (dryRun) return;
        clear(); if (disposed || ['quiet', 'impersonate'].includes(type) || !getSettings().apps.assets) return;
        const c = getContext(), metadata = c.chatMetadata;
        if (!metadata || !c.chat?.length || !c.setExtensionPrompt) return;
        const chat = ['swipe', 'regenerate'].includes(type) && !c.chat.at(-1).is_user ? c.chat.slice(0, -1) : c.chat;
        const signatures = messageSignatures(chat), token = generation;
        const current = () => !disposed && generation === token && getSettings().apps.assets && getContext().chatMetadata === metadata && JSON.stringify(messageSignatures(getContext().chat || []).slice(0, signatures.length)) === JSON.stringify(signatures);
        try {
            const revisions = await revisionsFor(signatures), legacy = chat.some(isMemoryHidden) ? await revisionsFor(messageSignatures(chat, true)) : null;
            const state = replayJournal(reconcileJournal(metadata[JOURNAL_KEY], revisions, legacy).journal);
            if (current()) output.set(buildAssetPrompt(state, getSettings()), current);
        } catch (e) { onError(e); }
    }
    if (first?.setExtensionPrompt && bus?.on) {
        if (types.GENERATION_AFTER_COMMANDS) { listen('GENERATION_STARTED', (t, o, dry) => { if (!dry) clear(); }); listen('GENERATION_AFTER_COMMANDS', prepare); }
        else listen('GENERATION_STARTED', prepare);
        for (const n of ['GENERATION_ENDED', 'GENERATION_STOPPED', 'CHAT_CHANGED', 'CHAT_LOADED', 'MESSAGE_EDITED', 'MESSAGE_UPDATED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'GROUP_MEMBER_DRAFTED', 'GROUP_WRAPPER_FINISHED']) listen(n, clear);
    }
    return { prepare, destroy() { clear(); disposed = true; output.destroy(); for (const [n, fn] of hooks) bus.removeListener?.(n, fn); } };
}
