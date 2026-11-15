import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWeatherPanel } from '../src/weather-view.js';
import { createCalendarPanel } from '../src/calendar-view.js';

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('weather shows metrics but not climate-source or simulation disclaimer text', () => {
    const panel = createWeatherPanel({
        adapter: { weather: { report: () => ({
            status: 'ready', city: '东京', climateSource: 'ai-offline-research',
            climateOrigin: 'real_knowledge', clock: { hour: 10 },
            report: { type: 'partly', temp: 21, wind: 2, humidity: 50 },
            forecast: { days: [] },
        }) } },
        getView: () => ({}), redraw() {},
    });
    const rendered = panel.html();
    assert.match(rendered, /天气指标/);
    assert.match(rendered, /体感温度/);
    assert.doesNotMatch(rendered, /气候参考|天气为剧情模拟|pp-weather-source|实时气象观测/);
    assert.doesNotMatch(source('style-weather.css'), /pp-weather-source/);
});

test('calendar settings retains region and time zone without AI source commentary', async () => {
    const state = { calendar: { database: {
        region: '日本 · 东京', regionKey: '东京', timezone: 'Asia/Tokyo',
        city: '东京', years: [2026, 2027], holidays: [],
        source: '使用已配置的 AI 连接', refreshedAt: 0,
    } }, location: { current: { city: '东京' } } };
    const panel = createCalendarPanel({
        adapter: { storyChat: () => [{ mes: '2026-11-15 10:00', is_user: false }] },
        getView: () => state, redraw() {},
    });
    await panel.action('settings');
    const rendered = panel.html();
    assert.match(rendered, /日历地区|时区|资料范围|上次成功刷新/);
    assert.doesNotMatch(rendered, /资料来源|节日由 AI|未连接官方节日数据库|手动刷新时与天气地点同步/);
    assert.doesNotMatch(source('src/calendar-view.js'), /<dt>资料来源<\/dt>/);
});
