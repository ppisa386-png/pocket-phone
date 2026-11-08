import { weatherScene, weatherType, weatherExtreme } from './weather.js?v=1.2';
import { sceneIcon, sceneBackdrop, metricIcon } from './weather-art.js?v=1.2';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// 主题只根据手机本地时间计算；不写入天气数据或存档。
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

const PIN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>';
const MINI_REFRESH = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11A8 8 0 1 0 18.9 15M20 5v6h-6"/></svg>';
const ARROW = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';

const metric = (name, label, value) =>
    '<div class="pp-weather-metric pp-weather-metric-' + name + '">' +
    '<span class="pp-weather-metric-icon" aria-hidden="true">' + metricIcon(name) + '</span>' +
    '<small>' + label + '</small><b>' + escapeHtml(value) + '</b></div>';

function upcomingHours(forecast, nowHour) {
    const days = forecast?.days || [];
    const today = days[0]?.hours || [];
    const tomorrow = days[1]?.hours || [];
    if (nowHour == null) return today.slice(0, 6).map((h, i) => ({ ...h, isNow: false }));
    const index = today.findIndex(h => Number(h.hour) === nowHour);
    if (index < 0) return today.slice(0, 6).map(h => ({ ...h, isNow: false }));
    return [...today.slice(index), ...tomorrow].slice(0, 6).map((h, i) => ({ ...h, isNow: i === 0 }));
}

function temperatureCurve(hours) {
    if (!hours || hours.length < 2) return '';
    const values = hours.map(h => Number(h.temp) || 0);
    const low = Math.min(...values), high = Math.max(...values), span = Math.max(1, high - low);
    const points = values.map((v, i) => {
        const x = 12 + i * (276 / (values.length - 1));
        const y = 25 - ((v - low) / span) * 15;
        return [x, y];
    });
    const path = points.map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)).join(' ');
    return '<svg class="pp-weather-band" viewBox="0 0 300 38" preserveAspectRatio="none" aria-hidden="true">' +
        '<path d="' + path + '" fill="none" stroke="var(--w-curve)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
        points.map(([x, y]) => '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="2.7" fill="var(--w-curve)"/>').join('') +
        '</svg>';
}

