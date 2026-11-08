import {recentPerConversation} from './proactive-pacing.js?v=1.1.29';
import { sameNamedPerson } from './names.js?v=1.1.29';
import { dateDay } from './story-clock.js?v=1.1.29';
import { isBlocked } from './contact-events.js?v=1.1.29';
import { commExpired, commMeta } from './comm-context.js?v=1.1.29';
// One narrative decision per fifth assistant reply. Social records use the
// destination app's account, message and post formats and the host journal.
export const frequencyRules = {
    low:'低频：优先留白。结合近期交流和经过时间，有适时分享、邀约、约定或新进展才联系，不轮流问候。',
    medium:'中频：允许闲聊、想念、分享与临时邀约。普通问候无人回应通常等待；偏执、激进或纠缠型角色可依人设继续，不强加礼貌。',
    high:'高频：鼓励因小事、情绪、聊天欲望或个人动机主动互动，不设冷却，不因刚联系过就阻止再次联系。'
};
export function availableChannels(settings,state,user) {
    const enabled=settings.apps;
    const channels=['sms','call','whatsapp','wechat'].filter(ch=>enabled[{sms:'messages',call:'phone'}[ch]||ch]);
    if(enabled.x && user && (state.x?.profile?.alias??user)===user){
        if(state.x?.profile?.requestsOpen!==false) channels.push('x_dm');
        else if(Object.values(state.x||{}).some(a=>a.type==='account'&&a.dmAccepted&&!a.blocked)) channels.push('x_dm');
        channels.push('x_mention');
    }
    return channels;
}
// Special re-outreach eligibility from public X activity. The program checks
// only communication facts, ordering and anonymity; whether an NPC shares a
// romantic or ambiguous bond with user stays a narrative judgment.
const undeliveredStatus = status => ['queued','pending','failed','blocked'].includes(status);
const hourOf = time => { const m=/^(\d{1,2}):(\d{2})/.exec(String(time||'')); return m?Number(m[1])+Number(m[2])/60:null; };
const messageAnchor = message => ({day:dateDay(message.storyTime?.date),hour:hourOf(message.storyTime?.time),at:Number(message.createdAt)||0});
const publicPostAnchor = post => post.author==='user'
    ? {day:post.postedAtStory?.day??dateDay(post.storyTime?.date),hour:post.postedAtStory?.hour??hourOf(post.storyTime?.time),at:Number(post.createdAt)||0}
    : {day:post.repostedDay??post.postedAtStory?.day??dateDay(post.storyTime?.date),hour:null,at:Number(post.repostedAt)||Number(post.createdAt)||0};
const postAfterMessage = (post,message) => {
    const a=publicPostAnchor(post),b=messageAnchor(message);
    if(a.day!=null&&b.day!=null){
        if(a.day!==b.day)return a.day>b.day;
        if(a.hour!=null&&b.hour!=null&&a.hour!==b.hour)return a.hour>b.hour;
    }
    return a.at>b.at;
};
const describePost = post => post.author==='user'
    ? {id:post.id,kind:'新原创推文',text:String(post.text||post.imageDescription||'').slice(0,120),storyTime:post.storyTime||null}
    : {id:post.id,kind:'转发',text:String(post.text||'').slice(0,120),storyDay:post.repostedDay??post.postedAtStory?.day??null};
