// Weather app: local sampling engine, manual refresh, location sharing and
// prompt gating. All values are engine-local; the narrative AI never decides
// weather, and no external weather API is involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPhoneMemory } from '../src/memory.js';
import { createPhoneService } from '../src/phone.js';
import { createWeather, climateFor, initialWeather, advanceWeather, weatherAt, weatherType, weatherExtreme, weatherScene, weatherWarning, environmentMetrics, weatherBackground, sceneBackground, buildForecast, monthDayOf, locationKind, worldClimate, WEATHER_LOCATION_RULE } from '../src/weather.js';
import { buildStoryPhonePrompt } from '../src/story-phone.js';
import { COMMUNICATION_LANGUAGE_RULE } from '../src/communication-language.js';
import { normalizeSettings } from '../src/config.js';
import { dateDay, dayDate } from '../src/story-clock.js';
import { createWeatherPanel, themeFor, nextThemeChange, themeForStory, upcomingHours } from '../src/weather-view.js';
import { sceneBackdrop, weatherPhoto } from '../src/weather-art.js';

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
    let response = { city: null }, calls = 0, prompt = '';
    const c = { chatId: 'weather', name1: 'Sam', characterId: 0, characters: [{ name: 'Alex', avatar: 'alex.png' }],
        chat: [...chat], chatMetadata: {}, saveMetadata: async () => {}, onlineStatus: 'connected', extensionPrompts: {},
        setExtensionPrompt(k, v) { this.extensionPrompts[k] = v; },
        eventSource: bus, event_types: Object.fromEntries(['CHAT_CHANGED', 'GENERATION_STARTED', 'GENERATION_ENDED', 'MESSAGE_EDITED', 'MESSAGE_DELETED'].map(n => [n, n])),
        generateQuietPrompt: async o => { calls++; prompt = o.quietPrompt; return JSON.stringify(typeof response === 'function' ? response() : response); } };
    const settings = normalizeSettings({ retries: 0 });
    const memory = createPhoneMemory({ getContext: () => c });
    const phone = createPhoneService({ memory, getContext: () => c, getSettings: () => settings });
    const weather = createWeather({ memory, phone, getContext: () => c, getSettings: () => settings });
    const state = async () => (await memory.read()).state;
    return { c, settings, memory, phone, weather, state, reply: r => response = r, calls: () => calls, prompt: () => prompt, close() { phone.destroy(); memory.destroy(); } };
}
const marker = (prose, city) => ({ mes: prose + `<!--durian-location:{"city":"${city}"}-->`, is_user: false });

