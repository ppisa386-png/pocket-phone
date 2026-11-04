import {privilegeLevel,privilegeRows,privilegeChanges,privilegeContract} from './x-privilege.js?v=1.1.18';
import {pageEdits} from './x-edit.js?v=1.1.16';
import {refreshFloor,influenceSources,impactRecords,settleInfluence,INFLUENCE_RULES,INFLUENCE_OUTPUT} from './x-influence.js?v=1.1.18';
import {dmDealTask,dealDecision} from './x-business.js?v=1.1.22';
import {JOURNAL_KEY} from './journal.js?v=1.1.13';
import {readStoryClock} from './story-clock.js?v=1.1.12';
import { X_TRENDS_RULES, X_TRENDS_OUTPUT, validateTrends } from './x-trends.js?v=1.1.8';
import { publicationScenePrompt } from './social-context.js?v=1.1.17';
import { xCommentKey, xComments } from './x-comments.js?v=1.1.8';
import { SQUARE_RULES, squareClock, storyEvidenceRows, squareBasis, squareStatus } from './square-core.js?v=1.1.22';
import { localizedPerson, sameNamedPerson } from './names.js?v=1.1.8';
import { parseModelObject } from './model-json.js?v=1.1.8';
import { xAudience, audienceSources, audienceChanges, AUDIENCE_RULES } from './x-audience.js?v=1.1.8';
// Story-local X simulation. No real social-network API or account is used.
export const xItems = (state,type) => type==='comment' ? xComments(state) : Object.values(state.x || {}).filter(item=>item.type===type);
export const xProfile = (state,name='user') => state.x?.profile || {id:'profile',type:'profile',alias:name,bio:''};
export const xUnread = state => xItems(state,'post').filter(p=>p.outreachMention&&!p.read&&!state.x[p.author]?.blocked).length + xItems(state,'message').filter(m=>m.role==='assistant'&&!m.read).length + xItems(state,'comment').filter(c=>c.author!=='user'&&!c.read&&!c.ambient).length;
const metric = n => Number.isFinite(Number(n)) ? Math.min(1000000000,Math.max(0,Math.floor(Number(n)))) : 0;
export function xCounts(state,post) {
    const comments=xItems(state,'comment').filter(c=>c.postId===post.id);
    const direct = comments.filter(c=>!c.ambient).length, ambient = comments.length-direct;
    const aggregate = metric(post.metrics?.replies);
    // Older snapshots counted ambient samples separately. When both old paths
    // stored the same reply, it is already represented in the aggregate.
    let covered = post.includedDirectReplies;
    if (covered == null && aggregate && direct) {
        const key = row => xCommentKey(post.id, row.author, row.text, row.replyTo);
        const sampled = new Set(Object.values(state.x || {}).filter(row=>row.type==='comment' && row.postId===post.id && row.ambient).map(key));
        covered = comments.filter(row=>!row.ambient && sampled.has(key(row))).length;
    }
    const included = Math.min(direct, covered || 0);
    return {likes:metric(post.metrics?.likes)+(post.liked?1:0),reposts:metric(post.metrics?.reposts)+(post.reposted?1:0),
        replies:Math.max(aggregate,ambient+included)+direct-included};
}
const xSet = value => ({collection:'x',key:value.id,value});
const xText = (s,max=6000) => typeof s==='string'?s.trim().slice(0,max):'';
const xRequired = (s,label,max=6000) => {const value=xText(s,max);if(!value)throw Error('请填写'+label+'。');return value;};
const xRecord = (type,data) => ({id:crypto.randomUUID(),type,createdAt:Date.now(),...data});
const xAccount = (state,id,unblocked=true) => {const a=state.x?.[id];if(a?.type!=='account')throw Error('账号不存在。');if(unblocked&&a.blocked)throw Error('此账号已被拉黑。');return a;};
const xThread = (state,id) => xItems(state,'message').filter(m=>m.accountId===id).sort((a,b)=>a.createdAt-b.createdAt);
export function parseXObject(text) {
    try { return parseModelObject(text,{allowTrailingCommas:true}); }
    catch (error) {
        throw Object.assign(new Error(error.message.replaceAll('账本','X 数据')), {
            code:error.code, diagnostic:error.diagnostic?.replaceAll('资产评估','X').replaceAll('账本','X 数据'),
        });
    }
}
export const X_ACCOUNT_RULES = '先判断谁可能使用 X/Twitter：根据时代、地区、联网条件、年龄、性格和明确设定筛选，不假定每个 char 都有账号。与世隔绝、长期不接触网络、明确厌恶现代科技/社交平台或设定无账号者不得生成个人账号，不借官方/代运营账号冒充本人。已有合法账号和明确新使用事实优先，不能因有电话号码或别的平台账号推定。char 使用真名是命名规则，不代表必定使用平台。';
const noAccount = row => row?.has_account === false || row?.has_account === 'false';
const X_JSON_OUTPUT = '当前是 X 应用结构化任务，不续写正文或输出HTML。最终只输出本任务要求的一个JSON对象。字段名和字符串使用英文双引号；字符串内部的双引号、反斜杠及换行必须转义。布尔值用true/false，数值直接写数字，不写千分位或单位。不得照抄说明性占位符，不使用单引号、注释、尾逗号或多个结果。内容语言、人物记忆和知情边界仍遵守原要求。';
const X_FEED_OUTPUT = '本次为X刷新，根结构为 {"posts":[],"replies":[]}；无内容也保留这两个数组，不能返回accounts代替posts。posts和replies各最多5条。帖子字段accountId/name/handle/text为字符串，has_account为布尔值；replies用postId和accountId关联提供的真实ID。推荐账号可另附accounts数组（最多8个）。可选metrics为含likes/reposts/replies数字的对象，comments为数组；已有帖互动放engagementUpdates数组，最多15条。可选audience为对象，initialFollowers为整数，growth为数组，项中的sourceId/basis为字符串、hot为布尔值、totalGain为整数。所有可选内容合并到同一个根对象，不输出额外JSON。';
const X_SEARCH_OUTPUT = '本次任务是搜索/添加 X 角色账号，不续写正文。最终仅输出一个 JSON 对象，根字段 accounts 为数组，最多10个；无合适账号返回 {"accounts":[]}。每条格式为 {"name":"姓名","handle":"唯一账号名","bio":"简介","has_account":true,"dm_policy":"requests"}，dm_policy 只选 open、requests、closed 之一。字段名及字符串必须用英文双引号；字符串内双引号、换行须按JSON转义，布尔值用true/false；不使用尾逗号、单引号、代码或说明。不抄占位内容，不用姓名替代字段名。内容语言及账号适用性保持原规则。';

