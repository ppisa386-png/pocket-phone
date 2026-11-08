import { foodItems } from './food.js?v=1.2';
import { formatMoney } from './currency.js?v=1.2';
import { dayDate } from './story-clock.js?v=1.2';
import { foodDeliveryStatus } from './delivery.js?v=1.2';
import { icon } from './icons.js?v=1.2';

// Visual-only replacement for food-view.js. The original adapter methods, IDs,
// event dispatch, checkout path and order delivery logic are preserved.
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[ch]);
const money = (minor, currency) => formatMoney(minor, currency);
const clockText = order => {
    const hour = order.createdHour;
    const text = Number.isFinite(hour)
        ? String(Math.floor(hour)).padStart(2, '0') + ':' + String(Math.round(hour % 1 * 60)).padStart(2, '0')
        : '—';
    return dayDate(order.createdDay) + '  ' + text;
};
const searchIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16.1 16.1 4.3 4.3"/></svg>';
const chevron = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
const arrow = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h16M13 5l7 7-7 7"/></svg>';

// Small locally rendered food motifs, deliberately not remote images or AI-generated
// per-dish assets. CSS supplies the color variations; all restaurant data remains real.
const motifs = [
    '<circle cx="40" cy="40" r="27"/><circle cx="40" cy="40" r="19"/><path d="M28 40c7-12 17 12 24 0M31 33c5-6 12 3 18-1"/>',
    '<path d="M16 43h48c-2 18-10 23-24 23s-22-5-24-23Z"/><path d="M23 48h34M31 16c-7 7 5 11-1 19M45 14c-7 9 4 11-2 19M54 19c-6 6 1 10-4 15"/>',
    '<path d="M20 30h39v23c0 8-8 12-19.5 12S20 61 20 53V30Z"/><path d="M59 35h4c12 0 10 19-3 19M25 25h29M32 17c-3 4 2 7-1 10M45 17c-3 4 2 7-1 10"/>',
    '<path d="M17 49c2-18 15-28 29-24 9 2 17 12 19 23-6 9-19 17-28 16-9 0-17-6-20-15Z"/><path d="M25 45c8-7 13-6 17-5M39 30c5 6 6 12 8 19M24 54c8 1 13-2 17-7"/>',
    '<path d="M20 25h40v30a20 20 0 0 1-40 0V25Z"/><path d="M15 25h50M30 18l2-8M40 17V7M50 18l-2-8"/><path d="M26 48c10 8 18 8 28 0"/>',
    '<circle cx="40" cy="40" r="26"/><path d="M22 48c12-15 24-15 36 0M28 30c8 8 16 8 24 0"/><path d="M40 15v8M40 57v9"/>'
];
function restaurantArt(cuisine, index) {
    const kind = String(cuisine || '').toLowerCase();
    let choice = index % motifs.length;
    if (/面|拉面|粉|汤|米线|noodle|ramen|soup/.test(kind)) choice = 1;
    else if (/奶茶|饮品|茶|咖啡|coffee|tea|drink|cafe/.test(kind)) choice = 2;
    else if (/面包|烘焙|法式|甜品|bakery|bread|pastry/.test(kind)) choice = 3;
    else if (/披萨|意大|pizza|italian|pasta/.test(kind)) choice = 0;
    else if (/寿司|日式|日本|sushi|japan/.test(kind)) choice = 4;
    return '<svg viewBox="0 0 80 80" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + motifs[choice] + '</svg>';
}

