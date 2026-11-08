import { weatherScene, weatherType, weatherExtreme } from './weather.js?v=1.2.6';
import { sceneIcon, sceneBackdrop, metricIcon, weatherPhoto } from './weather-art.js?v=1.2.12';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// The old public theme contract stays intact; the story's hour is preferred
// when it is known, so this fictional weather follows fictional story time.
export function themeFor(date = new Date()) {
    const hour = date.getHours();
    return hour >= 6 && hour < 16 ? 'mist' : hour >= 16 && hour < 20 ? 'apricot' : 'night';
}
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
export function themeForStory(clock, now = new Date()) {
    if (!Number.isFinite(Number(clock?.hour)) || clock?.hour == null) return themeFor(now);
    const simulated = new Date(now);
    simulated.setHours(Math.max(0, Math.min(23, Math.floor(Number(clock.hour)))), 0, 0, 0);
    return themeFor(simulated);
}

const PIN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>';
const MINI_REFRESH = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11A8 8 0 1 0 18.9 15M20 5v6h-6"/></svg>';
const CLOCK = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></svg>';
const CALENDAR = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/></svg>';

const metric = (name, label, value, note = '') =>
    '<article class="pp-weather-metric pp-weather-metric-' + name + '">' +
    '<div class="pp-weather-metric-caption"><span class="pp-weather-metric-icon" aria-hidden="true">' + metricIcon(name) + '</span><small>' + label + '</small></div>' +
    '<b>' + escapeHtml(value) + '</b>' + (note ? '<span class="pp-weather-metric-note">' + escapeHtml(note) + '</span>' : '') + '</article>';

export function upcomingHours(forecast, nowHour) {
    const today = forecast?.days?.[0]?.hours || [];
    const tomorrow = forecast?.days?.[1]?.hours || [];
    if (!Number.isInteger(nowHour) || nowHour < 0 || nowHour > 23)
        return today.slice(0, 24).map(h => ({ ...h, isNow: false }));
    const first = today.findIndex(h => Number(h.hour) === nowHour);
    if (first < 0) return today.slice(0, 24).map(h => ({ ...h, isNow: false }));
    return [...today.slice(first), ...tomorrow].slice(0, 24).map((h, i) => ({ ...h, isNow: i === 0 }));
}

function rangeStyle(day, low, span) {
    const left = Math.max(0, Math.min(100, ((Number(day.lo) - low) / span) * 100));
    const right = Math.max(left, Math.min(100, ((Number(day.hi) - low) / span) * 100));
    return 'left:' + left.toFixed(1) + '%;width:' + Math.max(4, right - left).toFixed(1) + '%';
}

