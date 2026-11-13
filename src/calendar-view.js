import { readStoryClock, dayDate, dateDay } from './story-clock.js?v=1.2';
import { calendarMonth, calendarOccurrences, calendarPersonal, calendarRegionKey } from './calendar-core.js?v=1.2.57';
import { icon } from './icons.js?v=1.2.57';

const calendarEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const calendarLabel = date => `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
const calendarWeekday = day => '星期' + '日一二三四五六'[new Date(day * 86400000).getUTCDay()];
const calendarStamp = value => value ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '尚未刷新';
export function createCalendarPanel({ adapter, getView, redraw, notice }) {
    let selected = '', month = '', page = 'month', draft = null, returnPage = 'month', working = false, status = '', epoch = 0, lastDay = null;
    const button = (action, text, label = '', extra = '') => `<button type="button" data-calendar-action="${action}"${label ? ` aria-label="${calendarEscape(label)}" title="${calendarEscape(label)}"` : ''} ${extra}>${text}</button>`;
    function html() {
        const state = getView(), db = state.calendar?.database, clock = readStoryClock(adapter.storyChat?.() || []), today = dayDate(clock.day);
        if (clock.day !== lastDay && page === 'month') { if (!selected || selected === dayDate(lastDay)) { selected = today; month = today.slice(0, 7); } lastDay = clock.day; }
        if (!selected) selected = today || (db ? `${String(db.years[0]).padStart(4, '0')}-01-01` : '');
        if (!month) month = selected.slice(0, 7);
        const busy = working || state.busy, disabled = busy ? 'disabled' : '', currentCity = state.location?.current?.city || '地点尚未确定';
        const season = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'][Number(month.slice(5)) - 1] || 'spring';
        const sprig = `<span class="pp-cal-sprig" data-season="${season}" aria-hidden="true"></span>`;
        const feedback = `<p class="pp-cal-status${status ? ' has-message' : ''}" role="status" aria-live="polite">${calendarEscape(working ? (page === 'editor' ? '正在保存事件…' : '正在整理地区节日资料…') : status)}</p>`;
        const header = `<header class="pp-cal-header"><div><small>SEASONAL ALMANAC</small><h2>榴莲日历</h2><p>${icon('map')}<span>${calendarEscape(db?.region || currentCity)}</span></p></div><div class="pp-cal-tools">${db ? button('refresh', `<span class="${busy ? 'pp-cal-spin' : ''}">${icon('refresh')}</span>`, '刷新日历', disabled) : ''}${button(page === 'settings' ? 'month' : 'settings', icon(page === 'settings' ? 'back' : 'settings'), page === 'settings' ? '返回月历' : '日历设置', disabled)}</div>${sprig}</header>`;
        const shell = content => `<section class="pp-calendar" aria-label="榴莲日历">${header}${feedback}${content}<footer class="pp-cal-footer">榴莲日历 <span>·</span> 让日子慢慢留下痕迹</footer></section>`;
        if (page === 'editor' && draft) {
            const option = (value, text, chosen) => `<option value="${value}"${chosen === value ? ' selected' : ''}>${text}</option>`;
            return shell(`<div class="pp-cal-section-heading"><h3>${draft.id ? '编辑日子' : '记下一个日子'}</h3>${button('cancel', '取消', '', disabled)}</div><form class="pp-cal-form" data-calendar-form>
                <label>事件名称<input name="name" required maxlength="80" value="${calendarEscape(draft.name)}" placeholder="想记住的事"></label>
                <label>日期<input name="date" type="date" required value="${calendarEscape(draft.date)}"></label>
                <div class="pp-cal-form-pair"><label>类型<select name="kind">${option('event', '自定义事件', draft.kind)}${option('anniversary', '纪念日', draft.kind)}</select></label><label>重复<select name="repeat">${option('none', '不重复', draft.repeat)}${option('yearly', '每年重复', draft.repeat)}</select></label></div>
                <label>备注 <small>可选</small><textarea name="note" maxlength="500" rows="4" placeholder="为这一天留几句话">${calendarEscape(draft.note)}</textarea></label>
                <p class="pp-cal-hint">每年重复按公历日期计算；2月29日只在闰年出现。提前三天及当天提供正文背景。</p>
                <button type="submit" class="pp-cal-primary" ${disabled}>${working ? '正在保存…' : '保存事件'}</button>
                ${draft.id ? button('delete', '删除事件', '', `class="pp-cal-delete" ${disabled}`) : ''}</form>`);
        }
        if (page === 'settings') {
            const personal = calendarPersonal(state).sort((a, b) => a.date.localeCompare(b.date));
            return shell(`<section class="pp-cal-settings"><h3>地区信息</h3><dl><dt>日历地区</dt><dd>${calendarEscape(db?.region || '尚未初始化')}</dd><dt>时区</dt><dd>${calendarEscape(db?.timezone || '未明确')}</dd><dt>天气当前地点</dt><dd>${calendarEscape(currentCity)}</dd></dl><p class="pp-cal-hint">手动刷新时与天气地点同步。日期、倒计时及正文提醒跟随剧情时间；刷新时间为本机操作时间。</p>
                <h3>日历管理</h3><dl><dt>上次成功刷新</dt><dd>${calendarStamp(db?.refreshedAt)}</dd><dt>资料范围</dt><dd>${db ? db.years.join(' / ') + ' 年' : '尚未建立'}</dd><dt>资料来源</dt><dd>${calendarEscape(db?.source || '使用已配置的 AI 连接')}</dd></dl><p class="pp-cal-hint">节日由 AI 按剧情地区与年代整理，未连接官方节日数据库。未覆盖的年份请手动刷新。</p>${button('refresh', `${icon('refresh')} 手动刷新日历`, '', `class="pp-cal-text-button" ${disabled}`)}
                <div class="pp-cal-section-heading"><h3>个人事件</h3>${button('add', '+ 添加', '', disabled)}</div>${personal.length ? personal.map(row => `<div class="pp-cal-manage-row"><div><strong>${calendarEscape(row.name)}</strong><small>${calendarEscape(row.date)} · ${row.kind === 'anniversary' ? '纪念日' : '事件'}${row.repeat === 'yearly' ? ' · 每年' : ''}</small></div>${button('edit', '编辑', '编辑 ' + row.name, `data-calendar-id="${calendarEscape(row.id)}" ${disabled}`)}</div>`).join('') : '<p class="pp-cal-empty">还没有记下个人事件。</p>'}</section>`);
        }
        if (!db) return shell(`<div class="pp-cal-welcome"><div class="pp-cal-welcome-mark">${icon('calendar')}${sprig}</div><small>四季流转 · 日子有迹</small><h3>让每一个重要的日子<br>都有迹可循。</h3><p>当前天气地点</p><strong class="pp-cal-place">${calendarEscape(currentCity)}</strong>${button('refresh', `${icon('refresh')} 刷新日历`, '', `class="pp-cal-primary" ${disabled}`)}<p class="pp-cal-hint">根据天气 App 当前地点获取当地节日资料，<br>初始化完成后即可使用日历。</p>${!today ? '<p class="pp-cal-hint">请先在剧情中明确日期。</p>' : ''}</div>`);
        const [year, monthNumber] = month.split('-').map(Number), cells = calendarMonth(year, monthNumber);
        const monthRows = cells.length ? calendarOccurrences(state, cells[0].day, cells.at(-1).day) : [];
        const selectedDay = dateDay(selected), entries = calendarOccurrences(state, selectedDay, selectedDay);
        const upcoming = clock.day === null ? [] : calendarOccurrences(state, clock.day, clock.day + 366);
        const renderEntry = row => `<article class="pp-cal-event" data-kind="${row.kind}"><span class="pp-cal-event-mark" aria-hidden="true">${row.kind === 'anniversary' ? icon('heart') : icon('calendar')}</span><div><small>${row.kind === 'holiday' ? '当地节日' : row.kind === 'anniversary' ? '纪念日' : '个人事件'}${row.repeat === 'yearly' ? ' · 每年' : ''}</small><h4>${calendarEscape(row.name)}</h4>${row.note ? `<p>${calendarEscape(row.note)}</p>` : ''}</div>${row.type === 'personal' ? button('edit', icon('edit'), '编辑 ' + row.name, `data-calendar-id="${calendarEscape(row.id)}" ${disabled}`) : ''}</article>`;
        const stale = calendarRegionKey(currentCity) !== db.regionKey;
        return shell(`${stale ? '<p class="pp-cal-hint pp-cal-attention">天气地点已变化，刷新后将切换到新地区的节日。</p>' : ''}${!today ? '<p class="pp-cal-hint pp-cal-attention">剧情日期待明确，暂不计算倒计时或发送提醒。</p>' : ''}
            <nav class="pp-cal-month" aria-label="月份导航">${button('previous', icon('back'), '上个月', year === 1 && monthNumber === 1 ? 'disabled' : '')}<h3><span>${year}</span>年<span>${monthNumber}</span>月</h3>${button('next', `<span class="pp-cal-next">${icon('back')}</span>`, '下个月', year === 9998 && monthNumber === 12 ? 'disabled' : '')}</nav>
            <div class="pp-cal-week" aria-hidden="true">${[...'日一二三四五六'].map(day => `<span>${day}</span>`).join('')}</div>
            <div class="pp-cal-grid" role="group" aria-label="${year}年${monthNumber}月日期">${cells.map(cell => {
                const rows = monthRows.filter(row => row.day === cell.day), kind = rows.length > 1 ? 'count' : rows[0]?.kind || '';
                return button('select', `<span class="pp-cal-number">${Number(cell.date.slice(8))}</span><span class="pp-cal-day-mark" data-kind="${kind}">${rows.length > 1 ? rows.length : rows.length ? (kind === 'anniversary' ? '◆' : '•') : ''}</span>`, cell.date + (cell.date === today ? ' 今天' : '') + (rows.length ? '，' + rows.map(row => row.name).join('、') : ''), `class="pp-cal-day${cell.current ? '' : ' is-outside'}${cell.date === selected ? ' is-selected' : ''}${cell.date === today ? ' is-today' : ''}" data-calendar-id="${cell.date}" aria-pressed="${cell.date === selected}"${cell.date === today ? ' aria-current="date"' : ''}`);
            }).join('')}</div>
            <div class="pp-cal-legend"><span><i></i>节日</span><span><i class="anniversary"></i>纪念日</span>${button('today', '回到今天', '', today ? '' : 'disabled')}</div>
            ${!db.years.includes(year) ? '<p class="pp-cal-hint pp-cal-attention">本年节日资料尚未收录，个人事件仍正常显示。</p>' : ''}
            <section class="pp-cal-details" aria-live="polite"><div class="pp-cal-section-heading"><h3>${calendarLabel(selected)}<small>${calendarWeekday(selectedDay)}</small></h3>${button('add', '+', '添加事件', disabled)}</div>${entries.length ? entries.map(renderEntry).join('') : '<p class="pp-cal-empty">这一天暂时没有安排。</p>'}</section>
            <section class="pp-cal-upcoming"><div class="pp-cal-section-heading"><h3>接下来，值得期待</h3><small>未来一年</small></div><div class="pp-cal-upcoming-list">${upcoming.length ? upcoming.map(row => `<button type="button" class="pp-cal-upcoming-row" data-calendar-action="select" data-calendar-id="${row.date}"><span class="pp-cal-upcoming-symbol" data-kind="${row.kind}">${icon(row.kind === 'anniversary' ? 'heart' : 'calendar')}</span><span class="pp-cal-upcoming-copy"><strong>${calendarEscape(row.name)}</strong><small>${calendarLabel(row.date)} · ${calendarWeekday(row.day)}</small></span><span class="pp-cal-countdown">${row.day === clock.day ? '就是今天' : `还有 <b>${row.day - clock.day}</b> 天`}</span></button>`).join('') : `<p class="pp-cal-empty">${today ? '暂无即将到来的节日与事件。' : '等待剧情日期明确。'}</p>`}</div></section>
            <p class="pp-cal-refreshed">${icon('refresh')} 上次刷新 · ${calendarStamp(db.refreshedAt)}</p>`);
    }
    function back() { if (page === 'month') return false; page = page === 'editor' ? returnPage : 'month'; draft = null; status = ''; redraw(); return true; }
    async function run(operation, success, after) {
        if (working || getView().busy) return;
        const turn = epoch; working = true; status = ''; redraw();
        try {
            const result = await operation();
            if (epoch !== turn) return;
            if (!result?.ok) throw Error(result?.error || '操作未完成，请重试。');
            after?.(result.value); notice?.(typeof success === 'function' ? success(result.value) : success);
        } catch (error) { if (epoch === turn) status = error.message; }
        finally { if (epoch === turn) { working = false; redraw(); } }
    }
    const api = {
        html, back,
        reset() { epoch++; selected = month = status = ''; lastDay = null; page = 'month'; draft = null; working = false; },
        change(name, value) { if (draft && ['name', 'date', 'kind', 'repeat', 'note'].includes(name)) draft[name] = value; },
        submit() { if (draft) return run(() => adapter.calendar.saveEvent(draft, draft.id), '事件已保存', event => { selected = event.date; month = selected.slice(0, 7); page = returnPage; draft = null; }); },
        async action(action, id) {
            if (action === 'refresh') {
                if (!adapter.calendar) { status = '请安装到酒馆并连接 AI 后使用日历。'; redraw(); return; }
                const initialized = !!getView().calendar?.database;
                return run(async () => { const result = await adapter.calendar.refresh(); if (!result.ok) return { ...result, error: (initialized ? '更新失败，已保留原有日历资料。' : '日历初始化失败，请检查网络后重试。') + (result.error ? ' ' + result.error : '') }; return result; }, db => '日历已更新 · ' + db.region);
            }
            if (['save', 'delete', 'edit', 'add'].includes(action) && (working || getView().busy)) return;
            if (action === 'settings' || action === 'month') { page = action; status = ''; }
            if (action === 'cancel') { back(); return; }
            if (action === 'previous' || action === 'next') {
                const [year, m] = month.split('-').map(Number), next = year * 12 + m - 1 + (action === 'next' ? 1 : -1);
                if (next < 12 || next >= 9999 * 12) return;
                month = String(Math.floor(next / 12)).padStart(4, '0') + '-' + String(next % 12 + 1).padStart(2, '0'); selected = month + '-01';
            }
            if (action === 'select' && dateDay(id) !== null) { selected = id; month = id.slice(0, 7); }
            if (action === 'today') { selected = dayDate(readStoryClock(adapter.storyChat?.() || []).day); month = selected.slice(0, 7); }
            if (action === 'add' || action === 'edit') {
                const row = action === 'edit' ? getView().calendar?.[id] : null;
                if (action === 'edit' && row?.type !== 'personal') return;
                returnPage = page; page = 'editor'; status = '';
                draft = row ? { ...row } : { name: '', date: selected, kind: 'event', repeat: 'none', note: '' };
            }
            if (action === 'delete' && draft?.id) {
                if (!globalThis.confirm('删除这个个人事件？')) return;
                return run(() => adapter.calendar.deleteEvent(draft.id), '事件已删除', () => { page = returnPage; draft = null; });
            }
            redraw();
        },
    };
    return api;
}
