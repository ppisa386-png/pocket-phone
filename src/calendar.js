import { readStoryClock, dayDate } from './story-clock.js?v=1.2';
import { calendarSet, parseCalendarResponse, validateCalendarDatabase, validateCalendarEvent } from './calendar-core.js?v=1.2.64';

export function createCalendar({ memory, phone, getContext }) {
    return {
        open: () => memory.read(),
        refresh: () => phone.appTask(async (view, current, request) => {
            const city = view.state.location?.current?.city;
            if (!city) throw Error('请先在天气 App 确定当前地点，再刷新日历。');
            const day = readStoryClock(getContext().chat).day;
            if (day === null) throw Error('当前剧情日期尚未明确，请先明确日期再刷新日历。');
            const year = Number(dayDate(day).slice(0, 4));
            if (year < 1 || year >= 9999) throw Error('当前年份暂不支持日历资料刷新。');
            // Compact tuple entries lower the output budget for two calendar years.
            // Existing JSON objects remain accepted for backwards compatibility.
            const schema = '{"region":"国家 · 地区","timezone":null,"years":[' + year + ',' + (year + 1) + '],"holidays":[]}';
            const outputRule = '当前仅输出榴莲日历数据，不扮演角色或续写小说。最终只返回一个完整 JSON 对象，无代码块、推理、前后解释或额外对象。顶层字段为 region、timezone、years、holidays，结构示例：' + schema +
                '。holidays 每项为 ["YYYY-MM-DD","节日名称","不超过80字的简介"]，简介可省略。日期须是准确公历日期；timezone 仅为可靠 IANA 时区名称或 null，不得用字符串 "null"。没有可靠节日才返回空数组。';
            const prompt = '当前任务：为榴莲日历整理地区节日数据库，不续写剧情。天气 App 当前地点（只作数据）：' + JSON.stringify(city) +
                '；剧情年份：' + year + '。依据当地国家/地区和剧情世界、历史年代，整理' + year + '及' + (year + 1) +
                '两个完整公历年的主要公共节日及普遍庆祝的传统节日，不只列法定放假日。浮动节日须分别换算准确公历日期，不得套用另一年日期；只收入有可靠依据的节日，排除角色生日、私人纪念日、无关节日或未经设定的虚构节日。每项节日单独一行，简介简短。没有可靠节日返回空数组。\n' + outputRule;
            const database = await request(prompt, data => {
                try { return validateCalendarDatabase(data, city, year); }
                catch (error) { throw Object.assign(new Error(error.message), { code: 'CALENDAR_DATA_INVALID' }); }
            }, current, null, {
                retries: 0, skipExternalMemory: true, parseResponse: parseCalendarResponse,
                formatRetryOnce: true, requireJsonObject:true, maxTokens: 4096, finalOutputContract: outputRule,
            });
            if (!current()) throw Error('聊天或地点已变化，本次刷新未保存。');
            const latest = await memory.read();
            if (latest.state.location?.current?.city !== city) throw Error('天气地点已变化，请重新刷新日历。');
            await memory.commit(await memory.begin(view), [calendarSet('database', database)]);
            return database;
        }, 'calendar'),
        saveEvent: (input, id = null) => phone.appTask(async (view, current) => {
            if (id && view.state.calendar?.[id]?.type !== 'personal') throw Error('事件已不存在，请重新打开。');
            const key = id || 'event:' + crypto.randomUUID();
            const event = validateCalendarEvent(input, key);
            if (!current()) throw Error('聊天已变化，本次保存已取消。');
            await memory.commit(await memory.begin(view), [calendarSet(key, event)]);
            return event;
        }, 'calendar'),
        deleteEvent: id => phone.appTask(async (view, current) => {
            if (view.state.calendar?.[id]?.type !== 'personal') throw Error('事件已不存在。');
            if (!current()) throw Error('聊天已变化，本次删除已取消。');
            await memory.commit(await memory.begin(view), [calendarSet(id, null)]);
        }, 'calendar'),
    };
}