export function createX({memory,phone,getContext,getSettings}) {
    const profile=state=>xProfile(state,getContext().name1);
    const known=(state,a)=>({...a,identityKnown:a.identityKnown===true||profile(state).alias===getContext().name1});
    const accountContext=(state,a)=>({id:a.id,name:a.name,aliases:a.aliases,handle:a.handle,identityKnown:known(state,a).identityKnown,following:a.following,crowd:a.crowd});
    const memoryQuery=(state,a,task,actors=[])=>({
        actors:(a?[a]:actors).filter(a=>!a.crowd).map(a=>({id:a.id,name:a.name,aliases:a.aliases})),
        names:(a?[a]:xItems(state,'account').filter(a=>!a.blocked)).flatMap(a=>[a.name,...(a.aliases||[])]),
        topic:xItems(state,'post').filter(p=>p.author==='user'||a&&p.author===a.id).slice(-15).map(p=>p.text).join('\n')+
            (a?'\n'+xThread(state,a.id).slice(-3).map(m=>m.text).join('\n'):'')+'\n'+task,
    });
    function publicConversation(state) {
        const all=xItems(state,'post');
        const posts=new Set([...all.slice(-20),...all.filter(p=>p.author==='user').slice(-15)].map(p=>p.id));
        const result=[];let size=0;
        for(const c of xItems(state,'comment').filter(c=>posts.has(c.postId)&&!state.x[c.author]?.blocked).slice(-40).reverse()) {
            const row={postId:c.postId,id:c.id,author:c.author,name:c.author==='user'?profile(state).alias:state.x[c.author]?.name,text:c.text,replyTo:c.replyTo};
            const length=JSON.stringify(row).length;if(size+length>24000)continue;
            result.unshift(row);size+=length;
        }
        return result;
    }
    const run=work=>phone.appTask(async(view,current,request)=>{
        if(!current())throw Error('X 已关闭或聊天已变化。');
        const ticket=await memory.begin(view);
        const commit=async changes=>{if(!current())throw Error('聊天已变化，本次操作已取消。');if(changes.length)await memory.commit(ticket,changes);};
        return work(view.state,current,request,commit);
    },'x');
    function prompt(state,a,task,combined) {
        const p=profile(state);
        return getSettings().prompts.general+'\n'+getSettings().prompts.x+'\n'+getSettings().prompts.xStyle+
            '\n这是 X 文字扮演任务，不执行真实网络操作。只输出本任务指定 JSON，内容语言遵守酒馆预设；不替 user 发言。user 的公开个人资料：'+JSON.stringify({alias:p.alias,bio:p.bio})+
            '\n结合有效正文、人设和千千结记忆理解当前发言及其指代；私人电话、短信、其他 App 内容不能凭空变成公开消息。每人一个 X 账号，发现账号不等于认识真人。'+
            '\n人物认知连续性：先结合有效正文、已提供的千千结记忆和本帖既有评论，逐人区分已经亲历/目击/被明确告知的事实、只见过的公开内容及尚未知情的事。已确认账号身份的熟人应延续自己已有认知，不因换到 X 就把见过的物品、已获知的关系或计划当成首次听说。可以对新变化作反应（例如订婚不等于已经结婚、计划出行不等于已经抵达），不重复首次惊讶或已经回答的问题。私下已知可以影响措辞或选择沉默，不等于把私密细节公开，也不等于其他网友知道。未知身份账号仍不得利用私下经历认人；无记录不能断言从未发生。'+
            '\n身份基线：'+(p.alias===getContext().name1?'user 当前使用已设置的真实姓名，按原有真名账号规则识别；是否熟悉以及知道哪些事仍须逐人有依据。':'user 使用网名；只有明确 identityKnown 的账号可关联真人，其他账号保持匿名边界。')+
            (a?'\n当前对方：'+JSON.stringify({name:a.name,handle:a.handle})+'。'+(a.identityKnown?'此前已确认 user 账号对应的真实身份，改网名不会遗忘。':'对方不知道此网名是谁。不能凭后台 user 对应关系、角色卡、人设、正文中的私人称呼或私下经历认出 user；只知道网名及本账号公开过或本私信提供的信息。'):'\n逐个人物区分知情范围，不把后台账号对应关系当作人物已知。')+
            '\nuser 最近公开帖子：'+JSON.stringify(xItems(state,'post').filter(p=>p.author==='user').slice(combined?-10:-15).map(({id,text})=>({id,text})))+'\nuser 最近公开转发（不代表赞同）：'+JSON.stringify(xItems(state,'post').filter(p=>p.reposted&&p.author!=='user').slice(-10).map(p=>({author:state.x[p.author]?.name,text:p.text})))+'\n'+task;
    }
    const ask=(state,a,request,current,task,validate,options)=>request(prompt(state,a,task,options?.combined),validate,current,a?{id:a.characterId||a.id,name:a.name,channel:'x',alias:profile(state).alias,identityKnown:!!a.identityKnown}:null,{
        retries:0,parseResponse:parseXObject,memoryQuery:memoryQuery(state,a,options?.memoryTopic ?? task,options?.memoryActors),finalOutputContract:X_JSON_OUTPUT,
        outputContract:X_JSON_OUTPUT+'\n当前是 X 应用任务，不续写正文、不输出状态栏或 HTML。保留人设、背景和语言约定，最终只返回本任务要求的单个完整 JSON 对象，数组无内容用[]；不要复述示例或输出多个候选。'+X_ACCOUNT_RULES,...options,
    });
    const audienceTask=state=>'\n'+AUDIENCE_RULES+'\n当前粉丝：'+JSON.stringify(xAudience(state)?{initialFollowers:xAudience(state).initialFollowers,followers:xAudience(state).followers}:null)+'\n可评估的公开传播来源：'+JSON.stringify(audienceSources(state).slice(-40).map(s=>({...s,creditedGain:xAudience(state)?.credited?.[s.sourceId]||0})))+
        '\n同一 JSON 可附 audience:{"initialFollowers":初始粉丝整数（已有初始值时省略）,"growth":[{"sourceId":"给出的来源ID","hot":true,"totalGain":此来源累计带来的新粉丝整数,"basis":"公开传播依据"}]}。不要单独输出第二个 JSON。';
    function register(state,item,changes,crowdOnly=false) {
        const identity=localizedPerson(item,getContext(),xItems(state,'account')),name=identity.name,handle=xText(item?.handle,60).replace(/^@/,'');
        if(!name||!handle||/[\s<>]/.test(handle)||name===getContext().name1||noAccount(item))return null;
        const normalize=s=>String(s||'').normalize('NFKC').trim().toLowerCase();
        const cards=(getContext().characters||[]).filter(c=>sameNamedPerson(c,identity));const characterId=identity.cardId;
        const existing=xItems(state,'account').find(a=>(characterId&&a.characterId===characterId)||sameNamedPerson(a,identity)||a.handle.toLowerCase()===handle.toLowerCase());
        if(crowdOnly&&(cards.length||normalize(name)===normalize(getContext().name1)||existing&&!existing.crowd))return null;
        if(existing){if(existing.name!==name||(!existing.characterId&&characterId)||identity.aliases.some(alias=>!existing.aliases?.includes(alias))){const next={...existing,name,aliases:identity.aliases,characterId:existing.characterId||characterId};state.x[next.id]=next;changes.push(xSet(next));return next;}return existing;}
        const a=xRecord('account',{name,aliases:identity.aliases,handle,characterId,bio:xText(item.bio,500),followers:metric(item.followers),dmPolicy:['open','requests','closed'].includes(item.dm_policy)?item.dm_policy:'requests',following:false,blocked:false,identityKnown:false,crowd:crowdOnly});
        state.x[a.id]=a;changes.push(xSet(a));return a;
    }
    const list=(data,key,max)=>{if(!Array.isArray(data?.[key])||data[key].length>max)throw Error('X 返回字段 '+key+' 应为最多 '+max+' 条的数组，当前'+(data?.[key]==null?'缺失':Array.isArray(data[key])?'有 '+data[key].length+' 条':'类型不正确')+'。本次未保存。');return data[key];};
    const engagementRules = () => '\n'+getSettings().prompts.xInteractions;
    const engagementShape = '\n每条 post 可附 metrics:{"likes":0,"reposts":0,"replies":0} 以及 comments:[{"key":"本帖内唯一标记","accountId":"已知评论者账号 ID，未知留空","name":"评论者姓名或网名","handle":"账号名","text":"评论内容","replyTo":"回复本帖某条 comment 的 key；回复帖子留空","isAuthor":false}]。作者发言用 isAuthor:true，不必再给姓名。每帖最多 8 条可见评论（可为零），先给原评论再给它的回复；metrics.replies 至少涵盖这些评论，可以有更多未展示的讨论。评论只属于本帖。';
    const findComment=(state,postId,author,body,parent=null)=>{
        const key=xCommentKey(postId,author,body,parent);
        return xComments(state).find(c=>xCommentKey(c.postId,c.author,c.text,c.replyTo)===key);
    };
    function addEngagement(state,post,item,changes) {
        const raw=item.metrics||{};
        post.metrics=Object.fromEntries(['likes','reposts','replies'].map(key=>[key,Math.max(metric(post.metrics?.[key]),metric(raw[key]))]));
        const keys=new Map();
        for(const row of Array.isArray(item.comments)?item.comments.slice(0,8):[]){
            if(!xText(row?.text)||noAccount(row))continue;
            const parent=row.replyTo?keys.get(String(row.replyTo)):null;
            if(row.replyTo&&!parent)continue;
            let a=row.isAuthor===true?state.x[post.author]:row.accountId?state.x[row.accountId]:null;
            if(a?.type!=='account')a=null;
            if(!a&&row.isAuthor!==true)a=register(state,row,changes);
            if(!a||a.blocked)continue;
            const existing=findComment(state,post.id,a.id,xText(row.text),parent);
            if(existing){if(row.key)keys.set(String(row.key),existing.id);continue;}
            const c=xRecord('comment',{postId:post.id,author:a.id,text:xText(row.text),replyTo:parent||null,ambient:true,read:true});
            state.x[c.id]=c;changes.push(xSet(c));
            if(row.key&&!keys.has(String(row.key)))keys.set(String(row.key),c.id);
        }
        if (raw.replies != null) post.includedDirectReplies=xComments(state).filter(c=>c.postId===post.id&&!c.ambient).length;
        changes.push(xSet(post));
    }
    function resolvePostAuthor(state,item,changes,following,square) {
        if(noAccount(item))return null;
        let a=item.accountId?state.x[item.accountId]:null;
        if(a?.type!=='account')a=null;
        if(square&&a&&!a.crowd)return null;
        if(!a&&!following)a=register(state,item,changes,square);
        if(!a||a.blocked||following&&!a.following||square&&a.characterId)return null;
        return a;
    }
    async function answer(state,a,m,current,request,commit) {
        const result=await ask(state,a,request,current,'当前任务：X 私信。仅回应本会话最后一条 user 消息，不查看其他账号的私信。对方的私信设置：'+a.dmPolicy+'；会话此前已通过：'+!!a.dmAccepted+'；记录：'+JSON.stringify(xThread(state,a.id).slice(-40).map(({role,text})=>({role,text})))+
            '\n根据角色判断是否接受并回复。输出 {"status":"reply/no_reply/request","text":"回复内容；不回复时为空"}。requests 且未通过时可返回 request（等待对方接受），reply 表示本次同意并回复，no_reply 表示保持沉默。'+dmDealTask(state,a.id),d=>{if(!['reply','no_reply','request'].includes(d.status)||d.status==='reply'&&!xText(d.text))throw Error('私信回复格式不正确。');return {status:d.status,text:xText(d.text),deal:d.deal};});
        const changes=[xSet({...a,dmAccepted:a.dmAccepted||result.status==='reply'}),xSet({...m,status:result.status==='reply'?'answered':result.status})];
        if(result.status==='reply')changes.push(xSet({id:'reply:'+m.id,type:'message',accountId:a.id,role:'assistant',text:result.text,createdAt:Date.now(),read:false}));
        const deal=result.deal,p=state.business?.[deal?.id];
        if(p?.accountId===a.id&&['accept','reject'].includes(deal?.kind)&&typeof deal.evidence==='string'&&deal.evidence.trim()&&m.text.includes(deal.evidence)){
            const context=getContext(),draw=context.chatMetadata?.[JOURNAL_KEY]?.businessDraws?.[p.id];
            changes.push(...dealDecision(p,deal.kind,state.business.counter.turn,readStoryClock(context.chat).day,draw,deal.terms));
        }
        await commit(changes);
    }
    async function refreshTrendsStage(state,current,request,commit,combined){
        const context=getContext(),chat=context.chat||[],persona=String(context.powerUserSettings?.persona_description||'');
        const valid=()=>current()&&String(getContext().powerUserSettings?.persona_description||'')===persona;
        const candidates=xItems(state,'post').filter(p=>p.author==='user').slice(combined?-10:-15);
        const clock=squareClock(chat),audience=xAudience(state),previous=state.x?.['trend-edition'];
        const data={now:clock,userPersona:persona,publicProfile:{alias:profile(state).alias,bio:profile(state).bio},
            audience:audience?{initialFollowers:audience.initialFollowers,followers:audience.followers}:null,
            candidates:candidates.map(p=>({postId:p.id,publicText:p.text,postedAtStory:p.postedAtStory||null,sourceIndex:p.sourceIndex??null,counts:xCounts(state,p)})),
            publicComments:publicConversation(state),publicFeed:combined?xItems(state,'post').filter(p=>p.author!=='user').slice(-20).map(({text,feed,metrics})=>({text,feed,metrics})):undefined,
            previous:previous?{clock:previous.clock,topics:previous.topics}:null};
        const output=X_JSON_OUTPUT+'\n'+X_TRENDS_OUTPUT;
        const result=await ask(state,null,request,valid,X_TRENDS_RULES+publicationScenePrompt(context,candidates)+
            '\n趋势评估资料（人设用于判断身份和公开知名度，不等于向网友公开）：'+JSON.stringify(data)+'\n'+output,
            d=>validateTrends(d,candidates),{outputContract:output,finalOutputContract:output,memoryActors:[],combined});
        if(!valid())throw Error('人设或聊天已变化，请重新刷新趋势。');
        await commit([xSet({id:'trend-edition',type:'trends',clock,...result})]);
        return {added:result.topics.length};
        }
    async function refreshFeedStage(state,current,request,commit,mode,combined){
        const square=mode==='square',following=mode===true;
        const chat=structuredClone(getContext().chat||[]),prose=square?storyEvidenceRows(chat):[];
        const edition=square?{id:'square-edition',type:'edition',editionId:crypto.randomUUID(),clock:squareClock(chat),postIds:[]}:null;
        const accounts=xItems(state,'account').filter(a=>!a.blocked&&(!following||a.following));
        if(following&&!accounts.length)return {added:0};
        const task=square?'当前任务：X 广场。无需关注任何人。'+getSettings().prompts.xSquare+'\n'+SQUARE_RULES+'\n禁止用作广场作者的角色姓名：'+JSON.stringify((getContext().characters||[]).map(c=>c.name)):
            '当前任务：X 动态。'+X_ACCOUNT_RULES+(following?'仅生成已关注账号的公开帖子，不能添加列表外发帖账号；评论者不受关注列表限制。':
                '为你推荐必须属于 user 生活的世界。优先考虑人设/有效剧情中已建立关系且可能使用 X 的朋友、同学、同事等账号；没有合适熟人时，按学校、职业、行业、城市、兴趣推荐机构或创作者。不能凭空捏造 user 与推荐者已认识，不强迫关注，也不能让推荐者知道未公开的 user 身份。可原创贴合背景的陌生账号，不让所有帖子围着 user 转。'+
                '可附 accounts:[{name:"名称",handle:"账号",bio:"简介",has_account:true,followers:合理粉丝数}] 推荐最多8个账号。帖子新作者也须先做账号适用性筛选，并附has_account。')+(combined?'粉丝交给本次专门结算，不输出growth。':audienceTask(state));
        const userPosts=square?[]:xItems(state,'post').filter(p=>p.author==='user').slice(combined?-10:-15);
        const reachPosts=userPosts.map(p=>({postId:p.id,publicText:p.text,postedAtStory:p.postedAtStory||null,sourceIndex:p.sourceIndex??null,counts:xCounts(state,p)}));
        const reachTask=reachPosts.length ? publicationScenePrompt(getContext(),userPosts)+
            `
根据 user 每条推文实际公开的内容，估算累计点赞、转发和回复数量。

首先判断内容本身的吸引力。 涉及热门人物、热门事件、劲爆八卦、新奇发现、强烈争议或其他容易引起公众兴趣的内容，可以获得较高热度。热度取决于具体发了什么，而不只是提到了谁。例如，同样涉及知名歌手，普通演唱会直拍与曝光其令人震惊的私人物品，带来的好奇、讨论和传播程度明显不同，不能因为都涉及同一位名人就给出相近的数据。

user 自身也可以成为热度来源。 如果推文展示了出色的歌唱、舞蹈、绘画、创作或其他才艺，可以因为作品质量和表现力获得大量互动；如果照片展示了出众的外貌，也可以因为自拍本身吸引关注。无需强行关联热门人物或公共事件。普通日常推文通常热度较低，但不等于没有人点赞或回复。

其次结合 user 当前的粉丝数量判断数据规模。 粉丝越多，推文通常越容易获得较高的基础互动；粉丝较少时，普通推文的数据通常较低。但粉丝数不是热度上限：内容足够吸引人时，小账号也能突然获得大量点赞、转发和回复；大账号发布缺乏看点的内容，也可能表现平平。

最后根据内容性质分别判断三项数据。 点赞反映喜欢、欣赏、认同或对内容的兴趣；转发反映内容是否值得分享、传播或让更多人看到；回复反映内容是否容易引发提问、讨论、争论或表达观点。三项数据不必按固定比例增长。例如，漂亮自拍可能收获大量点赞，但讨论不一定多；劲爆八卦或争议言论可能引发大量转发和回复，却不一定获得同等比例的点赞。

只依据推文中实际公开的文字、图片、视频及其已有描述判断，不把未公开的私人剧情当作网友已经看到的内容。匿名账号不能自动继承 user 现实身份的知名度。不要因为文字简短就降低热度，也不要因为涉及名人就无条件给出夸张数据。

输出每条推文的累计点赞、转发、回复数量，保持三项数据与具体内容及粉丝规模相符。不使用固定互动比例，不额外根据经过多少剧情时间调整数据；持续传播和七天影响由独立机制处理。没有新的公开内容或互动变化时，不因重复刷新而机械累加数据。结果填入 "engagementUpdates"，其中 "metrics" 为累计数，包含已经展示的评论。
`+JSON.stringify({followers:xAudience(state)?.followers??null,posts:reachPosts}) : '';
        const refreshOutput=X_JSON_OUTPUT+'\n'+(combined?X_FEED_OUTPUT.split('可选audience')[0]:X_FEED_OUTPUT)+(square?'广场只填posts，replies为空，不填accounts/engagementUpdates/audience；publicBasis仍须满足任务的逐字依据规则。':'');
        const results=await ask(state,null,request,current,task+reachTask+(square?'':'\n可附 engagementUpdates:[{postId:"已给出的 user 帖子ID",metrics:{likes:0,reposts:0,replies:0},comments:[]}] 更新所给 user 帖子的累计公开互动，不得替 user 改写发言。名人提及可在新posts附 mentionsUser:true，text中必须明确包含 @user 当前网名，并保持人物知情隔离；本次新提及的growth来源可用 mention:new:0（posts从0计数），已有提及继续用给出的来源ID。')+'已知账号：'+JSON.stringify(xItems(state,'account').filter(a=>!a.blocked).map(a=>accountContext(state,a)))+'。已加载帖子（避免重复）：'+JSON.stringify(xItems(state,'post').filter(p=>!combined||p.author!=='user'||userPosts.includes(p)).slice(-20).map(p=>({id:p.id,author:p.author,text:p.text})))+'\n已发生的公开评论（保持线程上下文，不重复首次反应；不是其他账号的私信）：'+JSON.stringify(publicConversation(state))+
            '\n输出 {"posts":[{"accountId":"已知账号 ID；新作者留空","name":"新作者名称","handle":"新作者账号","text":"公开帖子内容"}],"replies":[{"postId":"给出的 user 公开帖子 ID","accountId":"已知账号 ID；新作者留空","name":"新作者名称","handle":"新作者账号","text":"对这条 user 帖子的公开回复"}]}。posts 与 replies 各最多 5 条；可以为空，不强制回应。广场任务只填 posts，replies 为空。不得替 user 发帖，不泄漏私人剧情。'+engagementRules()+engagementShape+(square?'\n每条广场帖子必须附 publicBasis:{access:"background/public/limited",summary:"公众知情途径及实际可见范围",sourceIndex:已知时填原楼号，未知省略,evidence:"酒馆当前上下文中对应角色正文的连续逐字句子",witnessEvidence:"limited 时另填原文已发生外部目击的逐字句子，不能只写可能被看见",involvesCharacters:false}。background 仅为无剧情人物的普通背景帖子，不需引用；public/limited 必须有有效引用，private 内容不得生成。':''),d=>({posts:d.posts===undefined&&!square&&Array.isArray(d.accounts)?[]:list(d,'posts',5),replies:d.replies===undefined?[]:list(d,'replies',5),accounts:!square&&!following&&d.accounts!==undefined?list(d,'accounts',8):[],engagementUpdates:!square&&d.engagementUpdates!==undefined?list(d,'engagementUpdates',15):[],audience:square?null:d.audience}),{outputContract:refreshOutput,finalOutputContract:refreshOutput,combined,memoryActors:square?[]:xItems(state,'account').filter(a=>!a.blocked)});
        state=structuredClone(state);state.x||={};const changes=[],newMentions=new Map();let added=0,repeatedSquare=false;
        if(!square&&!following){
            for(const old of xItems(state,'account').filter(a=>a.recommended)){const next={...old,recommended:false};state.x[next.id]=next;changes.push(xSet(next));}
            for(const item of results.accounts){const a=register(state,item,changes);if(a&&!a.blocked){a.recommended=true;changes.push(xSet({...a}));}}
        }
        for(const [n,item] of results.posts.entries()){if(!xText(item?.text))continue;
            const basis=square?squareBasis(item,prose):null;if(square&&!basis)continue;
            const a=resolvePostAuthor(state,item,changes,following,square);if(!a)continue;
            if(!square&&!following){a.recommended=true;changes.push(xSet({...a}));}
            const existing=xItems(state,'post').find(p=>p.author===a.id&&p.text===xText(item.text));
            if(existing){if(square&&existing.feed==='square')repeatedSquare=true;if(existing.mentionsUser)newMentions.set('mention:new:'+n,'mention:'+existing.id);continue;}
            const mentionsUser=!square&&item.mentionsUser===true&&new RegExp('@'+profile(state).alias.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?=$|[^\\p{L}\\p{N}_])','u').test(item.text);
            const post=xRecord('post',{author:a.id,postedAtStory:squareClock(chat),text:xText(item.text),liked:false,reposted:false,feed:square?'square':'home',mentionsUser});
            if(mentionsUser)newMentions.set('mention:new:'+n,'mention:'+post.id);
            if(square){post.publication={editionId:edition.editionId,clock:edition.clock,publicBasis:basis,selected:false,sourceIndex:chat.length-1};edition.postIds.push(post.id);}
            state.x[post.id]=post;addEngagement(state,post,item,changes);
            added++;
        }
        for(const item of square?[]:results.replies){
            if(combined&&!userPosts.some(p=>p.id===item?.postId))continue;
            const post=state.x[item?.postId];if(post?.type!=='post'||post.author!=='user'||!xText(item.text)||noAccount(item))continue;
            let a=item.accountId?state.x[item.accountId]:null;if(a?.type!=='account')a=null;
            if(!a)a=register(state,item,changes);if(!a||a.blocked)continue;
            if(findComment(state,post.id,a.id,xText(item.text)))continue;
            a=known(state,a);state.x[a.id]=a;changes.push(xSet(a));
            const reply=xRecord('comment',{postId:post.id,author:a.id,text:xText(item.text),replyTo:null});state.x[reply.id]=reply;changes.push(xSet(reply));
        }
        for(const item of results.engagementUpdates){
            if(combined&&!userPosts.some(p=>p.id===item?.postId))continue;
            const post=state.x[item?.postId];if(post?.type!=='post'||post.author!=='user')continue;
            addEngagement(state,post,item,changes);
        }
        const audience=results.audience&&typeof results.audience==='object'&&!Array.isArray(results.audience)?{...results.audience,growth:Array.isArray(results.audience.growth)?results.audience.growth.map(row=>({...row,sourceId:newMentions.get(row?.sourceId)||row?.sourceId})):results.audience.growth}:results.audience;
        if(!combined)changes.push(...audienceChanges(state,audience));
        if(square){if(results.posts.length&&!added&&!repeatedSquare)throw Error('这批帖子缺少有效公开依据，原广场已保留，请重试。');if(added||!repeatedSquare)changes.push(xSet(edition));}
        await commit(changes);return {added};
        }
    return {
        open:()=>memory.read(),
        decideRequest(id,accept){return run(async(state,_c,_r,commit)=>{const a=xAccount(state,id);if(a.inboundRequest!=='pending'||a.blocked)throw Error('请求已失效');await commit([xSet({...a,inboundRequest:accept?'accepted':'declined',dmAccepted:accept})]);});},
        saveProfile(values){return run(async(state,_c,_r,commit)=>{await commit([xSet({...profile(state),alias:xRequired(values.alias,'名称',60),bio:xText(values.bio,500),requestsOpen:values.requestsOpen===undefined?profile(state).requestsOpen:values.requestsOpen==='true'||values.requestsOpen===true})]);});},
        resetFollowers(){return run(async(state,current,request,commit)=>{
            const saved=xAudience(state);
            if(saved){await commit([xSet({...saved,followers:saved.initialFollowers})]);return;}
            const data=await ask(state,null,request,current,'当前任务：X 初始粉丝。'+AUDIENCE_RULES+'只确定初始值，不计算发帖后的增长。输出 {"initialFollowers":整数}。',d=>{
                if(d.initialFollowers==null)throw Error('X 初始粉丝返回缺少 initialFollowers。');
                return audienceChanges(state,{initialFollowers:d.initialFollowers});
            });
            await commit(data);
        });},
        discover(query){return run(async(state,current,request,commit)=>{
            const results=await ask(state,null,request,current,'当前任务：X 搜索账号。搜索词：'+JSON.stringify(xText(query,100))+'。根据角色和世界设定查找使用 X 的人物，char 默认用真名；不能因为已有电话号码或 Snapchat 好友就假定有 X 账号。'+X_SEARCH_OUTPUT,d=>list(d,'accounts',10),{finalOutputContract:X_SEARCH_OUTPUT});
            state=structuredClone(state);state.x||={};const changes=[],ids=[];
            for(const item of results){if(item?.has_account!==true)continue;const a=register(state,item,changes);if(a&&!ids.includes(a.id))ids.push(a.id);}
            await commit(changes);return {ids};
        });},
        follow(id,value){return run(async(state,_c,_r,commit)=>{const a=xAccount(state,id);await commit([xSet({...known(state,a),following:value===true})]);});},
        block(id,value){return run(async(state,_c,_r,commit)=>{const a=xAccount(state,id,false);await commit([xSet({...a,blocked:value===true}),...xThread(state,id).filter(m=>!m.read).map(m=>xSet({...m,read:true}))]);});},
        reveal(id){return run(async(state,_c,_r,commit)=>{const a=xAccount(state,id);if(a.inboundRequest==='pending'||a.inboundRequest==='declined')throw Error('请先接受私信请求。');if(a.dmPolicy==='closed')throw Error('此账号暂不接收私信。');await commit([xSet({...a,identityKnown:true}),xSet(xRecord('message',{accountId:id,role:'user',text:'我是 '+getContext().name1+'。',status:'sent',read:true}))]);});},
        publish(value){return run(async(state,current,request,commit)=>{
            const chat=getContext().chat,post=xRecord('post',{author:'user',alias:profile(state).alias,text:xRequired(value,'帖子内容'),
                followersAtPublication:xAudience(state)?.followers??null,includedDirectReplies:0,postedAtStory:squareClock(chat),sourceIndex:chat.length-1,liked:false,reposted:false});
            const changes=[xSet(post)];
            if(privilegeLevel(post.followersAtPublication)){
                const targets=new Map(privilegeRows(state).map(r=>[r.targetId,{targetId:r.targetId,target:r.target,identity:r.identity}]));
                const task=privilegeContract+'\n本次推文：'+JSON.stringify(post.text)+'\n此前已识别的对象：'+JSON.stringify([...targets.values()])+'。同一目标沿用targetId，同名不同对象要区分。';
                changes.push(...await ask(state,null,request,current,task,r=>privilegeChanges(state,post,r),{finalOutputContract:privilegeContract,memoryTopic:post.text}));
            }
            await commit(changes);
        });},
        toggleInjection(id){return run(async(state,_c,_r,commit)=>{
            const p=state.x[id],chat=getContext().chat;
            if(p?.type!=='post'||p.feed!=='square'||squareStatus(p,state,chat)!=='active')throw Error('这条内容已采用、过期或时间不明确，无法注入。');
            await commit([xSet({...p,publication:{...p.publication,selected:!p.publication.selected,selectedIndex:chat.length-1}})]);
        });},
        refreshTrends(){return run((...args)=>refreshTrendsStage(...args,false));},
        refresh(following=false){return run((...args)=>refreshFeedStage(...args,following,false));},
        editPage(scope,edits){return run(async(state,_current,_request,commit)=>{await commit(pageEdits(state,scope,edits));});},
        refreshPublic(){return run(async(state,current,request,commit)=>{
            const context=getContext(),chat=context.chat,floor=refreshFloor(chat);
            if(floor<0||state.x['public-refresh']?.floor===floor)throw Error('当前楼层没有新的刷新机会。');
            const persona=context.powerUserSettings?.persona_description,valid=()=>current()&&getContext().powerUserSettings?.persona_description===persona;
            const staged=structuredClone(state),changes=[],clock=squareClock(chat);
            const collect=rows=>{for(const row of rows){
                if(!staged.x[row.key]&&row.value?.type==='comment'){row.value.sourceIndex=chat.length-1;row.value.postedAtStory=clock;}
                staged.x[row.key]=row.value;changes.push(row);
            }};
            await refreshFeedStage(staged,valid,request,collect,false,true);
            await refreshFeedStage(staged,valid,request,collect,'square',true);
            await refreshTrendsStage(staged,valid,request,collect,true);
            const info={now:clock,profile:profile(staged),anonymous:profile(staged).alias!==context.name1,
                persona,followers:xAudience(staged)?.followers,initial:xAudience(staged)?.initialFollowers,
                sources:influenceSources(staged,chat),trends:staged.x['trend-edition']?.topics,
                processed:impactRecords(staged).map(e=>({sourceId:e.sourceId,basis:e.basis,end:e.end,total:e.total,remaining:e.expired?0:clock.day===null?null:Math.max(0,e.end-clock.day)})),
                brandIncidents:Object.values(staged.business||{}).filter(p=>p.risk==='triggered').map(p=>({brand:p.brand,project:p.project,date:p.incidentDate,loss:p.loss}))};
            const impact=await ask(staged,null,request,valid,INFLUENCE_RULES+'\n资料：'+JSON.stringify(info)+'\n'+INFLUENCE_OUTPUT,
                data=>settleInfluence(staged,chat,context.name1,data),{combined:true,finalOutputContract:INFLUENCE_OUTPUT});
            if(!valid())throw Error('聊天或人设已改变。');
            collect(impact);collect([xSet({id:'public-refresh',type:'refresh',floor})]);
            await commit(changes);
        });},
        react(id,kind){return run(async(state,_c,_r,commit)=>{const p=state.x[id];if(p?.type!=='post'||!['liked','reposted'].includes(kind))throw Error('帖子不可用。');if(p.author!=='user')xAccount(state,p.author);await commit([xSet({...p,[kind]:!p[kind],[kind+'At']:Date.now(),...(kind==='reposted'?{repostedDay:squareClock(getContext().chat).day}:{})})]);});},
        comment(id,value,replyTo=null){return run(async(state,current,request,commit)=>{
            const p=state.x[id];if(p?.type!=='post')throw Error('帖子不存在。');
            if(p.author!=='user')xAccount(state,p.author);
            const parent=replyTo?state.x[replyTo]:null;
            if(replyTo&&(parent?.type!=='comment'||parent.postId!==id))throw Error('这条回复已不存在。');
            const targetId=parent?.author||p.author;
            const target=targetId==='user'?null:known(state,xAccount(state,targetId));
            const body=xRequired(value,'回复内容');const comment=xRecord('comment',{postId:id,author:'user',alias:profile(state).alias,text:body,replyTo:parent?.id||null});const changes=[xSet(comment)];
            // Square generation is refresh-only. Posting a comment is local;
            // direct conversations and the regular home feed keep their replies.
            if(target&&p.feed!=='square'){

                const reply=await ask(state,target,request,current,'当前任务：X 评论。你是被回复的账号：'+JSON.stringify({name:target.name,handle:target.handle})+'；帖子作者：'+JSON.stringify(p.author==='user'?profile(state).alias:state.x[p.author]?.name)+'；公开帖子：'+JSON.stringify(p.text)+publicationScenePrompt(getContext(),[p])+'；此前评论：'+JSON.stringify(xItems(state,'comment').filter(c=>c.postId===id).slice(-30).map(c=>({id:c.id,name:c.author==='user'?profile(state).alias:state.x[c.author]?.name,text:c.text,replyTo:c.replyTo})))+'；user 回复的目标评论：'+JSON.stringify(parent?.text||null)+'；user 本次评论：'+JSON.stringify(body)+'。仅决定本账号是否回应 user，可保持沉默，不强制帖子作者出面。输出 {"text":"回复或空字符串"}。不得用私信或未公开剧情作为公众已知。'+engagementRules()+'。粉丝变化在首页综合刷新时评估。',d=>{if(typeof d.text!=='string')throw Error('评论格式不正确。');return {text:xText(d.text),audience:d.audience};},{memoryTopic:[p.text,parent?.text,body].filter(Boolean).join('\n')});
                changes.push(xSet(target));if(reply.text)changes.push(xSet(xRecord('comment',{postId:id,author:target.id,text:reply.text,replyTo:comment.id})));


            }
            await commit(changes);
        });},
        send(id,value){return run(async(state,current,request,commit)=>{
            const a=known(state,xAccount(state,id));if(a.inboundRequest==='pending'||a.inboundRequest==='declined')throw Error('请先接受私信请求。');if(a.dmPolicy==='closed')throw Error('此账号暂不接收私信。');
            const m=xRecord('message',{accountId:id,role:'user',text:xRequired(value,'消息'),status:'pending',read:true});await commit([xSet(a),xSet(m)]);
            const fresh=await memory.read(),ticket=await memory.begin();
            try{await answer(fresh.state,a,m,current,request,async changes=>{if(!current())throw Error('聊天已变化。');await memory.commit(ticket,changes);});}
            catch(error){if(current())await memory.commit(ticket,[xSet({...m,status:'failed'})]);throw error;}
        });},
        retryMessage(id){return run(async(state,current,request,commit)=>{const m=state.x[id];if(m?.type!=='message'||m.role!=='user'||!['failed','pending','request'].includes(m.status))throw Error('此消息不需要重试。');const a=xAccount(state,m.accountId);if(a.inboundRequest==='pending'||a.inboundRequest==='declined')throw Error('请先接受私信请求。');if(a.dmPolicy==='closed')throw Error('此账号暂不接收私信。');await answer(state,a,m,current,request,commit);});},
        markPostRead(id){return run(async(state,_c,_r,commit)=>{await commit([...(state.x[id]?.outreachMention?[xSet({...state.x[id],read:true})]:[]),...xItems(state,'comment').filter(c=>c.postId===id&&c.author!=='user'&&!c.read).map(c=>xSet({...c,read:true}))]);});},
        markRead(id){return run(async(state,_c,_r,commit)=>{await commit(xThread(state,id).filter(m=>m.role==='assistant'&&!m.read).map(m=>xSet({...m,read:true})));});},
    };
}
