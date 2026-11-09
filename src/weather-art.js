// Weather icons are local SVG. Photographs are original-source WebP derivatives
// bundled under assets/weather, with source/author metadata in SOURCES.md.
const PHOTO_BY_THEME={mist:'day',apricot:'dusk',night:'night'};
const PHOTO_BY_TYPE={drizzle:true,rain:true,heavy:true,storm:true,thunder:true,severe:true};
export const weatherPhoto=(type,theme='mist')=>PHOTO_BY_TYPE[type]?'rain':(PHOTO_BY_THEME[theme]||'day');

const CLOUD = '<path d="M18 46c-2-12 7-21 19-21 6-16 31-19 42-5 14-2 25 8 25 21 13 1 20 9 20 20H27c-8 0-13-6-13-14 0-5 1-8 4-11Z"/>';
const WEATHER_SCENES = {
    clear: '<g fill="#F9BD45" stroke="#F9BD45" stroke-width="3" stroke-linecap="round"><circle cx="78" cy="46" r="20"/><path d="M78 9v11M78 72v11M41 46h11M104 46h11M52 20l8 8M98 64l8 8M104 20l-8 8M60 64l-8 8" fill="none"/></g>',
    cloud: '<path d="M28 70c-11 0-18-7-18-17 0-9 7-16 17-17 3-16 16-26 31-24 11 1 20 9 23 20 13-1 23 8 23 20 0 10-8 18-20 18H28Z" fill="#B7C9DA"/><path d="M33 47c7-14 27-17 39-6" fill="none" stroke="#F8FCFF" stroke-width="5" stroke-linecap="round" opacity=".75"/>',
    rain: '<path d="M25 57c-9 0-15-6-15-14 0-8 6-14 15-15 3-13 14-21 27-20 10 1 17 8 20 17 11-1 19 6 19 16 0 9-7 16-17 16H25Z" fill="#A8BCD0"/><g stroke="#6AADE0" stroke-width="5" stroke-linecap="round"><path d="m32 68-5 12M54 68l-5 12M76 68l-5 12"/></g>',
    snow: '<path d="M25 57c-9 0-15-6-15-14 0-8 6-14 15-15 3-13 14-21 27-20 10 1 17 8 20 17 11-1 19 6 19 16 0 9-7 16-17 16H25Z" fill="#B6C8D9"/><g fill="#F7FCFF"><circle cx="31" cy="72" r="3"/><circle cx="52" cy="78" r="3"/><circle cx="74" cy="70" r="3"/></g>',
    wind: '<g fill="none" stroke="#8BAEBB" stroke-width="6" stroke-linecap="round"><path d="M12 33h70c13 0 15-18 3-21-7-2-12 2-14 8"/><path d="M12 52h93c14 0 16 19 2 22-8 2-13-2-15-8"/><path d="M12 70h45"/></g>',
    typhoon: '<g fill="none" stroke="#8FB5D5" stroke-width="7" stroke-linecap="round"><path d="M98 22A43 43 0 1 0 111 57"/><path d="M87 43a22 22 0 1 0 1 22"/><path d="M75 50a8 8 0 1 0 4 10"/></g>',
    extreme: '<path d="M62 10 8 91h108L62 10Z" fill="#F3B45C"/><path d="M62 38v25" stroke="#fff" stroke-width="8" stroke-linecap="round"/><circle cx="62" cy="77" r="4" fill="#fff"/>',
};

const FAMILY_BY_TYPE = {
    sunny:'clear', partly:'cloud', overcast:'cloud', fog:'cloud',
    drizzle:'rain', rain:'rain', heavy:'rain', storm:'rain', thunder:'rain', severe:'rain',
    sleet:'snow', lightsnow:'snow', snow:'snow', heavysnow:'snow', blizzard:'snow', cold:'snow',
    windy:'wind', dust:'wind', typhoon:'typhoon', hail:'extreme', heat:'clear'
};

