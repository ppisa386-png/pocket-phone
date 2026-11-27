import { dateDay, dayDate } from './story-clock.js?v=1.2.102';
import { communicationTime, withinCommunicationWeek } from './communication-time.js?v=1.2.102';
import { xComments, xUserReplyChain } from './x-comments.js?v=1.2.66';

// All dates here are narrative dates. createdAt is only a stable tie breaker,
// never evidence that an in-world event is within the seven-day window.
export function xHistoryStamp(state, record) {
    const meta=state.commContext?.['x:'+record.id];
    const stamp=communicationTime(record,meta);
    if(dateDay(stamp.date)!==null)return stamp;
    const clock=record.postedAtStory||record.storyTime;
    if(!Number.isInteger(clock?.day)||clock.day < -719162||clock.day > 2932896)
        return stamp;
    const hour=clock.hour;
    const minute=Number.isFinite(hour)&&hour>=0&&hour<24?Math.floor(hour*60):null;
    return {date:dayDate(clock.day),time:minute===null?'':String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0')};
}

export function xPublicHistoryRecords(state, now) {
    const x=state.x||{},rows=Object.values(x),out=[];
    const seen=new Set(),sources=new Set(rows.filter(r=>r.type==='public-history').map(r=>r.sourceActivityId).filter(Boolean));
    const savedOrder=new Map(rows.map((record,index)=>[record.id,index]));
    const name=id=>id==='user'?x.profile?.alias||'user':x[id]?.name||id;
    const postContext=post=>({id:post.id,author:post.author,name:name(post.author),
        text:post.text??'',...(post.imageDescription!==undefined?{imageDescription:post.imageDescription}:{}),
        ...(Array.isArray(post.images)?{images:post.images}:{})});
    function add(record,id,action,extra) {
        const stamp=xHistoryStamp(state,record);
        if(!withinCommunicationWeek(stamp,now)||seen.has(id))return;
        seen.add(id);
        out.push({time:Number(record.createdAt)||0,order:savedOrder.get(record.id)??out.length, data:{
            channel:'X 公开动态',platform:'x-public',recordId:record.id,
            eventId:id,action,storyTime:stamp,...extra
        }});
    }
    for(const record of rows){
        if(record.type==='post'&&record.author==='user'&&
            (typeof record.text==='string'||typeof record.imageDescription==='string')){
            add(record,'post:'+record.id,'post',{postId:record.id,author:'user',
                alias:record.alias||name('user'),text:record.text??'',
                ...(record.imageDescription!==undefined?{imageDescription:record.imageDescription}:{}),
                ...(Array.isArray(record.images)?{images:record.images}:{})});
        }
    }
    const comments=xComments(state);
    for(const record of comments){
        if(record.author!=='user'||typeof record.text!=='string')continue;
        const chain=xUserReplyChain(state,record.id);
        // Missing parents must not yield a fabricated or misleading short chain.
        if(!chain)continue;
        add(record,'reply:'+record.id,'reply',{postId:record.postId,
            replyTo:record.replyTo||null,post:chain.post,comments:chain.comments});
    }
    for(const record of rows){
        if(record.type!=='public-history'&&record.type!=='public-activity')continue;
        // Newly logged events coexist with the mutable home-refresh pulse; the
        // pulse is a legacy fallback only, never a second copy of a new action.
        if(record.type==='public-activity'&&sources.has(record.id))continue;
        if(typeof record.action!=='string'||!record.action)continue;
        const accountId=record.accountId||x[record.postId]?.author||record.targetId;
        const account=x[accountId];
        const post=x[record.postId];
        add(record,'action:'+record.id,record.action,{
            ...(record.slot?{slot:record.slot}:{}),
            ...(record.targetId?{targetId:record.targetId}:{}),
            ...(accountId?{accountId}:{}),
            ...(account?.type==='account'?{targetAccount:{id:account.id,name:account.name,handle:account.handle||null}}:{}),
            ...(post?.type==='post'?{post:postContext(post),postId:post.id}:record.postId?{postId:record.postId}:{})
        });
    }
    const score=row=>dateDay(row.data.storyTime.date)*1440+
        (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.data.storyTime.time||'')
            ?Number(row.data.storyTime.time.slice(0,2))*60+Number(row.data.storyTime.time.slice(3)):0);
    return out.sort((a,b)=>score(a)-score(b)||a.time-b.time||a.order-b.order||a.data.eventId.localeCompare(b.data.eventId)).slice(-20);
}
