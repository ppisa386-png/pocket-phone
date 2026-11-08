import { weatherScene, weatherType, weatherExtreme } from './weather.js?v=1.2';
import { sceneIcon, weatherArt, sceneBackdrop, metricIcon } from './weather-art.js?v=1.2';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const monthDay = date => { const m = /-(\d{2})-(\d{2})$/.exec(String(date || '')); return m ? +m[1] + '/' + +m[2] : ''; };

// 昼夜主题：只看手机本地时间，不看剧情时间；打开与重绘时现算，不保存。
// 06:00–15:59 B 雾紫晴空；16:00–19:59 E 杏桃晴日；其余（20:00–05:59）D 深蓝玻璃。
export function themeFor(date = new Date()) {
    const hour = date.getHours();
    return hour >= 6 && hour < 16 ? 'mist' : hour >= 16 && hour < 20 ? 'apricot' : 'night';
}
// 下一次主题边界（本地时间 06:00 / 16:00 / 20:00），供界面定时重绘对齐。
export function nextThemeChange(from = new Date()) {
    for (const hour of [6, 16, 20]) {
        const boundary = new Date(from);
        boundary.setHours(hour, 0, 0, 0);
        if (boundary > from) return boundary;
    }
    const boundary = new Date(from);
    boundary.setDate(boundary.getDate() + 1);
    boundary.setHours(6, 0, 0, 0);
    return boundary;
}

const PIN = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11Z"/><circle cx="12" cy="10" r="2.4"/></svg>';
const MINI_REFRESH = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11A8 8 0 1 0 18.9 15M20 5v6h-6"/></svg>';
const metricCard = (cls, iconName, label, value) => '<div class="pp-weather-metric ' + cls + '"><span class="pp-weather-metric-icon" aria-hidden="true">' + metricIcon(iconName) + '</span><small>' + label + '</small><b>' + value + '</b></div>';

