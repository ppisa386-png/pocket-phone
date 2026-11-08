// 天气视觉素材：大面积云层场景、主视觉图形与线性图标，全部内联 SVG 本地实现。
// 颜色通过 --w-* 主题变量跟随昼夜主题，模块本身不关心当前是哪套主题。
const CLOUD = '<g fill="var(--w-cloud)"><circle cx="40" cy="52" r="16"/><circle cx="60" cy="56" r="13"/><rect x="28" y="52" width="42" height="17" rx="8.5"/></g>';
export const sceneIcon = (scene, size = 22) => {
    const SCENE_ICONS = {
        clear: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5 5l1.6 1.6M17.4 17.4 19 19M19 5l-1.6 1.6M6.6 17.4 5 19"/>',
        cloud: '<path d="M7 18h10a3.6 3.6 0 1 0-1.2-7A5.2 5.2 0 0 0 5.4 13 2.8 2.8 0 0 0 7 18Z"/>',
        rain: '<path d="M7 15h10a3.6 3.6 0 1 0-1.2-7A5.2 5.2 0 0 0 5.4 10 2.8 2.8 0 0 0 7 15Z"/><path d="m8 18-1 3m4-3-1 3m5-3-1 3" stroke-width="1.8"/>',
        snow: '<path d="M7 15h10a3.6 3.6 0 1 0-1.2-7A5.2 5.2 0 0 0 5.4 10 2.8 2.8 0 0 0 7 15Z"/><path d="M8 19.5h.01M12 21.5h.01M16 19.5h.01" stroke-width="2.6"/>',
        wind: '<path d="M3 8h9a2.5 2.5 0 1 0-2.4-3.2M3 12h13a2.8 2.8 0 1 1-2.7 3.6M3 16h7"/>',
        typhoon: '<path d="M12 3a9 9 0 1 0 9 9 7 7 0 1 1-7-7 5 5 0 1 0 5 5"/>',
        extreme: '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 10v4.5M12 17.5h.01" stroke-width="2"/>',
    };
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (SCENE_ICONS[scene] || SCENE_ICONS.cloud) + '</svg>';
};
const ART = {
    sunny: '<circle cx="48" cy="48" r="19" fill="var(--w-art)"/><g stroke="var(--w-art-deep)" stroke-width="3.4" stroke-linecap="round"><path d="M48 13v8.5M48 74.5V83M13 48h8.5M74.5 48H83M24.2 24.2l6 6M65.8 65.8l6 6M71.8 24.2l-6 6M30.2 65.8l-6 6"/></g>',
    partly: '<circle cx="61" cy="37" r="13" fill="var(--w-art)"/><g stroke="var(--w-art-deep)" stroke-width="3" stroke-linecap="round"><path d="M61 13.5v6.5M79.5 37H86M75.3 22.7l4.6-4.6M46.7 22.7l4.6 4.6"/></g>' + CLOUD,
    cloud: '<circle cx="38" cy="46" r="14" fill="var(--w-cloud)" opacity=".75"/><circle cx="58" cy="42" r="17" fill="var(--w-art)" opacity=".55"/><circle cx="47" cy="58" r="15" fill="var(--w-cloud)"/><rect x="30" y="55" width="40" height="18" rx="9" fill="var(--w-cloud)"/>',
    fog: CLOUD + '<g stroke="var(--w-art-deep)" stroke-width="3.2" stroke-linecap="round"><path d="M28 78h40M36 87h24"/></g>',
    rain: CLOUD + '<g stroke="var(--w-art-deep)" stroke-width="3" stroke-linecap="round"><path d="M36 78l-2.6 8M48 78l-2.6 8M60 78l-2.6 8"/></g>',
    thunder: CLOUD + '<path d="M50 72 40 88h9l-4 12 15-19h-9l5-9Z" fill="var(--w-warn)" stroke="none"/>',
    snow: CLOUD + '<g fill="var(--w-art-deep)" stroke="none"><circle cx="36" cy="80" r="2.6"/><circle cx="48" cy="86" r="2.6"/><circle cx="60" cy="80" r="2.6"/></g>',
    wind: '<g fill="none" stroke="var(--w-art)" stroke-width="4" stroke-linecap="round"><path d="M14 38h44a9 9 0 1 0-8.6-11.7"/><path d="M14 56h56a10 10 0 1 1-9.6 12.9"/><path d="M20 74h26"/></g>',
    typhoon: '<g fill="none" stroke="var(--w-art)" stroke-width="5" stroke-linecap="round"><path d="M74 30A30 30 0 1 0 78 48"/><path d="M78 48a14 14 0 1 0-14 14"/></g><circle cx="64" cy="62" r="4.5" fill="var(--w-art-deep)" stroke="none"/>',
    warn: '<path d="M48 16 12 76h72L48 16Z" fill="none" stroke="var(--w-warn)" stroke-width="4" stroke-linejoin="round"/><path d="M48 40v18" stroke="var(--w-warn)" stroke-width="4.5" stroke-linecap="round"/><circle cx="48" cy="66" r="2.8" fill="var(--w-warn)" stroke="none"/>',
};
const ART_OF = { sunny: 'sunny', partly: 'partly', overcast: 'cloud', fog: 'fog', drizzle: 'rain', rain: 'rain', heavy: 'rain', storm: 'rain', thunder: 'thunder', severe: 'thunder', sleet: 'snow', lightsnow: 'snow', snow: 'snow', heavysnow: 'snow', blizzard: 'snow', windy: 'wind', dust: 'warn', heat: 'sunny', cold: 'snow', hail: 'warn', typhoon: 'typhoon' };
export const weatherArt = type => '<svg viewBox="0 0 96 96" width="112" height="112" aria-hidden="true">' + (ART[ART_OF[type]] || ART.cloud) + '</svg>';