function lastUnanswered(thread){
    let lastNpc=null,replied=false;
    for(const m of thread){
        if(m.role==='assistant'){lastNpc=m;replied=false;}
        else if(m.role==='user'&&!undeliveredStatus(m.replyStatus??m.status))replied=true;
    }
    return lastNpc&&!replied?lastNpc:null;
}
// Candidates are facts only: a still-unanswered NPC message on SMS/WhatsApp/
// WeChat followed by user's public original post or repost from the
// non-anonymous X account. Blocked or declined contacts never qualify.
// With a story-time anchor, expired messages never re-enter the trigger.
export function xTriggerCandidates(state,user,now=null){
    if((state.x?.profile?.alias??user)!==user)return [];
    const posts=Object.values(state.x||{}).filter(p=>p.type==='post'&&(p.author==='user'||p.reposted===true));
    if(!posts.length)return [];
    // Expired public posts are no longer fresh narrative material, so they stop
    // serving as a re-outreach trigger or a quoted catalyst.
    const hitsAfter=message=>posts.filter(p=>postAfterMessage(p,message)&&!(now&&commExpired(commMeta(state,'x',p.id),now)))
        .sort((a,b)=>(publicPostAnchor(b).at||0)-(publicPostAnchor(a).at||0)).slice(0,2).map(describePost);
    const candidates=[];
    // SMS threads follow journal replay order, i.e. narrative occurrence order.
    const smsThreads=new Map();
    for(const m of Object.values(state.messages||{})){
        if(m.contactId==null)continue;
        if(now&&commExpired(commMeta(state,'sms',m.id),now))continue;
        if(!smsThreads.has(m.contactId))smsThreads.set(m.contactId,[]);
        smsThreads.get(m.contactId).push(m);
    }
    for(const [contactId,thread] of smsThreads){
        if(isBlocked(state,contactId,'messages'))continue;
        const message=lastUnanswered(thread);
        if(!message)continue;
        const hits=hitsAfter(message);
        if(hits.length)candidates.push({channel:'sms',name:message.name||message.participant?.name||state.contacts?.[contactId]?.name||contactId,
            unanswered:{storyTime:message.storyTime||null,text:String(message.text||'').slice(0,80)},posts:hits});
    }
    for(const app of ['whatsapp','wechat']){
        const threads=new Map();
        for(const m of Object.values(state[app]||{})){
            if(m.type!=='message'||m.accountId==null)continue;
            if(now&&commExpired(commMeta(state,app,m.id),now))continue;
            if(!threads.has(m.accountId))threads.set(m.accountId,[]);
            threads.get(m.accountId).push(m);
        }
        for(const [accountId,thread] of threads){
            const account=state[app]?.[accountId];
            if(account?.blocked||account?.friend==='declined'||account?.inboundRequest==='declined')continue;
            const message=lastUnanswered(thread);
            if(!message)continue;
            const hits=hitsAfter(message);
            if(hits.length)candidates.push({channel:app,name:account?.name||accountId,
                unanswered:{storyTime:message.storyTime||null,text:String(message.text||'').slice(0,80)},posts:hits});
        }
    }
    return candidates;
}
export function outreachPrompt(settings,state,user,due,now=null) {
    const channels=availableChannels(settings,state,user);
    if(!settings.proactiveEnabled)return '主动联系已关闭。正常回应照常。';
    if(!due || !channels.length)return '本轮不额外判定主动联系。user已发消息的正常回复、进行中的通话照常。';
    const accounts={};
    const activity={};
    for(const app of ['whatsapp','wechat','x'].filter(app=>app==='x'?channels.some(ch=>ch.startsWith('x_')):channels.includes(app)))accounts[app]=Object.values(state[app]||{}).filter(a=>a.type==='account').map(({id,name,friend,blocked,dmAccepted,inboundRequest})=>({id,name,friend,blocked,dmAccepted,inboundRequest}));
    for(const app of ['whatsapp','wechat','x'].filter(app=>app==='x'?channels.some(ch=>ch.startsWith('x_')):channels.includes(app))){
        activity[app]=recentPerConversation(Object.values(state[app]||{}).filter(m=>m.type==='message'&&m.status!=='queued').sort((a,b)=>a.createdAt-b.createdAt),m=>m.accountId)
            .slice(-20).map(({accountId,role,storyTime})=>({accountId,role,storyTime}));
    }
    // Only low and medium frequencies gain the special X-activity trigger; high
    // frequency keeps its existing no-cooldown behavior unchanged.
    let extra='';
    if((settings.proactiveFrequency||'low')!=='high'){
        const candidates=xTriggerCandidates(state,user,now).filter(c=>channels.includes(c.channel));
        if(candidates.length)extra='\n特殊再次联系契机（仅供恋爱或暧昧关系使用）：下列通信中NPC发出的最新消息仍未获user回复，其后user用非匿名X账号发布了公开动态：'+
            JSON.stringify(candidates.slice(0,12))+
            '。仅当该人物与user当前处于恋爱关系或暧昧关系（情侣、相互暧昧、发展中的明确浪漫关系）时，才可把该动态当作再次主动联系user的契机；普通朋友、同学、同事、家人，或单方面好感而尚未形成暧昧关系的不适用；关系依据不足或无法确认时同样不适用，不得为获得资格编造恋爱关系，也不得凭联系人名单、聊天次数或称呼推断。user发帖不等于回复了这些消息，不得据此把消息当作已回复。是否再次联系由该人物的性格、双方感情状态与剧情决定：可追问、试探、吃醋、委屈、不满，也可继续沉默，不强制克制也不强制负面情绪，无需其关注user的X账号或解释如何得知动态。同一条动态只作为一次契机，后续楼层不得机械重复同一追问。';
    }
    return '本轮是每五条有效角色正文一次的主动联系判定。只选当前开启且符合身份要求的渠道：'+channels.join('、')+'。'+frequencyRules[settings.proactiveFrequency||'low']+
        '从近期剧情中的相关人物出发，逐个人物结合近期正文、人设、当下具体动机、熟悉程度、最近交流、是否回应和表达习惯决定内容与渠道，不按关系类型分配平台，可无人联系，也可多人各自联系，无人数配额，不轮流点名。无需证明取得号码、交换账号、共同好友或在通讯录，不编造这些过程。第一次用这个App不等于刚认识；开局旧识与剧情新识按各自真实关系讲话。不得替user回应、接受、接听。被拉黑、拒绝或请求仍待处理的账号不得再发私信。公开@只写适合公开的内容，使用@加user完整账号名。'+
        '每次主动联系写一条<!--durian-outreach:{"channel":"渠道代号","sender":"角色真实姓名","recipient":"user","accountId":"只复制本渠道列出的准确ID，未知则省略，不自行拼name:","text":"实际消息或公开帖全文","motive":"此人当下的具体联系动机","media":"text/image/video","category":"可选A或B：日常闲聊为A，约定/待办/持续请求/情感纠纷或仍在发展的具体事件为B","shown":true}-->。主动来电仅记录响铃。不要为同一件事再写durian-contact。其他自然短信电话沿用原记录格式。关闭陌生私信请求时只可给已接受的X会话发私信。渠道独立，账号状态：'+JSON.stringify({accounts,xRequestsOpen:state.x?.profile?.requestsOpen!==false})+'。近期各渠道来往（仅用于把握节奏，各人只知自己参与的通信）：'+JSON.stringify(activity)+extra;
}
export function socialContact(state,row,id,clock,now,user,role=null) {
    const app=row.channel.startsWith('x_')?'x':row.channel;
    const records=state[app]||{};
    const matches=Object.values(records).filter(a=>a.type==='account'&&sameNamedPerson(a,{name:row.sender,aliases:row.aliases}));
    if(matches.length>1&&!row.accountId)return [];
    const byId=row.accountId?records[row.accountId]:null;
    // Some models echo name:<display name> instead of the app's stored card ID.
    // Only accept that hint if it names this sender and exactly one account matches.
    if(row.accountId&&!byId&&!(typeof row.accountId==='string'&&row.accountId.startsWith('name:')&&
        sameNamedPerson({name:row.accountId.slice(5)},{name:row.sender})&&matches.length===1))return [];
    const old=byId||matches[0];
    if((byId&&!matches.includes(byId))||matches.some(a=>a.blocked))return [];
    const account=old||{id:'outreach:'+encodeURIComponent(row.sender),name:row.sender,aliases:[],type:'account',handle:'',friend:'incoming',identityKnown:true,dmPolicy:'requests',createdAt:now};
    const write=value=>({collection:app,key:value.id,value});
    if(row.channel==='x_mention'){
        const handle='@'+user;
        if(!row.text.split(handle).slice(1).some(tail=>!/^[\p{L}\p{N}_]/u.test(tail)))return [];
        return [write(account),write({id,type:'post',author:account.id,feed:'home',text:row.text,mentionsUser:true,outreachMention:true,createdAt:now,storyTime:clock,read:false})];
    }
    const normal=app==='x'?account.dmAccepted:account.friend==='friends';
    if(account.friend==='declined'||account.inboundRequest==='declined')return [];
    if(role==='user')return [write(old||{...account,friend:'unsaved'}),write({id,type:'message',accountId:account.id,role,kind:row.media,text:row.text,status:'sent',read:true,createdAt:now,storyTime:clock})];
    if(!normal&&((account.inboundRequest&&role!=='assistant')||(app==='x'&&records.profile?.requestsOpen===false)))return [];
    const kind=['image','video'].includes(row.media)?row.media:'text';
    return [write(normal?account:{...account,inboundRequest:'pending',friend:'incoming'}),write({id,type:'message',accountId:account.id,role:'assistant',kind,text:row.text,status:'received',read:false,createdAt:now,storyTime:clock})];
}
