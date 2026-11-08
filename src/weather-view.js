import { weatherScene, weatherType, weatherExtreme } from './weather.js?v=1.2';

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

const SCENE_ICONS = {
    clear: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5 5l1.6 1.6M17.4 17.4 19 19M19 5l-1.6 1.6M6.6 17.4 5 19"/>',
    cloud: '<path d="M7 18h10a3.6 3.6 0 1 0-1.2-7A5.2 5.2 0 0 0 5.4 13 2.8 2.8 0 0 0 7 18Z"/>',
    rain: '<path d="M7 15h10a3.6 3.6 0 1 0-1.2-7A5.2 5.2 0 0 0 5.4 10 2.8 2.8 0 0 0 7 15Z"/><path d="m8 18-1 3m4-3-1 3m5-3-1 3" stroke-width="1.8"/>',
    snow: '<path d="M7 15h10a3.6 3.6 0 1 0-1.2-7A5.2 5.2 0 0 0 5.4 10 2.8 2.8 0 0 0 7 15Z"/><path d="M8 19.5h.01M12 21.5h.01M16 19.5h.01" stroke-width="2.6"/>',
    wind: '<path d="M3 8h9a2.5 2.5 0 1 0-2.4-3.2M3 12h13a2.8 2.8 0 1 1-2.7 3.6M3 16h7"/>',
    typhoon: '<path d="M12 3a9 9 0 1 0 9 9 7 7 0 1 1-7-7 5 5 0 1 0 5 5"/>',
    extreme: '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 10v4.5M12 17.5h.01" stroke-width="2"/>',
};
const sceneIcon = (scene, size = 22) => '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (SCENE_ICONS[scene] || SCENE_ICONS.cloud) + '</svg>';

// 主视觉天气插画：柔和现代图形，颜色随昼夜主题变量变化，不用吉祥物。
const CLOUD_PARTS = '<circle cx="40" cy="52" r="16" fill="var(--w-cloud)"/><circle cx="60" cy="56" r="13" fill="var(--w-cloud)"/><rect x="28" y="52" width="42" height="17" rx="8.5" fill="var(--w-cloud)"/>';
const ART = {
    sunny: '<circle cx="48" cy="48" r="19" fill="var(--w-art)"/><g stroke="var(--w-art-deep)" stroke-width="3.4" stroke-linecap="round"><path d="M48 13v8.5M48 74.5V83M13 48h8.5M74.5 48H83M24.2 24.2l6 6M65.8 65.8l6 6M71.8 24.2l-6 6M30.2 65.8l-6 6"/></g>',
    partly: '<circle cx="61" cy="37" r="13" fill="var(--w-art)"/><g stroke="var(--w-art-deep)" stroke-width="3" stroke-linecap="round"><path d="M61 13.5v6.5M79.5 37H86M75.3 22.7l4.6-4.6M46.7 22.7l4.6 4.6"/></g>' + CLOUD_PARTS,
    cloud: '<circle cx="38" cy="46" r="14" fill="var(--w-cloud)" opacity=".75"/><circle cx="58" cy="42" r="17" fill="var(--w-art)" opacity=".55"/><circle cx="47" cy="58" r="15" fill="var(--w-cloud)"/><rect x="30" y="55" width="40" height="18" rx="9" fill="var(--w-cloud)"/>',
    fog: CLOUD_PARTS + '<g stroke="var(--w-art-deep)" stroke-width="3.2" stroke-linecap="round"><path d="M28 78h40M36 87h24"/></g>',
    rain: CLOUD_PARTS + '<g stroke="var(--w-art-deep)" stroke-width="3" stroke-linecap="round"><path d="M36 78l-2.6 8M48 78l-2.6 8M60 78l-2.6 8"/></g>',
    thunder: CLOUD_PARTS + '<path d="M50 72 40 88h9l-4 12 15-19h-9l5-9Z" fill="var(--w-warn)" stroke="none"/>',
    snow: CLOUD_PARTS + '<g fill="var(--w-art-deep)" stroke="none"><circle cx="36" cy="80" r="2.6"/><circle cx="48" cy="86" r="2.6"/><circle cx="60" cy="80" r="2.6"/></g>',
    wind: '<g fill="none" stroke="var(--w-art)" stroke-width="4" stroke-linecap="round"><path d="M14 38h44a9 9 0 1 0-8.6-11.7"/><path d="M14 56h56a10 10 0 1 1-9.6 12.9"/><path d="M20 74h26"/></g>',
    typhoon: '<g fill="none" stroke="var(--w-art)" stroke-width="5" stroke-linecap="round"><path d="M74 30A30 30 0 1 0 78 48"/><path d="M78 48a14 14 0 1 0-14 14"/></g><circle cx="64" cy="62" r="4.5" fill="var(--w-art-deep)" stroke="none"/>',
    warn: '<path d="M48 16 12 76h72L48 16Z" fill="none" stroke="var(--w-warn)" stroke-width="4" stroke-linejoin="round"/><path d="M48 40v18" stroke="var(--w-warn)" stroke-width="4.5" stroke-linecap="round"/><circle cx="48" cy="66" r="2.8" fill="var(--w-warn)" stroke="none"/>',
};
const ART_OF = { sunny: 'sunny', partly: 'partly', overcast: 'cloud', fog: 'fog', drizzle: 'rain', rain: 'rain', heavy: 'rain', storm: 'rain', thunder: 'thunder', severe: 'thunder', sleet: 'snow', lightsnow: 'snow', snow: 'snow', heavysnow: 'snow', blizzard: 'snow', windy: 'wind', dust: 'warn', heat: 'sunny', cold: 'snow', hail: 'warn', typhoon: 'typhoon' };
const weatherArt = type => '<svg viewBox="0 0 96 96" width="112" height="112" aria-hidden="true">' + (ART[ART_OF[type]] || ART.cloud) + '</svg>';

