import { assetRows, assetSet, assetText, moneyMinor, cashRecord } from './assets-core.js?v=0.24.2';
import { dateDay, dayDate } from './story-clock.js?v=0.24.2';

export const ASSET_CATEGORIES = ['fixed', 'luxury', 'investment'];
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
    return { id, type: 'story_event', sourceIndex: index, name, kind: row.kind, day, amountMinor, monthlyMinor, marketMinor,
        category: row.category || null, details: assetText(row.details, 600), action: row.action || (row.kind === 'job' ? 'start' : 'acquire'),
        holdingId: assetText(row.holdingId), jobId: assetText(row.jobId), salaryEmployer: assetText(row.salaryEmployer),
        payDate: dateDay(row.payDate) !== null ? row.payDate : null,
        salary: row.kind === 'income' && (!!row.salaryEmployer || row.salary === true || /工资|薪水|薪资|salary|paycheck/i.test(name)),
        evidence: assetText(row.evidence, 1500), processed: false };
}
export function applyFinancialEvent(state, event) {
    if (event.processed) return [];
    const changes = [];
    if (['income', 'expense'].includes(event.kind)) {
        if (event.amountMinor === null) {
            // Ownership can be known even when the purchase price is missing.
            if (event.category && event.action !== 'dispose') changes.push(assetSet({ id: 'holding:' + event.id, type: 'holding', name: event.name,
                category: event.category, details: event.details, active: true, valueMinor: event.marketMinor ?? null, valued: event.marketMinor != null, purchaseMinor: null, startDay: event.day, eventId: event.id }));
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
    if (event.category || event.kind === 'asset') {
        const holding = event.holdingId ? state.assets?.[event.holdingId] : null;
        if (event.action === 'dispose') {
            if (!holding || holding.type !== 'holding') throw Error('出售资产未匹配到账本，请在一键更新时核对。');
            changes.push(assetSet({ ...holding, active: false, endDay: event.day }));
        } else {
            if (!event.category) return [assetSet(event)];
            const id = event.holdingId || 'holding:' + event.id;
            if (holding && holding.type !== 'holding') throw Error('资产编号冲突。');
            changes.push(assetSet({ ...(holding || {}), id, type: 'holding', name: event.name, category: event.category,
                active: true, valueMinor: holding?.valueMinor ?? event.marketMinor ?? null, valued: holding?.valued || event.marketMinor != null,
                details: event.details || holding?.details || '', purchaseMinor: event.amountMinor, startDay: event.day, eventId: event.id }));
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
