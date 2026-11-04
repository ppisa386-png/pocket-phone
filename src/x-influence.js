// Only public, addressable sources get an impact. A later development has to
// identify a different public record or an evidenced narrative floor.
import {dateDay,readStoryClock} from './story-clock.js?v=1.1.12';
import {effectiveReply} from './contact-policy.js?v=1.1.13';
import {audienceSources,xAudience} from './x-audience.js?v=1.1.8';

export const refreshFloor=chat=>chat.findLastIndex(effectiveReply);
const set=value=>({collection:'x',key:value.id,value});
export function influenceSources(state,chat){
    const all=Object.values(state.x),ids=new Set(all.filter(p=>p.author==='user'&&p.type==='post').slice(-10).map(p=>p.id));
    const sources=audienceSources(state).filter(s=>s.kind!=='post'||ids.has(s.postId)).slice(-40).map(s=>{
        const record=state.x[s.kind==='comment'?s.sourceId.slice(8):s.postId];
        const day=s.kind==='repost'?record.repostedDay:record.postedAtStory?.day??dateDay(record.storyTime?.date)??(Number.isInteger(record.sourceIndex)?readStoryClock(chat.slice(0,record.sourceIndex+1)).day:null);
        return {...s,day:day??null};
    });
    for(const c of all.filter(c=>c.type==='comment'&&c.author!=='user'&&ids.has(c.postId)&&!state.x[c.author]?.blocked).slice(-25)){
        sources.push({sourceId:'reply:'+c.id,kind:'reply',text:c.text,postId:c.postId,day:c.postedAtStory?.day??dateDay(c.storyTime?.date)});
    }
    return sources;
}
export const INFLUENCE_RULES='专项粉丝结算。综合曝光、公开形象、既有受众、人设及新受众，分开估算关注和取关。挨骂也可净涨粉，获赞也可净掉粉。普通推文首次可净增减1至2或零；长线来源给出第一天的关注和取关人数，由插件衰减，不能重算已登记来源。回复、热搜、转发若只是同一波传播，沿用原sourceId，不另报一份影响；若用派生来源说明同一件事，originId填原事件来源。同一品牌事故引用已入账的brand:来源。新的公开进展须有独立来源。匿名时私人经历和少数人知情不构成身份公开；剧情来源须有公众可见且明确关联该账号的逐字依据，public:true。个人知情或私下揭露不算。若相关报道只用真名，另给 identityFloor 和 identityEvidence，引用先前公开确认此账号归属的正文原句。品牌翻车已入账，不重复计入相关报道或评论。';
export const INFLUENCE_OUTPUT='返回 {"initialFollowers":初始非负整数（已有可省略）,"effects":[{"sourceId":"所给来源ID，或story:楼层索引（索引未知填story，按引文唯一定位）","mode":"ordinary或long","gained":首日新增关注数,"lost":首日取关数,"basis":"新增传播事实与受众依据","public":剧情来源已公开传播才为true,"evidence":"剧情来源须逐字引用公众可见事实","identityFloor":匿名账号此前公开关联真人的楼层（如需）,"identityEvidence":"该楼逐字公开关联依据（如需）"}]}。未发生新变化返回空effects。';
export function impactRecords(state){return Object.values(state.x).filter(x=>x.type==='influence');}
export function brandImpact(id,day,loss,index,long=false){
    return {id:'impact:brand:'+id,type:'influence',sourceId:'brand:'+id,sourceIndex:index,start:day,end:long?day+6:day,
        mode:'brand',gained:0,lost:loss,total:-loss,settled:1,expired:!long};
}
export function settleInfluence(state,chat,user,data){
    if(!Array.isArray(data?.effects))throw Error('粉丝评估缺少 effects 数组。');
    const day=readStoryClock(chat).day,old=xAudience(state),initial=old?.initialFollowers??data.initialFollowers;
    const count=n=>Number.isSafeInteger(n)&&n>=0&&n<=1e9;
    if(!count(initial))throw Error('初始粉丝数无效。');
    const audience={id:'audience',type:'audience',initialFollowers:initial,followers:initial,credited:{},...old};
    const sources=new Map(influenceSources(state,chat).map(s=>[s.sourceId,s]));
    const records=new Map(impactRecords(state).map(e=>[e.sourceId,{...e}]));
    const changes=[],daily=new Map(),alias=state.x.profile?.alias||user;
    for(const row of data.effects){
        if(!row||typeof row.sourceId!=='string'||!['ordinary','long'].includes(row.mode)||!count(row.gained)||!count(row.lost)||!row.basis?.trim?.())throw Error('粉丝影响记录格式无效。');
        let id=row.sourceId;
        if(id==='story'&&row.evidence){
            const hits=chat.map((m,i)=>effectiveReply(m)&&String(m.mes).replace(/<!--[\s\S]*?-->/g,'').includes(row.evidence)?i:-1).filter(i=>i>=0);
            if(hits.length!==1)continue;
            id='story:'+hits[0];
        }
        if(records.has(id)||audience.credited?.[id]||(row.originId&&row.originId!==id))continue;
        let source=sources.get(id);
        if(!source&&/^story:\d+$/.test(id)){
            const index=Number(id.slice(6)),msg=chat[index],quote=row.evidence?.trim?.();
            if(row.public!==true||!effectiveReply(msg)||!quote||quote.length<4||!String(msg.mes).replace(/<!--[\s\S]*?-->/g,'').includes(quote))continue;
            if(alias!==user&&!quote.includes(alias)){
                const link=chat[row.identityFloor],q=row.identityEvidence;
                if(!Number.isInteger(row.identityFloor)||row.identityFloor>index||!effectiveReply(link)||typeof q!=='string'||!q.includes(alias)||!q.includes(user)||!String(link.mes).replace(/<!--[\s\S]*?-->/g,'').includes(q))continue;
            }
            const legacyIncident=Object.values(state.business||{}).some(p=>p.risk==='triggered'&&String(msg.mes).includes('durian-business:')&&String(msg.mes).includes(p.brand)&&String(msg.mes).includes('"incident"'));
            if([...records.values()].some(e=>e.mode==='brand'&&e.sourceIndex===index)||legacyIncident)continue;
            source={day:readStoryClock(chat.slice(0,index+1)).day,kind:'story'};
        }
        if(!source)continue;
        const net=row.gained-row.lost;
        if(row.mode==='ordinary'&&Math.abs(net)>2)throw Error('普通推文的净变化必须在 -2 到 2 之间。');
        const start=source.day;
        if(start!=null&&day!=null&&(day<start||day>start+6))continue;
        if(row.mode==='long'&&(start==null||day==null))continue;
        const e={id:'impact:'+id,type:'influence',sourceId:id,mode:row.mode,start,end:start==null?null:start+(row.mode==='long'?6:0),
            basis:row.basis,evidence:row.evidence||null,gained:row.gained,lost:row.lost,total:0,settled:0,expired:false};
        records.set(id,e);
    }
    for(const e of records.values()){
        if(e.expired)continue;
        const elapsed=e.mode==='ordinary'?1:day===null?0:Math.max(0,Math.min(7,day-e.start+1));
        if(elapsed<=e.settled)continue;
        for(let i=e.settled;i<elapsed;i++){
            const delta=Math.trunc((e.gained-e.lost)*((7-i)/7)**2);
            const key=(e.start??day??0)+i;
            daily.set(key,(daily.get(key)||0)+delta);e.total+=delta;
        }
        e.settled=elapsed;e.expired=e.mode==='ordinary'||elapsed===7;changes.push(set(e));
    }
    for(const [,delta] of [...daily].sort((a,b)=>a[0]-b[0]))audience.followers=Math.max(0,Math.min(1e9,audience.followers+delta));
    return [...changes,set(audience)];
}
