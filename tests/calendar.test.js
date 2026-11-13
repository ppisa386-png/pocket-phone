import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhoneMemory } from '../src/memory.js';
import { createPhoneService } from '../src/phone.js';
import { normalizeSettings } from '../src/config.js';
import { createCalendar } from '../src/calendar.js';
import { createCalendarBridge, CALENDAR_KEY } from '../src/calendar-story.js';
import { createCalendarPanel } from '../src/calendar-view.js';
import { calendarOccurrences, calendarMonth, calendarDue, calendarSet, parseCalendarResponse, validateCalendarDatabase, validateCalendarEvent } from '../src/calendar-core.js';
import { dateDay } from '../src/story-clock.js';
const data = () => ({ region: '日本 · 东京', timezone: 'Asia/Tokyo', years: [2026, 2027], holidays: [
    { name: '节日甲', date: '2026-11-16', note: '公开节日背景' }, { name: '节日乙', date: '2026-11-16' },
    { name: '元旦', date: '2027-01-01' }, { name: '文化之日', date: '2026-11-03' },
] });
async function setup(independentClient = null) {
    const handlers = new Map(), bus = { on(n, f) { handlers.set(n, [...(handlers.get(n) || []), f]); }, removeListener(n, f) { handlers.set(n, (handlers.get(n) || []).filter(x => x !== f)); }, async emit(n, ...args) { for (const fn of [...(handlers.get(n) || [])]) await fn(...args); } };
    let response = data(), calls = 0, prompt = '';
    const c = { chatId: 'calendar', characterId: 0, characters: [{ name: 'Alex', avatar: 'a' }], name1: 'Sam', onlineStatus: 'connected', chatMetadata: {},
        chat: [{ mes: '2026-11-13 09:00\n在东京休息。', is_user: false }], saveMetadata: async () => {}, eventSource: bus,
        event_types: Object.fromEntries(['CHAT_CHANGED','MESSAGE_DELETED','MESSAGE_EDITED','GENERATION_STARTED','GENERATION_AFTER_COMMANDS','GENERATION_ENDED','GENERATION_STOPPED','CHAT_COMPLETION_PROMPT_READY','CHAT_COMPLETION_SETTINGS_READY'].map(n => [n, n])),
        extensionPrompts: {}, setExtensionPrompt(k, value, _a, _b, _c, _d, filter) { this.extensionPrompts[k] = { value, filter }; },
        generateQuietPrompt: async o => { calls++; prompt = o.quietPrompt; return typeof response === 'function' ? response() : JSON.stringify(response); } };
    const settings = normalizeSettings({ retries: 0, ...(independentClient ? { api: { mode: 'independent' } } : {}) });
    const memory = createPhoneMemory({ getContext: () => c }), phone = createPhoneService({ memory, getContext: () => c, getSettings: () => settings, modelClient: independentClient });
    const calendar = createCalendar({ memory, phone, getContext: () => c }), errors = [];
    const bridge = createCalendarBridge({ memory, getContext: () => c, getSettings: () => settings, onError: e => errors.push(e.message) });
    await memory.commit(await memory.begin(), [{ collection: 'location', key: 'current', value: { city: '东京', manual: true } }]);
    const f = { c, bus, settings, memory, phone, calendar, bridge, errors, calls: () => calls, prompt: () => prompt, state: () => phone.snapshot(), reply: r => response = r,
        async prepare(type = 'normal', dry = false) { await bus.emit('GENERATION_STARTED', type, {}, dry); await bus.emit('GENERATION_AFTER_COMMANDS', type, {}, dry); const d = { chat: [{ role: 'user', content: '继续' }], type, dryRun: dry }; await bus.emit('CHAT_COMPLETION_PROMPT_READY', d); await bus.emit('CHAT_COMPLETION_SETTINGS_READY', { ...d, messages: d.chat }); return d.chat; },
        async finish(text = '角色继续日常生活。') { c.chat.push({ mes: text, is_user: false }); await bus.emit('GENERATION_ENDED'); await memory.read(); },
        close() { bridge.destroy(); phone.destroy(); memory.destroy(); } };
    return f;
}
const ok = result => assert.equal(result.ok, true, result.error);
const receipts = state => Object.values(state.calendar || {}).filter(r => r.type === 'reminder');
test('calendar validates years, true dates, IANA zone, malformed data and duplicate holidays', () => {
    const input = data(); input.holidays.push(input.holidays[0]);
    const db = validateCalendarDatabase(input, '东京', 2026); assert.equal(db.holidays.length, 4);
    for (const invalid of [{ ...data(), years: [2026] }, { ...data(), timezone: 'Tokyo' }, { ...data(), holidays: [{ name: 'bad', date: '2026-02-29' }] }, { ...data(), holidays: [{ name: 'bad', date: '2028-01-01' }] }]) assert.throws(() => validateCalendarDatabase(invalid, '东京', 2026));
    assert.throws(() => validateCalendarEvent({ name: '', date: '2026-11-13' }, 'x'));
    assert.throws(() => validateCalendarEvent({ name: 'a', date: '2026-02-29', repeat: 'yearly', kind: 'anniversary' }, 'x'));
});
test('month grid starts Sunday, handles six weeks, leap years and centuries without local timezone', () => {
    for (const [y, m] of [[2026,11],[2027,1],[2000,2],[2100,2],[99,1],[2026,8]]) {
        const grid = calendarMonth(y,m); assert.ok([28,35,42].includes(grid.length)); assert.equal(new Date(grid[0].day*86400000).getUTCDay(),0);
        assert.ok(grid.every((r,i)=>r.day===grid[0].day+i));
    }
    assert.equal(calendarMonth(2026,8).length,42);
    assert.equal(calendarMonth(2000,2).filter(r=>r.current).length,29);
    assert.equal(calendarMonth(2100,2).filter(r=>r.current).length,28);
});
test('yearly events skip invalid leap anniversaries and dates before origin; cross-year countdown is exact', () => {
    const state = { calendar: { leap: { id:'leap',type:'personal',kind:'anniversary',name:'闰日',date:'2024-02-29',repeat:'yearly' }, future: {id:'future',type:'personal',name:'未来',date:'2030-01-01',repeat:'yearly'} } };
    assert.equal(calendarOccurrences(state,dateDay('2025-01-01'),dateDay('2025-12-31')).length,0);
    assert.equal(calendarOccurrences(state,dateDay('2028-01-01'),dateDay('2028-12-31'))[0].date,'2028-02-29');
    const db=validateCalendarDatabase(data(),'东京',2026);state.calendar.database=db;
    assert.equal(calendarOccurrences(state,dateDay('2026-12-30'),dateDay('2027-01-02'))[0].day-dateDay('2026-12-30'),2);
});
test('refresh uses weather location once, saves source/zone/range, open/select never call model', async () => {
    const f=await setup();try{ok(await f.calendar.refresh());assert.equal(f.calls(),1);assert.match(f.prompt(),/东京/);assert.equal(f.state().calendar.database.timezone,'Asia/Tokyo');
        await f.calendar.open();const panel=createCalendarPanel({adapter:{calendar:f.calendar,storyChat:()=>f.c.chat},getView:f.state,redraw(){}});
        assert.match(panel.html(),/榴莲日历/);await panel.action('next');await panel.action('select','2026-12-31');assert.match(panel.html(),/12月31日/);assert.equal(f.calls(),1);
    }finally{f.close();}
});
test('refresh preserves personal CRUD and receipts, failure preserves database, region replacement removes old holidays', async () => {
    const f=await setup();try{ok(await f.calendar.refresh());ok(await f.calendar.saveEvent({name:'相识',date:'2026-11-16',kind:'anniversary',repeat:'yearly',note:'特别的日子'}));
        const personal=Object.values(f.state().calendar).find(r=>r.type==='personal');
        await f.memory.commit(await f.memory.begin(),[calendarSet('reminder:test',{type:'reminder',stage:'today'})]);const before=f.state().calendar.database;
        f.reply(()=>{throw Error('offline');});assert.equal((await f.calendar.refresh()).ok,false);assert.deepEqual(f.state().calendar.database,before);assert.equal(f.state().calendar[personal.id].name,'相识');
        await f.memory.commit(await f.memory.begin(),[{collection:'location',key:'current',value:{city:'巴黎',manual:true}}]);
        f.reply({...data(),region:'法国 · 巴黎',timezone:'Europe/Paris',holidays:[{name:'新地区节日',date:'2026-12-01'}]});ok(await f.calendar.refresh());
        assert.equal(f.state().calendar.database.holidays.length,1);assert.equal(f.state().calendar.database.city,'巴黎');assert.ok(f.state().calendar['reminder:test']);assert.ok(f.state().calendar[personal.id]);
        ok(await f.calendar.saveEvent({...personal,name:'相识纪念'},personal.id));assert.equal(f.state().calendar[personal.id].name,'相识纪念');
        ok(await f.calendar.deleteEvent(personal.id));assert.equal(f.state().calendar[personal.id],undefined);
    }finally{f.close();}
});
test('same-day festivals and anniversary merge into one actual prompt; only successful prose records stages; repeated opens/refreshes do not repeat', async () => {
    const f=await setup();try{ok(await f.calendar.refresh());ok(await f.calendar.saveEvent({name:'相识',date:'2026-11-16',kind:'anniversary',repeat:'yearly',note:''}));
        let messages=await f.prepare();assert.equal(messages.filter(m=>m.content.includes('榴莲日历')).length,1);assert.match(messages[0].content,/节日甲/);assert.match(messages[0].content,/相识/);assert.doesNotMatch(messages[0].content,/元旦/);
        await f.bus.emit('GENERATION_STOPPED');await f.memory.read();assert.equal(receipts(f.state()).length,0);
        messages=await f.prepare();await f.bus.emit('GENERATION_ENDED');await f.memory.read();assert.equal(receipts(f.state()).length,0);
        await f.prepare();await f.finish();assert.equal(receipts(f.state()).length,2);assert.equal(f.errors.length,0);
        ok(await f.calendar.refresh());messages=await f.prepare();assert.equal(messages.length,1);await f.bus.emit('GENERATION_ENDED');
        f.c.chat.push({mes:'2026-11-16 08:00\n节日到了。',is_user:false});await f.memory.read();messages=await f.prepare();assert.match(messages[0].content,/今天/);await f.finish();assert.equal(receipts(f.state()).length,4);
        messages=await f.prepare();assert.equal(messages.length,1);await f.bus.emit('GENERATION_ENDED');
    }finally{f.close();}
});
test('quiet, impersonate, dry runs, disabled calendar and unknown dates never send reminders', async () => {
    const f=await setup();try{ok(await f.calendar.refresh());for(const type of ['quiet','impersonate']){assert.equal((await f.prepare(type)).length,1);await f.bus.emit('GENERATION_ENDED');}
        assert.equal((await f.prepare('normal',true)).length,1);f.settings.apps.calendar=false;assert.equal((await f.prepare()).length,1);await f.bus.emit('GENERATION_ENDED');
        assert.deepEqual(calendarDue(f.state(),null),[]);assert.equal(receipts(f.state()).length,0);
    }finally{f.close();}
});
test('receipt rolls back with generated floor and is isolated across chat switches', async () => {
    const f=await setup();try{ok(await f.calendar.refresh());await f.prepare();await f.finish();assert.equal(receipts(f.state()).length,1);
        f.c.chat.pop();await f.bus.emit('MESSAGE_DELETED');await f.memory.read();assert.equal(receipts(f.state()).length,0);
        assert.equal((await f.prepare()).length,2);f.c.chatMetadata={};f.c.chatId='other';await f.bus.emit('CHAT_CHANGED');await f.finish('另一段聊天');assert.equal(receipts(f.state()).length,0);assert.equal(f.state().calendar.database,undefined);
    }finally{f.close();}
});
test('host extension slot filter also records delivery; continue can consume after changed assistant text', async () => {
    const f=await setup();try{ok(await f.calendar.refresh());await f.bridge.prepare('continue');assert.equal(f.c.extensionPrompts[CALENDAR_KEY].filter(),true);
        f.c.chat.at(-1).mes+='\n继续写出的内容。';await f.bus.emit('GENERATION_ENDED');await f.memory.read();assert.equal(receipts(f.state()).length,1);
    }finally{f.close();}
});
test('unknown story date or weather place blocks refresh without a request; stale region does not remind', async () => {
    const f=await setup();try{ok(await f.calendar.refresh());const state=f.state();state.location.current.city='巴黎';assert.deepEqual(calendarDue(state,dateDay('2026-11-13')),[]);
        f.c.chat=[{mes:'没有明确日期',is_user:false}];await f.memory.read();assert.equal((await f.calendar.refresh()).ok,false);assert.equal(f.calls(),1);
    }finally{f.close();}
});

