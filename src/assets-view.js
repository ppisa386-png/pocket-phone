import { needsOwnershipRecovery } from './assets-recovery.js?v=1.0.6';
import { assetRows, cashBalance, reservedCash, dollars, recentCash } from './assets-core.js?v=1.0.6';
import { dayDate } from './story-clock.js?v=1.0.6';
const assetEscape = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function createAssetPanel({ adapter, getView, redraw, notice }) {
    let tab = 'cash', working = false, status = '', epoch = 0;
    const labels = { cash: '余额', fixed: '固定资产', luxury: '奢侈品', investment: '投资' };
    function html() {
        const state = getView(), wallet = state.assets?.wallet, balance = cashBalance(state), hold = reservedCash(state);
        const locked = !!wallet && wallet.revision === state.revision && !needsOwnershipRecovery(wallet);
        const pending = assetRows(state, 'story_event').filter(e => !e.processed).length;
        let body;
        if (tab === 'cash') {
            body = '<section class="pp-asset-balance"><small>可支配资金 · USD</small><strong>' + (balance === null ? '—' : assetEscape(dollars(balance))) + '</strong>' +
                (hold ? '<small>转账待收款占用 ' + dollars(hold) + ' · 可用 ' + dollars(balance === null ? 0 : balance - hold) + '</small>' : '') + '</section>';
            const summary = wallet?.settlement;
            if (summary) {
                const line = (label, amount) => '<article class="pp-asset-row"><span>' + label + '</span><b>' + dollars(amount) + '</b></article>';
                body += '<details class="pp-asset-ledger" open><summary>上次结算明细</summary><p class="pp-asset-note">' + dayDate(summary.fromDay) + ' 至 ' + dayDate(summary.toDay) + ' · ' + summary.days + ' 天</p>' +
                    line('期间生活费估算', summary.livingTotalMinor) + line('其中已逐笔扣除', summary.livingPaidMinor) + line('本次补扣生活费', summary.livingAddedMinor) +
                    line('本次补发工资', summary.salaryAddedMinor) + line('本次新增收入合计', summary.incomeAddedMinor) + line('本次新增支出合计', summary.expenseAddedMinor) +
                    '<article class="pp-asset-row"><span>本次余额变化</span><b>' + (summary.netChangeMinor < 0 ? '−' : '+') + dollars(Math.abs(summary.netChangeMinor)) + '</b></article>' +
                    '<p class="pp-asset-note">更新前 ' + dollars(summary.balanceBeforeMinor) + ' → 更新后 ' + dollars(summary.balanceAfterMinor) + '。已逐笔扣除的费用不重复扣款；工资已包含在新增收入合计中。</p></details>';
            } else if (wallet) body += '<p class="pp-asset-note">暂无期间结算明细；首次建账只记录当时余额。旧版结算未保存此明细。</p>';
            const jobs = assetRows(state, 'job').filter(j => j.endDay == null);
            body += '<h3>工作与收入</h3>' + (jobs.map(j => '<article class="pp-asset-row"><span>' + assetEscape(j.name) + '</span><b>' + (j.monthlyMinor == null ? '待评估' : dollars(j.monthlyMinor) + '/月') + '</b></article>').join('') || '<p class="pp-snap-empty">暂无工作记录</p>');
            if (jobs.length) body += '<p class="pp-asset-note">每月 15 日发薪</p>';
            body += '<details class="pp-asset-ledger"><summary>最近收支</summary>' + (recentCash(state).map(t => '<article class="pp-asset-row"><span>' + assetEscape(t.memo || (t.source === 'snapcash' ? 'Snapchat 转账' : '收支')) + '</span><b class="' + (t.deltaMinor > 0 ? 'pp-asset-income' : '') + '">' + (t.deltaMinor > 0 ? '+' : '−') + dollars(Math.abs(t.deltaMinor)) + '</b></article>').join('') || '<p class="pp-snap-empty">暂无收支</p>') + '</details>';
        } else {
            body = assetRows(state, 'holding').filter(h => h.category === tab && h.active !== false && !h.excludedFromAssets).map(h => '<article class="pp-asset-row"><span>' + assetEscape(h.name) + '</span><b>' + (h.valueMinor == null ? '待估值' : dollars(h.valueMinor)) + '</b></article>').join('') || '<p class="pp-snap-empty">暂无' + labels[tab] + '</p>';
        }
        return '<div class="pp-snap pp-assets"><div class="pp-asset-body" data-asset-page="' + tab + '"><header class="pp-snap-top"><b>小榴莲</b><button type="button" class="pp-snap-primary" data-asset-action="update"' + (working || state.busy || locked ? ' disabled' : '') + '>一键更新</button></header>' +
            '<p class="pp-asset-note">' + (wallet ? '已结算至 ' + dayDate(wallet.lastDay) : '点击一键更新，建立你的账本') + (pending ? ' · ' + pending + ' 笔待结算' : '') + '</p>' + (wallet?.skippedUnverified ? '<p class="pp-asset-note">上次更新跳过 ' + wallet.skippedUnverified + ' 条无法核对正文依据的新增收支，未入账。</p>' : '') +
            '<p class="pp-snap-status" role="status">' + assetEscape(working ? '正在更新…' : status || (locked ? '已更新' : '')) + '</p>' + body +
            '</div>' +
            '<nav class="pp-snap-tabs pp-asset-tabs" aria-label="小榴莲分类">' + Object.entries(labels).map(([key, label]) => '<button type="button" data-asset-action="tab" data-asset-tab="' + key + '" aria-pressed="' + (tab === key) + '">' + label + '</button>').join('') + '</nav></div>';
    }
    return { html, reset() { epoch++; tab = 'cash'; status = ''; working = false; },
        async action(action, nextTab) {
            if (action === 'tab') { if (labels[nextTab]) tab = nextTab; redraw(); return; }
            if (action !== 'update' || working || getView().busy) return;
            if (!adapter.assets) { notice('请在酒馆中点击一键更新建立账本。'); return; }
            const token = epoch; working = true; redraw();
            try { const result = await adapter.assets.update(); if (token === epoch) status = result?.ok ? (result.value?.repaired ? '遗漏物品已核对，原有收支结算未重算' : '账本已更新') : result?.error || '本次未更新，请重试。'; }
            catch (e) { if (token === epoch) status = e.message; }
            finally { if (token === epoch) working = false; redraw(); }
        },
    };
}