export const sceneIcon = (scene, size = 22) => {
    const family = scene === 'extreme' ? 'extreme' : (WEATHER_SCENES[scene] ? scene : 'cloud');
    const body = WEATHER_SCENES[family] || WEATHER_SCENES.cloud;
    return '<svg viewBox="0 0 124 100" width="' + size + '" height="' + size + '" aria-hidden="true" focusable="false">' + body + '</svg>';
};

// 天气场景图片独立于文字与数据层，裁切、淡出均由 .pp-weather-backdrop 控制。
export function sceneBackdrop(type, theme = 'mist', assetBase = 'assets/weather/') {
    const photo = weatherPhoto(type, theme);
    // assetBase is resolved from index.js at runtime, not the SillyTavern page URL.
    const src = String(assetBase).replace(/\/?$/, '/') + photo + '.webp';
    const safe = src.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    return '<img class="pp-weather-backdrop-art" src="' + safe + '" data-photo-source="' + photo + '" alt="" loading="eager" decoding="async" draggable="false">';
}

// 只叠加与背景照片互补的天气效果，不再重复画第二朵云。
const WEATHER_EFFECTS = {
    rain: '<g fill="none" stroke="#70B6E8" stroke-width="4.5" stroke-linecap="round"><path d="m35 32-7 20m31-25-7 20m31-14-7 20m31-14-7 20"/></g>',
    snow: '<g fill="none" stroke="#F5FBFF" stroke-width="3" stroke-linecap="round"><path d="M34 28v16m-8-8h16m-13-5 10 10m0-10L29 41M67 18v16m-8-8h16m-13-5 10 10m0-10L62 31M98 34v16m-8-8h16m-13-5 10 10m0-10L93 47"/></g>',
    wind: '<g fill="none" stroke="#E4F1F9" stroke-width="4.5" stroke-linecap="round" opacity=".9"><path d="M18 35h62c12 0 14-15 3-18M12 55h92c13 0 15 17 2 20M28 75h39"/></g>',
    typhoon: '<g fill="none" stroke="#D8EAF8" stroke-width="5" stroke-linecap="round"><path d="M99 22A40 40 0 1 0 110 56"/><path d="M86 42a21 21 0 1 0 1 23"/><path d="M74 49a8 8 0 1 0 4 11"/></g>',
    extreme: '<path d="M72 8 37 54h23l-10 38 42-54H67Z" fill="#FFD26A" stroke="#FFF2C8" stroke-width="2" stroke-linejoin="round"/>',
};
export const weatherArt = type => {
    const family = FAMILY_BY_TYPE[type] || 'cloud';
    const effect = WEATHER_EFFECTS[family];
    return effect ? '<svg viewBox="0 0 124 100" width="124" height="100" aria-hidden="true" focusable="false">' + effect + '</svg>' : '';
};

export const metricIcon = name => {
    const icons = {
        feels: '<path d="M10.2 13.7V5.4a1.8 1.8 0 1 1 3.6 0v8.3a4 4 0 1 1-3.6 0Z"/><path d="M12 16.8h.01" stroke-width="2.4"/>',
        precip: '<path d="M12 3.6c3 3.5 5.4 6.4 5.4 9.2a5.4 5.4 0 1 1-10.8 0C6.6 10 9 7.1 12 3.6Z"/>',
        wind: '<path d="M3.5 9.5h9a2.4 2.4 0 1 0-2.3-3.1M3.5 13.5h13a2.7 2.7 0 1 1-2.6 3.5M3.5 17.5h7"/>',
        humidity: '<path d="M3.5 14.5c2-1.6 4-1.6 6 0s4 1.6 6 0 3.4-1.3 4.5-.6M3.5 9.8c2-1.6 4-1.6 6 0s4 1.6 6 0 3.4-1.3 4.5-.6"/>',
        uv: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>',
        air: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h8"/>',
    };
    return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (icons[name] || '') + '</svg>';
};