export function createFoodPanel({ adapter, getView, redraw, notice }) {
    let tab = 'home', selectedShop = null, category = 'all';
    let status = '', working = false, epoch = 0, drafts = {}, buy = null;
    const chat = () => adapter.storyChat?.() || [];
    const disabled = () => working || getView().busy ? ' disabled' : '';
    const cart = state => state.orders?.foodCart?.items || [];
    const lineOf = (state, dishId) => cart(state).find(item => item.dishId === dishId);
    const shopLines = (state, shopId) => cart(state).filter(item => item.shopId === shopId);
    const qty = lines => lines.reduce((sum, item) => sum + item.quantity, 0);
    const total = lines => {
        const sums = Object.create(null);
        for (const item of lines) sums[item.currency] = (sums[item.currency] || 0) + item.quantity * item.priceMinor;
        return Object.entries(sums).map(([currency, value]) => money(value, currency)).join(' + ');
    };
    const empty = (symbol, title, description) => '<div class="pp-food-empty"><span class="pp-food-empty-glyph">' + icon(symbol) + '</span><h3>' + title + '</h3><p>' + description + '</p></div>';
    const bubble = (label, inner) => '<div class="pp-shop-bubble" role="dialog" aria-label="' + esc(label) + '">' + inner + '<span class="pp-shop-bubble-tail" aria-hidden="true"></span></div>';
    const bubbleOption = (action, id, title, note = '') => '<button type="button" class="pp-shop-bubble-option" data-food-action="' + action + '" data-food-id="' + esc(id) + '"' + disabled() + '><b>' + esc(title) + '</b>' + (note ? '<small>' + esc(note) + '</small>' : '') + chevron + '</button>';

    function buyBubble() {
        if (!buy) return '';
        const cancel = '<button type="button" class="pp-shop-bubble-quiet" data-food-action="gift-cancel"' + disabled() + '>取消</button>';
        const hint = buy.hint ? '<p class="pp-shop-bubble-hint" role="status">' + esc(buy.hint) + '</p>' : '';
        if (buy.step === 'target') return bubble('选择收件人',
            '<p class="pp-shop-bubble-title">这份外卖送给谁？</p><div class="pp-shop-bubble-options">' +
            bubbleOption('gift-self', 'self', '送到这里来', '收件人：' + String(adapter.userName?.() || 'user')) +
            bubbleOption('gift-other', '', '点给别人吃', '输入对方的名字或昵称') + '</div>' + hint + cancel);
        if (buy.step === 'name') return bubble('点给别人吃',
            '<p class="pp-shop-bubble-title">点给别人吃</p><form data-food-form="gift-name" class="pp-shop-bubble-form">' + hint +
            '<label class="pp-field"><span>收件人名字</span><input data-food-field="foodName" name="foodName" type="text" placeholder="名字或昵称" value="' + esc(drafts.foodName ?? '') + '"' + disabled() + '></label>' +
            '<div class="pp-shop-bubble-row"><button type="button" class="pp-shop-bubble-quiet" data-food-action="gift-back"' + disabled() + '>上一步</button><button type="submit" class="pp-shop-bubble-confirm"' + disabled() + '>继续</button></div></form>' + cancel);
        if (buy.step === 'payer') return bubble('请 NPC 代付',
            '<p class="pp-shop-bubble-title">请 TA 代付</p><form data-food-form="payer-name" class="pp-shop-bubble-form">' + hint +
            '<label class="pp-field"><span>代付角色名字</span><input data-food-field="payerName" name="payerName" type="text" placeholder="名字或昵称" value="' + esc(drafts.payerName ?? '') + '"' + disabled() + '></label>' +
            '<div class="pp-shop-bubble-row"><button type="button" class="pp-shop-bubble-quiet" data-food-action="gift-back"' + disabled() + '>上一步</button><button type="submit" class="pp-shop-bubble-confirm"' + disabled() + '>询问对方</button></div></form>' + cancel);
        return bubble('选择付款方式',
            '<p class="pp-shop-bubble-title">选择付款方式</p><div class="pp-shop-bubble-options">' +
            bubbleOption('pay-self', 'self', '自己付款', '从小榴莲余额中支付') +
            bubbleOption('pay-npc', '', '请 TA 代付', '由对方决定是否愿意') + '</div>' + hint + cancel);
    }

    function shopCard(shop, index, state) {
        const count = qty(shopLines(state, shop.id));
        const prices = (shop.menu || []).map(d => d.priceMinor).filter(Number.isFinite);
        const min = prices.length ? money(Math.min(...prices), shop.currency) : '—';
        const tint = index % 6;
        return '<article class="pp-food-shop-card"><button type="button" class="pp-food-shop-open" data-food-action="shop" data-food-id="' + esc(shop.id) + '"' + disabled() + '>' +
            '<div class="pp-food-shop-thumb" data-tint="' + tint + '">' + restaurantArt(shop.cuisine, index) + '</div>' +
            '<div class="pp-food-shop-content"><div class="pp-food-shop-row"><strong>' + esc(shop.name) + '</strong>' + (count ? '<b class="pp-food-shop-badge" aria-label="已选 ' + count + ' 件">' + count + '</b>' : '') + '</div>' +
            '<small class="pp-food-cuisine">' + esc(shop.cuisine || '精选餐厅') + '</small>' +
            (shop.description ? '<p>' + esc(shop.description) + '</p>' : '') +
            '<div class="pp-food-shop-foot"><span>' + (shop.menu?.length || 0) + ' 道菜品</span><span class="pp-food-shop-dot">·</span><span>低至 ' + esc(min) + '</span></div>' +
            '</div><span class="pp-food-shop-chevron">' + chevron + '</span></button></article>';
    }

    function homePage(state, shops) {
        const previous = state.orders?.foodSearch;
        return '<section class="pp-food-home">' +
            '<div class="pp-food-intro"><p class="pp-food-kicker">A LITTLE SOMETHING GOOD</p><h1>今天吃点好的<span>。</span></h1><p class="pp-food-intro-note">从熟悉的味道，到今天的新发现。</p></div>' +
            '<div class="pp-food-search"><form class="pp-food-search-form" data-food-form="search">' +
            '<label class="pp-food-search-input">' + searchIcon + '<span class="pp-food-sr">想吃的东西</span><input data-food-field="query" name="query" type="search" value="' + esc(drafts.query ?? (previous?.query || '')) + '" placeholder="今天想吃什么呢" autocomplete="off"' + disabled() + '></label>' +
            '<button type="submit" class="pp-food-search-btn" aria-label="搜索餐厅"' + disabled() + '>' + arrow + '</button></form></div>' +
            '<div class="pp-food-section-heading"><div><span class="pp-food-section-overline">DISCOVER</span><h2>' + (shops.length ? '找到的好味道' : '探索你的下一餐') + '</h2></div>' +
            (shops.length ? '<span class="pp-food-section-count">' + shops.length + ' 家餐厅</span>' : '') + '</div>' +
            (shops.length ? '<div class="pp-food-shops">' + shops.map((shop, i) => shopCard(shop, i, state)).join('') + '</div>' : empty('food', previous ? '换个口味试试？' : '从喜欢的味道开始', '输入菜系、饮品或任何想吃的东西，寻找合适的餐厅。')) +
            '</section>';
    }

    function shopPage(state) {
        const shop = state.orders[selectedShop];
        if (!shop || shop.type !== 'foodShop') { selectedShop = null; return ''; }
        const names = [];
        const groups = new Map();
        for (const dish of shop.menu || []) {
            const key = String(dish.category || '其他');
            if (!groups.has(key)) { names.push(key); groups.set(key, []); }
            groups.get(key).push(dish);
        }
        if (category !== 'all' && !groups.has(category)) category = 'all';
        const lines = shopLines(state, shop.id);
        const stepper = dish => {
            const line = lineOf(state, dish.id);
            return line
                ? '<div class="pp-food-step"><button type="button" class="pp-food-step-btn" data-food-action="dec" data-food-id="' + esc(dish.id) + '" aria-label="减少 ' + esc(dish.name) + ' 数量"' + disabled() + '>−</button><b aria-label="已选 ' + line.quantity + ' 份">' + line.quantity + '</b><button type="button" class="pp-food-step-btn" data-food-action="inc" data-food-id="' + esc(dish.id) + '" aria-label="增加 ' + esc(dish.name) + ' 数量"' + disabled() + '>+</button></div>'
                : '<button type="button" class="pp-food-add" data-food-action="inc" data-food-id="' + esc(dish.id) + '" aria-label="加一份 ' + esc(dish.name) + '"' + disabled() + '>+</button>';
        };
        const dishRow = (dish, i) => '<article class="pp-food-dish"><div class="pp-food-dish-info"><strong>' + esc(dish.name) + '</strong>' +
            (dish.description ? '<p>' + esc(dish.description) + '</p>' : '') +
            '<b class="pp-food-price">' + esc(money(dish.priceMinor, shop.currency)) + '</b></div>' + stepper(dish) + '</article>';
        const sections = names.filter(name => category === 'all' || category === name).map(name =>
            '<section class="pp-food-menu-group"><h4 class="pp-food-cat">' + esc(name) + '<span>' + groups.get(name).length + ' ITEMS</span></h4>' + groups.get(name).map(dishRow).join('') + '</section>'
        ).join('');
        const rail = '<div class="pp-food-category-rail" role="group" aria-label="菜品分类">' +
            [['all', '全部'], ...names.map(n => [n, n])].map(([id, name]) => '<button type="button" data-food-action="category" data-food-id="' + esc(id) + '" aria-pressed="' + (category === id) + '"' + disabled() + '>' + esc(name) + '</button>').join('') + '</div>';
        return '<section class="pp-food-shoppage">' +
            '<div class="pp-food-shophead"><button type="button" class="pp-food-back" data-food-action="back"' + disabled() + '><span>‹</span> 返回餐厅</button>' +
            '<p class="pp-food-shop-overline">CURATED MENU · ' + (shop.menu?.length || 0) + ' ITEMS</p><h2>' + esc(shop.name) + '</h2>' +
            '<p class="pp-food-shop-subtitle">' + esc([shop.cuisine, shop.description].filter(Boolean).join(' · ')) + '</p></div>' +
            rail + '<div class="pp-food-menu" data-food-menu="shop:' + esc(shop.id) + ':' + esc(category) + '">' + sections + '</div>' +
            (buy ? '<div class="pp-food-buy-popover">' + buyBubble() + '</div>' : '') +
            '<div class="pp-food-bar"><div class="pp-food-bar-total"><small>' + (qty(lines) ? '已选 ' + qty(lines) + ' 份 · 合计' : '尚未选择菜品') + '</small><b>' + (lines.length ? esc(total(lines)) : '—') + '</b></div>' +
            '<button type="button" class="pp-food-buy" data-food-action="buy"' + (lines.length ? disabled() : ' disabled') + '>结算 ' + arrow + '</button></div></section>';
    }

    function ordersPage(state) {
        const orders = foodItems(state, 'foodOrder').slice().reverse();
        return '<section class="pp-food-orders-page"><div class="pp-food-section-heading"><div><span class="pp-food-section-overline">ORDER HISTORY</span><h2>你的订单</h2></div><span class="pp-food-section-count">' + orders.length + ' 笔</span></div>' +
            (orders.length ? '<div class="pp-food-orders">' + orders.map(order => {
                const delivery = foodDeliveryStatus(order, chat());
                const done = delivery.delivered === true; // 状态以配送状态机的 delivered 字段为准，不猜文案
                return '<article class="pp-food-order"><header><div class="pp-food-order-heading"><small>' + esc(clockText(order)) + '</small><h3>' + esc(order.shopName) + '</h3></div><span class="pp-food-order-status" data-done="' + done + '">' + esc(delivery.label) + '</span></header>' +
                    '<div class="pp-food-order-body">' +
                    '<div class="pp-food-order-meta"><span>送给 ' + esc(order.recipient?.name || 'user') + '</span>' + (order.paymentMethod === 'npc' && order.payerName ? '<span>由 ' + esc(order.payerName) + ' 代付</span>' : '') + '</div>' +
                    '<div class="pp-food-order-lines">' + (order.items || []).map(item => '<div class="pp-food-order-line"><span>' + esc(item.name) + '<em>× ' + Number(item.quantity || 0) + '</em></span><b>' + esc(money(item.priceMinor * item.quantity, item.currency || order.items?.[0]?.currency)) + '</b></div>').join('') + '</div>' +
                    '<div class="pp-food-order-total"><span>实付金额</span><b>' + esc(Object.entries(order.totals || {}).map(([c, v]) => money(v, c)).join(' + ')) + '</b></div></div></article>';
            }).join('') + '</div>' : empty('parcel', '还没有外卖订单', '下单之后，订单会出现在这里。')) + '</section>';
    }

    function html() {
        const state = getView();
        const shops = foodItems(state, 'foodShop');
        if (selectedShop && !shops.some(s => s.id === selectedShop)) selectedShop = null;
        const body = tab === 'orders' ? ordersPage(state) : selectedShop ? shopPage(state) : homePage(state, shops);
        const visibleStatus = working || state.busy ? '正在处理…' : state.errorKind === 'food' && state.error ? state.error : status;
        return '<div class="pp-snap pp-food"><header class="pp-food-masthead"><span class="pp-food-masthead-mark"><i></i> ENJOY YOUR MOMENT</span><span class="pp-food-masthead-side">DURIAN · DELIVERY</span></header>' +
            '<div class="pp-food-body" data-food-page="' + esc(tab + ':' + (selectedShop || '')) + '">' +
            (visibleStatus ? '<p class="pp-snap-status" role="status">' + esc(visibleStatus) + '</p>' : '') + body + '</div>' +
            '<nav class="pp-snap-tabs pp-food-tabs" aria-label="榴莲外卖页面">' + [['home', '外卖', 'food'], ['orders', '订单', 'parcel']].map(([id, label, symbol]) =>
                '<button type="button" data-food-action="tab" data-food-id="' + id + '" aria-pressed="' + (tab === id) + '" aria-label="' + label + '"><span class="pp-food-tab-icon">' + icon(symbol) + '</span><span>' + label + '</span></button>'
            ).join('') + '</nav></div>';
    }

    async function perform(method, args, message = '') {
        if (!adapter.food) { notice('请在酒馆内使用榴莲外卖。'); return null; }
        if (working || getView().busy) return null;
        const token = epoch; working = true; redraw();
        try {
            const result = await adapter.food[method](...args);
            if (token !== epoch) return null;
            status = result?.ok ? message : result?.error || '请重试。';
            return result;
        } catch (error) {
            if (token === epoch) status = error.message;
            return null;
        } finally {
            working = false;
            redraw();
        }
    }

    async function placeOrder(key, method = 'self', payerName = '') {
        const target = buy;
        const recipientName = key === 'other' ? (drafts.foodName ?? '') : '';
        buy = null; status = ''; redraw();
        const result = await perform('checkout', [selectedShop, key, recipientName, method, payerName], '下单成功');
        if (result?.ok) {
            if (result.value?.rejected) { buy = { ...target, step: 'pay', hint: '对方拒绝了你的代付要求' }; status = ''; redraw(); return; }
            tab = 'orders'; selectedShop = null; category = 'all'; delete drafts.foodName; delete drafts.payerName; redraw(); return;
        }
        buy = target ? { ...target, step: method === 'npc' ? 'payer' : 'pay', hint: result?.error || '请重试。' } : null;
        redraw();
    }

    return {
        html,
        back() { if (tab === 'home' && selectedShop) { selectedShop = null; category = 'all'; buy = null; redraw(); return true; } return false; },
        reset() { epoch++; tab = 'home'; selectedShop = null; category = 'all'; drafts = {}; status = ''; buy = null; },
        input(el) { drafts[el.dataset.foodField] = el.value; },
        async action(action, id) {
            if (action === 'tab') { if (!['home', 'orders'].includes(id)) return; tab = id; selectedShop = null; category = 'all'; status = ''; buy = null; redraw(); return; }
            if (action === 'shop') { selectedShop = id; category = 'all'; status = ''; buy = null; redraw(); return; }
            if (action === 'back') { selectedShop = null; category = 'all'; buy = null; redraw(); return; }
            if (action === 'category') { category = id || 'all'; redraw(); return; }
            if (action === 'inc') await perform('add', [selectedShop, id, 1]);
            if (action === 'dec') {
                const line = lineOf(getView(), id);
                await perform('update', [selectedShop, id, Math.max(0, (line?.quantity || 1) - 1)]);
            }
            if (action === 'buy') {
                if (!shopLines(getView(), selectedShop).length) { status = '还没有选择菜品，先挑几样想吃的吧。'; redraw(); return; }
                buy = { step: 'target', hint: '' }; status = ''; redraw(); return;
            }
            if (action === 'gift-self') { buy = { step: 'pay', recipientKey: 'self', origin: 'target', hint: '' }; status = ''; redraw(); return; }
            if (action === 'gift-other') { buy = { step: 'name', hint: '' }; status = ''; delete drafts.foodName; redraw(); return; }
            if (action === 'gift-back') {
                if (buy?.step === 'payer') buy = { ...buy, step: 'pay', hint: '' };
                else if (buy?.step === 'pay') buy = { ...buy, step: buy.origin || 'target', hint: '' };
                else { buy = { step: buy?.step === 'name' ? 'target' : 'name', hint: '' }; if (buy.step === 'name') delete drafts.foodName; }
                redraw(); return;
            }
            if (action === 'gift-cancel') { buy = null; status = ''; redraw(); return; }
            if (action === 'pay-self') await placeOrder(buy?.recipientKey || 'self', 'self');
            if (action === 'pay-npc') { buy = { ...(buy || {}), step: 'payer', hint: '' }; status = ''; delete drafts.payerName; redraw(); }
        },
        async submit(form) {
            const values = Object.fromEntries(new FormData(form));
            const kind = form.dataset.foodForm;
            if (kind === 'search') await perform('search', [values.query]);
            if (kind === 'gift-name') {
                if (!String(values.foodName || '').trim()) { buy = { step: 'name', hint: '请填写收件人的名字。' }; status = ''; redraw(); return; }
                buy = { ...(buy || {}), step: 'pay', recipientKey: 'other', origin: 'name', hint: '' }; status = ''; redraw();
            }
            if (kind === 'payer-name') {
                const name = String(values.payerName || '').trim();
                if (!name) { buy = { ...(buy || {}), step: 'payer', hint: '请填写代付角色的名字。' }; status = ''; redraw(); return; }
                await placeOrder(buy?.recipientKey || 'self', 'npc', name);
            }
        }
    };
}
