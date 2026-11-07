// Weather app: local sampling engine, manual refresh, location sharing and
// prompt gating. All values are engine-local; the narrative AI never decides
// weather, and no external weather API is involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPhoneMemory } from '../src/memory.js';
import { createPhoneService } from '../src/phone.js';
import { createWeather, climateFor, initialWeather, advanceWeather, weatherAt, weatherType, weatherExtreme, weatherScene, weatherBackground, sceneBackground, buildForecast, monthDayOf, WEATHER_LOCATION_RULE } from '../src/weather.js';
import { buildStoryPhonePrompt } from '../src/story-phone.js';
import { COMMUNICATION_LANGUAGE_RULE } from '../src/communication-language.js';
import { normalizeSettings } from '../src/config.js';
import { dateDay, dayDate } from '../src/story-clock.js';
import { createWeatherPanel } from '../src/weather-view.js';

// Simple deterministic LCG so statistical assertions never flake between runs.
let lcg = 0x2f6e2b1;
const rng = () => { lcg = (Math.imul(lcg, 1103515245) + 12345 | 0) >>> 0; return lcg / 4294967296; };
const freshRng = index => { lcg = (0x2f6e2b1 + Math.imul(index + 1, 2654435761)) | 0; return rng; };
// The engine samples its own hours with rngAt(seed, key, hour); replicate it to
// prove that weatherAt really is the hour-by-hour advance of the saved state.
const hash32 = text => { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const mulberry32 = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const engineRngAt = (seed, key, hour) => mulberry32(hash32(seed + '|' + key + '|' + hour));

function setup(chat = [{ mes: '2026-01-01 10:00\n开场，暂未提及城市。', is_user: false }]) {
    const bus = new EventEmitter();
    const c = { chatId: 'weather', name1: 'Sam', characterId: 0, characters: [{ name: 'Alex', avatar: 'alex.png' }],
        chat: [...chat], chatMetadata: {}, saveMetadata: async () => {}, onlineStatus: 'connected', extensionPrompts: {},
        setExtensionPrompt(k, v) { this.extensionPrompts[k] = v; },
        eventSource: bus, event_types: Object.fromEntries(['CHAT_CHANGED', 'GENERATION_STARTED', 'GENERATION_ENDED', 'MESSAGE_EDITED', 'MESSAGE_DELETED'].map(n => [n, n])) };
    const settings = normalizeSettings({ retries: 0 });
    const memory = createPhoneMemory({ getContext: () => c });
    const phone = createPhoneService({ memory, getContext: () => c, getSettings: () => settings });
    const weather = createWeather({ memory, phone, getContext: () => c });
    const state = async () => (await memory.read()).state;
    return { c, settings, memory, phone, weather, state, close() { phone.destroy(); memory.destroy(); } };
}
const marker = (prose, city) => ({ mes: prose + `<!--durian-location:{"city":"${city}"}-->`, is_user: false });

test('manual refresh samples the first weather locally for the marked city with its real climate and saved seed', async () => {
    const f = setup(); try {
        assert.equal(f.weather.report(await f.state()).status, 'no-location');
        const refused = await f.weather.refresh();
        assert.equal(refused.ok, false);
        assert.match(refused.error, /尚未标记当前位置/);
        f.c.chat.push(marker('2026-01-01 10:00\nSam arrived in Shanghai.', '上海'));
        await f.memory.read();
        const pending = f.weather.report(await f.state());
        assert.equal(pending.status, 'pending'); assert.equal(pending.city, '上海');
        const result = await f.weather.refresh();
        assert.equal(result.ok, true);
        assert.deepEqual(result.value, { refreshed: true });
        const state = await f.state();
        const record = state.weather['上海'];
        assert.equal(record.city, '上海');
        assert.deepEqual(record.climate, { archetype: 'cfa', offset: 1, south: false });
        assert.equal(typeof record.seed, 'string');
        assert.equal(record.hour, dateDay('2026-01-01') * 24 + 10);
        assert.equal(record.date, '2026-01-01');
        const info = f.weather.report(state);
        assert.equal(info.status, 'ok');
        assert.equal(info.report.date, '2026-01-01'); assert.equal(info.report.time, '10:00');
        assert.equal(info.report.label, weatherType(record.state.type));
        assert.equal(info.report.temp, record.state.temp);
        assert.ok(info.report.wind >= 0 && info.report.wind <= 12);
        assert.ok(info.report.humidity >= 12 && info.report.humidity <= 99);
    } finally { f.close(); }
});

test('real cities adapt to their climate table and the southern hemisphere reads the shifted season', () => {
    assert.deepEqual(climateFor('北京'), { archetype: 'dwa', offset: 0, south: false });
    assert.deepEqual(climateFor('上海'), { archetype: 'cfa', offset: 1, south: false });
    assert.deepEqual(climateFor('伦敦'), { archetype: 'cfb', offset: 0, south: false });
    assert.deepEqual(climateFor('悉尼'), { archetype: 'cfb', offset: 1, south: true });
    const meanTemp = (city, date) => {
        const climate = climateFor(city);
        let sum = 0;
        // Sample the night and afternoon means so the diurnal swing cancels out.
        for (let i = 0; i < 300; i++) for (const hour of [3, 14]) sum += initialWeather(climate, { day: dateDay(date), hour }, freshRng(i * 2 + (hour === 3 ? 0 : 1))).temp;
        return sum / 600;
    };
    assert.ok(meanTemp('新加坡', '2026-01-15') > 22, 'tropical January stays hot');
    assert.ok(meanTemp('雷克雅未克', '2026-01-15') < 2, 'subarctic January stays freezing');
    assert.ok(meanTemp('北京', '2026-01-15') < 2, 'Beijing January is winter cold');
    assert.ok(meanTemp('北京', '2026-07-15') > 20, 'Beijing July is summer hot');
    assert.ok(meanTemp('悉尼', '2026-01-15') > 15, 'Sydney January is southern summer');
    assert.ok(meanTemp('悉尼', '2026-07-15') < 14, 'Sydney July is southern winter');
});

test('fictional places get a stable locally derived climate that the first refresh saves', async () => {
    const first = climateFor('云京城'), second = climateFor('云京城');
    assert.equal(first.derived, true);
    assert.deepEqual(first, second);
    assert.ok(weatherType(initialWeather(first, { day: dateDay('2026-04-08'), hour: 15 }, freshRng(3)).type) !== '未知');
    const f = setup(); try {
        f.c.chat.push(marker('2026-01-01 10:00\nThe caravan reached 云京城 at last.', '云京城'));
        await f.memory.read();
        await f.weather.refresh();
        const record = (await f.state()).weather['云京城'];
        assert.equal(record.climate.derived, true);
        assert.equal(f.weather.report(await f.state()).status, 'ok');
    } finally { f.close(); }
});

test('weather type distribution is genuinely random and extremes stay rare, seasonal and climate-bound', () => {
    const july = { day: dateDay('2026-07-15'), hour: 14 }, january = { day: dateDay('2026-01-15'), hour: 14 };
    const sample = (city, clock, count) => {
        const climate = climateFor(city), types = [];
        for (let i = 0; i < count; i++) types.push(initialWeather(climate, clock, freshRng(i)).type);
        return types;
    };
    const shanghai = sample('上海', july, 4000);
    const counts = {}; for (const t of shanghai) counts[t] = (counts[t] || 0) + 1;
    assert.ok(Object.keys(counts).length >= 8, 'a rainy month produces a wide mix, never one endless sunny result');
    assert.ok(Math.max(...Object.values(counts)) / shanghai.length < .6, 'no single type dominates');
    assert.ok(shanghai.filter(weatherExtreme).length / shanghai.length < .05, 'extreme weather stays rare overall');
    assert.ok(!shanghai.includes('typhoon') && !shanghai.includes('hail'), 'typhoon and hail never appear out of nowhere');
    for (const city of ['北京', '伦敦', '新加坡']) {
        const winter = sample(city, january, 1500), summer = sample(city, july, 1500);
        assert.ok(!winter.includes('heat'), 'heat waves never sample in January: ' + city);
        assert.ok(!summer.includes('cold'), 'cold snaps never sample in July: ' + city);
    }
    assert.ok(sample('哈尔滨', january, 1500).some(t => ['lightsnow', 'snow', 'heavysnow', 'blizzard'].includes(t)), 'Harbin winter can snow');
    assert.ok(!sample('新加坡', january, 1500).some(t => ['lightsnow', 'snow', 'heavysnow', 'blizzard'].includes(t)), 'tropical snow never happens');
});

test('the weather advances one story hour at a time, deterministically, with both persistence and transitions', () => {
    const day = dateDay('2026-01-01'), climate = climateFor('上海'), key = '上海';
    const record = { city: '上海', climate, seed: 'seed-1', hour: day * 24 + 10, date: '2026-01-01', state: { type: 'rain', temp: 8, wind: 3, humidity: 80 } };
    const same = weatherAt(record, { day, hour: 10 });
    assert.equal(same.time, '10:00'); assert.equal(same.type, 'rain'); assert.equal(same.temp, 8);
    assert.deepEqual(weatherAt(record, { day, hour: 11 }), weatherAt(record, { day, hour: 11 }), 'no re-roll for the same hour');
    const stepped = weatherAt(record, { day, hour: 13 });
    let steady = record.state;
    for (let hour = record.hour + 1; hour <= day * 24 + 13; hour++) steady = advanceWeather(steady, climate, hour, engineRngAt(record.seed, key, hour));
    assert.equal(stepped.type, steady.type);
    assert.equal(stepped.temp, steady.temp);
    assert.equal(stepped.wind, steady.wind);
    assert.equal(stepped.humidity, steady.humidity);
    let persisted = 0, switched = 0;
    for (let i = 0; i < 120; i++) {
        lcg = (0x9e3779b9 + Math.imul(i + 1, 2654435761)) | 0;
        const state0 = initialWeather(climate, { day, hour: 9 }, rng);
        const state1 = advanceWeather(state0, climate, day * 24 + 10, rng);
        if (state1.type === state0.type) persisted++; else switched++;
    }
    assert.ok(persisted > 10 && switched > 10, 'hours can keep the type or move to a new one');
    const folded = weatherAt(record, { day: day + 31, hour: 12 });
    assert.deepEqual(folded, weatherAt(record, { day: day + 31, hour: 12 }));
    assert.equal(folded.date, '2026-02-01'); assert.equal(folded.time, '12:00');
    assert.ok(weatherType(folded.type) !== '未知');
});

test('moving to another city re-points the app to the new place while the old record survives', async () => {
    const f = setup(); try {
        f.c.chat.push(marker('2026-01-01 10:00\nSam arrived in Shanghai.', '上海'));
        await f.memory.read();
        await f.weather.refresh();
        assert.equal(f.weather.report(await f.state()).status, 'ok');
        f.c.chat.push(marker('2026-01-02 12:00\nSam took the train to Tokyo.', '东京'));
        await f.memory.read();
        const state = await f.state();
        const info = f.weather.report(state);
        assert.equal(info.status, 'pending'); assert.equal(info.city, '东京');
        assert.equal(weatherBackground(state, f.c.chat), '');
        assert.ok(state.weather['上海'], 'the previous city keeps its record');
        await f.weather.refresh();
        const next = await f.state();
        assert.ok(next.weather['东京']);
        assert.equal(f.weather.report(next).status, 'ok');
        assert.equal(f.weather.report(next).report.time, '12:00');
    } finally { f.close(); }
});

test('every narrative generation receives the scene rule and current weather, gated by the three consumer apps', () => {
    const day = dateDay('2026-01-01');
    const chat = [{ mes: '2026-01-01 10:00\n在上海的一天。', is_user: false }];
    const state = { location: { current: { city: '上海' } }, weather: { 上海: { city: '上海', climate: climateFor('上海'), seed: 's', hour: day * 24 + 10, date: '2026-01-01', state: { type: 'rain', temp: 8, wind: 3, humidity: 80 } } } };
    const background = weatherBackground(state, chat);
    assert.match(background, /当前位置：上海；当前剧情时间：2026-01-01 10:00。/);
    assert.match(background, /今天（1月1日）：/);
    assert.match(background, /明天（1月2日）：/);
    assert.equal(weatherBackground({ ...state, weather: {} }, chat), '');
    assert.equal(weatherBackground(null, chat), '');
    const all = sceneBackground(state, chat, { apps: { weather: true, daily: true, assets: true } });
    assert.ok(all.startsWith(WEATHER_LOCATION_RULE));
    assert.match(all, /今天（1月1日）：/);
    assert.equal(sceneBackground(state, chat, { apps: { weather: false, daily: true, assets: false } }), WEATHER_LOCATION_RULE);
    assert.equal(sceneBackground(state, chat, { apps: { weather: false, daily: false, assets: false } }), '');
    assert.ok(sceneBackground(state, chat, undefined).startsWith(WEATHER_LOCATION_RULE), 'missing settings default to the shared rule');
    assert.equal(sceneBackground({ ...state, location: {} }, chat, { apps: { weather: true } }), WEATHER_LOCATION_RULE);
    assert.equal(sceneBackground(state, [{ mes: '没有日期的一天。', is_user: false }], { apps: { weather: true } }), WEATHER_LOCATION_RULE, 'unknown story time still injects only the rule');
});

test('story-phone prompt carries the scene block before the language rule and honours the app switches', () => {
    const day = dateDay('2026-01-01');
    const chat = [{ mes: '2026-01-01 10:00\n在上海的一天。', is_user: false }];
    const state = { contacts: {}, calls: {}, messages: {}, profiles: {}, location: { current: { city: '上海' } }, weather: { 上海: { city: '上海', climate: climateFor('上海'), seed: 's', hour: day * 24 + 10, date: '2026-01-01', state: { type: 'rain', temp: 8, wind: 3, humidity: 80 } } } };
    const context = { name1: 'Sam', characterId: 0, characters: [{ name: 'Alex', avatar: 'alex.png' }] };
    const prompt = buildStoryPhonePrompt(state, context, normalizeSettings({}), chat);
    assert.match(prompt, /durian-location/);
    assert.match(prompt, /当前位置：上海；当前剧情时间：/);
    assert.ok(prompt.endsWith(COMMUNICATION_LANGUAGE_RULE));
    const noWeather = buildStoryPhonePrompt(state, context, normalizeSettings({ apps: { weather: false } }), chat);
    assert.match(noWeather, /durian-location/);
    assert.doesNotMatch(noWeather, /当前位置：上海/);
    const allOff = buildStoryPhonePrompt(state, context, normalizeSettings({ apps: { weather: false, daily: false, assets: false } }), chat);
    assert.doesNotMatch(allOff, /durian-location/);
});

test('with the weather app switched off the service refuses to refresh and no state is saved', async () => {
    const f = setup(); try {
        f.c.chat.push(marker('2026-01-01 10:00\nSam arrived in Shanghai.', '上海'));
        await f.memory.read();
        const settings = normalizeSettings({ retries: 0, apps: { weather: false } });
        const phone = createPhoneService({ memory: f.memory, getContext: () => f.c, getSettings: () => settings });
        const weather = createWeather({ memory: f.memory, phone, getContext: () => f.c });
        const refused = await weather.refresh();
        assert.equal(refused.ok, false);
        assert.match(refused.error, /此 App 已关闭/);
        assert.deepEqual((await f.state()).weather, {});
        phone.destroy();
    } finally { f.close(); }
});

test('weather survives archive reload and later clocks evolve it without re-rolling', async () => {
    const f = setup(); try {
        f.c.chat.push(marker('2026-01-01 10:00\nSam arrived in Shanghai.', '上海'));
        await f.memory.read();
        await f.weather.refresh();
        const before = await f.state(), info = f.weather.report(before);
        const reload = createPhoneMemory({ getContext: () => f.c });
        try {
            const reloaded = (await reload.read()).state;
            assert.deepEqual(reloaded.weather, before.weather);
            assert.deepEqual(f.weather.report(reloaded), info);
        } finally { reload.destroy(); }
        f.c.chat.push({ mes: '2026-01-01 12:00\n中午在上海逛街。', is_user: false });
        await f.memory.read();
        const advanced = f.weather.report(await f.state());
        assert.equal(advanced.status, 'ok');
        assert.equal(advanced.report.time, '12:00');
        assert.deepEqual(advanced.report, weatherAt(before.weather['上海'], { day: dateDay('2026-01-01'), hour: 12 }));
    } finally { f.close(); }
});

test('without a story time the app falls back to the saved weather from the last refresh', async () => {
    const f = setup([{ mes: '开场，本楼没有日期。', is_user: false }]); try {
        f.c.chat.push(marker('Sam settled in Shanghai.<!--durian-location:{"city":"上海"}-->', '上海'));
        await f.memory.read();
        const pending = f.weather.report(await f.state());
        assert.equal(pending.status, 'pending');
        const refused = await f.weather.refresh();
        assert.equal(refused.ok, false);
        assert.match(refused.error, /日期和时间/);
        const ticket = await f.memory.begin();
        await f.memory.commit(ticket, [{ collection: 'weather', key: '上海', value: { city: '上海', climate: climateFor('上海'), seed: 'x', hour: dateDay('2026-01-01') * 24 + 10, date: '2026-01-01', state: { type: 'fog', temp: 9, wind: 1, humidity: 88 } } }]);
        const info = f.weather.report(await f.state());
        assert.equal(info.status, 'unknown-time');
        assert.equal(info.city, '上海');
        assert.equal(info.date, '2026-01-01');
        assert.equal(info.weather.label, '雾');
        assert.equal(info.weather.temp, 9);
    } finally { f.close(); }
});

test('the weather panel renders the report and refresh reports success', async () => {
    const f = setup(); try {
        f.c.chat.push(marker('2026-01-01 10:00\nSam arrived in Shanghai.', '上海'));
        await f.memory.read();
        await f.weather.refresh();
        let current = await f.state();
        let redraws = 0;
        const panel = createWeatherPanel({ adapter: { weather: f.weather }, getView: () => ({ state: current, busy: false }), redraw: () => { redraws++; } });
        const html = panel.html();
        assert.match(html, /<h2>上海<\/h2>/);
        assert.match(html, /data-weather="(clear|cloud|rain|snow|wind|typhoon|extreme)"/);
        assert.match(html, /data-weather-action="refresh"/);
        assert.match(html, /刷新天气/);
        await panel.action('refresh');
        current = await f.state();
        assert.match(panel.html(), /已为当前位置抽取天气。/);
        assert.ok(redraws >= 2);
        for (const [type, family] of [['sunny', 'clear'], ['fog', 'cloud'], ['storm', 'rain'], ['blizzard', 'snow'], ['windy', 'wind'], ['typhoon', 'typhoon'], ['heat', 'extreme']])
            assert.equal(weatherScene(type), family);
    } finally { f.close(); }
});

// ---- Seven-day forecast (deterministic window over the same engine chain) ----

const forecastFor = (seed, city = '上海', date = '2026-07-01') => {
    const climate = climateFor(city), day = dateDay(date);
    const state = initialWeather(climate, { day, hour: 10 }, engineRngAt(seed, city, day * 24 + 10));
    const record = { city, climate, seed, hour: day * 24 + 10, date, state };
    return { record, forecast: buildForecast(record, { day, hour: 10 }) };
};
const findSeed = pred => {
    for (let i = 0; i < 500; i++) {
        const found = forecastFor('seed-' + i);
        if (pred(found.forecast)) return found;
    }
    throw new Error('no deterministic seed matched the layout');
};
const forecastState = record => ({ location: { current: { city: record.city } }, weather: { [record.city]: record } });
const forecastChat = date => [{ mes: date + ' 10:00\n在城市里的一天。', is_user: false }];

test('manual refresh yields the full seven-day window with story dates, weekdays and day stats', async () => {
    const f = setup(); try {
        f.c.chat.push(marker('2026-01-01 10:00\nSam arrived in Shanghai.', '上海'));
        await f.memory.read();
        await f.weather.refresh();
        const info = f.weather.report(await f.state());
        assert.equal(info.status, 'ok');
        assert.equal(info.forecast.city, '上海');
        assert.equal(info.forecast.days.length, 7);
        for (let i = 0; i < 7; i++) {
            const day = info.forecast.days[i];
            assert.equal(day.date, dayDate(dateDay('2026-01-01') + i), 'story dates only, no wall clock');
            assert.match(day.weekday, /^星期[一二三四五六日]$/);
            assert.equal(day.today, i === 0);
            assert.ok(day.hi >= day.lo);
            assert.ok(day.precip >= 0 && day.precip <= 100);
            assert.ok(day.wind >= 0 && day.wind <= 12);
            assert.ok(day.label && !day.label.includes('未知'));
            assert.ok(['clear', 'cloud', 'rain', 'snow', 'wind', 'typhoon', 'extreme'].includes(day.scene));
            assert.equal(day.hours.length, 24);
        }
    } finally { f.close(); }
});

test('the forecast is climate-bound and never re-rolls on reopen, reload or re-report', async () => {
    const f = setup(); try {
        f.c.chat.push(marker('2026-01-01 10:00\nSam arrived in Harbin.', '哈尔滨'));
        await f.memory.read();
        await f.weather.refresh();
        const first = f.weather.report(await f.state());
        for (const day of first.forecast.days) assert.ok(day.hi < 15, 'Harbin January stays cold: ' + day.hi);
        assert.deepEqual(f.weather.report(await f.state()).forecast, first.forecast, 'reopening the app does not re-roll');
        const reload = createPhoneMemory({ getContext: () => f.c });
        try { assert.deepEqual((await reload.read()).state.weather, (await f.state()).weather); } finally { reload.destroy(); }
        const fresh = createPhoneMemory({ getContext: () => f.c });
        try {
            const weather2 = createWeather({ memory: fresh, phone: f.phone, getContext: () => f.c });
            const info2 = weather2.report((await fresh.read()).state);
            assert.deepEqual(info2.forecast, first.forecast, 'chat reload keeps the same forecast');
        } finally { fresh.destroy(); }
    } finally { f.close(); }
});

test('past midnight the forecast slides: tomorrow becomes today and a new seventh day appears', async () => {
    const f = setup(); try {
        f.c.chat.push(marker('2026-01-01 10:00\nSam arrived in Shanghai.', '上海'));
        await f.memory.read();
        await f.weather.refresh();
        const before = f.weather.report(await f.state()).forecast;
        f.c.chat.push({ mes: '2026-01-02 00:30\n午夜的上海很安静。', is_user: false });
        await f.memory.read();
        const after = f.weather.report(await f.state()).forecast;
        const pick = d => ({ date: d.date, type: d.type, label: d.label, hi: d.hi, lo: d.lo, wind: d.wind, precip: d.precip, extreme: d.extreme, extremeLabel: d.extremeLabel });
        assert.deepEqual(pick(after.days[0]), pick(before.days[1]), "yesterday's tomorrow becomes today's baseline on the same chain");
        assert.deepEqual(pick(after.days[1]), pick(before.days[2]));
        assert.equal(after.days[0].today, true);
        assert.equal(after.days[0].date, '2026-01-02');
        assert.equal(after.days[6].date, '2026-01-08', 'the window slides forward, no date is regenerated');
    } finally { f.close(); }
});

test("hourly evolution never breaks today's summary and the current reading sits on the hourly curve", async () => {
    const f = setup(); try {
        f.c.chat.push(marker('2026-01-01 10:00\nSam arrived in Shanghai.', '上海'));
        await f.memory.read();
        await f.weather.refresh();
        const before = f.weather.report(await f.state()).forecast;
        f.c.chat.push({ mes: '2026-01-01 12:00\n中午在上海逛街。', is_user: false });
        await f.memory.read();
        const info = f.weather.report(await f.state());
        assert.equal(info.report.time, '12:00');
        assert.equal(info.report.temp, before.days[0].hours[12].temp);
        assert.deepEqual(info.forecast, before, 'hourly updates leave the deterministic window untouched');
    } finally { f.close(); }
});

test('ordinary weather injects only today and tomorrow, never days three to seven', () => {
    const { record } = findSeed(f => f.days.slice(2).every(d => !d.extreme));
    const background = weatherBackground(forecastState(record), forecastChat(record.date));
    assert.match(background, /今天（7月1日）：/);
    assert.match(background, /明天（7月2日）：/);
    assert.equal((background.match(/（\d+月\d+日）：/g) || []).length, 2);
    assert.ok(!background.includes('未来极端天气预警'), 'no warning block without extreme days');
    assert.match(background, /不得把未来天气写成当前正在发生/);
});

test('extreme days three to seven go out as dated warnings that are not current weather', () => {
    const { record, forecast } = findSeed(f => f.days.slice(2).some(d => d.extreme));
    const extreme = forecast.days.find((day, index) => day.extreme && index >= 2);
    const background = weatherBackground(forecastState(record), forecastChat(record.date));
    assert.match(background, /未来极端天气预警（尚未发生的预报）：/);
    const md = monthDayOf(extreme.date);
    assert.match(background, new RegExp(md + extreme.extremeLabel + '，强度' + extreme.extremeStrength + '，预计'));
    assert.match(background, /影响上海/);
    assert.match(background, /今天（7月1日）：.*目前-?\d+°C，风力\d+级/);
    assert.match(background, /预报不代表已经发生/);
});

test('several extreme days are all reported, none dropped', () => {
    const { record, forecast } = findSeed(f => f.days.slice(2).filter(d => d.extreme).length >= 2);
    const extremes = forecast.days.filter((day, index) => day.extreme && index >= 2);
    assert.ok(extremes.length >= 2);
    const background = weatherBackground(forecastState(record), forecastChat(record.date));
    const section = background.split('未来极端天气预警')[1];
    for (const day of extremes) assert.ok(section.includes(monthDayOf(day.date)), 'warning present for ' + day.date);
});

test('an extreme today or tomorrow keeps its full warning detail inside the day line', () => {
    const { record } = findSeed(f => (f.days[0].extreme || f.days[1].extreme) && f.days.slice(2).every(d => !d.extreme));
    const background = weatherBackground(forecastState(record), forecastChat(record.date));
    assert.match(background, /；预计\d{2}时(?:至\d{2}时|至23时)?出现/);
    assert.ok(!background.includes('未来极端天气预警'), 'no duplicated warning block for today or tomorrow');
});

test('forecast and warning machinery never calls the model', async () => {
    const f = setup(); try {
        let modelCalls = 0;
        f.c.generateQuietPrompt = async () => { modelCalls++; return '{}'; };
        f.c.chat.push(marker('2026-01-01 10:00\nSam arrived in Shanghai.', '上海'));
        await f.memory.read();
        await f.weather.refresh();
        f.weather.report(await f.state());
        weatherBackground(await f.state(), f.c.chat);
        f.c.chat.push({ mes: '2026-01-01 12:00\n中午逛街。', is_user: false });
        await f.memory.read();
        f.weather.report(await f.state()).forecast;
        assert.equal(modelCalls, 0, 'no model request for forecast, hourly evolution or warnings');
    } finally { f.close(); }
});

test('deleted floors remove the record together with its forecast window', async () => {
    const f = setup(); try {
        f.c.chat.push(marker('2026-01-01 10:00\nSam arrived in Shanghai.', '上海'));
        await f.memory.read();
        await f.weather.refresh();
        assert.equal(f.weather.report(await f.state()).forecast.days.length, 7);
        f.c.chat.pop();
        await f.memory.read();
        assert.equal(f.weather.report(await f.state()).status, 'no-location');
        assert.equal(f.weather.report(await f.state()).forecast, undefined);
        assert.equal(weatherBackground(await f.state(), f.c.chat), '');
    } finally { f.close(); }
});