const PIN = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11Z"/><circle cx="12" cy="10" r="2.4"/></svg>';
const MINI_REFRESH = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11A8 8 0 1 0 18.9 15M20 5v6h-6"/></svg>';
const METRIC_ICONS = {
    feels: '<path d="M10.2 13.7V5.4a1.8 1.8 0 1 1 3.6 0v8.3a4 4 0 1 1-3.6 0Z"/><path d="M12 16.8h.01" stroke-width="2.4"/>',
    precip: '<path d="M12 3.6c3 3.5 5.4 6.4 5.4 9.2a5.4 5.4 0 1 1-10.8 0C6.6 10 9 7.1 12 3.6Z"/>',
    wind: '<path d="M3.5 9.5h9a2.4 2.4 0 1 0-2.3-3.1M3.5 13.5h13a2.7 2.7 0 1 1-2.6 3.5M3.5 17.5h7"/>',
    humidity: '<path d="M3.5 14.5c2-1.6 4-1.6 6 0s4 1.6 6 0 3.4-1.3 4.5-.6M3.5 9.8c2-1.6 4-1.6 6 0s4 1.6 6 0 3.4-1.3 4.5-.6"/>',
};
const metricIcon = name => '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + METRIC_ICONS[name] + '</svg>';

const metricCard = (cls, iconName, label, value) => '<div class="pp-weather-metric ' + cls + '"><span class="pp-weather-metric-icon" aria-hidden="true">' + metricIcon(iconName) + '</span><small>' + label + '</small><b>' + value + '</b></div>';

