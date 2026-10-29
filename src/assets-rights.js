import { dateDay } from './story-clock.js?v=1.0.5';

// Dates delimit [fromDay, toDay): changes take effect at the start of their day.
// expiresOn is inclusive, so that right ends at the next day's boundary.
export function validateRights(value) {
    if (value == null) return {};
    if (typeof value !== 'object' || Array.isArray(value)) throw Error('权益条件格式不正确。');
    const result = {};
    if (Object.hasOwn(value, 'sharePercent')) {
        if (value.sharePercent !== null && (typeof value.sharePercent !== 'number' || !Number.isFinite(value.sharePercent) || value.sharePercent <= 0 || value.sharePercent > 100)) throw Error('保留权益比例须大于0且不超过100；全部终止请使用dispose。');
        result.sharePercent = value.sharePercent;
    }
    if (Object.hasOwn(value, 'expiresOn')) {
        if (value.expiresOn !== null && dateDay(value.expiresOn) === null) throw Error('权益到期日期无效。');
        result.expiresOn = value.expiresOn;
    }
    return result;
}
export function rightsHistory(holding) {
    return holding.termsHistory?.length ? holding.termsHistory : [{fromDay:holding.startDay,details:holding.details||'',rights:holding.rights||{}}];
}
export function holdingEnd(holding) {
    const expires = dateDay(holding.rights?.expiresOn);
    return Math.min(holding.endDay ?? Infinity, expires === null ? Infinity : expires + 1);
}
export function expiryChanges(state, day) {
    if (day === null) return [];
    return Object.values(state.assets||{}).filter(h=>h.type==='holding'&&h.active!==false&&holdingEnd(h)<=day)
        .map(h=>({collection:'assets',key:h.id,value:{...h,active:false,endDay:holdingEnd(h),expired:true}}));
}
export function businessPeriods(holding, from, to) {
    if (!holding || holding.type!=='holding' || holding.category!=='investment' || from==null || to==null || holding.startDay==null || holding.active===false && !Number.isFinite(holding.endDay)) return [];
    const history=rightsHistory(holding), result=[];
    for(let i=0;i<history.length;i++){
        const terms=history[i]; if(terms.fromDay==null)continue;
        const expiry=dateDay(terms.rights?.expiresOn);
        const start=Math.max(from,holding.startDay,terms.fromDay);
        const end=Math.min(to,holding.endDay??Infinity,history[i+1]?.fromDay??Infinity,expiry===null?Infinity:expiry+1);
        if(start<end)result.push({fromDay:start,toDay:end,details:terms.details,rights:terms.rights||{}});
    }
    return result;
}
export function validateBusinessPeriod(holding, item, from, to) {
    const periods=businessPeriods(holding,from,to);
    const explicit=item.from!=null||item.to!=null;
    const start=explicit?dateDay(item.from):from, end=explicit?dateDay(item.to):to;
    if(start===null||end===null||start>=end||!periods.some(p=>start>=p.fromDay&&end<=p.toDay))throw Error('收益期间超出有效持有期或跨越权益变更，请按有效期间分段结算。');
    return {fromDay:start,toDay:end};
}