export const metricIcon = name => {
    const METRIC_ICONS = {
        feels: '<path d="M10.2 13.7V5.4a1.8 1.8 0 1 1 3.6 0v8.3a4 4 0 1 1-3.6 0Z"/><path d="M12 16.8h.01" stroke-width="2.4"/>',
        precip: '<path d="M12 3.6c3 3.5 5.4 6.4 5.4 9.2a5.4 5.4 0 1 1-10.8 0C6.6 10 9 7.1 12 3.6Z"/>',
        wind: '<path d="M3.5 9.5h9a2.4 2.4 0 1 0-2.3-3.1M3.5 13.5h13a2.7 2.7 0 1 1-2.6 3.5M3.5 17.5h7"/>',
        humidity: '<path d="M3.5 14.5c2-1.6 4-1.6 6 0s4 1.6 6 0 3.4-1.3 4.5-.6M3.5 9.8c2-1.6 4-1.6 6 0s4 1.6 6 0 3.4-1.3 4.5-.6"/>',
    };
    return '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + METRIC_ICONS[name] + '</svg>';
};

function hash(text) { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const fuzz = (id, dev) => '<filter id="' + id + '" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="' + dev + '"/></filter>';
function cloudCluster(x, y, scale, main, deep, night) {
    return '<g transform="translate(' + x + ' ' + y + ') scale(' + scale + ')" filter="url(#w-soft)">' +
        '<ellipse cx="70" cy="34" rx="52" ry="24" fill="' + deep + '"/>' +
        '<ellipse cx="34" cy="44" rx="38" ry="20" fill="' + main + '"/>' +
        '<ellipse cx="86" cy="52" rx="46" ry="22" fill="' + main + '"/>' +
        '<ellipse cx="60" cy="30" rx="30" ry="16" fill="' + main + '"/>' +
        '<ellipse cx="58" cy="24" rx="22" ry="10" fill="#ffffff' + (night ? '14' : '8c') + '"/></g>';
}
// 大面积场景层：铺在页面右上方的写实质感云层与天体。随天气类型与主题变化，
// 颜色全部走 --w-sky 系主题变量；静态 SVG，无外部资源。
export function sceneBackdrop(type, theme = 'apricot') {
    const art = ART_OF[type] || 'cloud';
    const night = theme === 'night';
    const main = 'var(--w-sky-cloud1)', deep = 'var(--w-sky-cloud2)';
    const id = 'w' + hash(type + theme) % 100000;
    const parts = ['<svg class="pp-weather-backdrop-art" viewBox="0 0 400 320" preserveAspectRatio="xMaxYMin slice" aria-hidden="true">', '<defs>' + fuzz('w-soft' + id, 2.2) + fuzz('w-softer' + id, 5) + '</defs>'];
    const soft = 'url(#w-soft' + id + ')', softer = 'url(#w-softer' + id + ')';
    // 大面积柔光晕（主题氛围底光）
    parts.push('<circle cx="330" cy="60" r="120" fill="var(--w-glow)" opacity="' + (night ? '.22' : '.4') + '" filter="' + softer + '"/>');
    // 天体：晴/少云画太阳（夜间换月亮），夜间补星点
    if (art === 'sunny' || art === 'partly') {
        if (night) parts.push('<g filter="' + soft + '"><circle cx="316" cy="72" r="34" fill="var(--w-orb)" opacity=".35"/></g><circle cx="316" cy="72" r="24" fill="var(--w-orb)"/>');
        else parts.push('<g filter="' + softer + '"><circle cx="316" cy="70" r="52" fill="var(--w-orb)" opacity=".5"/></g><circle cx="316" cy="70" r="25" fill="var(--w-orb)"/><g stroke="var(--w-orb)" stroke-width="4" stroke-linecap="round" opacity=".8"><path d="M316 22v14M316 118v-14M268 70h14M364 70h-14M281 35l10 10M351 105l-10-10M351 35l-10 10M281 105l10-10"/></g>');
    } else if (night || theme === 'night') {
        parts.push('<g filter="' + soft + '"><circle cx="312" cy="66" r="36" fill="var(--w-orb)" opacity=".18"/></g><circle cx="312" cy="66" r="24" fill="var(--w-orb)" opacity=".95"/><circle cx="322" cy="58" r="19" fill="var(--w-page-top)" opacity=".92"/>');
    }
    if (night) parts.push('<g fill="var(--w-orb)" opacity=".8"><circle cx="52" cy="40" r="1.6"/><circle cx="120" cy="24" r="1.2"/><circle cx="180" cy="52" r="1.5"/><circle cx="240" cy="30" r="1.2"/><circle cx="30" cy="90" r="1.2"/><circle cx="210" cy="90" r="1"/><circle cx="90" cy="70" r="1"/></g>');
    // 主云簇与远景云
    parts.push(cloudCluster(110, 4, 1.4, main, deep, night));
    parts.push('<g transform="translate(-30 100) scale(.95)" filter="' + softer + '" opacity=".72"><ellipse cx="90" cy="30" rx="52" ry="18" fill="' + deep + '"/><ellipse cx="140" cy="38" rx="40" ry="14" fill="' + main + '"/></g>');
    // 天气元素：雨丝/雪花/闪电/风线/冰雹
    if (['drizzle','rain','heavy','storm'].includes(type)) parts.push('<g stroke="var(--w-art-deep)" stroke-width="2.4" stroke-linecap="round" opacity=".72"><path d="M150 152l-6 22M186 148l-6 22M222 154l-6 22M258 150l-6 22M294 156l-6 22"/></g>');
    else if (['sleet','lightsnow','snow','heavysnow','blizzard','cold'].includes(type)) parts.push('<g fill="var(--w-art-deep)" opacity=".85"><circle cx="150" cy="152" r="3"/><circle cx="190" cy="166" r="2.4"/><circle cx="228" cy="150" r="3"/><circle cx="266" cy="168" r="2.4"/><circle cx="304" cy="152" r="3"/></g>');
    else if (['thunder','severe'].includes(type)) parts.push('<path d="M226 128l-18 34h16l-10 30 34-40h-17l12-24Z" fill="var(--w-warn)" opacity=".95"/>');
    else if (type === 'windy') parts.push('<g fill="none" stroke="var(--w-art-deep)" stroke-width="4" stroke-linecap="round" opacity=".7"><path d="M120 142h70a10 10 0 1 0-9.5-13"/><path d="M150 170h84a11 11 0 1 1-10.5 14"/></g>');
    else if (type === 'hail') parts.push('<g fill="var(--w-art-deep)" opacity=".9"><circle cx="160" cy="154" r="4"/><circle cx="204" cy="162" r="3.4"/><circle cx="248" cy="150" r="4"/></g>');
    parts.push('</svg>');
    return parts.join('');
}