test('manual refresh samples the first weather locally for the marked city with its real climate and saved seed', async () => {
    const f = setup(); try {
        assert.equal(f.weather.report(await f.state()).status, 'no-location');
        const refused = await f.weather.refresh();
        assert.equal(refused.ok, false);
        assert.match(refused.error, /你太神秘了/); // 探测无果才失败，提示保持剧情内口吻
        assert.equal(f.calls(), 1);
        assert.match(f.prompt(), /判断 user 此刻身处哪座城市/);
        assert.match(f.prompt(), /"city":null/);
        assert.equal(f.state().location?.current, undefined); // 探测无果不写地点
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

test('refresh without a marker probes the recent prose and status bars, saves the found city and rolls back with its floor', async () => {
    const f = setup([
        { mes: '2026-01-01 10:00\n【状态栏】位置：东京·新宿 ｜ 时间 10:00\n开场。', is_user: false },
        { mes: '2026-01-02 09:00\nSam 提到计划下周去大阪旅行。', is_user: false },
    ]); try {
        f.reply({ city: '东京' });
        const result = await f.weather.refresh();
        assert.equal(result.ok, true, result.error);
        assert.equal(f.calls(), 1); // 一次探测请求；天气采样仍是本地随机
        assert.match(f.prompt(), /判断 user 此刻身处哪座城市/);
        assert.match(f.prompt(), /状态栏明确给出位置时优先采用/);
        assert.match(f.prompt(), /user 的名字："Sam"/);
        assert.match(f.prompt(), /位置：东京·新宿/); // 历史正文与状态栏进入探测上下文
        assert.match(f.prompt(), /计划下周去大阪/); // 干扰项也在上下文里，由提示词排除
        assert.match(f.prompt(), /{"city":"城市名称"}/);
        const state = await f.state();
        assert.equal(state.location.current.city, '东京'); // 与标记路径写同一条位置记录
        assert.equal(state.location.current.sourceIndex, 1);
        assert.equal(state.weather['东京'].city, '东京'); // 同一次提交顺带完成天气采样
        assert.equal(f.weather.report(state).status, 'ok');
        // 探测到的地点锚定在当时的最新楼层，删除楼层随剧情回退
        f.c.chat.pop(); f.c.eventSource.emit('MESSAGE_DELETED'); await f.memory.read();
        const rolled = await f.state();
        assert.equal(rolled.location?.current, undefined);
        assert.equal(rolled.weather?.['东京'], undefined);
    } finally { f.close(); }
});
test('an existing marker path stays model-free: refresh with a location makes no request', async () => {
    const f = setup(); try {
        f.c.chat.push(marker('2026-01-01 10:00\nSam arrived in Shanghai.', '上海'));
        await f.memory.read();
        const result = await f.weather.refresh();
        assert.equal(result.ok, true, result.error);
        assert.equal(f.calls(), 0); // 标记路径保持不动，零模型请求
        assert.equal((await f.state()).location.current.city, '上海');
    } finally { f.close(); }
});

test('weather location can be edited from the shared location record without a model call',async()=>{
    const f=setup();try{
        f.c.chat.push(marker('2026-01-01 10:00\nSam has arrived in Shanghai.','上海'));
        await f.memory.read();
        assert.equal((await f.weather.refresh()).ok,true);
        const oldWeather=(await f.state()).weather['上海'],beforeCalls=f.calls();
        const result=await f.weather.editLocation('  洛杉矶  ','上海');
        assert.equal(result.ok,true,result.error);
        const state=await f.state();
        assert.equal(state.location.current.city,'洛杉矶');
        assert.equal(state.location.current.manual,true);
        assert.equal(state.weather['上海'].seed,oldWeather.seed,"the previous city weather stays intact");
        assert.equal(state.weather['洛杉矶'].kind,'real');
        assert.equal(state.weather['洛杉矶'].climate.archetype,'csa');
        assert.equal(f.weather.report(state).city,'洛杉矶');
        assert.equal(f.weather.report(state).status,'ok');
        assert.equal(f.calls(),beforeCalls,'editing and locally sampling weather makes no model request');
        const panel=createWeatherPanel({adapter:{weather:f.weather},getView:()=>({...state,busy:false}),redraw(){},editLocation(){}});
        assert.match(panel.html(),/data-press="weather-location"/);
        assert.deepEqual(panel.press({dataset:{press:'weather-location'}}).map(a=>a.icon),['edit']);
        assert.equal(panel.press({dataset:{press:'weather-location'}})[0].label,'修改地点');
        const reloaded=createPhoneMemory({getContext:()=>f.c});
        try{assert.equal((await reloaded.read()).state.location.current.city,'洛杉矶');}
        finally{reloaded.destroy();}
        const same=await f.weather.editLocation('洛杉矶','洛杉矶');
        assert.equal(same.ok,true);
        assert.equal(same.value.unchanged,true);
        assert.equal(f.calls(),beforeCalls);
    }finally{f.close();}
});

test('editing the location rejects stale names, invalid inputs and rolls back when the story floor is removed',async()=>{
    const f=setup();try{
        f.c.chat.push(marker('2026-01-01 10:00\nSam has arrived in Shanghai.','上海'));
        await f.memory.read();
        assert.equal((await f.weather.editLocation('北京','上海')).ok,true);
        const bad=await f.weather.editLocation('<fake>','北京');
        assert.equal(bad.ok,false);
        const stale=await f.weather.editLocation('东京','上海');
        assert.equal(stale.ok,false);
        assert.equal((await f.state()).location.current.city,'北京');
        f.c.chat.pop();
        f.c.eventSource.emit('MESSAGE_DELETED');
        await f.memory.read();
        assert.equal((await f.state()).location?.current,undefined);
        assert.equal((await f.state()).weather?.['北京'],undefined);
        assert.equal(f.calls(),0);
    }finally{f.close();}
});

test('manual weather location is available when no city marker or story time exists',async()=>{
    const f=setup([{mes:'没有明确剧情日期。',is_user:false}]);try{
        const result=await f.weather.editLocation('伦敦','');
        assert.equal(result.ok,true,result.error);
        assert.equal((await f.state()).location.current.city,'伦敦');
        assert.equal(f.weather.report(await f.state()).status,'pending');
        assert.equal(f.calls(),0);
        const panel=createWeatherPanel({adapter:{weather:f.weather},getView:()=>({...f.phone.snapshot(),busy:false}),redraw(){},editLocation(){}});
        assert.match(panel.html(),/data-press="weather-location"/);
    }finally{f.close();}
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
        const panel = createWeatherPanel({ adapter: { weather: f.weather }, getView: () => ({ ...current, busy: false }), redraw: () => { redraws++; } });
        const html = panel.html();
        assert.match(html, /data-wtheme="(mist|apricot|night)"/);
        assert.match(html, /<b>上海<\/b>/); // 城市在顶部导航信息区
        assert.match(html, /data-weather="(clear|cloud|rain|snow|wind|typhoon|extreme)"/);
        assert.match(html, /data-weather-action="refresh"/);
        assert.match(html, /刷新天气/);
        assert.match(html, /体感温度/);assert.match(html, /降水情况/);assert.match(html, /风力/);assert.match(html, /湿度/);
        assert.match(html, /pp-weather-hour-now/); // 当前小时突出
        assert.match(html, /pp-weather-metrics/); // 四指标连续横栏
        assert.match(html, /pp-weather-hourly-card/); // 逐小时单面板
        assert.match(html, /pp-weather-week/); // 七天连续列表
        assert.match(html, /assets\/weather\/(?:day|dusk|night|rain)\.webp/); // 随插件打包的真实照片
        assert.doesNotMatch(html, /剧情时间/); // 界面不显示内部系统信息
        assert.doesNotMatch(html, /pp-weather-refresh/); // 底部大号刷新按钮已移除
        await panel.action('refresh');
        current = await f.state();
        assert.match(panel.html(), /天气已更新/);
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

// ---- Real vs fictional locations: kind detection and climate adaptation ----

test('location kinds: real table cities, worldbook-named fictional cities, and unconfirmed places', () => {
    const context = { name1: 'Sam', characterId: 0, powerUserSettings: { persona_description: 'Sam 在虚构的云京城生活。' },
        characters: [{ name: 'Alex', avatar: 'alex.png', data: { description: 'Alex 久居虚构的雾港城。', character_book: { entries: [{ enabled: true, content: '虚构的上海是云京国的港口。' }] } } }] };
    assert.equal(locationKind('北京', context), 'real');
    assert.equal(locationKind('雾港城', context), 'fictional');
    assert.equal(locationKind('上海', context), 'fictional', 'a same-named place in the world material is fictional');
    assert.equal(locationKind('无名小城', context), 'unconfirmed');
    assert.equal(locationKind('', context), 'unconfirmed');
});

test('fictional and unconfirmed places never borrow a same-named real city climate', () => {
    const context = { name1: 'Sam', characters: [], powerUserSettings: { persona_description: '' } };
    void context;
    assert.equal(climateFor('上海', null, 'real').archetype, 'cfa');
    assert.equal(climateFor('上海', null, 'fictional', context).fictional, true);
    assert.notEqual(JSON.stringify(climateFor('上海', null, 'fictional', context)), JSON.stringify(climateFor('上海', null, 'real')));
    assert.notEqual(JSON.stringify(climateFor('上海', null, 'unconfirmed', context)), JSON.stringify(climateFor('上海', null, 'real')));
});

test('worldbook climate settings drive a fictional city weather profile', async () => {
    const f = setup([{ mes: '2008-10-15 10:00\n开场。', is_user: false }]);
    try {
        f.c.characters[0] = { name: 'Alex', avatar: 'alex.png', data: { character_book: { entries: [{ enabled: true, content: '云京城地处热带，全年炎热，夏季多暴雨。' }] } } };
        f.c.chat.push(marker('2026-10-15 10:00\nThe caravan reached 云京城.', '云京城'));
        await f.memory.read();
        await f.weather.refresh();
        const record = (await f.state()).weather['云京城'];
        assert.equal(record.kind, 'fictional');
        assert.equal(record.climate.archetype, 'af');
        assert.equal(record.climate.fromWorld, true);
        const clock = { day: dateDay('2008-10-15'), hour: 10 };
        let sum = 0; for (let i = 0; i < 300; i++) sum += initialWeather(record.climate, clock, freshRng(i)).temp;
        assert.ok(sum / 300 > 22, 'the worldbook tropical setting keeps the city hot');
        await f.weather.refresh();
        assert.equal((await f.state()).weather['云京城'].climate.archetype, 'af', 'the saved profile is reused, not re-rolled');
    } finally { f.close(); }
});

test('the same fictional city name in a different world gets a different climate', () => {
    const cold = { name1: 'Sam', characterId: 0, characters: [{ name: 'Alex', avatar: 'a.png', data: { character_book: { entries: [{ enabled: true, content: '云京城地处极地，冰原茫茫，常年寒风。' }] } } }] };
    const hot = { name1: 'Sam', characterId: 0, characters: [{ name: 'Alex', avatar: 'a.png', data: { character_book: { entries: [{ enabled: true, content: '云京城地处热带，全年炎热。' }] } } }] };
    assert.equal(worldClimate('云京城', cold).archetype, 'et');
    assert.equal(worldClimate('云京城', hot).archetype, 'af');
});

// ---- 昼夜自动主题（手机本地时间）与视图结构 ----

test('day-night themes switch exactly at 06:00, 16:00 and 20:00 local time', () => {
    const at = (h, m = 0) => new Date(2026, 4, 1, h, m);
    assert.equal(themeFor(at(5, 59)), 'night');
    assert.equal(themeFor(at(6, 0)), 'mist');
    assert.equal(themeFor(at(15, 59)), 'mist');
    assert.equal(themeFor(at(16, 0)), 'apricot');
    assert.equal(themeFor(at(19, 59)), 'apricot');
    assert.equal(themeFor(at(20, 0)), 'night');
    assert.equal(themeFor(at(23, 30)), 'night');
    assert.equal(themeFor(at(0, 30)), 'night');
    assert.deepEqual(nextThemeChange(at(9, 0)), at(16, 0));
    assert.deepEqual(nextThemeChange(at(17, 0)), at(20, 0));
    assert.deepEqual(nextThemeChange(at(21, 0)), new Date(2026, 4, 2, 6, 0));
    assert.deepEqual(nextThemeChange(at(3, 0)), at(6, 0));
    assert.deepEqual(nextThemeChange(at(15, 59)), at(16, 0));
});

test('weather theme follows the story hour when known and falls back to local time only if unknown',()=>{
    const at=(h)=>new Date(2026,4,1,h,0);
    assert.equal(themeForStory({hour:9},at(23)),'mist');
    assert.equal(themeForStory({hour:17},at(9)),'apricot');
    assert.equal(themeForStory({hour:22},at(9)),'night');
    assert.equal(themeForStory({hour:null},at(17)),'apricot');
    assert.equal(themeForStory(null,at(23)),'night');
    for(const [type,theme,expected] of [
        ['sunny','mist','day'],['sunny','apricot','dusk'],['sunny','night','night'],
        ['rain','mist','rain'],['drizzle','night','rain'],['storm','apricot','rain'],
        ['snow','night','night']]){
        assert.equal(weatherPhoto(type,theme),expected);
        assert.match(sceneBackdrop(type,theme),new RegExp(expected+'\\.webp'));
    }
});

test('all four weather photographs are bundled real WebP files, not embedded previews or remote images',async()=>{
    const {readFileSync,statSync}=await import('node:fs');
    for(const name of ['day','dusk','night','rain']){
        const file=new URL('../assets/weather/'+name+'.webp',import.meta.url);
        assert.ok(statSync(file).size>45000,'photo '+name+' must be a sizeable WebP derivative');
        const header=readFileSync(file).subarray(0,12);
        assert.equal(header.subarray(0,4).toString('ascii'),'RIFF');
        assert.equal(header.subarray(8,12).toString('ascii'),'WEBP');
    }
    const credit=readFileSync(new URL('../assets/weather/SOURCES.md',import.meta.url),'utf8');
    assert.match(credit,/2916 × 5184/);
    assert.match(credit,/4608 × 3072/);
    assert.match(credit,/4000 × 6000/);
    assert.doesNotMatch(sceneBackdrop('sunny','mist'),/data:image\/webp|images\.pexels|images\.unsplash/);
});

test('24 real forecast hours continue across midnight and seven-day ranges use saved model-free data',async()=>{
    const f=setup();try{
        f.c.chat.push(marker('2026-01-01 10:00\nSam arrived in Shanghai.','上海'));
        await f.memory.read();await f.weather.refresh();
        const info=f.weather.report(await f.state()),clock=info.clock;
        assert.equal(info.forecast.days.length,7);
        const hours=upcomingHours(info.forecast,23);
        assert.equal(hours.length,24);
        assert.equal(hours[0].hour,23);
        assert.equal(hours[1].hour,0);
        assert.equal(hours[23].hour,22);
        assert.equal(hours[0].isNow,true);
        assert.equal(hours[1].isNow,false);
    }finally{f.close();}
});

test('redesigned Chinese weather panel keeps location edits, refresh, 24-hour and seven-day forecast with four photo cases',async()=>{
    const f=setup();try{
        f.c.chat.push(marker('2026-01-01 10:00\nSam arrived in Shanghai.','上海'));
        await f.memory.read();await f.weather.refresh();
        const state=await f.state();
        const base=f.weather.report(state);
        const make=(hour,type)=>createWeatherPanel({
            adapter:{weather:{report:()=>({...base,clock:{...base.clock,hour},report:{...base.report,type}})}},
            getView:()=>({...state,busy:false}),redraw(){},notice(){},now:()=>new Date(2026,4,1,12),
            assetBase:'https://example.invalid/pocket-phone/assets/weather/'
        });
        for(const [hour,type,theme,photo] of [
            [9,'sunny','mist','day'],[17,'sunny','apricot','dusk'],
            [23,'sunny','night','night'],[13,'rain','mist','rain']
        ]){
            const panel=make(hour,type),html=panel.html();
            assert.match(html,new RegExp('data-wtheme="'+theme+'"'));
            assert.match(html,new RegExp('data-photo="'+photo+'"'));
            assert.match(html,new RegExp('assets/weather/'+photo+'\\.webp'));
            assert.match(html,/<b>上海<\/b>/);
            assert.match(html,/pp-weather-hero-copy/);
            assert.match(html,/pp-weather-highlow/);
            assert.match(html,/24小时天气/);
            assert.match(html,/未来7天天气预报/);
            assert.match(html,/pp-weather-hours/);
            assert.match(html,/pp-weather-hour-now/);
            assert.match(html,/pp-weather-week/);
            assert.match(html,/pp-weather-tempbar/);
            assert.match(html,/pp-weather-day-now/);
            assert.match(html,/pp-weather-metrics/);
            for(const label of ['体感温度','降水情况','风力','湿度'])assert.match(html,new RegExp(label));
            assert.match(html,/data-press="weather-location"/);
            assert.match(html,/aria-label="刷新天气"/);
            assert.doesNotMatch(html,/剧情时间|pp-weather-refresh|pp-weather-art-main/);
            assert.deepEqual(panel.press({dataset:{press:'weather-location'}}).map(a=>a.icon),['edit']);
        }
        assert.equal(sceneBackdrop('rain','night').includes('rain.webp'),true);
        const unavailable=createWeatherPanel({adapter:{weather:f.weather},getView:()=>({...state,location:null,busy:false}),redraw(){},now:()=>new Date(2026,4,1,9)});
        assert.match(unavailable.html(),/尚未标记位置/);
        assert.match(unavailable.html(),/data-weather-action="refresh"/);
    }finally{f.close();}
});

test('common Los Angeles labels stay real and use one climate profile',()=>{
 for(const label of ['洛杉矶','洛杉磯市','美国洛杉矶','洛杉矶（加州）','Los Angeles','Los Ángeles, CA','Los Angeles, California, USA']){
  assert.equal(locationKind(label,{}),'real',label);
  assert.equal(climateFor(label,null,'real').archetype,'csa',label);
 }
 assert.equal(locationKind('新洛杉矶城',{}),'unconfirmed');
});

// ---- Locally derived UV, AQI and active extreme-weather alert cards ----

test('UV and AQI are deterministic local metrics that respond to solar time and weather', () => {
    const climate = climateFor('上海'), day = dateDay('2026-07-01');
    const sunny = environmentMetrics(climate, 'sunny', 30, 2, 52, day * 24 + 12, 'weather-seed', 'shanghai');
    const same = environmentMetrics(climate, 'sunny', 30, 2, 52, day * 24 + 12, 'weather-seed', 'shanghai');
    const night = environmentMetrics(climate, 'sunny', 24, 1, 58, day * 24 + 0, 'weather-seed', 'shanghai');
    const dusty = environmentMetrics(climate, 'dust', 31, 5, 28, day * 24 + 12, 'weather-seed', 'shanghai');
    assert.deepEqual(same, sunny, 'same saved seed and story hour always produce the same metrics');
    assert.ok(sunny.uv >= 6 && sunny.uv <= 11, 'summer noon sunlight produces a high UV reading');
    assert.equal(night.uv, 0, 'UV falls to zero at night');
    assert.ok(dusty.aqi > sunny.aqi, 'a simulated dust storm raises the air-quality index');
    for (const metrics of [sunny, night, dusty]) {
        assert.ok(Number.isInteger(metrics.uv) && metrics.uv >= 0 && metrics.uv <= 11);
        assert.ok(Number.isInteger(metrics.aqi) && metrics.aqi >= 5 && metrics.aqi <= 500);
        assert.ok(metrics.uvLevel && metrics.aqiLevel);
    }
});

test('extreme weather warnings support all four color grades and respond to simulated intensity', () => {
    assert.equal(weatherWarning('rain'), null);
    assert.deepEqual(weatherWarning('storm', { wind: 4, humidity: 50 }), {
        level: '黄色', color: 'yellow', grade: 'Ⅲ级', title: '暴雨',
        detail: '当前出现暴雨天气，留意强降雨和积水。', type: 'storm',
    });
    assert.deepEqual(
        [6, 8, 10, 12].map(wind => weatherWarning('dust', { wind }).color),
        ['blue', 'yellow', 'orange', 'red'],
    );
    assert.deepEqual(
        [34, 36, 41, 45].map(temp => weatherWarning('heat', { temp }).grade),
        ['Ⅳ级', 'Ⅲ级', 'Ⅱ级', 'Ⅰ级'],
    );
    assert.deepEqual(
        [-5, -15, -25, -35].map(temp => weatherWarning('cold', { temp }).color),
        ['blue', 'yellow', 'orange', 'red'],
    );
    assert.equal(weatherWarning('typhoon', { wind: 8 }).level, '橙色');
    assert.equal(weatherWarning('typhoon', { wind: 10 }).level, '红色');
    assert.equal(weatherWarning('severe', { wind: 8 }).grade, 'Ⅰ级');
});

test('weather reports expose stable UV/AQI readings and the weather panel renders six matching metrics plus active alerts', async () => {
    const f = setup();
    try {
        f.c.chat.push(marker('2026-01-01 10:00\\nSam arrived in Shanghai.', '上海'));
        await f.memory.read();
        await f.weather.refresh();
        const state = await f.state();
        const base = f.weather.report(state);
        assert.equal(base.status, 'ok');
        assert.ok(Number.isInteger(base.report.uv));
        assert.ok(Number.isInteger(base.report.aqi));
        assert.equal(base.report.uv, f.weather.report(state).report.uv);
        assert.equal(base.report.aqi, f.weather.report(state).report.aqi);

        const make = (type, overrides = {}) => createWeatherPanel({
            adapter: { weather: { report: () => ({
                ...base,
                report: { ...base.report, type, label: weatherType(type), extreme: weatherExtreme(type),
                    uv: 7, uvLevel: '高', aqi: 138, aqiLevel: '轻度污染', ...overrides },
            }) } },
            getView: () => ({ ...state, busy: false }), redraw() {},
            now: () => new Date(2026, 4, 1, 12),
        });
        const normal = make('sunny').html();
        for (const label of ['体感温度', '降水情况', '风力', '湿度', '紫外线', '空气质量'])
            assert.ok(normal.includes(label), 'metric card present: ' + label);
        assert.match(normal, /pp-weather-metric-uv/);
        assert.match(normal, /pp-weather-metric-air/);
        assert.match(normal, />138<|>7</);
        assert.doesNotMatch(normal, /pp-weather-warning/);

        const blue = make('dust', { wind: 6 }).html();
        assert.match(blue, /pp-weather-warning-blue/);
        assert.match(blue, /蓝色预警 · Ⅳ级/);
        const yellow = make('heat', { temp: 36 }).html();
        assert.match(yellow, /pp-weather-warning-yellow/);
        assert.match(yellow, /黄色预警 · Ⅲ级/);
        const orange = make('storm', { wind: 8, humidity: 50 }).html();
        assert.match(orange, /pp-weather-warning-orange/);
        assert.match(orange, /橙色预警 · Ⅱ级/);
        assert.match(orange, /暴雨/);
        const red = make('typhoon', { wind: 10 }).html();
        assert.match(red, /pp-weather-warning-red/);
        assert.match(red, /红色预警 · Ⅰ级/);
        assert.match(red, /台风/);
    } finally { f.close(); }
});
