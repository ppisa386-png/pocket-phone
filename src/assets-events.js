import { validateRights, rightsHistory, holdingEnd } from './assets-rights.js?v=1.0.7';
import { assetRows, assetSet, assetText, moneyMinor, cashRecord } from './assets-core.js?v=1.0.7';
import { dateDay, dayDate } from './story-clock.js?v=1.0.7';

export const ASSET_CATEGORIES = ['fixed', 'luxury', 'investment'];
export const financialEventKey = row => JSON.stringify([row.kind, assetText(row.name), row.action || (row.kind === 'job' ? 'start' : 'acquire')]);
export function validateFinancialEvent(row, id, index, fallbackDay = null) {
    if (!['income', 'expense', 'asset', 'job'].includes(row?.kind)) throw Error('收支类型不正确。');
    const name = assetText(row.name); if (!name) throw Error('收支名称缺失。');
    if (row.currency && row.currency !== 'USD') throw Error('非美元收支不能直接记作美元。');
    const day = row.date ? dateDay(row.date) : fallbackDay;
    if (row.date && day === null) throw Error('收支日期无效。');
    const amountMinor = row.amount == null ? null : moneyMinor(row.amount);
    const monthlyMinor = row.monthlySalary == null ? null : moneyMinor(row.monthlySalary);
    const marketMinor = row.marketValue == null ? null : moneyMinor(row.marketValue);
    if (row.category && !ASSET_CATEGORIES.includes(row.category)) throw Error('资产分类不正确。');
    const rights = validateRights(row.rights);
    if (row.kind === 'asset' && row.action && !['acquire','amend','dispose'].includes(row.action)) throw Error('资产变化类型不正确。');
    if (row.action === 'amend' && (row.kind !== 'asset' || !assetText(row.details, 600))) throw Error('权益修改必须是asset事件，并提供修改后的完整条款摘要。');
    return { rights, id, type: 'story_event', sourceIndex: index, name, kind: row.kind, day, amountMinor, monthlyMinor, marketMinor,
        category: row.category || null, details: assetText(row.details, 600), action: row.action || (row.kind === 'job' ? 'start' : 'acquire'),
        holdingId: assetText(row.holdingId, 4000), jobId: assetText(row.jobId), salaryEmployer: assetText(row.salaryEmployer),
        payDate: dateDay(row.payDate) !== null ? row.payDate : null,
        salary: row.kind === 'income' && (!!row.salaryEmployer || row.salary === true || /工资|薪水|薪资|salary|paycheck/i.test(name)),
        evidence: assetText(row.evidence, 1500), processed: false };
}
export function applyFinancialEvent(state, event) {
    if (event.processed) return [];
    const changes = [];
    if (['amend','dispose'].includes(event.action)) {
        const h=state.assets?.[event.holdingId];
        if (!h || h.type!=='holding' || h.active===false) throw Error('权益变更未匹配到当前持有的资产。');
        if(event.day===null)return [assetSet(event)];
        if(event.day<(h.startDay??event.day)||event.day<(state.assets?.wallet?.lastDay??event.day)||event.day<(rightsHistory(h).at(-1)?.fromDay??event.day)||event.day>=holdingEnd(h))throw Error('权益变更日期早于已结算期间/现有条款，或权利已到期。');
        if(event.action==='amend'){
            if(h.category!=='investment'||event.category&&event.category!=='investment')throw Error('权益修改只适用于当前投资资产。');
            const rights={...(h.rights||{}),...event.rights};
            if(dateDay(rights.expiresOn)!==null && dateDay(rights.expiresOn)<event.day)throw Error('新条款到期日早于生效日；已终止权益请使用dispose。');
            const history=[...rightsHistory(h),{fromDay:event.day,details:event.details,rights,eventId:event.id}];
            changes.push(assetSet({...h,details:event.details,rights,termsHistory:history,valueMinor:event.marketMinor??null,valued:event.marketMinor!=null}));
            return [...changes,assetSet({...event,processed:true})];
        }
    }
    if (['income', 'expense'].includes(event.kind)) {
        if (event.amountMinor === null) {
            // Ownership can be known even when the purchase price is missing.
            if (event.category && event.action !== 'dispose') changes.push(assetSet({ id: 'holding:' + event.id, type: 'holding', name: event.name,
                category: event.category, details: event.details, rights:event.rights||{}, active: true, valueMinor: event.marketMinor ?? null, valued: event.marketMinor != null, purchaseMinor: null, startDay: event.day, eventId: event.id }));
            return [...changes, assetSet(event)];
        }
        if (event.salary && (!event.salaryEmployer || !event.payDate || !event.payDate.endsWith('-15') ||
            !assetRows(state, 'job').some(j => j.employer === event.salaryEmployer))) return [assetSet(event)];
        let delta = event.kind === 'income' ? event.amountMinor : -event.amountMinor;
        // A prose salary may describe a payday already paid by the app.
        if (event.salaryEmployer && event.payDate) {
            const paid = assetRows(state, 'cash_transaction').filter(t => t.salaryEmployer === event.salaryEmployer && t.payDate === event.payDate)
                .reduce((sum, t) => sum + Math.max(0, t.deltaMinor), 0);
            delta = Math.max(0, delta - paid);
        }
        changes.push(assetSet(cashRecord('cash:' + event.id, delta, event.name, { source: 'story', eventId: event.id, day: event.day, salaryEmployer: event.salaryEmployer, payDate: event.payDate })));
    }
    if (event.category || event.kind === 'asset' || event.action === 'dispose') {
        const id = event.holdingId || 'holding:' + event.id;
        const holding = state.assets?.[id];
        if (event.action === 'dispose') {
            if (!holding || holding.type !== 'holding' || holding.active === false) throw Error('出售资产未匹配到当前持有的财产，请在一键更新时核对。');
            changes.push(assetSet({ ...holding, active: false, endDay: event.day }));
        } else {
            if (!event.category) return [assetSet(event)];
            if (holding && holding.type !== 'holding') throw Error('资产编号冲突。');
            if (event.holdingId && !holding || holding && holding.eventId !== event.id) throw Error('已有权益须使用amend修改，不能重复取得或复活已终止资产。');
            // Resolving the original purchase cost must not undo a later amendment/disposal.
            if(holding){
                const valueMinor=holding.termsHistory?.length?holding.valueMinor:(holding.valueMinor??event.marketMinor??null);
                changes.push(assetSet({...holding,purchaseMinor:event.amountMinor??holding.purchaseMinor,valueMinor,valued:valueMinor!=null}));
            }else changes.push(assetSet({ id, type: 'holding', name: event.name, category: event.category,
                active: true, valueMinor: holding?.valueMinor ?? event.marketMinor ?? null, valued: holding?.valued || event.marketMinor != null,
                details: event.details || holding?.details || '', rights:event.rights||holding?.rights||{}, purchaseMinor: event.amountMinor, startDay: event.day, eventId: event.id }));
        }
    }
    if (event.kind === 'job') {
        if (event.day === null) return [assetSet(event)];
        if (!['start', 'change', 'end'].includes(event.action)) throw Error('工作变动类型不正确。');
        const prior = event.jobId ? state.assets?.[event.jobId] : null;
        if (event.action !== 'start' && (!prior || prior.type !== 'job' || prior.endDay != null)) throw Error('工作变动未匹配有效工作。');
        if (prior && event.day < prior.startDay) throw Error('工作变动日期早于入职日期。');
        if (prior) changes.push(assetSet({ ...prior, endDay: event.day }));
        if (event.action !== 'end') changes.push(assetSet({ id: 'job:' + event.id, type: 'job', name: event.name,
            employer: prior?.employer || 'job:' + event.id, monthlyMinor: event.monthlyMinor, startDay: event.day, endDay: null, eventId: event.id }));
    }
    changes.push(assetSet({ ...event, processed: true }));
    return changes;
}

export function applyAssetChanges(state, changes) {
    for (const c of changes) { if (c.value === null) delete state.assets[c.key]; else state.assets[c.key] = structuredClone(c.value); }
}
export const publicEvent = e => ({ ...e, date: dayDate(e.day), amount: e.amountMinor == null ? null : e.amountMinor / 100 });
