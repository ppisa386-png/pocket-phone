import { ASSET_CATEGORY_RULES } from './assets-policy.js?v=1.0.4';
import { expiryChanges } from './assets-rights.js?v=1.0.4';
import { JOURNAL_KEY, messageSignatures, revisionsFor, reconcileJournal, replayJournal, appendChange, isMemoryHidden } from './journal.js?v=1.0.4';
import { storyAnnotations } from './story-phone.js?v=1.0.4';
import { readStoryClock } from './story-clock.js?v=1.0.4';
import { assetRows, assetSet, assetText, cashBalance, reservedCash, debtEpisode, dollars } from './assets-core.js?v=1.0.4';
import { validateFinancialEvent, applyFinancialEvent, financialEventKey } from './assets-events.js?v=1.0.4';
import { createNarrativePrompt } from './narrative-prompt.js?v=1.0.4';

export const ASSETS_KEY = 'durian_phone_finances';
export const ASSET_RIGHTS_STORY_RULES = '经济权益不按职业或行业推断；有新作品、项目、合作或授权时，只检查本次已发生的财务变化。参与、署名、创作、制作、发行或成功不等于拥有版权/分成，须依据明确剧情、合同、人设及既有账本确认归属。'
    + '新取得且持续拥有的权利用 kind:asset、category:investment 登记；details 用600字以内保留权利范围、归属比例、合同条件、期限、收益基数、成本扣除和结算周期，未知写未知，不补合同。一次性实际到账用 income，不因收款自动新增持续权益，不把估值当收入。'
    + '部分授权不等于全部转让；仅当该资产所代表的全部权利已转出/到期/终止时，才用 asset + action:dispose + holdingId 结束该资产，付款另按原规则登记一次。仍持有的部分不能注销；修改或部分转让用 kind:asset、action:amend、holdingId、date及修改后的完整details，不用acquire覆盖；只更新条款，不直接收钱，实际付款另记一次。可附rights:{sharePercent:user保留比例,expiresOn:已知到期日YYYY-MM-DD（含当日）}，未知省略；完整终止用dispose。有新事实才写注释，正文不估算收益。';

const safe = x => JSON.stringify(x).replace(/\{\{/g, '\\u007b\\u007b');
export function importStoryAssets(journal, revisions, chat) {
    let state = replayJournal(journal), changed = false;
    let clock = { day: null, hour: null };
    for (let index = 0; index < chat.length; index++) {
        clock = readStoryClock([chat[index]], clock);
        for (const row of storyAnnotations(chat[index], 'durian-money')) {
            const legacyId = 'money:' + revisions[index] + ':' + row.evidence.trim();
            const id = legacyId + ':' + financialEventKey(row);
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
    const expired=expiryChanges(state,clock.day);
    if(expired.length){journal=appendChange(journal,revisions,expired);changed=true;}
    return { journal, changed };
}

export function buildAssetPrompt(state, settings) {
    if (!settings.apps.assets) return '';
    const balance = cashBalance(state), debt = debtEpisode(state);
    const holdings = assetRows(state, 'holding').filter(h => h.active !== false && !h.excludedFromAssets).map(({ id, name, category, details, rights }) => ({ id, name, category, details: assetText(details, 600), rights: rights || {} }));
    const jobs = assetRows(state, 'job').filter(j => j.endDay == null).map(({ id, employer, name, monthlyMinor }) => ({ id, employer, name, monthlySalary: monthlyMinor == null ? null : monthlyMinor / 100 }));
    return settings.prompts.assetStory + '\n' + ASSET_RIGHTS_STORY_RULES + '\n经济资料只供叙事参考，不表示其他人物知道私人余额：' + safe({
        balance: balance === null ? '尚未建账' : dollars(balance), reserved: dollars(reservedCash(state)),
        pending: assetRows(state, 'story_event').some(e => !e.processed), holdings, jobs,
        recentAppPayments: assetRows(state, 'cash_transaction').filter(t => ['amazon', 'snapcash', 'salary'].includes(t.source)).slice(-6).map(t => ({ id: t.orderId || t.transferId || t.id, name: t.memo, amount: t.deltaMinor / 100, payDate: t.payDate })),
    }) + '\n仅本次实际发生的 user 收支/资产/工作变化附隐藏注释，无事不写，不估价、不算盈亏：<!--durian-money:{"kind":"income/expense/asset/job","name":"事项或物品/工作名","amount":null,"date":"已知剧情日期 YYYY-MM-DD，未知省略","evidence":"本次正文逐字事实原句"}-->。金额仅正文明确美元数字，未知 null。财产增加可附 category:fixed/luxury/investment 和 details（已知规格/权益合同摘要），正文明确正常价值才填 marketValue；全部出售/权利终止附 action:dispose 与 holdingId；工作附 action:start/change/end、变动旧 jobId，明确月薪才填 monthlySalary。工资到账附 salaryEmployer 和 payDate 匹配上述工作。手机已支付的订单、转账和已发工资不要重复记录，必要时用 ref 引用其 id。他人付款但已送给user的物品仍须记 asset，amount:null，不记user支出；不得因付款人是他人而漏记user获赠的财产。给他人买的物品、计划、试穿试背但尚未买下、回忆旧物和他人自有财产不记。evidence 优先引用一句完整原文；必须合并多段时用省略号连接按原顺序的完整片段，不改写事实。保持合法JSON，正文引号须转义。不要代码块。' + ASSET_CATEGORY_RULES + '\n正文完成后核对本次已取得物品：有实际财产变化即在文尾为每项追加独立的durian-money隐藏注释，价格未知照常登记null，不等正文写价钱，不把既有物品再次登记。此记账规则适用于本轮全部正文，不受通信每三回合考虑主动联系的节奏影响。' +
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
