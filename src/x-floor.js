import {effectiveReply} from './contact-policy.js?v=1.2.57';
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
// A strong public-virality statement warrants a reviewed audience outcome,
// not an automatic multiplier. An unresolved response must not consume its floor.
const PUBLIC_REACH_CUE = /(?:\bX\b|推文|推特|发推|帖子|发帖|热搜|转发|点赞|评论区|粉丝|账号|视频|社交平台|Twitter)/i;
const STRONG_REACH_CUE = /(?:大爆|爆火|爆红|爆款|爆了|疯传|刷屏|出圈|火遍|病毒式传播|(?:数据|阅读量|浏览量|播放量|点赞数|点赞量|转发量|评论数|粉丝数|粉丝量|互动量|热度)(?:明显)?(?:暴涨|激增|飙升|暴增|猛增|翻倍|创新高|破(?:了)?[千万亿0-9]+)|\b(?:went viral|going viral|blew up|trending everywhere)\b)/gi;
const NEGATED_REACH_CUE = /(?:没有|并未|不曾|尚未|未曾|不可能|并非|不是|假如|如果|计划|打算|希望|并不)\s*$/;
export function strongReachFloors(rows=[]) {
    return (Array.isArray(rows)?rows:[]).filter(row=>{
        if(!Number.isInteger(row?.sourceIndex)||typeof row.text!=='string')return false;
        for(const match of row.text.matchAll(STRONG_REACH_CUE)){
            const at=match.index,nearby=row.text.slice(Math.max(0,at-100),Math.min(row.text.length,at+match[0].length+100));
            const prefix=row.text.slice(Math.max(0,at-16),at);
            if(PUBLIC_REACH_CUE.test(nearby)&&!NEGATED_REACH_CUE.test(prefix))return true;
        }
        return false;
    }).map(row=>row.sourceIndex);
}
export function requireReachResolution(result,rows) {
    const focused=strongReachFloors(rows);
    if(!focused.length||(Array.isArray(result?.effects)&&result.effects.some(e=>e.gained>0||e.lost>0)))return;
    for(const index of focused){
        const review=Array.isArray(result?.noGrowthReview)?result.noGrowthReview.find(r=>
            r?.sourceIndex===index&&['unrelated','already_counted','no_new_audience'].includes(r.classification)&&
            typeof r.reason==='string'&&r.reason.trim().length>=8):null;
        if(!review)throw Object.assign(new Error('第'+(index+1)+'楼明确提到公开传播爆发，但 X 模型未确认新增影响、也未说明为什么无需新增结算。本次没有保存或划掉该楼层，可重新刷新。'),
            {code:'X_REACH_UNRESOLVED',retryable:false});
    }
}

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