test('calendar reads complete wrapped JSON, compact tuples, legacy rows and benign trailing commas', () => {
    const compact = { ...data(), holidays: [['2026-11-16', '节日甲'], ['2027-01-01', '元旦', '简短介绍']] };
    const result = parseCalendarResponse('说明：\n' + ['```json', JSON.stringify(compact), '```'].join('\n'));
    assert.deepEqual(result.holidays, [
        { date: '2026-11-16', name: '节日甲', note: '' },
        { date: '2027-01-01', name: '元旦', note: '简短介绍' },
    ]);
    assert.equal(validateCalendarDatabase(result, '东京', 2026).holidays.length, 2);
    assert.equal(validateCalendarDatabase(parseCalendarResponse(JSON.stringify(data())), '东京', 2026).holidays.length, 4);
    assert.equal(parseCalendarResponse('{"region":"东京","years":[2026,2027],"holidays":[["2026-11-16","节日甲",],],}').holidays.length, 1);
    for (const raw of ['模型暂时无法生成节日', '{"region":"东京"', '{}{}']) {
        assert.throws(() => parseCalendarResponse(raw), error =>
            error.code?.startsWith('MODEL_JSON_') && error.message.includes('节日 JSON') && !error.diagnostic.includes(raw));
    }
});
test('calendar malformed reply triggers one format recovery, failed recovery preserves saved data', async () => {
    const f = await setup(); let returned = 0;
    try {
        f.reply(() => ++returned === 1 ? '这是节日介绍而不是 JSON' :
            ['```json', JSON.stringify({ ...data(), holidays: [['2026-11-16', '节日甲'], ['2027-01-01', '元旦']] }), '```'].join('\n'));
        ok(await f.calendar.refresh());
        assert.equal(f.calls(), 2);
        assert.equal(f.state().calendar.database.holidays.length, 2);
        assert.match(f.prompt(), /榴莲日历格式恢复/);
        const before = f.state().calendar.database;
        f.reply(() => '无效的模型回答');
        const failed = await f.calendar.refresh();
        assert.equal(failed.ok, false);
        assert.equal(failed.code, 'MODEL_JSON_MISSING');
        assert.equal(f.calls(), 4);
        assert.deepEqual(f.state().calendar.database, before);
    } finally { f.close(); }
});
test('independent calendar requests carry a final JSON contract and isolated output ceiling', async () => {
    const calls = [];
    const f = await setup({ generate: async (prompt, contact, current, progress, options) => {
        calls.push({ prompt, options });
        return JSON.stringify({ ...data(), holidays: [['2026-11-16', '节日甲']] });
    } });
    try {
        ok(await f.calendar.refresh());
        assert.equal(calls.length, 1);
        assert.equal(calls[0].options.maxTokens, 4096);
        assert.match(calls[0].options.finalOutputContract, /holidays/);
        assert.equal(f.state().calendar.database.holidays[0].name, '节日甲');
    } finally { f.close(); }
});
