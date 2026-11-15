import { dateDay, exactStoryTime } from './story-clock.js?v=1.2';

const validTime = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value||'');
const minutes = value => validTime(value) ? Number(value.slice(0,2))*60+Number(value.slice(3)) : null;
// Prefer the actual sending floor for queued messages. Old records may keep
// their full date in the journal sidecar; never infer it from device createdAt.
export function communicationTime(record, meta = {}) {
    const stored=record?.storyTime||{},anchor=meta?.anchor||{};
    if(meta?.sentAfterQueue&&dateDay(anchor.date)!==null)return {...anchor};
    const date=dateDay(stored.date)!==null?stored.date:dateDay(anchor.date)!==null?anchor.date:'';
    const time=validTime(stored.time)?stored.time:date===anchor.date&&validTime(anchor.time)?anchor.time:'';
    return {date,time,precision:stored.precision||anchor.precision||'exact'};
}
export function withinCommunicationWeek(stamp, now) {
    const day=dateDay(stamp?.date),today=dateDay(now?.date);
    if(day===null||today===null)return false;
    const days=today-day,sent=minutes(stamp?.time),current=minutes(now?.time);
    if(sent!==null&&current!==null){const elapsed=days*1440+current-sent;return elapsed>=0&&elapsed<=7*1440;}
    // Without exact times only include dates certainly within seven days.
    return days>=0&&days<7;
}
export function displayCommunicationTime(record, chat = [], meta = {}) {
    const stamp=communicationTime(record,meta),now=exactStoryTime(chat);
    const day=dateDay(stamp.date),today=dateDay(now.date),time=stamp.time;
    if(day===null)return time||'—';
    const days=today===null?null:today-day,sent=minutes(time),current=minutes(now.time);
    if(days===0||(days===1&&sent!==null&&current!==null&&days*1440+current-sent<=1440))return time||stamp.date;
    const label=days===1?'昨天':days===2?'前天':days>2&&days<7?'周'+'日一二三四五六'[new Date(day*86400000).getUTCDay()]:stamp.date;
    return label+(time?' '+time:'');
}
