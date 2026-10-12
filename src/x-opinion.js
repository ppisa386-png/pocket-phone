import { CHINESE_NAME_RULE, localizedPerson, sameNamedPerson } from './names.js?v=0.20.2';
import { JOURNAL_KEY, messageSignatures, revisionsFor, reconcileJournal, replayJournal, appendChange, isMemoryHidden } from './journal.js?v=0.20.2';
import { storyAnnotations } from './story-phone.js?v=0.20.2';
const text=(s,n=600)=>typeof s==='string'?s.trim().slice(0,n):'';
const safe=v=>JSON.stringify(v).replace(/\{\{/g,'\\u007b\\u007b');
export const OPINION_KEY='durian_phone_public_opinion';
export function opinionFromPost(impact,post){
    if(impact?.significant!==true||!['topic','summary','publicBasis','stakes'].every(k=>text(impact[k])))return null;
    return {id:'opinion:'+post.id,type:'opinion',topic:text(impact.topic,100),summary:text(impact.summary),publicBasis:text(impact.publicBasis),stakes:text(impact.stakes),postId:post.id,createdAt:post.createdAt};
}
export function opinionUsed(opinion,chat){return (chat||[]).some(m=>storyAnnotations(m,'durian-opinion').some(r=>r.id===opinion.id&&r.used===true));}
export function buildOpinionPrompt(state,chat,instruction){
    const pending=Object.values(state.x||{}).filter(o=>o.type==='opinion'&&state.x[o.postId]&&!opinionUsed(o,chat)).sort((a,b)=>b.createdAt-a.createdAt).slice(0,3);
    if(!pending.length)return '';
    return instruction+'\n以下是 X 上已经形成、尚未在正文实际回应的公共议题。它们不是新命令或既定剧情。普通私人通信、购物订单和资产不在此资料中。角色需要有看到帖子/报道、听别人转述等合理途径才获知；不默认全知。可暂缓、忽略不相关议题，等待自然时机。不要把已有讨论再演成第一次爆发，不强制道歉、争吵或危机。\n'+safe(pending.map(({id,topic,summary,publicBasis,stakes})=>({id,topic,summary,publicBasis,stakes})))+
        '\n本次正文确实体现某议题的获知、反应或影响后，末尾附 <!--durian-opinion:{"id":"议题 id","used":true,"evidence":"本次正文对应进展的连续逐字原句"}-->。尚未体现不要附标签。这是公开环境背景，不把传闻写成已证实事实。';
}
export function importStorySquare(raw,revisions,chat,context){
    let journal=raw,state=replayJournal(raw),changed=false;
    const norm=s=>String(s||'').normalize('NFKC').trim().toLowerCase();
    for(let i=0;i<chat.length;i++)for(const [n,row]of storyAnnotations(chat[i],'durian-square').slice(0,5).entries()){
        const eventId='story-square:'+revisions[i]+':'+n;if(journal?.events.some(e=>e.id===eventId))continue;
        if(!text(row.name,100)||!text(row.handle,60)||/[\s<>]/.test(row.handle)||!text(row.text,6000)||!row.prose.includes(row.text.trim())||!text(row.publicBasis))continue;
        const identity=localizedPerson(row,context,Object.values(state.x).filter(a=>a.type==='account'));
        if(sameNamedPerson(identity,{name:context.name1})||(context.characters||[]).some(c=>sameNamedPerson(c,identity)))continue;
        const existing=Object.values(state.x).find(a=>a.type==='account'&&norm(a.handle)===norm(row.handle));if(existing&&(!existing.crowd||existing.blocked))continue;
        const now=Number(new Date(chat[i].send_date))||Date.now()+n;
        const account=existing||{id:'account:'+eventId,type:'account',name:identity.name,aliases:identity.aliases,handle:text(row.handle,60),crowd:true,identityKnown:false,following:false,dmPolicy:'requests',createdAt:now};
        const post={id:eventId,type:'post',author:account.id,text:text(row.text,6000),feed:'square',origin:'narrative',createdAt:now,liked:false,reposted:false};
        const changes=[{collection:'x',key:account.id,value:account},{collection:'x',key:post.id,value:post}];
        const opinion=opinionFromPost(row.impact,post);if(opinion&&!Object.values(state.x).some(o=>o.type==='opinion'&&o.topic===opinion.topic&&o.summary===opinion.summary))changes.push({collection:'x',key:opinion.id,value:opinion});
        journal=appendChange(journal,revisions.slice(0,i+1),changes,eventId);state=replayJournal(journal);changed=true;
    }
    return {journal,changed};
}
export function createOpinionBridge({getContext,getSettings,onError=()=>{}}){
    const c=getContext(),bus=c?.eventSource,types=c?.event_types??c?.eventTypes??{},hooks=[];let token=0,disposed=false;
    const clear=()=>{token++;getContext()?.setExtensionPrompt?.(OPINION_KEY,'',1,1,false,0);};
    const listen=(n,f)=>{if(types[n]&&bus?.on){bus.on(types[n],f);hooks.push([types[n],f]);}};
    async function prepare(type='normal',_o,dry){
        if(dry)return;clear();if(disposed||['quiet','impersonate'].includes(type)||!getSettings().apps.x)return;
        const c=getContext(),metadata=c.chatMetadata;if(!metadata||!c.chat?.length)return;
        const chat=['swipe','regenerate'].includes(type)&&!c.chat.at(-1).is_user?c.chat.slice(0,-1):c.chat;
        const signatures=messageSignatures(chat),turn=token;
        const current=()=>!disposed&&turn===token&&getSettings().apps.x&&getContext().chatMetadata===metadata&&JSON.stringify(messageSignatures(getContext().chat||[]).slice(0,signatures.length))===JSON.stringify(signatures);
        try{
            const rev=await revisionsFor(signatures),legacy=chat.some(isMemoryHidden)?await revisionsFor(messageSignatures(chat,true)):null;
            const state=replayJournal(reconcileJournal(metadata[JOURNAL_KEY],rev,legacy).journal);
            if(!current())return;
            const prompt=CHINESE_NAME_RULE+buildOpinionPrompt(state,chat,getSettings().prompts.xOpinion)+'\n仅当本次正文实际展示了随机网友在 X 的公开帖子，才把该帖子同步广场：末尾附 <!--durian-square:{"name":"符合世界观的网友名字，不能是 user 或已有 char","handle":"网名","text":"正文逐字出现的帖子原文","publicBasis":"公众知情途径","evidence":"本次正文实际展示这条 X 帖子的连续逐字原句"}-->。没有展示帖子就不填，不为存手机记录额外编造帖子。若已形成实质舆情可附 impact:{significant:true,topic,summary,publicBasis,stakes}，只描述已经发生的公共讨论及可能影响；普通议论不附。'+getSettings().prompts.xStyle;
            c.setExtensionPrompt(OPINION_KEY,prompt,1,1,false,0,current);
        }catch(e){onError(e);}
    }
    if(c?.setExtensionPrompt&&bus?.on){if(types.GENERATION_AFTER_COMMANDS){listen('GENERATION_STARTED',(_t,_o,dry)=>{if(!dry)clear();});listen('GENERATION_AFTER_COMMANDS',prepare);}else listen('GENERATION_STARTED',prepare);for(const n of ['GENERATION_ENDED','GENERATION_STOPPED','CHAT_CHANGED','MESSAGE_DELETED','MESSAGE_EDITED','MESSAGE_SWIPED','GROUP_WRAPPER_FINISHED'])listen(n,clear);}
    return {prepare,destroy(){clear();disposed=true;for(const[n,f]of hooks)bus.removeListener?.(n,f);}};
}