export function createWeatherPanel({ adapter, getView, redraw, notice, now = () => new Date() }) {
    let working = false, status = '', epoch = 0;

    function top(cityName, cityNote, busy) {
        return '<header class="pp-weather-top"><div class="pp-weather-loc"><span class="pp-weather-pin" aria-hidden="true">' + PIN + '</span><div class="pp-weather-loc-text"><b>' + escapeHtml(cityName) + '</b><small>' + cityNote + '</small></div></div>' +
            '<button type="button" class="pp-weather-mini-refresh" data-weather-action="refresh" aria-label="刷新天气"' + (busy ? ' disabled' : '') + '>' + MINI_REFRESH + '</button></header>';
    }
    function refreshButton(busy) {
        return '<button type="button" class="pp-weather-refresh" data-weather-action="refresh"' + (busy ? ' disabled' : '') + '>' + (busy ? '正在刷新…' : '刷新天气') + '</button>';
    }
    function foot(statusText, busy) {
        return '<footer class="pp-weather-foot"><p class="pp-weather-status" role="status">' + escapeHtml(statusText) + '</p>' + refreshButton(busy) + '</footer>';
    }

    function html() {
        const view = getView(), state = view || {};
        const busy = working || view.busy;
        const info = adapter.weather?.report(state);
        const theme = themeFor(now());
        const backdrop = '<div class="pp-weather-backdrop" aria-hidden="true">' + sceneBackdrop(info?.report?.type || (info?.status === 'pending' ? 'partly' : 'cloud'), theme) + '</div>';
        if (!info) return '<section class="pp-weather" data-wtheme="' + theme + '" data-weather="cloud">' + backdrop + '<div class="pp-weather-scroll"><div class="pp-weather-hero-copy pp-weather-hero-flat"><strong>—</strong><span class="pp-weather-desc">天气待刷新</span></div></div>' + foot('', busy) + '</section>';
        if (info.status === 'no-location') {
            return '<section class="pp-weather" data-wtheme="' + theme + '" data-weather="cloud">' + backdrop +
                '<div class="pp-weather-scroll">' + top('尚未标记位置', '天气会跟随剧情所在的城市', busy) +
                '<div class="pp-weather-hero-copy"><strong>—</strong><span class="pp-weather-desc">等待你的位置</span><small>让正文提到所在城市，或点击刷新自动判断</small></div>' +
                '<div class="pp-weather-card pp-weather-hint-card"><p>标记位置后，这里会展示当前天气、逐小时和七天预报。</p></div></div>' +
                foot(status, busy) + '</section>';
        }
        const city = escapeHtml(info.city || '');
        if (info.status === 'pending') {
            return '<section class="pp-weather" data-wtheme="' + theme + '" data-weather="cloud">' + backdrop +
                '<div class="pp-weather-scroll">' + top(city, '天气待刷新', busy) +
                '<div class="pp-weather-hero-copy"><strong>—</strong><span class="pp-weather-desc">天气待刷新</span><small>点击下方按钮，为' + city + '抽取当前天气</small></div></div>' +
                foot(status, busy) + '</section>';
        }
        const w = info.report || {};
        const scene = weatherScene(w.type);
        const clockHour = info.clock?.hour;
        const nowHour = clockHour == null ? null : Math.floor(clockHour);
        const feelsNote = '体感 ' + (w.feels == null ? '—' : Math.round(w.feels) + '°C');
        const timeNote = info.status === 'unknown-time'
            ? '剧情时间不明确 · 显示 ' + escapeHtml(info.date || '') + ' 刷新时的天气'
            : '剧情时间 ' + escapeHtml((w.date || '') + ' ' + (w.time || ''));
        const metrics = '<div class="pp-weather-metrics">' +
            metricCard('pp-weather-metric-lav', 'feels', '体感温度', w.feels == null ? '—' : Math.round(w.feels) + '°C') +
            metricCard('pp-weather-metric-apri', 'precip', '降水情况', w.precip == null || w.precip === 0 ? '暂无降水' : w.precip + ' mm/h') +
            metricCard('pp-weather-metric-sage', 'wind', '风力', w.wind == null ? '—' : w.wind + ' 级') +
            metricCard('pp-weather-metric-butter', 'humidity', '湿度', w.humidity == null ? '—' : Math.round(w.humidity) + '%') + '</div>';
        const hours = (info.forecast?.days?.[0]?.hours || []).map(h =>
            '<div class="pp-weather-hour' + (nowHour === h.hour ? ' pp-weather-hour-now' : '') + '"><i>' + (nowHour === h.hour ? '现在' : String(h.hour).padStart(2, '0') + '时') + '</i><span aria-hidden="true">' + sceneIcon(weatherScene(h.type), 20) + '</span><b>' + Math.round(h.temp) + '°</b></div>').join('');
        const hoursBand = hours ? '<div class="pp-weather-band" aria-hidden="true"></div>' : '';
        const forecast = info.forecast;
        let week = '';
        if (forecast?.days?.length) {
            const weekHi = Math.max(...forecast.days.map(d => d.hi)), weekLo = Math.min(...forecast.days.map(d => d.lo)), span = Math.max(1, weekHi - weekLo);
            week = forecast.days.map(d => {
                const left = Math.round((d.lo - weekLo) / span * 100), width = Math.round((d.hi - d.lo) / span * 100);
                return '<article class="pp-weather-day' + (d.today ? ' pp-weather-day-now' : '') + (d.extreme ? ' pp-weather-day-extreme' : '') + '">' +
                    '<header><span class="pp-weather-day-date"><b>' + (d.today ? '今天' : monthDay(d.date)) + '</b><i>' + escapeHtml(d.weekday) + '</i></span>' +
                    '<span class="pp-weather-day-icon" aria-hidden="true">' + sceneIcon(d.scene, 20) + '</span>' +
                    '<span class="pp-weather-day-desc">' + (d.extreme ? '<em title="极端天气">⚠</em>' : '') + escapeHtml(d.label) + '</span>' +
                    '<span class="pp-weather-day-temp"><b>' + Math.round(d.hi) + '°</b><i>' + Math.round(d.lo) + '°</i></span></header>' +
                    '<div class="pp-weather-day-meta"><span class="pp-weather-range" aria-hidden="true"><i style="left:' + left + '%;width:' + Math.max(8, width) + '%"></i></span>' +
                    '<small>降水 ' + d.precip + '% · 风 ' + d.wind + ' 级</small></div>' +
                    (d.extreme ? '<p class="pp-weather-day-warn">预计' + escapeHtml(d.extremeSpan || '全天') + '出现' + escapeHtml(d.extremeLabel || '') + '（' + escapeHtml(d.extremeStrength || '') + '）</p>' : '') +
                    '</article>';
            }).join('');
        }
        const alert = w.extreme ? '<span class="pp-weather-alert">' + escapeHtml(w.label || '') + ' · 请留意天气变化</span>' : '';
        const section = '<section class="pp-weather" data-wtheme="' + theme + '" data-weather="' + scene + '">' + backdrop +
            '<div class="pp-weather-scroll">' +
            top(city, info.status === 'unknown-time' ? '剧情时间不明确' : timeNote, busy) +
            '<div class="pp-weather-hero-copy">' + alert +
            '<strong>' + (w.temp == null ? '—' : Math.round(w.temp) + '°') + '</strong>' +
            '<span class="pp-weather-desc">' + escapeHtml(w.label || weatherType(w.type)) + '</span>' +
            '<small>' + feelsNote + ' · ' + timeNote + '</small></div>' +
            '<div class="pp-weather-art-main" aria-hidden="true">' + weatherArt(w.type) + '</div>' +
            metrics +
            (hours ? '<h3 class="pp-weather-heading">逐小时预报</h3><div class="pp-weather-hours">' + hours + '</div>' + hoursBand : '') +
            (week ? '<h3 class="pp-weather-heading">七天预报</h3><div class="pp-weather-card pp-weather-week">' + week + '</div>' : '') +
            '</div>' + foot(status, busy) + '</section>';
        return section;
    }

    async function action(name) {
        if (name !== 'refresh' || working || getView().busy) return;
        if (!adapter.weather) { status = '请在酒馆中使用天气。'; redraw(); return; }
        const token = epoch; working = true; status = ''; redraw();
        try {
            const result = await adapter.weather.refresh();
            if (token === epoch) status = result?.ok ? '已为当前位置抽取天气。' : (result?.error || '本次未能刷新，请重试。');
        } catch (e) {
            if (token === epoch) status = e.message;
        } finally {
            if (token === epoch) working = false;
            redraw();
        }
    }
    return { html, action, reset() { epoch++; working = false; status = ''; } };
}
