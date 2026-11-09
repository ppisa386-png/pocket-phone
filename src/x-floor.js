import {effectiveReply} from './contact-policy.js?v=1.2';
import {xAudience} from './x-audience.js?v=1.2';

// Message indices are zero-based in storage; displayed floor numbers are index + 1.
export const X_FLOOR_LEDGER='follower-floor-ledger';
export const X_FLOOR_VERSION=2;
export function coveredFloors(ranges=[]) {
    const sorted=(Array.isArray(ranges)?ranges:[]).filter(r=>Array.isArray(r)&&r.length===2&&
        Number.isSafeInteger(r[0])&&Number.isSafeInteger(r[1])&&r[0]>=0&&r[1]>=r[0]).sort((a,b)=>a[0]-b[0]);
    const result=[];
    for(const [start,end] of sorted){
        const previous=result.at(-1);
        if(previous&&start<=previous[1]+1)previous[1]=Math.max(previous[1],end);
        else result.push([start,end]);
    }
    return result;
}
const alreadyCovered=(index,ranges)=>ranges.some(([start,end])=>start<=index&&index<=end);
export function hasUnsettledFloors(chat,ledger,floor) {
    if(!ledger||ledger.type!=='floor-ledger'||ledger.version!==X_FLOOR_VERSION)return true;
    const ranges=coveredFloors(ledger.ranges);
    return (chat||[]).some((message,index)=>index<=floor&&effectiveReply(message)&&!alreadyCovered(index,ranges));
}
function visibleProse(message){
    return String(message?.mes??'').replace(/<!--[\s\S]*?(?:-->|$)/g,'')
        .replace(/<(think|thinking|analysis|script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,'')
        .replace(/```[\s\S]*?```/g,'').trim();
}
export function pendingFloorBatch(chat,ranges,floor,maxChars=32000,recentFirst=false) {
    const paid=coveredFloors(ranges),eligible=[];
    for(let i=0;i<=(Math.min(floor,(chat||[]).length-1));i++){
        if(!effectiveReply(chat[i])||alreadyCovered(i,paid))continue;
        const text=visibleProse(chat[i]);if(!text)continue;
        eligible.push({sourceIndex:i,floor:i+1,text});
    }
    const rows=[];let size=0;
    for(const row of recentFirst?eligible.reverse():eligible){
        if(rows.length&&size+row.text.length+64>maxChars)break;
        rows.push(row);size+=row.text.length+64;
    }
    rows.sort((a,b)=>a.sourceIndex-b.sourceIndex);
    return {rows,lastIndex:rows.at(-1)?.sourceIndex??null};
}
export const coverThrough=(ranges,end)=>end===null?coveredFloors(ranges):coveredFloors([...(ranges||[]),[0,end]]);
export function floorAudienceChanges(state,effects){
    if(!Array.isArray(effects))throw Error('楼层粉丝变化缺少 effects 数组。');
    const audience=xAudience(state);
    if(!audience)throw Error('请先确定 X 初始粉丝数。');
    const safe=n=>Number.isSafeInteger(n)&&n>=0;
    const seen=new Set();let gained=0,lost=0;
    for(const effect of effects){
        const post=state.x?.[effect?.postId];
        if(post?.type!=='post'||post.author!=='user'||!state.x?.['impact:post:'+effect.postId])
            throw Error('楼层粉丝变化引用了未评估的推文。');
        if(seen.has(effect.postId))throw Error('同一推文不能重复列入本次楼层粉丝变化。');
        seen.add(effect.postId);
        if(!safe(effect.gained)||!safe(effect.lost))throw Error('楼层粉丝变化必须是非负安全整数。');
        gained+=effect.gained;lost+=effect.lost;
        if(!safe(gained)||!safe(lost))throw Error('楼层粉丝变化总量超出安全范围。');
    }
    const followers=Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,audience.followers+gained-lost));
    return [{collection:'x',key:'audience',value:{...audience,followers}}];
}