export function createWeatherPanel({ adapter, getView, redraw, notice, editLocation, now = () => new Date() }) {
    let working = false, status = '', epoch = 0;

    function top(cityName, busy) {
        return '<header class="pp-weather-top">' +
            '<div class="pp-weather-loc" data-press="weather-location" tabindex="0" title="长按修改地点"><span class="pp-weather-pin" aria-hidden="true">' + PIN + '</span>' +
            '<b>' + escapeHtml(cityName) + '</b><span class="pp-weather-loc-chevron" aria-hidden="true">⌄</span></div>' +
            '<button type="button" class="pp-weather-mini-refresh' + (busy ? ' is-busy' : '') + '" data-weather-action="refresh" aria-label="刷新天气" title="刷新天气"' + (busy ? ' disabled' : '') + '>' + MINI_REFRESH + '</button>' +
            '</header>';
    }

    function hero(w, theme, city, busy, emptyText = '', emptyNote = '') {
        const type = w?.type || 'partly';
        const temp = w?.temp == null ? '—' : Math.round(w.temp);
        const label = w?.label || (w?.type ? weatherType(w.type) : emptyText || '天气待更新');
        const feels = w?.feels == null ? (w?.temp == null ? '—' : Math.round(w.temp)) : Math.round(w.feels);
        const extreme = !!(w?.extreme || weatherExtreme(type));
        const alert = extreme ? '<span class="pp-weather-alert">' + escapeHtml(label) + '</span>' : '';
        // 抬头一体：天气照片作为 hero 的背景层（inset:0 全铺），城市导航、温度与天气信息
        // 直接叠加在照片之上；照片底部经渐变融入页面背景顶色（--w-scene-merge），分界线不可见。
        return '<section class="pp-weather-hero">' +
            '<div class="pp-weather-backdrop" aria-hidden="true">' + sceneBackdrop(type, theme) + '</div>' +
            top(city, busy) +
            '<div class="pp-weather-hero-copy">' + alert +
            '<strong><span>' + temp + '</span><i>°C</i></strong>' +
            '<b class="pp-weather-desc">' + escapeHtml(label) + '</b>' +
            (w?.temp == null ? '<small class="pp-weather-hero-note">' + escapeHtml(emptyNote) + '</small>' : '<small class="pp-weather-hero-note">体感 ' + feels + '</small>') +
            '</div>' +
            '</section>';
    }

    function statusMarkup() {
        return status ? '<p class="pp-weather-status" role="status">' + escapeHtml(status) + '</p>' : '';
    }

    function emptyPage(theme, city, busy, title, note) {
        return '<section class="pp-weather" data-wtheme="' + theme + '" data-weather="cloud">' +
            '<div class="pp-weather-scroll">' +
            '<div class="pp-weather-scene">' + hero(null, theme, city, busy, title, note) + '</div>' +
            statusMarkup() +
            '</div></section>';
    }

    function html() {
        const view = getView() || {};
        const busy = working || !!view.busy;
        const info = adapter.weather?.report(view);
        const theme = themeFor(now());

        if (!info) return emptyPage(theme, '天气', busy, '天气待更新', '暂时无法读取天气。');
        if (info.status === 'no-location') return emptyPage(theme, '尚未标记位置', busy, '等待定位', '还不知道你在哪里，点击右上角试试。');

        const city = info.city || '';
        if (info.status === 'pending') return emptyPage(theme, info.city || '天气', busy, '天气待更新', '为 ' + (info.city || '当前位置') + ' 更新天气。');

        const w = info.report || info.weather || {};
        const type = w.type || 'partly';
        const family = weatherScene(type);
        const feels = w.feels == null ? (w.temp == null ? '—' : Math.round(w.temp) + '°C') : Math.round(w.feels) + '°C';
        const precip = w.precip == null ? '—' : Number(w.precip).toFixed(1).replace(/\.0$/, '') + ' mm/h';
        const wind = w.wind == null ? '—' : w.wind + ' 级';
        const humidity = w.humidity == null ? '—' : Math.round(w.humidity) + '%';

        const metrics = '<section class="pp-weather-metrics" aria-label="天气指标">' +
            metric('feels', '体感温度', feels) +
            metric('precip', '降水情况', precip) +
            metric('wind', '风力', wind) +
            metric('humidity', '湿度', humidity) +
            '</section>';

        const nowHour = info.clock?.hour == null ? null : Math.floor(info.clock.hour);
        const hours = upcomingHours(info.forecast, nowHour);
        const hourly = hours.length ? '<section class="pp-weather-hourly">' +
            '<h3 class="pp-weather-heading">逐小时预报</h3>' +
            '<div class="pp-weather-hourly-card">' +
            '<div class="pp-weather-hours">' + hours.map(h =>
                '<div class="pp-weather-hour' + (h.isNow ? ' pp-weather-hour-now' : '') + '">' +
                '<i>' + (h.isNow ? '现在' : String(h.hour).padStart(2, '0') + '时') + '</i>' +
                '<span aria-hidden="true">' + sceneIcon(weatherScene(h.type), 25) + '</span>' +
                '<b>' + Math.round(h.temp) + '°</b></div>'
            ).join('') + '</div>' +
            (theme === 'apricot' ? temperatureCurve(hours) : '') +
            '</div></section>' : '';

        const days = info.forecast?.days || [];
        const week = days.length ? '<section class="pp-weather-week-section">' +
            '<h3 class="pp-weather-heading">未来几天</h3>' +
            '<div class="pp-weather-week">' + days.map(d => {
                const weekday = d.today ? '今天' : String(d.weekday || '').replace('星期', '周');
                const label = d.label || weatherType(d.type);
                return '<article class="pp-weather-day' + (d.today ? ' pp-weather-day-now' : '') + (d.extreme ? ' pp-weather-day-extreme' : '') + '">' +
                    '<span class="pp-weather-day-date">' + escapeHtml(weekday) + '</span>' +
                    '<span class="pp-weather-day-icon" aria-hidden="true">' + sceneIcon(d.scene || weatherScene(d.type), 24) + '</span>' +
                    '<span class="pp-weather-day-desc">' + (d.extreme ? '<em aria-label="极端天气">!</em>' : '') + escapeHtml(label) + '</span>' +
                    '<span class="pp-weather-day-temp"><b>' + Math.round(d.hi) + '°</b><i>' + Math.round(d.lo) + '°</i></span>' +
                    (d.extreme ? '<small class="pp-weather-day-warn">预计' + escapeHtml(d.extremeSpan || '全天') + '：' + escapeHtml(d.extremeLabel || label) + '（' + escapeHtml(d.extremeStrength || '显著') + '）</small>' : '') +
                    '</article>';
            }).join('') + '</div></section>' : '';

        return '<section class="pp-weather" data-wtheme="' + theme + '" data-weather="' + family + '">' +
            '<div class="pp-weather-scroll">' +
            '<div class="pp-weather-scene">' +
            hero(w, theme, city, busy) +
            '</div>' +
            statusMarkup() + metrics + hourly + week +
            '</div></section>';
    }

    function press(target) {
        if(target?.dataset?.press!=='weather-location')return [];
        const view=getView(),busy=working||!!view?.busy;
        const city=view?.location?.current?.city||'';
        return [{icon:'edit',label:'修改地点',disabled:busy,run:()=>editLocation?.(city)}];
    }

    async function action(name) {
        if (name !== 'refresh' || working || getView()?.busy) return;
        if (!adapter.weather) { status = '暂时无法更新天气。'; redraw(); return; }
        const token = epoch;
        working = true;
        status = '';
        redraw();
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
