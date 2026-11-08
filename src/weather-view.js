import { weatherScene, weatherType } from './weather.js?v=1.2';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Soft scene art per weather family; the page background follows the same key.
const SCENE_ICONS = {
    clear: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5 5l1.6 1.6M17.4 17.4 19 19M19 5l-1.6 1.6M6.6 17.4 5 19"/>',
    cloud: '<path d="M7 18h10a3.6 3.6 0 1 0-1.2-7A5.2 5.2 0 0 0 5.4 13 2.8 2.8 0 0 0 7 18Z"/>',
    rain: '<path d="M7 15h10a3.6 3.6 0 1 0-1.2-7A5.2 5.2 0 0 0 5.4 10 2.8 2.8 0 0 0 7 15Z"/><path d="m8 18-1 3m4-3-1 3m5-3-1 3" stroke-width="1.8"/>',
    snow: '<path d="M7 15h10a3.6 3.6 0 1 0-1.2-7A5.2 5.2 0 0 0 5.4 10 2.8 2.8 0 0 0 7 15Z"/><path d="M8 19.5h.01M12 21.5h.01M16 19.5h.01" stroke-width="2.6"/>',
    wind: '<path d="M3 8h9a2.5 2.5 0 1 0-2.4-3.2M3 12h13a2.8 2.8 0 1 1-2.7 3.6M3 16h7"/>',
    typhoon: '<path d="M12 3a9 9 0 1 0 9 9 7 7 0 1 1-7-7 5 5 0 1 0 5 5"/>',
    extreme: '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 10v4.5M12 17.5h.01" stroke-width="2"/>',
};

const sceneIcon = (scene, size = 72) => '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (SCENE_ICONS[scene] || SCENE_ICONS.cloud) + '</svg>';

const monthDay = date => { const m = /-(\d{2})-(\d{2})$/.exec(String(date || '')); return m ? +m[1] + '/' + +m[2] : ''; };

export function createWeatherPanel({ adapter, getView, redraw }) {
    let working = false, status = '', epoch = 0;

    function html() {
        // getView() returns the flat phone snapshot (location/weather at the top
        // level, no .state wrapper) merged with runtime fields like busy.
        const view = getView(), state = view || {};
        const busy = working || view.busy;
        const info = adapter.weather?.report(state);
        if (!info) return '<section class="pp-weather" data-weather="cloud"><div class="pp-weather-pending"><span>☁</span><p>天气待刷新</p></div></section>';
        const city = escapeHtml(info.city || '');
        if (info.status === 'no-location') {
            return '<section class="pp-weather" data-weather="cloud"><header class="pp-weather-city"><small>当前位置</small><h2>尚未标记</h2></header>' +
                '<div class="pp-weather-pending"><span>☁</span><p>正文尚未明确当前城市。<br>等待剧情标记位置后可刷新天气。</p></div>' +
                actions(busy) + statusLine(status) + '</section>';
        }
        if (info.status === 'pending') {
            return '<section class="pp-weather" data-weather="cloud"><header class="pp-weather-city"><small>当前位置</small><h2>' + city + '</h2></header>' +
                '<div class="pp-weather-pending"><span>☁</span><p>天气待刷新</p><small>点击下方按钮，为' + city + '生成当前天气</small></div>' +
                actions(busy) + statusLine(status) + '</section>';
        }
        if (info.status === 'unknown-time') {
            const w = info.weather || {};
            const scene = weatherScene(w.type);
            return '<section class="pp-weather" data-weather="' + scene + '"><header class="pp-weather-city"><small>当前位置</small><h2>' + city + '</h2></header>' +
                hero(scene, w, weatherType(w.type)) +
                grid({ feels: null, precip: null, wind: w.wind, humidity: w.humidity }) +
                '<div class="pp-weather-clock">剧情时间不明确 · 显示刷新时的天气（' + escapeHtml(info.date || '') + '）</div>' +
                actions(busy) + statusLine(status) + '</section>';
        }
        const r = info.report || {};
        const scene = weatherScene(r.type);
        return '<section class="pp-weather" data-weather="' + scene + '"><header class="pp-weather-city"><small>当前位置</small><h2>' + city + '</h2></header>' +
            hero(scene, r, r.label) +
            grid({ feels: r.feels, precip: r.precip, wind: r.wind, humidity: r.humidity }) +
            (info.forecast ? hoursStrip(info.forecast) + forecastList(info.forecast) : '') +
            '<div class="pp-weather-clock">剧情时间 ' + escapeHtml((r.date || '').replaceAll('-', ' / ') + ' ' + (r.time || '')) + '</div>' +
            actions(busy) + statusLine(status) + '</section>';
    }

    function hoursStrip(forecast) {
        const today = forecast.days[0];
        return '<div class="pp-weather-hours">' + today.hours.map(h =>
            '<span class="pp-weather-hour"><i>' + String(h.hour).padStart(2, '0') + '</i><b>' + Math.round(h.temp) + '°</b></span>').join('') + '</div>';
    }

    function forecastList(forecast) {
        return '<div class="pp-weather-days">' + forecast.days.map(d =>
            '<div class="pp-weather-day' + (d.today ? ' pp-weather-day-now' : '') + '">' +
            '<span class="pp-weather-day-date"><b>' + (d.today ? '今天' : monthDay(d.date)) + '</b><i>' + d.weekday + '</i></span>' +
            '<span class="pp-weather-day-icon">' + sceneIcon(d.scene, 22) + '</span>' +
            '<span class="pp-weather-day-desc">' + (d.extreme ? '<em title="极端天气">⚠</em>' : '') + escapeHtml(d.label) + '</span>' +
            '<span class="pp-weather-day-stats"><b>' + d.hi + '°</b><i>' + d.lo + '°</i><i>降水' + d.precip + '% · 风' + d.wind + '级</i></span>' +
            '</div>').join('') + '</div>';
    }

    function hero(scene, w, label) {
        return '<div class="pp-weather-hero"><span class="pp-weather-icon">' + sceneIcon(scene) + '</span><span class="pp-weather-temp">' + (w.temp == null ? '—' : Math.round(w.temp) + '°') + '</span><span class="pp-weather-label">' + escapeHtml(label || '') + '</span></div>';
    }
    function grid(r) {
        const precip = r.precip == null || r.precip === 0 ? '暂无降水' : r.precip + ' mm/h';
        return '<div class="pp-weather-grid">' +
            '<div><small>体感温度</small><b>' + (r.feels == null ? '—' : Math.round(r.feels) + '°C') + '</b></div>' +
            '<div><small>降水情况</small><b>' + precip + '</b></div>' +
            '<div><small>风力</small><b>' + (r.wind == null ? '—' : r.wind + ' 级') + '</b></div>' +
            '<div><small>湿度</small><b>' + (r.humidity == null ? '—' : Math.round(r.humidity) + '%') + '</b></div>' +
            '</div>';
    }
    function actions(busy) {
        return '<div class="pp-weather-actions"><button type="button" class="pp-weather-refresh" data-weather-action="refresh"' + (busy ? ' disabled' : '') + '>' + (busy ? '正在刷新…' : '刷新天气') + '</button></div>';
    }
    function statusLine(text) {
        return text ? '<p class="pp-weather-status" role="status">' + escapeHtml(text) + '</p>' : '';
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
