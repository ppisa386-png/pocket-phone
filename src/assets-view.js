import { walletCurrency, formatMoney, majorAmount } from './currency.js?v=1.2';
import { needsOwnershipRecovery } from './assets-recovery.js?v=1.2.57';
import { assetRows, cashBalance, reservedCash, recentCash } from './assets-core.js?v=1.2';
import { dayDate } from './story-clock.js?v=1.2';
import { icon } from './icons.js?v=1.2.57';
const assetEscape = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// 底部导航图标：与 icons.js 相同的线性风格（1.65 描边、圆角端点），本地定义避免动共享文件。
const TAB_ICONS = {
    cash: '<rect x="3" y="6.5" width="18" height="12" rx="3"/><path d="M15.8 12.5h2.6"/><path d="M3 9.5V7.6A1.6 1.6 0 0 1 4.6 6H15"/>',
    fixed: '<path d="m3 11 9-8 9 8"/><path d="M5 9.8V20h14V9.8"/><path d="M10 20v-5.5h4V20"/>',
    luxury: '<path d="m7.5 4 4-1.5 5 1.5L21 9l-9 12L3 9l4.5-5Z"/><path d="M3 9h18M9.5 9 12 20.5 14.5 9M9.5 9 12 4l2.5 5"/>',
    investment: '<path d="M4 20V4M4 20h16"/><path d="m7 14 4-4.5 3.5 3L19 7"/><path d="M15.6 7H19v3.4"/>',
};
const tabIcon = key => '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + TAB_ICONS[key] + '</svg>';
// 编辑窗口：与小榴莲视觉一致的轻量表单，覆盖在面板上；字段经 data-asset-field 由 ui.js 委托收集。
function editDialog(h, code) {
    const moneyInput = (minor) => minor == null ? '' : assetEscape(majorAmount(minor, code));
    return '<div class="pp-asset-edit" data-asset-edit><div class="pp-asset-edit-card" role="dialog" aria-label="编辑资产">' +
        '<header><b>编辑资产</b><button type="button" class="pp-asset-edit-close" data-asset-action="cancel-edit" aria-label="关闭">×</button></header>' +
        '<label>名称<input data-asset-field="name" maxlength="300" value="' + assetEscape(h.name) + '"></label>' +
        '<label>分类<select data-asset-field="category">' + [['fixed', '固定资产'], ['luxury', '奢侈品'], ['investment', '投资']].map(([v, l]) => '<option value="' + v + '"' + (h.category === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label>' +
        '<label>购入价格<input data-asset-field="purchase" inputmode="decimal" placeholder="留空表示未知" value="' + moneyInput(h.purchaseMinor) + '"></label>' +
        '<label>当前估值<input data-asset-field="value" inputmode="decimal" placeholder="清空恢复自动估值" value="' + moneyInput(h.valueMinor) + '"></label>' +
        '<label>' + (h.category === 'investment' ? '权益说明' : '详细说明') + '<textarea data-asset-field="details" rows="3" maxlength="600">' + assetEscape(h.details || '') + '</textarea></label>' +
        (h.category === 'investment' ? '<label>持有比例 %<input data-asset-field="sharePercent" inputmode="decimal" value="' + (h.rights?.sharePercent ?? '') + '"></label>' +
        '<label>到期日期<input data-asset-field="expiresOn" type="date" value="' + (h.rights?.expiresOn ?? '') + '"></label>' : '') +
        '<p class="pp-asset-note">手动确认的估值不会被一键更新自动修改；清空当前估值将恢复自动估值。</p>' +
        '<footer><button type="button" data-asset-action="cancel-edit">取消</button><button type="button" class="pp-asset-edit-save" data-asset-action="save-edit">保存</button></footer></div></div>';
}
// 余额卡装饰：流动曲线与钱包插画（本地 SVG，纯装饰，不承载交互）。
const BALANCE_ART = '<svg class="pp-asset-balance-art" viewBox="0 0 320 150" preserveAspectRatio="xMaxYMax meet" aria-hidden="true">'
    + '<path d="M-12 106 C 58 76, 128 116, 188 92 S 296 58, 342 82" fill="none" stroke="#ffffff" stroke-opacity=".55" stroke-width="2"/>'
    + '<path d="M-12 128 C 68 100, 148 138, 218 112 S 306 84, 344 104" fill="none" stroke="#ffffff" stroke-opacity=".3" stroke-width="2"/>'
    + '<g><rect x="246" y="64" width="66" height="48" rx="11" fill="#FFFFFFE9"/><rect x="246" y="64" width="66" height="15" rx="7.5" fill="#D9CFEE"/><path d="M246 79h66" stroke="#C4B4E6" stroke-width="1"/><rect x="236" y="76" width="27" height="20" rx="7" fill="#E8E2F3" stroke="#B9A7E0"/><circle cx="247" cy="86" r="3.2" fill="#8A79C9"/></g></svg>';
export function createAssetPanel({ adapter, getView, redraw, notice }) {
    let tab = 'cash', working = false, status = '', epoch = 0, proposal = null, ledgerOpen = false, recentAll = false, editing = null;
    const labels = { cash: '余额', fixed: '固定资产', luxury: '奢侈品', investment: '投资' };
    function html() {
        const state = getView(), wallet = state.assets?.wallet, balance = cashBalance(state), hold = reservedCash(state);
        const code=walletCurrency(state), money=n=>formatMoney(n,code);
        const locked = !!wallet?.region && wallet.revision === state.revision && !needsOwnershipRecovery(wallet) && !adapter.assets?.needsResidenceCheck?.(wallet);
        const pending = assetRows(state, 'story_event').filter(e => !e.processed).length;
        const editingHolding = editing ? getView().assets?.[editing] : null;
        const editMarkup = editingHolding && editingHolding.deleted !== true ? editDialog(editingHolding, code) : '';
        const flowRow = t => '<article class="pp-asset-row"><span class="pp-asset-flow-icon ' + (t.deltaMinor > 0 ? 'is-income' : 'is-expense') + '" aria-hidden="true">' + icon(t.deltaMinor > 0 ? 'cash' : 'cart') + '</span><span class="pp-asset-memo">' + assetEscape(t.memo || (t.source === 'snapcash' ? 'Snapchat 转账' : '收支')) + (t.source === 'snapcash' && t.memo ? '<small>Snapchat 转账</small>' : '') + '</span><b class="' + (t.deltaMinor > 0 ? 'pp-asset-income' : 'pp-asset-expense') + '">' + (t.deltaMinor > 0 ? '+' : '−') + formatMoney(Math.abs(t.deltaMinor),t.currency) + (t.currency!==code?' <i>'+assetEscape(t.currency)+'</i>':'') + '</b></article>';
        let body;
        if (tab === 'cash') {
            body = '<section class="pp-asset-balance">' + BALANCE_ART + '<div class="pp-asset-balance-head"><small>可支配资金</small><span class="pp-asset-chip">' + assetEscape(code || '待定币种') + '</span></div>' +
                '<strong>' + (balance === null ? '—' : assetEscape(money(balance))) + '</strong>' +
                (hold ? '<div class="pp-asset-hold"><span>转账待收款占用 <b>' + money(hold) + '</b></span><span>可用 <b>' + money(balance === null ? 0 : balance - hold) + '</b></span></div>' : '') + '</section>';
            const summary = wallet?.settlement;
            if (summary) body += '<div class="pp-asset-period"><span>上次结算</span><i>' + dayDate(summary.fromDay) + ' – ' + dayDate(summary.toDay) + '</i></div>' +
                '<div class="pp-asset-overview">' +
                '<div class="pp-asset-stat pp-asset-stat-income"><span class="pp-asset-stat-icon" aria-hidden="true">' + icon('cash') + '</span><span class="pp-asset-stat-text"><small>上次结算收入</small><b>+' + money(summary.incomeAddedMinor) + '</b></span></div>' +
                '<div class="pp-asset-stat pp-asset-stat-expense"><span class="pp-asset-stat-icon" aria-hidden="true">' + icon('cart') + '</span><span class="pp-asset-stat-text"><small>上次结算支出</small><b>−' + money(summary.expenseAddedMinor) + '</b></span></div>' +
                '</div>';
            const flows = recentCash(state);
            body += '<div class="pp-asset-recent-head"><h3 class="pp-asset-heading">最近收支</h3>' + (flows.length > 4 ? '<button type="button" class="pp-asset-recent-toggle" data-asset-action="recent">' + (recentAll ? '收起' : '查看全部') + '</button>' : '') + '</div><div class="pp-asset-card pp-asset-flow">' + (flows.slice(0, recentAll ? flows.length : 4).map(flowRow).join('') || '<p class="pp-snap-empty">暂无收支</p>') + '</div>';
            const jobs = assetRows(state, 'job').filter(j => j.endDay == null);
            body += '<h3 class="pp-asset-heading">工作与收入</h3><div class="pp-asset-card">' + (jobs.map(j => '<article class="pp-asset-row"><span class="pp-asset-job"><strong>' + assetEscape(j.name) + '</strong><small>每月 15 日发薪</small></span><b>' + (j.monthlyMinor == null ? '待评估' : money(j.monthlyMinor) + '/月') + '</b></article>').join('') || '<p class="pp-snap-empty">暂无工作记录</p>') + '</div>';
            if (summary) {
                const line = (label, amount) => '<article class="pp-asset-row"><span>' + label + '</span><b>' + money(amount) + '</b></article>';
                body += '<section class="pp-asset-ledger"><button type="button" class="pp-asset-ledger-toggle" data-asset-action="ledger" aria-expanded="' + ledgerOpen + '"><span>上次结算明细</span><i class="pp-asset-chevron" aria-hidden="true"></i></button>' +
                    (ledgerOpen ? '<div class="pp-asset-ledger-body"><p class="pp-asset-note">' + dayDate(summary.fromDay) + ' 至 ' + dayDate(summary.toDay) + ' · ' + summary.days + ' 天</p>' +
                        line('期间生活费估算', summary.livingTotalMinor) + line('其中已逐笔扣除', summary.livingPaidMinor) + line('本次补扣生活费', summary.livingAddedMinor) +
                        line('本次补发工资', summary.salaryAddedMinor) + line('本次新增收入合计', summary.incomeAddedMinor) + line('本次新增支出合计', summary.expenseAddedMinor) +
                        '<article class="pp-asset-row pp-asset-row-total"><span>本次余额变化</span><b>' + (summary.netChangeMinor < 0 ? '−' : '+') + money(Math.abs(summary.netChangeMinor)) + '</b></article>' +
                        '<p class="pp-asset-note">更新前 ' + money(summary.balanceBeforeMinor) + ' → 更新后 ' + money(summary.balanceAfterMinor) + '。已逐笔扣除的费用不重复扣款；工资已包含在新增收入合计中。</p></div>' : '') +
                    '</section>';
            } else if (wallet) body += '<p class="pp-asset-note">暂无期间结算明细；首次建账只记录当时余额。旧版结算未保存此明细。</p>';
        } else {
            body = '<div class="pp-asset-card">' + (assetRows(state, 'holding').filter(h => h.category === tab && h.active !== false && !h.excludedFromAssets && h.deleted !== true).map(h => '<article class="pp-asset-row" data-press="asset-row" data-asset-id="' + assetEscape(h.id) + '"><span class="pp-asset-memo">' + assetEscape(h.name) + '</span><b>' + (h.valueMinor == null ? '待估值' : money(h.valueMinor)) + '</b></article>').join('') || '<p class="pp-snap-empty">暂无' + labels[tab] + '</p>') + '</div>';
        }
        return '<div class="pp-snap pp-assets"><div class="pp-asset-body" data-asset-page="' + tab + '"><header class="pp-asset-top"><div class="pp-asset-top-info"><b>财务概览</b><small>' + (wallet ? '已结算至 ' + dayDate(wallet.lastDay) : '点击一键更新，建立你的账本') + (pending ? ' · ' + pending + ' 笔待结算' : '') + '</small></div><button type="button" class="pp-asset-update" data-asset-action="update"' + (working || state.busy || locked ? ' disabled' : '') + '>一键更新</button></header>' +
            (wallet?.skippedUnverified ? '<p class="pp-asset-note">上次更新跳过 ' + wallet.skippedUnverified + ' 条无法核对正文依据的新增收支，未入账。</p>' : '') +
            '<p class="pp-snap-status" role="status">' + assetEscape(working ? '正在更新…' : status || (locked ? '已更新' : '')) + '</p>' + (proposal?'<div class="pp-asset-convert"><p class="pp-asset-note">常住地区使用 '+proposal.switchTo+'。旧账仍为 '+proposal.switchFrom+'。请输入剧情换算比例：1 '+proposal.switchFrom+' 等于多少 '+proposal.switchTo+'？</p><input data-asset-rate type="text" inputmode="decimal" aria-label="换算比例"><button type="button" data-asset-action="convert">按此比例换算旧账</button></div>':'') + body +
            '</div>' +
            '<nav class="pp-asset-tabs" aria-label="小榴莲分类">' + Object.entries(labels).map(([key, label]) => '<button type="button" data-asset-action="tab" data-asset-tab="' + key + '" aria-pressed="' + (tab === key) + '">' + tabIcon(key) + '<span>' + label + '</span></button>').join('') + '</nav>' + editMarkup + '</div>';
    }
    // 长按/右键资产条目：仅固定资产、奢侈品、投资提供编辑与删除；余额栏目不出现。
    function press(target) {
        const holding = getView().assets?.[target.dataset.assetId];
        if (!holding || holding.type !== 'holding' || holding.deleted === true || !['fixed', 'luxury', 'investment'].includes(holding.category)) return [];
        return [
            { icon: 'edit', label: '编辑', run: () => { editing = holding.id; redraw(); } },
            { icon: 'delete', label: '删除', danger: true, run: () => {
                if (!window.confirm('确定从资产列表中删除这项记录吗？')) return;
                if (!adapter.assets?.manualDelete) { notice('请在酒馆中使用小榴莲。'); return; }
                adapter.assets.manualDelete(holding.id).then(() => redraw()).catch(e => notice(e.message));
            } },
        ];
    }
    return { html, press,
        reset() { epoch++; proposal=null; tab = 'cash'; status = ''; working = false; ledgerOpen = false; recentAll = false; editing = null; },
        async action(action, nextTab, rate, fields) {
            if (action === 'tab') { if (labels[nextTab]) tab = nextTab; redraw(); return; }
            if (action === 'ledger') { ledgerOpen = !ledgerOpen; redraw(); return; }
            if (action === 'recent') { recentAll = !recentAll; redraw(); return; }
            if (action === 'cancel-edit') { editing = null; redraw(); return; }
            if (action === 'save-edit') {
                if (!editing) return;
                if (!adapter.assets?.manualEdit) { notice('请在酒馆中使用小榴莲。'); return; }
                adapter.assets.manualEdit(editing, fields).then(() => { editing = null; redraw(); }).catch(e => notice(e.message));
                return;
            }
            if (!['update','convert'].includes(action) || working || getView().busy) return;
            if (!adapter.assets) { notice('请在酒馆中点击一键更新建立账本。'); return; }
            const token = epoch; working = true; redraw();
            try { const result = action==='convert'?await adapter.assets.convert(rate):await adapter.assets.update(); if (token === epoch) { if (action==='update'||result?.ok) proposal=result?.value?.switchTo?result.value:null; status = result?.value?.switchTo?'常住地币种已确定，请确认旧账换算比例。':result?.value?.currency?'旧账已换算为 '+result.value.currency+'。': result?.ok ? (result.value?.repaired ? '遗漏物品已核对，原有收支结算未重算' : '账本已更新') : result?.error || '本次未更新，请重试。'; } }
            catch (e) { if (token === epoch) status = e.message; }
            finally { if (token === epoch) working = false; redraw(); }
        },
    };
}