export function createWeatherPanel({ adapter, getView, redraw, notice, now = () => new Date() }) {
    let working = false, status = '', epoch = 0;

    function hero(copy, art, alertLabel = '') {
        return '<div class="pp-weather-hero' + (alertLabel ? ' pp-weather-hero-alert' : '') + '">' +
            (alertLabel ? '<span class="pp-weather-alert">' + escapeHtml(alertLabel) + '</span>' : '') +
            '<div class="pp-weather-hero-copy">' + copy + '</div>' +
            '<div class="pp-weather-art" aria-hidden="true">' + art + '</div></div>';
    }
    function heroCopy(temp, label, note) {
        return '<strong>' + temp + '</strong><span class="pp-weather-desc">' + escapeHtml(label) + '</span><small>' + escapeHtml(note) + '</small>';
    }
    function refreshButton(busy) {
        return '<button type="button" class="pp-weather-refresh" data-weather-action="refresh"' + (busy ? ' disabled' : '') + '>' + (busy ? '正在刷新…' : '刷新天气') + '</button>';
    }
    function top(cityName, cityNote, busy, refreshable = true) {
        return '<header class="pp-weather-top"><div class="pp-weather-loc"><span class="pp-weather-pin" aria-hidden="true">' + PIN + '</span><div class="pp-weather-loc-text"><b>' + escapeHtml(cityName) + '</b><small>' + escapeHtml(cityNote) + '</small></div></div>' +
            (refreshable ? '<button type="button" class="pp-weather-mini-refresh" data-weather-action="refresh" aria-label="刷新天气"' + (busy ? ' disabled' : '') + '>' + MINI_REFRESH + '</button>' : '') + '</header>';
    }
    function foot(statusText, busy) {
        return '<footer class="pp-weather-foot"><p class="pp-weather-status" role="status">' + escapeHtml(statusText) + '</p>' + refreshButton(busy) + '</footer>';
    }

    function html() {
        const view = getView(), state = view || {};
        const busy = working || view.busy;
        const info = adapter.weather?.report(state);
        const theme = themeFor(now());
        if (!info) return '<section class="pp-weather" data-wtheme="' + theme + '" data-weather="cloud"><div class="pp-weather-card pp-weather-note-card"><p>天气待刷新</p></div>' + foot('', busy) + '</section>';
        if (info.status === 'no-location') {
            return '<section class="pp-weather" data-wtheme="' + theme + '" data-weather="cloud">' +
                top('尚未标记位置', '天气会跟随剧情所在的城市', busy) +
                hero(heroCopy('—', '等待你的位置', '让正文提到所在城市，或点击刷新自动判断'), '<svg viewBox="0 0 96 96" width="112" height="112" aria-hidden="true">' + ART.cloud + '</svg>') +
                '<div class="pp-weather-card pp-weather-hint-card"><p>标记位置后，这里会展示当前天气、逐小时和七天预报。</p></div>' +
                foot(status, busy) + '</section>';
        }
        const city = escapeHtml(info.city || '');
        if (info.status === 'pending') {
            return '<section class="pp-weather" data-wtheme="' + theme + '" data-weather="cloud">' +
                top(city, '天气待刷新', busy) +
                hero(heroCopy('—', '天气待刷新', '点击下方按钮，为' + city + '抽取当前天气'), weatherArt('partly')) +
                foot(status, busy) + '</section>';
        }
        const w = info.report || {};
        const scene = weatherScene(w.type);
        const clockHour = info.clock?.hour;
        const nowHour = clockHour == null ? null : Math.floor(clockHour);
        const clockNote = info.status === 'unknown-time'
            ? '剧情时间不明确 · 显示 ' + escapeHtml(info.date || '') + ' 刷新时的天气'
            : escapeHtml((w.date || '') + ' ' + (w.time || ''));
        const metrics = '<div class="pp-weather-metrics">' +
            metricCard('pp-weather-metric-lav', 'feels', '体感温度', w.feels == null ? '—' : Math.round(w.feels) + '°C') +
            metricCard('pp-weather-metric-apri', 'precip', '降水情况', w.precip == null || w.precip === 0 ? '暂无降水' : w.precip + ' mm/h') +
            metricCard('pp-weather-metric-sage', 'wind', '风力', w.wind == null ? '—' : w.wind + ' 级') +
            metricCard('pp-weather-metric-butter', 'humidity', '湿度', w.humidity == null ? '—' : Math.round(w.humidity) + '%') + '</div>';
        const hours = (info.forecast?.days?.[0]?.hours || []).map(h =>
            '<div class="pp-weather-hour' + (nowHour === h.hour ? ' pp-weather-hour-now' : '') + '"><i>' + String(h.hour).padStart(2, '0') + '时</i><span aria-hidden="true">' + sceneIcon(weatherScene(h.type), 19) + '</span><b>' + Math.round(h.temp) + '°</b></div>').join('');
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
        const alert = w.extreme ? '⚠ ' + escapeHtml(w.label || '') + ' · 请留意天气变化' : '';
        const section = '<section class="pp-weather" data-wtheme="' + theme + '" data-weather="' + scene + '">' +
            top(city, info.status === 'unknown-time' ? '剧情时间不明确' : '剧情时间 ' + escapeHtml((w.date || '') + ' ' + (w.time || '')), busy) +
            '<div class="pp-weather-scroll">' +
            hero(heroCopy(w.temp == null ? '—' : Math.round(w.temp) + '°', w.label || weatherType(w.type), clockNote), weatherArt(w.type), alert) +
            metrics +
            (hours ? '<h3 class="pp-weather-heading">逐小时</h3><div class="pp-weather-hours">' + hours + '</div>' : '') +
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
