// Only public, addressable sources get an impact. A later development has to
// identify a different public record or an evidenced narrative floor.
import {dateDay,readStoryClock} from './story-clock.js?v=1.2';
import {effectiveReply} from './contact-policy.js?v=1.2';
import {xComments} from './x-comments.js?v=1.2';
import {xAudience} from './x-audience.js?v=1.2';

export const refreshFloor=chat=>chat.findLastIndex(effectiveReply);
const set=value=>({collection:'x',key:value.id,value});
// The timer is anchored to the last authored post, never to activity or a refresh.
function inactivityPeriod(state,chat,day){
    const post=Object.values(state.x||{}).findLast(p=>p.type==='post'&&p.author==='user');
    if(!post||day===null)return null;
    const start=post.postedAtStory?.day??dateDay(post.storyTime?.date)??(Number.isInteger(post.sourceIndex)?readStoryClock(chat.slice(0,post.sourceIndex+1)).day:null);
    if(start===null)return null;
    const saved=state.x['inactivity:'+post.id],paid=saved?.cycles||0,cycles=Math.floor((day-start)/7);
    return cycles>paid?{post,start,saved,paid,cycles}:null;
}
export function timedAudienceChanges(state,chat,day){
    if(!xAudience(state)||!inactivityPeriod(state,chat,day))return [];
    return settleInfluence(state,chat,[]);
}
export const REACH_CONTEXT='结合酒馆当前已提供的世界书、人设和发帖时的有效正文，判断公开画面里能认出谁、此人在什么圈层受关注，以及这次举动或剪辑为何值得讨论。被拍者在学校、行业或当地的名气也能带动传播。区分到场目击者与只看帖的读者，视频截断后的言行不能写成网友看过的镜头。';
export function impactRecords(state){return Object.values(state.x).filter(x=>x.type==='influence');}
export function brandImpact(id,day,loss,index,long=false){
    return {id:'impact:brand:'+id,type:'influence',sourceId:'brand:'+id,sourceIndex:index,start:day,end:long?day+6:day,
        mode:'brand',gained:0,lost:loss,total:-loss,settled:1,expired:!long};
}
export function settleInfluence(state,chat,stats,initialFollowers){
    const day=readStoryClock(chat).day,old=xAudience(state),initial=old?.initialFollowers??initialFollowers;
    const count=n=>Number.isSafeInteger(n)&&n>=0;
    if(!count(initial))throw Error('初始粉丝数无效。');
    const audience={id:'audience',type:'audience',initialFollowers:initial,followers:initial,...old};
    const records=new Map(impactRecords(state).map(e=>[e.sourceId,{...e}]));
    const changes=[],daily=new Map();
    for(const row of stats){
        const post=state.x[row.postId],id='post:'+row.postId;
        if(post?.type!=='post'||post.author!=='user')throw Error('推文ID无效。');
        if(records.has(id))continue;
        if(!['likes','reposts','replies','gained','lost'].every(k=>count(row[k])))throw Error('推文数据必须是非负安全整数。');
        const start=post.postedAtStory?.day??dateDay(post.storyTime?.date);
        const metrics=Object.fromEntries(['likes','reposts','replies'].map(key=>[key,Math.max(post.metrics?.[key]||0,row[key])]));
        const includedDirectReplies=xComments(state).filter(c=>c.postId===post.id&&!c.ambient).length;
        changes.push(set({...post,metrics,includedDirectReplies}));
        records.set(id,{id:'impact:'+id,type:'influence',sourceId:id,start,end:start===null?null:start+6,
            gained:row.gained,lost:row.lost,total:0,settled:0,expired:false});
    }
    for(const e of records.values()){
        if(e.expired)continue;
        const elapsed=e.start==null?1:day===null?0:Math.max(0,Math.min(7,day-e.start+1));
        if(elapsed<=e.settled){if(!e.settled)changes.push(set(e));continue;}
        for(let i=e.settled;i<elapsed;i++){
            const delta=Math.trunc((e.gained-e.lost)*((7-i)/7)**2);
            const key=(e.start??day??0)+i;
            daily.set(key,(daily.get(key)||0)+delta);e.total+=delta;
        }
        e.settled=elapsed;e.expired=e.start==null||elapsed===7;changes.push(set(e));
    }
    const period=inactivityPeriod(state,chat,day),due=new Set();
    if(period)for(let i=period.paid+1;i<=period.cycles;i++)due.add(period.start+7*i);
    let loss=0;
    for(const d of [...new Set([...daily.keys(),...due])].sort((a,b)=>a-b)){
        audience.followers=Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,audience.followers+(daily.get(d)||0)));
        if(due.has(d)){const n=Math.round(audience.followers/100);loss+=n;audience.followers-=n;}
    }
    if(period)changes.push(set({id:'inactivity:'+period.post.id,type:'inactivity',postId:period.post.id,start:period.start,
        cycles:period.cycles,lastDay:period.start+period.cycles*7,totalLost:(period.saved?.totalLost||0)+loss}));
    return [...changes,set(audience)];
}