export function createWeatherPanel({ adapter, getView, redraw, notice, editLocation, now = () => new Date(), assetBase = 'assets/weather/' }) {
    let working = false, status = '', epoch = 0;

    function top(cityName, busy) {
        return '<header class="pp-weather-top">' +
            '<div class="pp-weather-loc" data-press="weather-location" tabindex="0" role="button" aria-label="长按修改天气地点" title="长按修改地点"><span class="pp-weather-pin" aria-hidden="true">' + PIN + '</span>' +
            '<b>' + escapeHtml(cityName) + '</b><span class="pp-weather-loc-chevron" aria-hidden="true">⌄</span></div>' +
            '<button type="button" class="pp-weather-mini-refresh' + (busy ? ' is-busy' : '') + '" data-weather-action="refresh" aria-label="刷新天气" title="刷新天气"' + (busy ? ' disabled' : '') + '>' + MINI_REFRESH + '</button>' +
            '</header>';
    }

    function hero(w, theme, city, busy, today = null, emptyText = '', emptyNote = '') {
        const type = w?.type || 'partly';
        const temp = w?.temp == null ? '—' : Math.round(w.temp);
        const label = w?.label || (w?.type ? weatherType(w.type) : emptyText || '天气待更新');
        const feels = w?.feels == null ? (w?.temp == null ? '—' : Math.round(w.temp)) : Math.round(w.feels);
        const extreme = !!(w?.extreme || weatherExtreme(type));
        const alert = extreme ? '<span class="pp-weather-alert">' + escapeHtml(label) + '</span>' : '';
        const highs = today && Number.isFinite(Number(today.hi)) && Number.isFinite(Number(today.lo))
            ? '<div class="pp-weather-highlow">最高 ' + Math.round(today.hi) + '° / 最低 ' + Math.round(today.lo) + '°</div>' : '';
        return '<section class="pp-weather-hero">' + top(city, busy) +
            '<div class="pp-weather-hero-copy">' + alert +
            '<strong><span>' + temp + '</span><i>°</i></strong>' +
            '<b class="pp-weather-desc">' + escapeHtml(label) + '</b>' +
            highs +
            (w?.temp == null ? '<small class="pp-weather-hero-note">' + escapeHtml(emptyNote) + '</small>'
                : '<small class="pp-weather-hero-note">体感温度 ' + feels + '°</small>') +
            '</div></section>';
    }

    function background(type, theme) {
        const photo = weatherPhoto(type, theme);
        return '<div class="pp-weather-background" aria-hidden="true">' + sceneBackdrop(type, theme, assetBase) + '</div>';
    }
    const statusMarkup = () => status ? '<p class="pp-weather-status" role="status">' + escapeHtml(status) + '</p>' : '';

    function emptyPage(theme, city, busy, title, note) {
        return '<section class="pp-weather" data-wtheme="' + theme + '" data-weather="cloud" data-photo="' + weatherPhoto('partly', theme) + '">' +
            background('partly', theme) + '<div class="pp-weather-scroll"><div class="pp-weather-scene">' +
            hero(null, theme, city, busy, null, title, note) + '</div>' + statusMarkup() + '</div></section>';
    }

    function html() {
        const view = getView() || {};
        const busy = working || !!view.busy;
        const info = adapter.weather?.report(view);
        const theme = themeForStory(info?.clock, now());
        if (!info) return emptyPage(theme, '天气', busy, '天气待更新', '暂时无法读取天气。');
        if (info.status === 'no-location') return emptyPage(theme, '尚未标记位置', busy, '等待定位', '请刷新天气或长按地点手动修改。');
        if (info.status === 'pending') return emptyPage(theme, info.city || '天气', busy, '天气待更新', '为 ' + (info.city || '当前位置') + ' 更新天气。');

        const city = info.city || '天气';
        const w = info.report || info.weather || {};
        const type = w.type || 'partly';
        const family = weatherScene(type);
        const photo = weatherPhoto(type, theme);
        const today = info.forecast?.days?.[0] || null;
        const feels = w.feels == null ? (w.temp == null ? '—' : Math.round(w.temp) + '°') : Math.round(w.feels) + '°';
        const precip = w.precip == null ? '—' : Number(w.precip).toFixed(1).replace(/\.0$/, '') + ' 毫米/时';
        const wind = w.wind == null ? '—' : w.wind + ' 级';
        const humidity = w.humidity == null ? '—' : Math.round(w.humidity) + '%';

        const hours = upcomingHours(info.forecast, info.clock?.hour == null ? null : Math.floor(info.clock.hour));
        const hourly = hours.length ? '<section class="pp-weather-hourly">' +
            '<h3 class="pp-weather-heading">' + CLOCK + '<span>24小时天气</span></h3>' +
            '<div class="pp-weather-hourly-card"><div class="pp-weather-hours">' + hours.map(h =>
                '<div class="pp-weather-hour' + (h.isNow ? ' pp-weather-hour-now' : '') + '">' +
                '<i>' + (h.isNow ? '现在' : String(h.hour).padStart(2, '0') + '时') + '</i>' +
                '<span aria-hidden="true">' + sceneIcon(weatherScene(h.type), 28) + '</span>' +
                '<b>' + Math.round(h.temp) + '°</b></div>'
            ).join('') + '</div></div></section>' : '';

        const days = info.forecast?.days || [];
        const lows = days.map(d => Number(d.lo)).filter(Number.isFinite), highs = days.map(d => Number(d.hi)).filter(Number.isFinite);
        const low = lows.length ? Math.min(...lows) : 0, span = Math.max(1, highs.length ? Math.max(...highs) - low : 1);
        const week = days.length ? '<section class="pp-weather-week-section">' +
            '<h3 class="pp-weather-heading">' + CALENDAR + '<span>未来' + days.length + '天天气预报</span></h3>' +
            '<div class="pp-weather-week">' + days.map(d => {
                const weekday = d.today ? '今天' : String(d.weekday || '').replace('星期', '周');
                const label = d.label || weatherType(d.type);
                const high = Math.round(d.hi), lowest = Math.round(d.lo);
                return '<article class="pp-weather-day' + (d.today ? ' pp-weather-day-now' : '') + (d.extreme ? ' pp-weather-day-extreme' : '') + '">' +
                    '<span class="pp-weather-day-date">' + escapeHtml(weekday) + '</span>' +
                    '<span class="pp-weather-day-icon" aria-hidden="true">' + sceneIcon(d.scene || weatherScene(d.type), 27) + '</span>' +
                    '<span class="pp-weather-day-desc">' + (d.extreme ? '<em aria-label="极端天气">!</em>' : '') + escapeHtml(label) + '</span>' +
                    '<span class="pp-weather-day-temp"><i>' + lowest + '°</i><span class="pp-weather-tempbar"><span style="' + rangeStyle(d, low, span) + '"></span></span><b>' + high + '°</b></span>' +
                    (d.extreme ? '<small class="pp-weather-day-warn">预计' + escapeHtml(d.extremeSpan || '全天') + '：' + escapeHtml(d.extremeLabel || label) + '（' + escapeHtml(d.extremeStrength || '显著') + '）</small>' : '') +
                    '</article>';
            }).join('') + '</div></section>' : '';

        const metrics = '<section class="pp-weather-metrics" aria-label="天气指标">' +
            metric('feels', '体感温度', feels, '当前体感') +
            metric('precip', '降水情况', precip, '当前降水强度') +
            metric('wind', '风力', wind, '当前风力等级') +
            metric('humidity', '湿度', humidity, '空气相对湿度') +
            '</section>';

        return '<section class="pp-weather" data-wtheme="' + theme + '" data-weather="' + family + '" data-photo="' + photo + '">' +
            background(type, theme) + '<div class="pp-weather-scroll">' +
            '<div class="pp-weather-scene">' + hero(w, theme, city, busy, today) + '</div>' +
            statusMarkup() + hourly + week + metrics +
            '</div></section>';
    }

    function press(target) {
        if (target?.dataset?.press !== 'weather-location') return [];
        const view = getView(), busy = working || !!view?.busy;
        const city = view?.location?.current?.city || '';
        return [{ icon: 'edit', label: '修改地点', disabled: busy, run: () => editLocation?.(city) }];
    }
    async function action(name) {
        if (name !== 'refresh' || working || getView()?.busy) return;
        if (!adapter.weather) { status = '暂时无法更新天气。'; redraw(); return; }
        const token = epoch;
        working = true; status = ''; redraw();
        try {
            const result = await adapter.weather.refresh();
            if (token === epoch) status = result?.ok ? '天气已更新' : (result?.error || '天气暂时无法更新，请重试。');
        } catch (error) {
            if (token === epoch) status = error?.message || '天气暂时无法更新，请重试。';
        } finally {
            if (token === epoch) working = false;
            redraw();
        }
    }

    return { html, action, press, reset() { epoch++; working = false; status = ''; } };
}
