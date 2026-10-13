import { dateDay, dayDate } from './story-clock.js?v=0.21.2';

export const assetRows = (state, type) => Object.values(state.assets || {}).filter(x => x.type === type);
export const assetSet = value => ({ collection: 'assets', key: value.id, value });
export const dollars = minor => '$' + (minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const assetText = (s, max = 180) => typeof s === 'string' ? s.trim().slice(0, max) : '';
export function moneyMinor(value, signed = false) {
    if (!new RegExp(signed ? '^-?\\d{1,12}(\\.\\d{1,2})?$' : '^\\d{1,12}(\\.\\d{1,2})?$').test(String(value))) throw Error('账本金额格式不正确。');
    const n = Math.round(Number(value) * 100);
    if (!Number.isSafeInteger(n)) throw Error('账本金额超出范围。');
    return n;
}
export function cashBalance(state) {
    const wallet = state.assets?.wallet;
    if (!wallet) return null;
    const ignored = new Set(wallet.included || []);
    const amount = assetRows(state, 'cash_transaction').filter(t => t.currency === 'USD' && !ignored.has(t.id))
        .reduce((sum, t) => sum + t.deltaMinor, wallet.openingMinor);
    if (!Number.isSafeInteger(amount)) throw Error('账本金额超出范围。');
    return amount;
}
export function reservedCash(state, except = '') {
    return Object.values(state.snapchat || {}).filter(t => t.type === 'transfer' && t.direction === 'outgoing' && t.status === 'pending' && t.currency === 'USD' && t.id !== except)
        .reduce((sum, t) => sum + t.amountMinor, 0);
}
export function requireCash(state, minor, currency = 'USD', except = '') {
    if (currency !== 'USD') throw Error('小榴莲统一使用美元，请使用 USD。');
    const balance = cashBalance(state);
    if (balance === null) throw Error('请先在小榴莲点击「一键更新」建立账本。');
    if (assetRows(state, 'story_event').some(e => e.kind === 'expense' && !e.processed)) throw Error('还有待结算的支出，请先在小榴莲点击「一键更新」。');
    if (balance - reservedCash(state, except) < minor) throw Error('可用余额不足。');
}
export function cashRecord(id, deltaMinor, memo, fields = {}) {
    if (!Number.isSafeInteger(deltaMinor)) throw Error('账本金额超出范围。');
    return { id, type: 'cash_transaction', currency: 'USD', deltaMinor, memo: assetText(memo), createdAt: Date.now(), ...fields };
}

// Payday covers [previous month's 15th, this month's 15th). Partial employment
// earns the corresponding fraction; all calculations use fictional UTC dates.
export function salaryPayments(state, throughDay) {
    const wallet = state.assets?.wallet;
    if (!wallet || !Number.isInteger(throughDay) || throughDay < wallet.startDay) return [];
    const changes = [];
    const first = new Date(wallet.startDay * 86400000);
    let year = first.getUTCFullYear(), month = first.getUTCMonth();
    const end = new Date(throughDay * 86400000);
    for (; year < end.getUTCFullYear() || year === end.getUTCFullYear() && month <= end.getUTCMonth(); month++) {
        if (month === 12) { year++; month = 0; }
        const due = dateDay(`${year}-${String(month + 1).padStart(2, '0')}-15`);
        if (due > throughDay) break;
        if (due <= wallet.startDay) continue;
        const prevYear = month === 0 ? year - 1 : year, prevMonth = month === 0 ? 12 : month;
        const from = dateDay(`${prevYear}-${String(prevMonth).padStart(2, '0')}-15`);
        const groups = new Map();
        for (const job of assetRows(state, 'job')) {
            if (job.monthlyMinor === null || job.monthlyMinor === undefined) continue;
            const days = Math.max(0, Math.min(due, job.endDay ?? due) - Math.max(from, job.startDay, wallet.startDay));
            if (!days) continue;
            const group = groups.get(job.employer) || { amount: 0, name: job.name };
            group.amount += job.monthlyMinor * days / (due - from);
            groups.set(job.employer, group);
        }
        for (const [employer, group] of groups) {
            const id = 'salary:' + employer + ':' + dayDate(due);
            const explicit = assetRows(state, 'cash_transaction').filter(t => t.salaryEmployer === employer && t.payDate === dayDate(due) && t.id !== id)
                .reduce((sum, t) => sum + Math.max(0, t.deltaMinor), 0);
            const amount = Math.max(0, Math.round(group.amount) - explicit);
            if (!state.assets[id]) changes.push(assetSet(cashRecord(id, amount, group.name + ' · ' + dayDate(due) + ' 工资', { source: 'salary', salaryEmployer: employer, payDate: dayDate(due), day: due })));
        }
    }
    return changes;
}

export function recentCash(state) {
    return assetRows(state, 'cash_transaction').map((t, index) => ({ t, index })).filter(({ t }) => t.deltaMinor !== 0)
        .sort((a, b) => (b.t.createdAt || 0) - (a.t.createdAt || 0) || b.index - a.index).slice(0, 6).map(({ t }) => t);
}
export function debtEpisode(state) {
    if (cashBalance(state) === null) return null;
    const wallet = state.assets.wallet, ignored = new Set(wallet.included || []);
    let balance = wallet.openingMinor, id = balance < 0 ? 'debt:opening' : null;
    for (const t of assetRows(state, 'cash_transaction').filter(t => t.currency === 'USD' && !ignored.has(t.id))) {
        const prior = balance; balance += t.deltaMinor;
        if (balance >= 0) id = null;
        else if (prior >= 0) id = 'debt:' + t.id;
    }
    return id;
}
