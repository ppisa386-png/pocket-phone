import { assetRows, assetSet, assetText } from './assets-core.js?v=1.0.4';
import { validateFinancialEvent, applyFinancialEvent, applyAssetChanges } from './assets-events.js?v=1.0.4';
import { financialEvidenceMatches } from './assets-policy.js?v=1.0.4';
import { readStoryClock } from './story-clock.js?v=1.0.4';
import { isMemoryHidden } from './journal.js?v=1.0.4';

// One migration audit for ledgers settled before ownership recovery existed.
// This is NOT permission to reroll money, prices or the settlement period.
export const needsOwnershipRecovery = wallet => !!wallet && wallet.ownershipAuditVersion !== 1;
export function ownershipRecoveryProse(state, chat) {
    if (!needsOwnershipRecovery(state.assets?.wallet)) return [];
    let clock = { day: null, hour: null };
    return chat.map((m, index) => {
        clock = readStoryClock([m], clock);
        return { index, day: clock.day, text: String(m.mes || '').replace(/<(think|thinking|script|style)[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '') };
    }).filter(p => p.index <= state.assets.wallet.lastIndex && !chat[p.index].is_user &&
        (!chat[p.index].is_system || isMemoryHidden(chat[p.index])) && p.day !== null && p.day >= state.assets.wallet.startDay).slice(-20);
}

export const OWNERSHIP_RECOVERY_RULES = '本次还需一次性检查ownershipRecoveryProse中的旧版已结算正文，仅补登记漏掉的user实物财产。返回recoveredAssets数组（确无遗漏返回[]），每条为{sourceIndex:原楼层index,evidence:同楼逐字取得依据,name:具体物品名,category:"fixed或luxury",owner:"user",amount:null,marketValue:合理正常市价或null,details:已知规格及取得方式}。'
    + '只登记已经买到/获赠且当前仍属于user的财产，付款人可以是别人；试穿、试背、想买、计划、他人物品、回忆旧物、无法确定内容的购物袋不算。逐项对照ownershipRecoveryHoldings全部记录（含已出售/排除条目），同一物品即使换了名称也不得再登；整套和单件不能重复，已有笼统收藏不得遮蔽明确后续新取得的物品。'
    + '旧楼仅恢复财产所有权，不补记现金、不重算旧生活费/工资/投资收益、不修改或重新估价已有财产，不回溯新增投资权益。旧楼提到的收支不能放入events绕过限制。不要续写剧情或补写正文注释。';

const nameKey = name => assetText(name).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
export function applyOwnershipRecovery(original, data, chat) {
    if (!needsOwnershipRecovery(original.assets?.wallet)) {
        if (data.recoveredAssets?.length) throw Error('旧账物品补查已完成，不重复补登记。');
        return [];
    }
    if (!Array.isArray(data.recoveredAssets) || data.recoveredAssets.length > 100) throw Error('缺少旧账物品核对结果 recoveredAssets，未更改账本。');
    const prose = ownershipRecoveryProse(original, chat), state = structuredClone(original), changes = [];
    const names = new Set(assetRows(state, 'holding').map(h => nameKey(h.name)));
    const add = rows => { changes.push(...rows); applyAssetChanges(state, rows); };
    for (const raw of data.recoveredAssets) {
        const source = prose.find(p => p.index === raw.sourceIndex);
        if (!source || !financialEvidenceMatches(source.text, raw.evidence)) throw Error('旧账补登记缺少可核对的原楼层依据。');
        if (raw.owner !== 'user' || !['fixed', 'luxury'].includes(raw.category) || raw.amount != null ||
            (raw.kind && raw.kind !== 'asset') || (raw.action && raw.action !== 'acquire') || raw.holdingId || raw.id)
            throw Error('旧账补查只能新增user实物财产，不能登记现金、投资或改写旧资产。');
        const name = nameKey(raw.name);
        if (!name) throw Error('补登记物品缺少名称。');
        if (names.has(name)) continue;
        const id = 'recovered:' + source.index + ':' + name;
        if (state.assets[id]) continue;
        const event = validateFinancialEvent({ ...raw, kind: 'asset', action: 'acquire', amount: null, date: undefined }, id, source.index, source.day);
        add(applyFinancialEvent(state, event)); names.add(name);
    }
    add([assetSet({ ...state.assets.wallet, ownershipAuditVersion: 1 })]);
    return changes;
}

export function applyOwnershipRepair(original, data, chat) {
    // The same-floor upgrade audit cannot execute any settlement operations.
    if (data.initial != null || ['events','valuations','ownership','classifications','salaries','business'].some(k => data[k] != null && (!Array.isArray(data[k]) || data[k].length)) ||
        data.living && (data.living.total !== 0 || (data.living.bookedIds?.length ?? 0) !== 0))
        throw Error('本轮仅补查遗漏物品，不允许重新结算收支或估价旧财产。');
    return applyOwnershipRecovery(original, data, chat);
}
