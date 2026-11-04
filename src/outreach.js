import {recentPerConversation} from './proactive-pacing.js?v=1.1.17';
import { sameNamedPerson } from './names.js?v=1.1.8';
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
export function outreachPrompt(settings,state,user,due) {
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
    return '本轮是每五条有效角色正文一次的主动联系判定。只选当前开启且符合身份要求的渠道：'+channels.join('、')+'。'+frequencyRules[settings.proactiveFrequency||'low']+
        '从近期剧情中的相关人物出发，逐个人物结合近期正文、人设、当下具体动机、熟悉程度、最近交流、是否回应和表达习惯决定内容与渠道，不按关系类型分配平台，可无人联系，也可多人各自联系，无人数配额，不轮流点名。无需证明取得号码、交换账号、共同好友或在通讯录，不编造这些过程。第一次用这个App不等于刚认识；开局旧识与剧情新识按各自真实关系讲话。不得替user回应、接受、接听。被拉黑、拒绝或请求仍待处理的账号不得再发私信。公开@只写适合公开的内容，使用@加user完整账号名。'+
        '每次主动联系写一条<!--durian-outreach:{"channel":"渠道代号","sender":"角色真实姓名","recipient":"user","accountId":"已知时填写对应渠道账号ID","text":"实际消息或公开帖全文","motive":"此人当下的具体联系动机","media":"text/image/video","evidence":"本轮正文逐字事实"}-->。主动来电仅记录响铃。不要为同一件事再写durian-contact。其他自然短信电话沿用原记录格式。关闭陌生私信请求时只可给已接受的X会话发私信。渠道独立，账号状态：'+JSON.stringify({accounts,xRequestsOpen:state.x?.profile?.requestsOpen!==false})+'。近期各渠道来往（仅用于把握节奏，各人只知自己参与的通信）：'+JSON.stringify(activity);
}
export function socialContact(state,row,id,clock,now,user) {
    const app=row.channel.startsWith('x_')?'x':row.channel;
    const records=state[app]||{};
    const matches=Object.values(records).filter(a=>a.type==='account'&&sameNamedPerson(a,{name:row.sender,aliases:row.aliases}));
    if(matches.length>1&&!row.accountId)return [];
    const old=row.accountId?records[row.accountId]:matches[0];
    if(row.accountId&&(!old||!matches.includes(old))||old?.blocked||matches.some(a=>a.blocked))return [];
    const account=old||{id:'outreach:'+encodeURIComponent(row.sender),name:row.sender,aliases:[],type:'account',handle:'',friend:'incoming',identityKnown:true,dmPolicy:'requests',createdAt:now};
    const write=value=>({collection:app,key:value.id,value});
    if(row.channel==='x_mention'){
        const handle='@'+user;
        if(!row.text.split(handle).slice(1).some(tail=>!/^[\p{L}\p{N}_]/u.test(tail)))return [];
        return [write(account),write({id,type:'post',author:account.id,feed:'home',text:row.text,mentionsUser:true,outreachMention:true,createdAt:now,storyTime:clock,read:false})];
    }
    const normal=app==='x'?account.dmAccepted:account.friend==='friends';
    if(!normal&&(account.inboundRequest||account.friend==='declined'||(app==='x'&&records.profile?.requestsOpen===false)))return [];
    const kind=['image','video'].includes(row.media)?row.media:'text';
    return [write(normal?account:{...account,inboundRequest:'pending',friend:'incoming'}),write({id,type:'message',accountId:account.id,role:'assistant',kind,text:row.text,status:'received',read:false,createdAt:now,storyTime:clock})];
}
