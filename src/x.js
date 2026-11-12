import {privilegeLevel,privilegeRows,privilegeChanges,privilegeContract} from './x-privilege.js?v=1.2';
import {pageEdits,objectEdits} from './x-edit.js?v=1.2';
import {refreshFloor,settleInfluence,REACH_CONTEXT} from './x-influence.js?v=1.2';
import {X_FLOOR_LEDGER,X_FLOOR_VERSION,coveredFloors,pendingFloorBatch,coverThrough,floorAudienceChanges} from './x-floor.js?v=1.2';
import {readXMemory} from './external-memory.js?v=1.2';
import {dmDealTask,dealDecision,businessLateReplyOutcome,isLateBusinessReply} from './x-business.js?v=1.2.35';
import {JOURNAL_KEY} from './journal.js?v=1.2';
import {readStoryClock,storyTime,exactStoryTime} from './story-clock.js?v=1.2';
import { X_TRENDS_RULES, X_TRENDS_OUTPUT, validateTrends } from './x-trends.js?v=1.2';
import { publicationScenePrompt } from './social-context.js?v=1.2';
import { xCommentKey, xComments, X_COMMENT_LIMIT } from './x-comments.js?v=1.2';
import { SQUARE_RULES, squareClock, storyEvidenceRows, squareBasis, squareStatus } from './square-core.js?v=1.2';
import {xAccountKind,institutionName,xFeedArea} from './x-feed.js?v=1.2';
import {establishedSources} from './contacts.js?v=1.2';
import { localizedPerson, sameNamedPerson, nameAliases } from './names.js?v=1.2';
import { parseModelObject } from './model-json.js?v=1.2.47';
import { smsCategory, commReplyClassification } from './comm-context.js?v=1.2.50';
import { xAudience, audienceChanges, AUDIENCE_RULES } from './x-audience.js?v=1.2';
// Story-local X simulation. No real social-network API or account is used.
export const xItems = (state,type) => type==='comment' ? xComments(state) : Object.values(state.x || {}).filter(item=>item.type===type);
export const xProfile = (state,name='user') => state.x?.profile || {id:'profile',type:'profile',alias:name,bio:''};
// Public actions are first-class X facts, not private messages or instructions
// addressed to one NPC. A deterministic key keeps only the latest unconsumed
// state change of each kind for each public post or account.
export const xPendingPublicActivities = state => xItems(state,'public-activity')
    .filter(row => row.shown !== true)
    .sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)||a.id.localeCompare(b.id));
// The desktop X badge represents unread incoming DMs from unblocked accounts.
// Blocking a sender hides their badge but does not falsely mark the message read.
export const xUnread = state => xItems(state,'message').filter(m=>m.role==='assistant'&&!m.read&&!state.x?.[m.accountId]?.blocked).length;
const metric = n => Number.isFinite(Number(n)) ? Math.min(Number.MAX_SAFE_INTEGER,Math.max(0,Math.floor(Number(n)))) : 0;
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
// A few X models return a complete array despite being asked for the list's
// root object. Convert only an unambiguous task-specific array; never guess a
// private message, engagement update, account identity or financial record.
export function parseXObject(text, {arrayKey = null} = {}) {
    try {
        const data=parseModelObject(text,{allowTrailingCommas:true,allowRootArray:!!arrayKey});
        if (!Array.isArray(data)) return data;
        const record=row=>!!row&&typeof row==='object'&&!Array.isArray(row);
        const populated=value=>typeof value==='string'&&!!value.trim();
        const valid={
            posts:row=>populated(row.text)&&(populated(row.accountId)||(populated(row.name)&&populated(row.handle))),
            replies:row=>populated(row.text)&&populated(row.postId)&&(populated(row.accountId)||(populated(row.name)&&populated(row.handle))),
            accounts:row=>populated(row.name)&&populated(row.handle),
            comments:row=>populated(row.text)&&(populated(row.accountId)||(populated(row.name)&&populated(row.handle))),
            topics:row=>populated(row.title)&&populated(row.summary),
        };
        if (!Object.hasOwn(valid,arrayKey)||!data.every(row=>record(row)&&valid[arrayKey](row))) {
            throw Object.assign(new Error('X 数据返回格式不正确：顶层数组无法对应本次任务。本次未保存。'),{
                code:'MODEL_JSON_TYPE',diagnostic:'任务：X；错误代码：MODEL_JSON_TYPE；原因：顶层数组与任务字段不符；返回条数：'+data.length,
            });
        }
        return {[arrayKey]:data};
    }
    catch (error) {
        throw Object.assign(new Error(error.message.replaceAll('账本','X 数据')), {
            code:error.code, diagnostic:error.diagnostic?.replaceAll('资产评估','X').replaceAll('账本','X 数据'),
        });
    }
}
export const X_ACCOUNT_RULES = '先判断谁可能使用 X/Twitter：根据时代、地区、联网条件、年龄、性格和明确设定筛选，不假定每个 char 都有账号。与世隔绝、长期不接触网络、明确厌恶现代科技/社交平台或设定无账号者不得生成个人账号，不借官方/代运营账号冒充本人。已有合法账号和明确新使用事实优先，不能因有电话号码或别的平台账号推定。char 使用真名是命名规则，不代表必定使用平台。';
const noAccount = row => row?.has_account === false || row?.has_account === 'false';
const X_JSON_OUTPUT = '当前是 X 应用结构化任务，不续写正文或输出HTML。最终只输出本任务要求的一个JSON对象。字段名和字符串使用英文双引号；字符串内部的双引号、反斜杠及换行必须转义。布尔值用true/false，数值直接写数字，不写千分位或单位。不得照抄说明性占位符，不使用单引号、注释、尾逗号或多个结果。内容语言、人物记忆和知情边界仍遵守原要求。';
    const X_FEED_OUTPUT = (recommended,square=false) => '本次为X刷新，根结构为 {"posts":[],"replies":[]}；无内容也保留这两个数组，不能返回accounts代替posts。'+(square?'生成 10～15 条不同作者的广场帖子，少于 10 条本次不会保存；':recommended?'有足够适合发帖的剧情NPC时返回10～15条不同作者的新推文，每人一条；合理人数较少时按实际人数，可为0；':'posts 最多5条；')+'replies 最多5条，可为空。帖子字段accountId/name/handle/text为字符串，has_account为布尔值，category 为可选时效分类（"A"=日常闲聊/短时动态，"B"=约定/待办/仍在发展的具体事件）；imageDescription 为可选图片描述，仅图文帖填写，纯文字帖省略；replies用postId和accountId关联提供的真实ID，可同样附 category。推荐账号可另附accounts数组（最多15个），新作者直接附在 posts 中也可正常注册。可选metrics为含likes/reposts/replies数字的对象，comments为数组；已有帖互动放engagementUpdates数组，最多15条。所有可选内容合并到同一个根对象，不输出额外JSON。';
const X_SEARCH_OUTPUT = '本次任务是搜索/添加 X 角色账号，不续写正文。最终仅输出一个 JSON 对象，根字段 accounts 为数组，最多10个；无合适账号返回 {"accounts":[]}。每条格式为 {"name":"姓名","handle":"唯一账号名","bio":"简介","has_account":true,"dm_policy":"requests"}，dm_policy 只选 open、requests、closed 之一。字段名及字符串必须用英文双引号；字符串内双引号、换行须按JSON转义，布尔值用true/false；不使用尾逗号、单引号、代码或说明。不抄占位内容，不用姓名替代字段名。内容语言及账号适用性保持原规则。';

export function createX({memory,phone,getContext,getSettings}) {
    const profile=state=>xProfile(state,getContext().name1);
    const socialEvent=(slot,target,action,fields={})=>({
        id:'public-activity:'+slot+':'+target,
        type:'public-activity',action,shown:false,createdAt:Date.now(),
        storyTime:squareClock(getContext().chat||[]),...fields,
    });
    function publicActivityPrompt(state,rows,candidateMap=new Map()) {
        if(!rows.length)return '';
        const events=rows.map(item=>{
            const post=item.postId?state.x?.[item.postId]:null;
            const targetId=item.accountId||post?.author;
            const author=targetId==='user'?{name:profile(state).alias,handle:null}:state.x?.[targetId];
            if(targetId!=='user'&&(!author||author.type!=='account'||author.blocked))return null;
            return {eventId:item.id,action:item.action,
                targetAccount:author?{id:targetId,name:author.name,handle:author.handle||null}:null,
                ...(post?.type==='post'?{post:{id:post.id,authorId:post.author,text:xText(post.text,360),imageDescription:xText(post.imageDescription,160)}}:{}),
                relatedNPCs:(candidateMap.get(item.id)||[]).map(a=>({id:a.id,name:a.name,handle:a.handle||null,characterId:a.characterId||null,relationshipSignals:a.relationshipSignals||[]})),
                storyTime:item.storyTime||null};
        }).filter(Boolean);
        if(!events.length)return '';
        return '\n本次首页刷新新增的一次性公开社交动态（只有本次可作为新鲜事件，已展示后不再注入）：'+
            JSON.stringify({userAlias:profile(state).alias,currentRoleCharacter:getContext().name2||null,events})+
            '。这不是发送给某个NPC的私信，而是公开社交行为。每个事件都必须检查相关NPC是否能通过公开点赞列表、公开关注关系、转发记录、共同社交圈或已有公开互动注意到。' +
            '对 relatedNPCs 中有合理知情路径的人物，至少生成1条、通常1～2条公开反应推文；不要把“允许沉默”当成默认答案，也不能在有相关NPC时让所有人毫无反应。每个事件最多2条，使用该事件提供的准确 accountId，反应必须写进 activityReactions，不要混入普通 posts。只有确实没有合适的相关NPC或事件没有合理公开可见路径时才返回空数组。' +
            '反应应像真实 X 用户发推：可以含蓄调侃、猜测、吃瓜、阴阳怪气、表达醋意或单纯讨论，不必每次直白复述 user 的操作，也不必直接点名 user。' +
            '匿名账号仅可按公开网名识别，除非已知身份，不得凭私人剧情认出真人；人物私下知道的关系不能自动变成公众已知。' +
            '事件发生过不等于事件当前仍在发生；旧帖子和既有关注状态也不代表刚刚点赞、转发或关注，不可把历史动态反复当新闻。';
    }
    const known=(state,a)=>({...a,identityKnown:a.identityKnown===true||profile(state).alias===getContext().name1});
    const accountContext=(state,a)=>({id:a.id,name:a.name,aliases:a.aliases,handle:a.handle,identityKnown:known(state,a).identityKnown,following:a.following,crowd:a.crowd});
    const isNpcAccount=(state,a)=>{
        if(!a||a.type!=='account'||a.blocked||a.crowd)return false;
        const kind=xAccountKind(a);
        return kind==='npc'||kind==null&&xItems(state,'post').some(p=>p.author===a.id&&p.feed!=='square');
    };
    function relatedNpcAccounts(state,postId,focusIds=[],excludeIds=[],limit=6){
        const context=getContext(),post=state.x?.[postId],thread=xItems(state,'comment').filter(c=>c.postId===postId);
        const focus=new Set([...focusIds,post?.author,...thread.map(c=>c.author)].filter(id=>id&&id!=='user'));
        const threadAuthors=new Set(thread.map(c=>c.author)),connected=new Set();
        for(const comment of xItems(state,'comment')){
            const owner=state.x?.[comment.postId]?.author;
            if(focus.has(comment.author)&&owner&&owner!=='user')connected.add(owner);
            if(focus.has(owner)&&comment.author&&comment.author!=='user')connected.add(comment.author);
        }
        const excluded=new Set(excludeIds),current=context.name2;
        return xItems(state,'account').filter(a=>isNpcAccount(state,a)&&!excluded.has(a.id)).map((a,index)=>{
            const signals=[],currentRole=!!current&&sameNamedPerson(a,{name:current});
            let score=0;
            if(currentRole){score+=100;signals.push('当前剧情角色');}
            if(threadAuthors.has(a.id)){score+=40;signals.push('参与过同一评论串');}
            if(connected.has(a.id)){score+=20;signals.push('与事件相关账号有公开互动');}
            if(focus.has(a.id)){score+=15;signals.push('事件目标账号');}
            if(a.following){score+=5;signals.push('user 已关注');}
            return {...a,score,index,relationshipSignals:signals};
        }).filter(a=>a.score>0).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,limit);
    }
    function publicConversation(state, maxComments=40, maxChars=24000) {
        const all=xItems(state,'post');
        const posts=new Set([...all.slice(-20),...all.filter(p=>p.author==='user').slice(-15)].map(p=>p.id));
        const result=[];let size=0;
        for(const c of xItems(state,'comment').filter(c=>posts.has(c.postId)&&!state.x[c.author]?.blocked).slice(-maxComments).reverse()) {
            const row={postId:c.postId,id:c.id,author:c.author,name:c.author==='user'?profile(state).alias:state.x[c.author]?.name,text:c.text,replyTo:c.replyTo};
            const length=JSON.stringify(row).length;if(size+length>maxChars)continue;
            result.unshift(row);size+=length;
        }
        return result;
    }
    const run=work=>phone.appTask(async(view,current,request)=>{
        if(!current())throw Error('X 已关闭或聊天已变化。');
        const ticket=await memory.begin(view);
        const commit=async changes=>{if(!current())throw Error('聊天已变化，本次操作已取消。');if(changes.length)await memory.commit(ticket,changes);};
        return work(view.state,current,request,commit,ticket);
    },'x');
    function prompt(state,a,task,combined) {
        const p=profile(state);
        return getSettings().prompts.general+'\n'+getSettings().prompts.x+'\n'+getSettings().prompts.xStyle+
            '\n这是 X 文字扮演任务，不执行真实网络操作。只输出本任务指定 JSON，内容语言遵守酒馆预设；不替 user 发言。user 的公开个人资料：'+JSON.stringify({alias:p.alias,bio:p.bio})+
            '\n结合有效正文、人设和千千结记忆理解当前发言及其指代；私人电话、短信、其他 App 内容不能凭空变成公开消息。每人一个 X 账号，发现账号不等于认识真人。'+
            '\n人物认知连续性：先结合有效正文、已提供的千千结记忆和本帖既有评论，逐人区分已经亲历/目击/被明确告知的事实、只见过的公开内容及尚未知情的事。已确认账号身份的熟人应延续自己已有认知，不因换到 X 就把见过的物品、已获知的关系或计划当成首次听说。可以对新变化作反应（例如订婚不等于已经结婚、计划出行不等于已经抵达），不重复首次惊讶或已经回答的问题。私下已知可以影响措辞或选择沉默，不等于把私密细节公开，也不等于其他网友知道。未知身份账号仍不得利用私下经历认人；无记录不能断言从未发生。'+
            '\n身份基线：'+(p.alias===getContext().name1?'user 当前使用已设置的真实姓名，按原有真名账号规则识别；是否熟悉以及知道哪些事仍须逐人有依据。':'user 使用网名；只有明确 identityKnown 的账号可关联真人，其他账号保持匿名边界。')+
            (a?'\n当前对方：'+JSON.stringify({name:a.name,handle:a.handle})+'。'+(a.identityKnown?'此前已确认 user 账号对应的真实身份，改网名不会遗忘。':'对方不知道此网名是谁。不能凭后台 user 对应关系、角色卡、人设、正文中的私人称呼或私下经历认出 user；只知道网名及本账号公开过或本私信提供的信息。'):'\n逐个人物区分知情范围，不把后台账号对应关系当作人物已知。')+
            '\nuser 最近公开帖子：'+JSON.stringify(xItems(state,'post').filter(p=>p.author==='user').slice(combined?-10:-15).map(({id,text,imageDescription})=>({id,text,imageDescription})))+'\n'+task;
    }
    const ask=(state,a,request,current,task,validate,options)=>request(prompt(state,a,task,options?.combined),validate,current,a?{id:a.characterId||a.id,name:a.name,channel:'x',alias:profile(state).alias,identityKnown:!!a.identityKnown}:null,{
        retries:0,parseResponse:text=>parseXObject(text,{arrayKey:options?.arrayKey}),formatRetryOnce:true,memoryQuery:{actors:a?[a]:[],names:a?[a.name,...(a.aliases||[])]:[],topic:options?.memoryTopic||''},finalOutputContract:X_JSON_OUTPUT,
        outputContract:X_JSON_OUTPUT+'\n当前是 X 应用任务，不续写正文、不输出状态栏或 HTML。保留人设、背景和语言约定，最终只返回本任务要求的单个完整 JSON 对象，数组无内容用[]；不要复述示例或输出多个候选。'+X_ACCOUNT_RULES,...options,
    });
    function register(state,item,changes,kind=null) {
        if(!kind&&item?.authorKind==='organization')kind='organization';
        const organization=kind==='organization',crowdOnly=organization||kind==='public';
        const identity=organization?{name:xText(item?.name,100),aliases:nameAliases(item),cardId:null}:localizedPerson(item,getContext(),xItems(state,'account'));
        const name=identity.name,handle=xText(item?.handle,60).replace(/^@/,'');
        if(!name||!handle||/[\s<>]/.test(handle)||name===getContext().name1||noAccount(item))return null;
        const normalize=s=>String(s||'').normalize('NFKC').trim().toLowerCase();
        const cards=(getContext().characters||[]).filter(c=>sameNamedPerson(c,identity));const characterId=identity.cardId;
        const existing=xItems(state,'account').find(a=>normalize(a.handle)===normalize(handle))||
            xItems(state,'account').find(a=>(characterId&&a.characterId===characterId)||(!organization&&sameNamedPerson(a,identity)));
        const oldKind=xAccountKind(existing);
        if(crowdOnly&&(normalize(name)===normalize(getContext().name1)||oldKind==='npc'||
            (cards.length&&!(organization&&institutionName(name)))))return null;
        if(kind==='npc'&&['organization','public'].includes(oldKind))return null;
        if(existing&&oldKind==='organization')return existing;
        if(existing){if(existing.name!==name||(!existing.characterId&&characterId)||identity.aliases.some(alias=>!existing.aliases?.includes(alias))){const next={...existing,name,aliases:identity.aliases,characterId:existing.characterId||characterId};state.x[next.id]=next;changes.push(xSet(next));return next;}return existing;}
        const a=xRecord('account',{name,aliases:identity.aliases,handle,characterId,bio:xText(item.bio,500),followers:metric(item.followers),dmPolicy:['open','requests','closed'].includes(item.dm_policy)?item.dm_policy:'requests',following:false,blocked:false,identityKnown:false,crowd:crowdOnly,...(kind?{authorKind:kind}:{})});
        state.x[a.id]=a;changes.push(xSet(a));return a;
    }
    const list=(data,key,max)=>{if(!Array.isArray(data?.[key])||data[key].length>max)throw Error('X 返回字段 '+key+' 应为最多 '+max+' 条的数组，当前'+(data?.[key]==null?'缺失':Array.isArray(data[key])?'有 '+data[key].length+' 条':'类型不正确')+'。本次未保存。');return data[key];};
    const engagementRules = () => '\n'+getSettings().prompts.xInteractions;
    const engagementShape = '\n每条 post 可附 metrics:{"likes":0,"reposts":0,"replies":0} 以及 comments:[{"key":"本帖内唯一标记","accountId":"已知评论者账号 ID，未知留空","name":"评论者姓名或网名","handle":"账号名","text":"评论内容","replyTo":"回复本帖某条 comment 的 key；回复帖子留空","isAuthor":false,"category":"可选时效分类：A=日常闲聊/短时回应，B=约定/待办/仍在发展的具体事件"}]。作者发言用 isAuthor:true，不必再给姓名。按累计评论数给出最多15条具体评论，0～15条时全部给出，超过15条时选15条有代表性的评论。已有具体评论计入目标，不重写或重复。先给原评论再给它的回复；metrics.replies 为含这些样本的累计数。评论只属于本帖。';
    const findComment=(state,postId,author,body,parent=null)=>{
        const key=xCommentKey(postId,author,body,parent);
        return xComments(state).find(c=>xCommentKey(c.postId,c.author,c.text,c.replyTo)===key);
    };
    function addSamples(state,post,rows,changes,limit) {
        const saved=xComments(state).filter(c=>c.postId===post.id),keys=new Map(saved.map(c=>[c.id,c.id]));
        let count=saved.length;
        for(const row of Array.isArray(rows)?rows:[]){
            if(count>=limit)break;
            if(!xText(row?.text)||noAccount(row)||row.accountId==='user'||row.isAuthor===true&&post.author==='user')continue;
            if(sameNamedPerson(row,{name:'user',aliases:[getContext().name1,profile(state).alias]}))continue;
            const parent=row.replyTo?keys.get(String(row.replyTo)):null;
            if(row.replyTo&&!parent)continue;
            // Do not invent a user's reply, or replace an unknown explicit ID by a name match.
            let a=row.isAuthor===true?state.x[post.author]:row.accountId?state.x[row.accountId]:null;
            if(!row.accountId&&row.isAuthor!==true)a=register(state,row,changes);
            if(a?.type!=='account'||a.blocked)continue;
            const existing=findComment(state,post.id,a.id,xText(row.text),parent);
            const id=existing?.id||crypto.randomUUID();
            if(!existing){
                const comment={id,type:'comment',postId:post.id,author:a.id,text:xText(row.text),replyTo:parent||null,
                    ambient:true,read:true,createdAt:Date.now(),sourceIndex:getContext().chat.length-1,postedAtStory:squareClock(getContext().chat)};
                state.x[id]=comment;changes.push(xSet(comment));count++;
                // Backfilled samples join the unified timing sidecar: whenever
                // the phone provides a comment to the narrative it obeys the
                // same A/B expiry and shown rules as every other record.
                const classified=commReplyClassification('x',id,post.id,smsCategory(row.category),state);
                if(classified.length)changes.push(...classified);
            }
            if(row.key&&!keys.has(String(row.key)))keys.set(String(row.key),id);
        }
        return count;
    }
    function addEngagement(state,post,item,changes) {
        const raw=item.metrics||{},hasTotal=raw.replies!=null||post.metrics?.replies!=null;
        post.metrics=Object.fromEntries(['likes','reposts','replies'].map(key=>[key,Math.max(metric(post.metrics?.[key]),metric(raw[key]))]));
        if(raw.replies!=null)post.includedDirectReplies=xComments(state).filter(c=>c.postId===post.id&&!c.ambient).length;
        const limit=hasTotal?Math.min(X_COMMENT_LIMIT,xCounts(state,post).replies):X_COMMENT_LIMIT;
        addSamples(state,post,item.comments,changes,limit);
        changes.push(xSet(post));
    }
    async function completeComments(state,current,request,commit,id) {
        const post=state.x[id];
        if(post?.type!=='post'||state.x[post.author]?.blocked)throw Error('这条推文已不可用。');
        const saved=xComments(state).filter(c=>c.postId===id);
        const target=Math.min(X_COMMENT_LIMIT,xCounts(state,post).replies),missing=target-saved.length;
        if(missing<=0)return;
        const contract='仅输出 {"comments":[]}，comments 恰好填 '+missing+' 条缺少的具体评论，属于已有累计评论样本，每条可附可选时效分类 category（"A"=日常闲聊/短时回应，"B"=约定/待办/仍在发展的具体事件）。不得返回互动或粉丝统计。';
        const task='当前任务：补齐此帖已有公开评论。'+contract+engagementRules()+engagementShape+
            '只生成此帖还未保存的公开回应，不重复已有评论，不替user发言。replyTo 可填此帖已有评论ID或本批前面评论的key；回复帖子本身留空。已知作者用账号ID，新作者填姓名、唯一handle及has_account。禁止使用私信、隐藏身份或私人剧情作公众已知。'+
            JSON.stringify({post:{id:post.id,author:post.author,text:post.text,imageDescription:post.imageDescription,sourceIndex:post.sourceIndex},
                accounts:xItems(state,'account').filter(a=>!a.blocked).map(a=>accountContext(state,a)),
                comments:saved.map(({id,author,text,replyTo})=>({id,author,text,replyTo}))});
        // The shared engagement shape tells the model "超过15条时选15条", so it may
        // return up to 15 rows even when fewer are missing. A cap at `missing` here
        // discarded every fill for posts with large totals and left the detail page
        // stuck on its one sample comment.
        const rows=await ask(state,null,request,current,task,d=>list(d,'comments',X_COMMENT_LIMIT),{postQueries:[post],finalOutputContract:contract,arrayKey:'comments'});
        const staged=structuredClone(state),changes=[];
        const count=addSamples(staged,post,rows,changes,target);
        // Partial progress commits: duplicates or skipped rows must never wipe the
        // whole batch. The remaining gap stays visible through the 补齐 button.
        await commit(changes);
        return {completed:count>=target,saved:count,target};
    }
    // Returns {account} on success or {rejected:reason}; the reason is used for
    // aggregate diagnostics only and never contains private model output.
    function resolvePostAuthor(state,item,changes,following,square,sources) {
        const reject=reason=>({rejected:reason});
        if(noAccount(item))return reject('account');
        let a=item.accountId?state.x[item.accountId]:null;
        if(item.accountId&&a?.type!=='account')return reject('account');
        if(!a)a=xItems(state,'account').find(old=>item.handle&&old.handle?.toLowerCase()===xText(item.handle).replace(/^@/,'').toLowerCase());
        if(a?.blocked||(following&&!a?.following))return reject('account');
        const identity=a||item,names=nameAliases(identity),context=getContext();
        if(!names.length||sameNamedPerson(identity,{name:context.name1}))return reject('identity');
        const cards=context.characters||[];
        // Any character card counts as a story NPC; the cast filter used before
        // wrongly dropped non-primary characters that exist in the settings.
        const actor=cards.some(c=>sameNamedPerson(c,identity));
        const previous=xAccountKind(a),declared=item.authorKind;
        let kind;
        if(square){
            kind=declared||previous||(institutionName(identity.name)?'organization':'public');
            if(!['public','organization'].includes(kind)||previous==='npc')return reject('identity');
            if(actor&&!(kind==='organization'&&institutionName(identity.name)))return reject('identity');
            if(kind==='public'&&sources.some(s=>names.some(n=>s.includes(n))))return reject('identity');
        }else{
            if(declared&&declared!=='npc'||['organization','public'].includes(previous)||institutionName(identity.name))return reject('identity');
            // A brand-new NPC author must be a real story figure: the name (or an
            // alias) has to appear in the provided story sources. Quotes are no
            // longer required; fabricated names still fail this membership check.
            const grounded=sources.some(s=>names.some(n=>s.includes(n)));
            if(!a&&item.has_account!==true&&item.has_account!=='true')return reject('account');
            if(a&&Object.values(state.business||{}).some(deal=>deal?.accountId===a.id))return reject('identity');
            // Established story NPCs: classified NPC accounts, any character
            // card, and legacy accounts that already authored home feed posts
            // before classification fields existed (their posts stay in the
            // home area, so they keep their posting rights).
            const established=previous==='npc'||actor||!!a&&previous==null&&xItems(state,'post').some(p=>p.author===a.id&&p.feed!=='square');
            if(!established&&!(declared==='npc'&&grounded))return reject('identity');
            kind='npc';
        }
        if(!a)a=register(state,item,changes,kind);
        if(!a||a.blocked||kind==='npc'&&['public','organization'].includes(xAccountKind(a))||square&&xAccountKind(a)==='npc')return reject('identity');
        if(a.authorKind!==kind){
            a={...a,authorKind:kind,crowd:kind!=='npc'};state.x[a.id]=a;changes.push(xSet(a));
        }
        if(kind==='npc'&&!a.characterId){
            // Legacy accounts can miss the card link; backfill it so memory
            // queries and later classification keep working.
            const cardId=localizedPerson(a,getContext(),xItems(state,'account')).cardId;
            if(cardId){a={...a,characterId:cardId};state.x[a.id]=a;changes.push(xSet(a));}
        }
        return {account:a};
    }
    async function answer(state,a,m,current,request,commit) {
        const businessPlan=Object.values(state.business||{}).find(p=>p?.accountId===a.id&&p.status==='invited'&&p.replyBy);
        if(businessPlan?.lateReplyDecision==='declined'){
            const context=getContext(),replyId='reply:'+m.id;
            const refusal='抱歉，这次合作的回复期限已经过了，我们这边已安排其他合作档期，暂时无法继续推进。感谢理解。';
            const changes=[xSet({...a,dmAccepted:true}),xSet({...m,status:'answered'}),
                xSet({id:replyId,type:'message',accountId:a.id,role:'assistant',text:refusal,createdAt:Date.now(),read:false,storyTime:storyTime(context.chat)}),
                ...dealDecision(businessPlan,'reject',state.business?.counter?.turn??0,readStoryClock(context.chat).day),
                ...commReplyClassification('x',replyId,a.id,'B',state)];
            await commit(changes);return;
        }
        const result=await ask(state,a,request,current,'当前任务：X 私信。仅回应本会话最后一条 user 消息，不查看其他账号的私信。对方的私信设置：'+a.dmPolicy+'；会话此前已通过：'+!!a.dmAccepted+'；记录：'+JSON.stringify(xThread(state,a.id).slice(-40).map(({role,text})=>({role,text})))+
            '\n根据角色判断是否接受并回复。输出 {"status":"reply/no_reply/request","text":"回复内容；不回复时为空","category":"可选A或B：日常闲聊为A，约定/待办/持续请求/情感纠纷或仍在发展的具体事件为B"}。requests 且未通过时可返回 request（等待对方接受），reply 表示本次同意并回复，no_reply 表示保持沉默。'+dmDealTask(state,a.id),d=>{if(!['reply','no_reply','request'].includes(d.status)||d.status==='reply'&&!xText(d.text))throw Error('私信回复格式不正确。');return {status:d.status,text:xText(d.text),deal:d.deal,category:smsCategory(d.category)};},{memoryTopic:m.text,maxTokens:4096,retryEmptyOnce:true});
        const changes=[xSet({...a,dmAccepted:a.dmAccepted||result.status==='reply'}),xSet({...m,status:result.status==='reply'?'answered':result.status})];
        if(result.status==='reply'){
            changes.push(xSet({id:'reply:'+m.id,type:'message',accountId:a.id,role:'assistant',text:result.text,createdAt:Date.now(),read:false,storyTime:storyTime(getContext().chat)}));
            if(result.category)changes.push(...commReplyClassification('x','reply:'+m.id,a.id,result.category,state));
        }
        const deal=result.deal,p=state.business?.[deal?.id];
        if(p?.accountId===a.id&&['accept','reject'].includes(deal?.kind)){
            const context=getContext(),journal=context.chatMetadata?.[JOURNAL_KEY],draw=journal?.businessDraws?.[p.id];
            changes.push(...dealDecision(p,deal.kind,state.business.counter.turn,readStoryClock(context.chat).day,draw,deal.terms,deal,journal?.businessRolls?.[p.id]));
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
            candidates:candidates.map(p=>({postId:p.id,publicText:p.text,imageDescription:p.imageDescription,postedAtStory:p.postedAtStory||null,sourceIndex:p.sourceIndex??null,counts:xCounts(state,p)})),
            publicComments:publicConversation(state),publicFeed:combined?xItems(state,'post').filter(p=>p.author!=='user').slice(-20).map(({text,feed,metrics})=>({text,feed,metrics})):undefined,
            previous:previous?{clock:previous.clock,topics:previous.topics.map(({title,summary,scope,sourcePostIds})=>({title,summary,scope,sourcePostIds}))}:null};
        const output=X_JSON_OUTPUT+'\n'+X_TRENDS_OUTPUT;
        const result=await ask(state,null,request,valid,X_TRENDS_RULES+publicationScenePrompt(context,candidates)+
            '\n趋势评估资料（人设用于判断身份和公开知名度，不等于向网友公开）：'+JSON.stringify(data)+'\n'+output,
            d=>validateTrends(d,candidates),{outputContract:output,finalOutputContract:output,postQueries:candidates,combined,arrayKey:'topics'});
        if(!valid())throw Error('人设或聊天已变化，请重新刷新趋势。');
        await commit([xSet({id:'trend-edition',type:'trends',clock,...result})]);
        return {added:result.topics.length};
        }
    async function refreshFeedStage(state,current,request,commit,mode,combined){
        const square=mode==='square',following=mode===true,recommended=!square&&!following;
        const chat=structuredClone(getContext().chat||[]),prose=storyEvidenceRows(chat);
        const sources=[...prose,...establishedSources(getContext())].map(s=>s.text);
        const edition=square?{id:'square-edition',type:'edition',editionId:crypto.randomUUID(),clock:squareClock(chat),postIds:[]}:null;
        const accounts=xItems(state,'account').filter(a=>!a.blocked&&(!following||a.following));
        if(following&&!accounts.length)return {added:0};
        // Only the HOME refresh path consumes this global public activity pulse.
        // Square, trends, comments, DMs and standalone followed feeds do not.
        const pendingActivity=combined&&!square&&!following?xPendingPublicActivities(state):[];
        const activityCandidates=new Map(pendingActivity.map(row=>[row.id,relatedNpcAccounts(state,row.postId,[row.accountId],[row.accountId],6)]));
        const activityPrompt=publicActivityPrompt(state,pendingActivity,activityCandidates);
        const activityQueries=pendingActivity.map(row=>{
            const post=row.postId?state.x?.[row.postId]:null,targetId=row.accountId||post?.author,target=targetId&&targetId!=='user'?state.x?.[targetId]:null;
            const actors=[...(isNpcAccount(state,target)?[target]:[]),...(activityCandidates.get(row.id)||[])];
            const unique=[...new Map(actors.map(a=>[a.id,a])).values()];
            return unique.length?{id:row.id,text:JSON.stringify({action:row.action,target:target?.name||profile(state).alias,post:post?{text:post.text,imageDescription:post.imageDescription}:null}),sourceIndex:post?.sourceIndex,explicitActors:unique.map(a=>({id:a.id,name:a.name,aliases:a.aliases||[]}))}:null;
        }).filter(Boolean);
        const activityReactionLimit=Math.min(24,pendingActivity.length*2);
        // Give the model the identity roster the program can already verify,
        // so it does not have to guess which account IDs are eligible.
        const identityAid=!square?(()=>{
            const all=xItems(state,'account'),established=[],unclassified=[];
            for(const account of accounts){
                const kind=xAccountKind(account);
                if(kind==='npc'||kind==null&&xItems(state,'post').some(p=>p.author===account.id&&p.feed!=='square'))established.push({id:account.id,name:account.name});
                else if(kind==null&&!institutionName(account.name))unclassified.push({id:account.id,name:account.name});
            }
            const candidates=following?[]:(getContext().characters||[]).filter(c=>!sameNamedPerson(c,{name:getContext().name1})&&!all.some(a=>sameNamedPerson(a,c))).map(c=>c.name);
            return (following?'\n关注流发帖身份由程序核对，禁止编造名单外人物、陌生网友或机构账号：已确立NPC账号直接用 accountId 发帖并附 authorKind:"npc"：':'\n首页发帖身份由程序核对，禁止编造名单外人物、陌生网友或机构账号：已确立NPC账号直接用 accountId 发帖并附 authorKind:"npc"：')+JSON.stringify(established)+
                '；其余已知个人账号发帖须用 accountId 并附 authorKind:"npc"：'+JSON.stringify(unclassified)+
                (following?'':'；尚无账号的设定角色可作为新作者附 name/handle/has_account:true/authorKind:"npc"：'+JSON.stringify(candidates))+
                '；其他正文出现过的真实剧情人物作为新作者时必须附 has_account:true、authorKind:"npc"。';
        })():'';
        const task=square?'当前任务：X 广场。无需关注任何人。广场帖子可纯文字，也可附图；有适合展示的公开图片时填写可选 imageDescription，不带图则省略；不得强制所有帖子附图。'+getSettings().prompts.xSquare+'\n'+SQUARE_RULES+'\n禁止用作广场作者的角色姓名：'+JSON.stringify((getContext().characters||[]).map(c=>c.name)):
            '当前任务：X 动态。'+X_ACCOUNT_RULES+(following?'仅生成已关注且有剧情身份的NPC公开帖子，不生成公众或机构帖子，不能添加列表外发帖账号；评论者不受关注列表限制。':
                '为你推荐只选当前剧情世界中有明确身份并适合使用X的NPC（朋友、同学、同事、其他剧情人物）。人数足够时生成10～15条，每位作者一条；合理人数不足按实返回，包括空数组。不创造人物冒充既有NPC。'+
                '可写个人日常、工作、兴趣和观点，不要求围绕user，不泄露私事。陌生网友、校园资讯、官方、企业、品牌、媒体、赛事等公共账号只属于广场。')+
                '。每个 NPC 可按自身习惯、当下内容与情境发布纯文字或附图帖。实际适合有照片、截图、插画或公开可见画面的帖子可填 imageDescription 描述画面；不带图则省略，不要默认全部纯文字，也不强制每条配图。图像不得凭空暴露未公开的私人信息。首页作者附 authorKind:"npc"。accounts 如提供也遵守相同规则，最多15个；新账号附has_account。'+identityAid;
        const userPosts=square?[]:xItems(state,'post').filter(p=>p.author==='user').slice(combined?-10:-15);
        const reachPosts=userPosts.filter(p=>!combined||state.x['impact:post:'+p.id]).map(p=>({postId:p.id,publicText:p.text,imageDescription:p.imageDescription,postedAtStory:p.postedAtStory||null,sourceIndex:p.sourceIndex??null,counts:xCounts(state,p)}));
        const reachTask=reachPosts.length ? REACH_CONTEXT+publicationScenePrompt(getContext(),userPosts)+
            `
根据 user 每条推文实际公开的内容，估算累计点赞、转发和回复数量。

首先判断内容本身的吸引力。 涉及热门人物、热门事件、劲爆八卦、新奇发现、强烈争议或其他容易引起公众兴趣的内容，可以获得较高热度。热度取决于具体发了什么，而不只是提到了谁。例如，同样涉及知名歌手，普通演唱会直拍与曝光其令人震惊的私人物品，带来的好奇、讨论和传播程度明显不同，不能因为都涉及同一位名人就给出相近的数据。

user 自身也可以成为热度来源。 如果推文展示了出色的歌唱、舞蹈、绘画、创作或其他才艺，可以因为作品质量和表现力获得大量互动；如果照片展示了出众的外貌，也可以因为自拍本身吸引关注。无需强行关联热门人物或公共事件。普通日常推文通常热度较低，但不等于没有人点赞或回复。

其次结合 user 当前的粉丝数量判断数据规模。 粉丝越多，推文通常越容易获得较高的基础互动；粉丝较少时，普通推文的数据通常较低。但粉丝数不是热度上限：内容足够吸引人时，小账号也能突然获得大量点赞、转发和回复；大账号发布缺乏看点的内容，也可能表现平平。

最后根据内容性质分别判断三项数据。 点赞反映喜欢、欣赏、认同或对内容的兴趣；转发反映内容是否值得分享、传播或让更多人看到；回复反映内容是否容易引发提问、讨论、争论或表达观点。三项数据不必按固定比例增长。例如，漂亮自拍可能收获大量点赞，但讨论不一定多；劲爆八卦或争议言论可能引发大量转发和回复，却不一定获得同等比例的点赞。

只依据推文中实际公开的文字、图片、视频及其已有描述判断，不把未公开的私人剧情当作网友已经看到的内容。匿名账号不能自动继承 user 现实身份的知名度。不要因为文字简短就降低热度，也不要因为涉及名人就无条件给出夸张数据。

输出每条推文的累计点赞、转发、回复数量，保持三项数据与具体内容及粉丝规模相符。不使用固定互动比例，不额外根据经过多少剧情时间调整数据；持续传播和七天影响由独立机制处理。没有新的公开内容或互动变化时，不因重复刷新而机械累加数据。结果填入 "engagementUpdates"，其中 "metrics" 为累计数，包含已经展示的评论。
`+JSON.stringify({followers:xAudience(state)?.followers??null,posts:reachPosts}) : '';
        const refreshOutput=X_JSON_OUTPUT+'\n'+X_FEED_OUTPUT(recommended,square)+(square?'广场只填posts，replies为空，不填accounts/engagementUpdates/audience；publicBasis仍须填写。':'');
        const reachOutput=reachPosts.length?' 对每条所给 user 推文在 engagementUpdates 返回一组累计 metrics，即使本次估算与已有值相同。':'';
        const activityOutput=pendingActivity.length?'\n附加字段 activityReactions: [{eventId:"本次公开事件ID",accountId:"relatedNPCs 中的现存 NPC 账号ID",text:"该 NPC 的公开时间线推文",category:"可选A或B"}]。每个有相关NPC的事件至少1条、最多2条，最多 '+activityReactionLimit+' 条；没有相关NPC的事件可不回应。activityReactions 是独立于常规 posts 的事件回应推文。':'';
        const results=await ask(state,null,request,current,task+reachTask+activityPrompt+activityOutput+(square?'':'\n可附 engagementUpdates:[{postId:"已给出的 user 帖子ID",metrics:{likes:0,reposts:0,replies:0},comments:[]}] 更新所给 user 帖子的累计公开互动，不得替 user 改写发言。名人提及可在新posts附 mentionsUser:true，text中必须明确包含 @user 当前网名，并保持人物知情隔离；')+'已知账号：'+JSON.stringify(xItems(state,'account').filter(a=>!a.blocked).map(a=>accountContext(state,a)))+'。已加载帖子（避免重复）：'+JSON.stringify(xItems(state,'post').filter(p=>!combined||p.author!=='user'||userPosts.includes(p)).slice(-20).map(p=>({id:p.id,author:p.author,text:xText(p.text,600)})))+'\n已发生的公开评论（保持线程上下文，不重复首次反应；不是其他账号的私信）：'+JSON.stringify(publicConversation(state,12,6000))+
            '\n输出 {"posts":[{"accountId":"已知账号 ID；新作者留空","name":"新作者名称","handle":"新作者账号","text":"公开帖子内容","imageDescription":"可选：公开可见的图片画面描述；纯文字帖省略"}],"replies":[{"postId":"给出的 user 公开帖子 ID","accountId":"已知账号 ID；新作者留空","name":"新作者名称","handle":"新作者账号","text":"对这条 user 帖子的公开回复"}]}。'+(recommended?'posts 只含不同NPC，最多15条，人数充足时10～15条，可按实际人数减少到0；':'posts 10～15 条不同作者，少于 10 条本次不会保存；')+'replies 最多5条，可为空，不强制回应。广场任务只填 posts，replies 为空。不得替 user 发帖，不泄漏私人剧情。'+engagementRules()+engagementShape+(square?'\n每条广场帖子必须附 publicBasis:{access:"background/public/limited",summary:"公众知情途径及实际可见范围",sourceIndex:已知时填原楼号，未知省略,involvesCharacters:false}。background 仅为无剧情人物的普通背景帖子；public/limited 的 summary 必须说明公众知情途径与实际可见范围，private 内容不得生成。':''),
            d=>{
                const posts=d.posts===undefined&&following&&Array.isArray(d.accounts)?[]:list(d,'posts',15);
                const activityReactions=pendingActivity.length?list(d,'activityReactions',activityReactionLimit):[];
                if(pendingActivity.length){
                    const perEvent=new Map();
                    for(const row of activityReactions){
                        const candidates=activityCandidates.get(row?.eventId)||[];
                        if(typeof row?.text!=='string'||!row.text.trim()||!candidates.some(a=>a.id===row.accountId))throw Error('公开动态回应引用了无关事件、未知 NPC 或空内容。');
                        const count=(perEvent.get(row.eventId)||0)+1;perEvent.set(row.eventId,count);
                        if(count>2)throw Error('每条公开动态最多生成两条 NPC 回应。');
                    }
                    for(const [eventId,candidates] of activityCandidates)if(candidates.length&&!perEvent.get(eventId))throw Error('公开动态 '+eventId+' 有相关 NPC，但本次没有生成任何公开回应。请重试首页刷新。');
                }
                return {posts,replies:d.replies===undefined?[]:list(d,'replies',5),activityReactions,accounts:!square&&!following&&d.accounts!==undefined?list(d,'accounts',15):[],engagementUpdates:!square&&d.engagementUpdates!==undefined?list(d,'engagementUpdates',15):[],audience:square?null:d.audience};
            },{outputContract:refreshOutput+reachOutput+activityOutput,finalOutputContract:refreshOutput+reachOutput+activityOutput,combined,postQueries:[...(square?[]:userPosts.slice(-10)),...activityQueries],memoryChars:8000,maxTokens:8192,retryEmptyOnce:true,arrayKey:'posts'});
        if(square&&!combined&&results.posts.length<10)throw Error('本批广场帖子只有 '+results.posts.length+' 条，广场刷新需要 10～15 条，本次未保存。');
        state=structuredClone(state);const changes=[],authors=new Set();let added=0,repeatedSquare=false;
        if(!square&&!following){
            for(const old of xItems(state,'account').filter(a=>a.recommended)){const next={...old,recommended:false};state.x[next.id]=next;changes.push(xSet(next));}
            for(const item of results.accounts){const resolved=resolvePostAuthor(state,item,changes,false,false,sources),a=resolved.account;if(a&&!a.blocked){a.recommended=true;changes.push(xSet({...a}));}}
        }
        // Safe filtering diagnostics: only aggregated reasons are counted;
        // no post text, private story content or full model output is kept.
        const skipped={identity:0,account:0,duplicate:0,invalid:0};let activityAdded=0;
        for(const item of results.posts){if(!xText(item?.text)){skipped.invalid++;continue;}
            const basis=square?squareBasis(item,prose):null;if(square&&!basis){skipped.invalid++;continue;}
            const resolved=resolvePostAuthor(state,item,changes,following,square,sources),a=resolved.account;
            if(!a){skipped[resolved.rejected||'identity']++;continue;}
            if(!square&&!following){a.recommended=true;changes.push(xSet({...a}));}
            const existing=xItems(state,'post').find(p=>p.author===a.id&&(recommended?xCommentKey('',a.id,p.text)===xCommentKey('',a.id,item.text):p.text===xText(item.text)));
            if(existing){if(square&&existing.feed==='square')repeatedSquare=true;skipped.duplicate++;continue;}
            if(recommended){
                if(authors.has(a.id)){skipped.duplicate++;continue;}
                authors.add(a.id);
            }
            const mentionsUser=!square&&item.mentionsUser===true&&new RegExp('@'+profile(state).alias.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?=$|[^\\p{L}\\p{N}_])','u').test(item.text);
            const media=xText(item.imageDescription,2000);
            const post=xRecord('post',{author:a.id,postedAtStory:squareClock(chat),text:xText(item.text),
                ...(media?{imageDescription:media}:{}),liked:false,reposted:false,feed:square?'square':'home',mentionsUser});
            if(square){post.publication={editionId:edition.editionId,clock:edition.clock,publicBasis:basis,selected:false,sourceIndex:chat.length-1};edition.postIds.push(post.id);}
            state.x[post.id]=post;addEngagement(state,post,item,changes);
            // Home-feed posts enter the unified timing sidecar; square keeps its
            // own publication mechanism. The model may classify each post.
            if(!square&&item.category)changes.push(...commReplyClassification('x',post.id,null,smsCategory(item.category),state));
            added++;
        }
        // Public activity reactions are separate, ordinary home-feed posts.
        // Each event gets at most two distinct, verified NPC authors.
        const reactionCounts=new Map(),reactionAuthors=new Set();
        for(const item of results.activityReactions){
            const event=pendingActivity.find(row=>row.id===item.eventId),author=state.x[item.accountId];
            if(!event||!isNpcAccount(state,author)||!activityCandidates.get(event.id)?.some(a=>a.id===author.id))continue;
            const count=reactionCounts.get(event.id)||0,key=event.id+':'+author.id;
            if(count>=2||reactionAuthors.has(key)||xItems(state,'post').some(post=>post.publicActivityId===event.id&&post.author===author.id))continue;
            const text=xText(item.text,1600);if(!text)continue;
            const post=xRecord('post',{author:author.id,postedAtStory:squareClock(chat),text,feed:'home',publicActivityId:event.id,liked:false,reposted:false});
            state.x[post.id]=post;changes.push(xSet(post));
            if(item.category)changes.push(...commReplyClassification('x',post.id,null,smsCategory(item.category),state));
            reactionCounts.set(event.id,count+1);reactionAuthors.add(key);activityAdded++;
        }
        // Empty model batches (no fitting NPC) return added: 0 normally;
        // only batches whose posts were all filtered report a failure with
        // the aggregated reasons so the failing step stays identifiable.
        const breaks=Object.entries({identity:'身份不符',account:'账号不可用',duplicate:'重复帖子',invalid:'字段无效'}).map(([key,label])=>skipped[key]?label+' '+skipped[key]+' 条':'').filter(Boolean).join('；');
        if(recommended&&results.posts.length&&!added)throw Error('为你推荐没有可保存的新NPC推文：本批有效新增 0 条'+(breaks?'（'+breaks+'）':'')+'，原首页已保留。');
        for(const item of square?[]:results.replies){
            if(combined&&!userPosts.some(p=>p.id===item?.postId))continue;
            const post=state.x[item?.postId];if(post?.type!=='post'||post.author!=='user'||!xText(item.text)||noAccount(item))continue;
            let a=item.accountId?state.x[item.accountId]:null;if(a?.type!=='account')a=null;
            if(!a)a=register(state,item,changes);if(!a||a.blocked)continue;
            if(findComment(state,post.id,a.id,xText(item.text)))continue;
            a=known(state,a);state.x[a.id]=a;changes.push(xSet(a));
            const reply=xRecord('comment',{postId:post.id,author:a.id,text:xText(item.text),replyTo:null});state.x[reply.id]=reply;changes.push(xSet(reply));
            if(item.category)changes.push(...commReplyClassification('x',reply.id,post.id,smsCategory(item.category),state));
        }
        for(const item of results.engagementUpdates){
            if(combined&&!reachPosts.some(p=>p.postId===item?.postId))continue;
            const post=state.x[item?.postId];if(post?.type!=='post'||post.author!=='user')continue;
            addEngagement(state,post,item,changes);
        }
        if(!combined)changes.push(...audienceChanges(state,results.audience));
        if(square){if(results.posts.length&&!added&&!repeatedSquare)throw Error('本批没有同时符合广场作者与公开依据要求的新帖'+(breaks?'（'+breaks+'）':'')+'，原广场已保留。');if(added||!repeatedSquare)changes.push(xSet(edition));}
        // Consume in the same atomic home-refresh commit as the generated feed:
        // a later failed follower/reach stage must leave every pulse pending.
        if(pendingActivity.length)changes.push(...pendingActivity.map(row=>xSet({...row,shown:true})));
        await commit(changes);return {added:added+activityAdded,activityReactions:activityAdded};
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
            const results=await ask(state,null,request,current,'当前任务：X 搜索账号。搜索词：'+JSON.stringify(xText(query,100))+'。根据角色和世界设定查找使用 X 的人物，char 默认用真名；不能因为已有电话号码或 Snapchat 好友就假定有 X 账号。'+X_SEARCH_OUTPUT,d=>list(d,'accounts',10),{finalOutputContract:X_SEARCH_OUTPUT,memoryTopic:query,arrayKey:'accounts'});
            state=structuredClone(state);state.x||={};const changes=[],ids=[];
            for(const item of results){if(item?.has_account!==true)continue;const a=register(state,item,changes);if(a&&!ids.includes(a.id))ids.push(a.id);}
            await commit(changes);return {ids};
        });},
        follow(id,value){return run(async(state,_c,_r,commit)=>{
            const a=xAccount(state,id),next=value===true;
            if(!!a.following===next)return;
            await commit([xSet({...known(state,a),following:next}),
                xSet(socialEvent('follow',id,next?'follow':'unfollow',{accountId:id}))]);
        });},
        block(id,value){return run(async(state,_c,_r,commit)=>{const a=xAccount(state,id,false);await commit([xSet({...a,blocked:value===true})]);});},
        reveal(id){return run(async(state,_c,_r,commit)=>{const a=xAccount(state,id);if(a.inboundRequest==='pending'||a.inboundRequest==='declined')throw Error('请先接受私信请求。');if(a.dmPolicy==='closed')throw Error('此账号暂不接收私信。');await commit([xSet({...a,identityKnown:true}),xSet(xRecord('message',{accountId:id,role:'user',text:'我是 '+getContext().name1+'。',status:'sent',read:true,storyTime:storyTime(getContext().chat)}))]);});},
        publish(value,imageDescription=''){return run(async(state,current,request,commit)=>{
            const media=xText(imageDescription,2000);
            const chat=getContext().chat,post=xRecord('post',{author:'user',alias:profile(state).alias,text:xRequired(value,'帖子内容'),
                ...(media?{imageDescription:media}:{}),
                followersAtPublication:xAudience(state)?.followers??null,includedDirectReplies:0,postedAtStory:squareClock(chat),sourceIndex:chat.length-1,liked:false,reposted:false});
            const changes=[xSet(post)];
            if(privilegeLevel(post.followersAtPublication)){
                const targets=new Map(privilegeRows(state).map(r=>[r.targetId,{targetId:r.targetId,target:r.target,identity:r.identity}]));
                const task=privilegeContract+'\n本次推文：'+JSON.stringify(post.text)+'\n此前已识别的对象：'+JSON.stringify([...targets.values()])+'。同一目标沿用targetId，同名不同对象要区分。';
                changes.push(...await ask(state,null,request,current,task,r=>privilegeChanges(state,post,r),{finalOutputContract:privilegeContract,postQueries:[post]}));
            }
            await commit(changes);
        });},
        toggleInjection(id){return run(async(state,_c,_r,commit)=>{
            const p=state.x[id],chat=getContext().chat;
            if(p?.type!=='post'||p.feed!=='square'||squareStatus(p,state,chat)!=='active')throw Error('这条内容已采用、过期或时间不明确，无法注入。');
            await commit([xSet({...p,publication:{...p.publication,selected:!p.publication.selected,selectedIndex:chat.length-1}})]);
        });},
        refreshTrends(){return run((state,current,request,commit)=>refreshTrendsStage(state,current,request,commit,false));},
        refresh(following=false){return run((state,current,request,commit)=>refreshFeedStage(state,current,request,commit,following,false));},
        editPage(scope,edits){return run(async(state,_current,_request,commit)=>{await commit(scope?.kind?objectEdits(state,scope,edits):pageEdits(state,scope,edits));});},
        refreshPublic(){return run(async(state,current,request,commit)=>{
            const context=getContext(),chat=context.chat,floor=refreshFloor(chat);
            const oldLedger=state.x[X_FLOOR_LEDGER],needsCatchUp=oldLedger?.version!==X_FLOOR_VERSION;
            // Earlier markers did not guarantee that subsequent conversations
            // about an assessed post were paid. Reconcile visible prose once.
            const baseRanges=needsCatchUp?[]:coveredFloors(oldLedger.ranges);
            const batch=pendingFloorBatch(chat,baseRanges,floor,48000,needsCatchUp);
            const newPosts=xItems(state,'post').some(p=>p.author==='user'&&!state.x['impact:post:'+p.id]);
            const newPublicActivity=xPendingPublicActivities(state).length>0;
            if(floor<0||(!needsCatchUp&&state.x['public-refresh']?.floor===floor&&!batch.rows.length&&!newPosts&&!newPublicActivity))
                throw Error('当前楼层没有新的刷新机会。');
            // First use and older ledger migrations read visible prose only.
            // Do not query QQJ until this floor ledger is initialized.
            const refreshRequest=needsCatchUp?(prompt,validate,check,contact,options={})=>
                request(prompt,validate,check,contact,{...options,skipExternalMemory:true}):request;
            const persona=context.powerUserSettings?.persona_description;
            const valid=()=>current()&&getContext().powerUserSettings?.persona_description===persona;
            const staged=structuredClone(state),changes=[],clock=squareClock(chat);
            const previouslyAssessed=xItems(staged,'post').filter(p=>p.author==='user'&&staged.x['impact:post:'+p.id]);
            const collect=rows=>{for(const row of rows){
                if(!staged.x[row.key]&&row.value?.type==='comment'){row.value.sourceIndex=chat.length-1;row.value.postedAtStory=clock;}
                staged.x[row.key]=row.value;changes.push(row);
            }};
            // Homepage owns its feed and follower/engagement settlement only.
            const home=await refreshFeedStage(staged,valid,refreshRequest,collect,false,true);
            const pending=xItems(staged,'post').filter(p=>p.author==='user'&&!staged.x['impact:post:'+p.id]);
            if(pending.length||!xAudience(staged)){
                const contract='只返回一个 JSON 对象，stats 数组必须恰好覆盖列出的每个 postId，各一次。每项只填 postId、likes、reposts、replies、gained、lost，均为非负整数。初始粉丝未知时另填 initialFollowers。无需理由、等级、传播预测或分类。';
                const inputs=pending.map(({id,text,imageDescription,sourceIndex})=>({postId:id,text,imageDescription,sourceIndex}));
                const sources=new Set(inputs.map(p=>p.sourceIndex).filter(Number.isInteger));
                const prose=storyEvidenceRows(chat).filter(r=>r.index<=floor);
                const visible=[...new Map([...prose.filter(r=>sources.has(r.index)),...prose.slice(-12)]
                    .map(r=>[r.index,{sourceIndex:r.index,role:r.role,text:r.text.slice(0,4000)}])).values()]
                    .sort((a,b)=>a.sourceIndex-b.sourceIndex);
                const task=(xAudience(staged)?'':AUDIENCE_RULES)+'\n'+REACH_CONTEXT+'\n逐条独立估计当前帖子的点赞、转发、回复和首日新增关注、取关人数。结合实际发布内容、设定、世界书和本帖所指剧情。五项数字不按固定比例，账号粉丝数不是热度上限。不把后台私事或匿名身份当作公开事实。'+
                    '\n资料：'+JSON.stringify({posts:inputs,alias:profile(staged).alias,bio:profile(staged).bio,followers:xAudience(staged)?.followers??null})+
                    '\n当前可见正文：'+JSON.stringify(visible)+'\n'+contract;
                const impactChanges=await refreshRequest(task,d=>{
                    if(!Array.isArray(d.stats)||d.stats.length!==pending.length||new Set(d.stats.map(r=>r?.postId)).size!==pending.length||
                        !d.stats.every(r=>pending.some(p=>p.id===r?.postId)))throw Error('推文评估缺少、重复或错用了帖子ID。');
                    return settleInfluence(staged,chat,d.stats,d.initialFollowers);
                },valid,null,{combined:true,postQueries:pending,retries:0,parseResponse:parseXObject,finalOutputContract:contract});
                collect(impactChanges);
            }else collect(settleInfluence(staged,chat,[]));

            // Previously assessed posts may receive new, independently evidenced
            // attention in later narrative floors. New posts already received
            // their initial impact above and are excluded from this second pass.
            if(batch.rows.length&&previouslyAssessed.length){
                const selected=previouslyAssessed.map(p=>{
                    const impact=staged.x['impact:post:'+p.id];
                    return {postId:p.id,text:p.text,imageDescription:p.imageDescription,
                        postedAtStory:p.postedAtStory,sourceIndex:p.sourceIndex,
                        metricsBefore:xCounts(state,p),metricsNow:xCounts(staged,p),
                        previouslyAssessed:{gained:impact.gained,lost:impact.lost,settledDays:impact.settled,totalPaid:impact.total}};
                });
                const remembered=needsCatchUp?[]:JSON.parse(readXMemory(context,getSettings(),
                    {floorIndices:batch.rows.map(row=>row.sourceIndex)}).text||'[]');
                const contract='只返回 {"effects":[{"postId":"已有 user 推文 ID","gained":非负整数,"lost":非负整数}]}。没有符合条件的新增影响返回 {"effects":[]}；同一帖最多一次，不返回无关字段。';
                const task='当前任务：X 未结算剧情楼层的新增粉丝影响。'+REACH_CONTEXT+
                    '\n逐楼阅读本次未结算的有效正文，以及同楼已保存的千千结摘要。它们是同一剧情的两种资料，不得重复计数。'+
                    '判断既有 user 推文是否在本批剧情里继续获得传播、围观、分享、讨论、关注或取关。发布几天后的旧帖依然可以涨粉。'+
                    '正文确实出现许多人谈论、分享或传播一条公开推文时，应把这看作新增曝光与潜在关注的依据，并合理估算新增粉丝；不要求正文明确写出“增加了多少粉丝”或每个人点击关注。'+
                    '区分有新受众的持续传播与同一批人重复讨论。公开推文被私下谈论不等于那些私谈内容本身已经公开，不推断网友看到了私密细节。'+
                    '只估计本批剧情额外带来的关注与取关；首次发帖的粉丝收益和已结算的七日自然影响不再次发放。'+
                    '只有确实没有新增传播或关注影响时才返回空数组。结合讨论人数、传播范围、公开内容吸引力、受众规模和账号身份估计，不使用固定比例。'+
                    (needsCatchUp?'本次为旧存档补结算：只补此前可能遗漏的后续影响，不能把推文发布时已经计过的首日收益重新发放。':'')+
                    '\n用户账号：'+JSON.stringify({name:context.name1,alias:profile(staged).alias,bio:profile(staged).bio})+
                    '\n本次楼层和可见正文：'+JSON.stringify(batch.rows)+
                    '\n同楼千千结正式摘要（可能为空）：'+JSON.stringify(remembered)+
                    '\n此前已评估的 user 推文、首日收益和刷新前后互动数据：'+JSON.stringify(selected)+
                    '\n当前粉丝：'+JSON.stringify(xAudience(staged)?.followers??null)+'\n'+contract;
                const delta=await refreshRequest(task,d=>floorAudienceChanges(staged,d.effects),valid,null,{
                    skipExternalMemory:true,retries:0,parseResponse:parseXObject,finalOutputContract:contract});
                collect(delta);
            }
            if(!valid())throw Error('聊天或人设已改变。');
            // Initialize the floor ledger after one visible-context catch-up.
            // Later refreshes settle only fresh narrative floors.
            const endCovered=needsCatchUp?floor:batch.lastIndex;
            const storedRanges=needsCatchUp?coveredFloors(oldLedger?.ranges):baseRanges;
            collect([{collection:'x',key:X_FLOOR_LEDGER,value:{
                id:X_FLOOR_LEDGER,type:'floor-ledger',version:X_FLOOR_VERSION,
                ranges:coverThrough(storedRanges,endCovered)}}]);
            collect([xSet({id:'public-refresh',type:'refresh',floor})]);
            await commit(changes);return {added:home.added};
        });},
        react(id,kind){return run(async(state,_c,_r,commit)=>{
            const p=state.x[id];
            if(p?.type!=='post'||!['liked','reposted'].includes(kind))throw Error('帖子不可用。');
            if(p.author!=='user')xAccount(state,p.author);
            const next=!p[kind],action=kind==='liked'?(next?'like':'unlike'):(next?'repost':'unrepost');
            await commit([xSet({...p,[kind]:next,[kind+'At']:Date.now(),...(kind==='reposted'?{repostedDay:squareClock(getContext().chat).day}:{})}),
                xSet(socialEvent(kind,id,action,{accountId:p.author,postId:id}))]);
        });},
        comment(id,value,replyTo=null){return run(async(state,current,request,commit)=>{
            const p=state.x[id];if(p?.type!=='post')throw Error('帖子不存在。');
            if(p.author!=='user')xAccount(state,p.author);
            const parent=replyTo?state.x[replyTo]:null;
            if(replyTo&&(parent?.type!=='comment'||parent.postId!==id))throw Error('这条回复已不存在。');
            const targetId=parent?.author||p.author;
            const target=targetId==='user'?null:known(state,xAccount(state,targetId));
            const body=xRequired(value,'回复内容');
            const comment=xRecord('comment',{postId:id,author:'user',alias:profile(state).alias,text:body,replyTo:parent?.id||null});
            const changes=[xSet(comment)];
            // NPC-authored home-feed threads can attract one or two additional
            // related NPCs. The directly addressed account keeps its own reply
            // channel; community replies are separate comments in this thread.
            const community=p.author!=='user'&&xFeedArea(state,p)!=='square'
                ?relatedNpcAccounts(state,id,[p.author,target?.id,...xItems(state,'comment').filter(c=>c.postId===id).map(c=>c.author)].filter(Boolean),target?[target.id]:[],8)
                :[];
            const shouldGenerate=xFeedArea(state,p)!=='square'&&(!!target||community.length>0);
            if(shouldGenerate){
                const thread=xItems(state,'comment').filter(c=>c.postId===id);
                const actorRows=[...(target?[target]:[]),...community];
                const actors=[...new Map(actorRows.map(a=>[a.id,a])).values()];
                const contract='输出一个 JSON 对象：{"text":"被直接回复账号的公开回复；若没有回应则为空字符串","reactions":[{"key":"本批评论唯一键","accountId":"relatedNPCs 中现存 NPC 账号ID","text":"公开跟帖内容","replyTo":"user_comment、target_reply、已有评论ID或本批前面评论的key"}]}。reactions 最多2条，可为空；但只要 relatedNPCs 中存在合理相关人物，就必须生成至少1条、通常1～2条跟帖。每个NPC最多一条。不得创建名单外账号。';
                const task='当前任务：X 公开评论区互动。帖子作者：'+JSON.stringify(p.author==='user'?profile(state).alias:state.x[p.author]?.name)+'；原帖：'+JSON.stringify({id:p.id,text:p.text,imageDescription:p.imageDescription})+
                    publicationScenePrompt(getContext(),[p])+'；此前评论串：'+JSON.stringify(thread.map(c=>({id:c.id,name:c.author==='user'?profile(state).alias:state.x[c.author]?.name,text:c.text,replyTo:c.replyTo})))+
                    '；user 本次公开评论：'+JSON.stringify({id:comment.id,text:body,replyTo:parent?.id||null})+
                    '；被直接回复的账号：'+JSON.stringify(target?{id:target.id,name:target.name,handle:target.handle}:null)+
                    '；可参与的其他相关 NPC 账号（只能从这里选，优先考虑当前剧情角色、同帖参与者及与帖子作者有既有公开互动者）：'+JSON.stringify(community.map(a=>({id:a.id,name:a.name,handle:a.handle,characterId:a.characterId||null,relationshipSignals:a.relationshipSignals})))+
                    '。先判断被直接回复账号是否回应 user，回复写入 text；再判断其他相关NPC是否加入同一公开讨论串，写入 reactions。至少有一名合理相关NPC时不能默认全体沉默。其他NPC可以回复 user_comment、target_reply、已有评论ID或本批前面评论的key；允许形成一层或多层对话，不要只生成两条互不相关的孤立评论。人物只依据各自知道的公开信息和自身关系反应，不泄露私人剧情；不必所有人都发言。'+contract+engagementRules();
                const queryPost={...p,text:[p.text,...thread.map(c=>c.text),body].filter(Boolean).join('\n'),
                    explicitActors:actors.map(a=>({id:a.id,name:a.name,aliases:a.aliases||[]}))};
                const result=await ask(state,target,request,current,task,d=>{
                    if(typeof d.text!=='string')throw Error('评论格式不正确。');
                    const reactions=d.reactions===undefined?[]:list(d,'reactions',2),seen=new Set();
                    for(const row of reactions){
                        if(typeof row?.text!=='string'||!row.text.trim()||!community.some(a=>a.id===row.accountId)||seen.has(row.accountId))throw Error('评论区 NPC 跟帖引用了未知账号、重复作者或空内容。');
                        seen.add(row.accountId);
                    }
                    if(community.length&&!reactions.length)throw Error('评论区存在相关 NPC，但本次没有生成跟帖。请重试。');
                    return {text:xText(d.text),reactions};
                },{postQueries:[queryPost],finalOutputContract:contract});
                if(target)changes.push(xSet(target));
                const targetReply=target&&result.text?xRecord('comment',{postId:id,author:target.id,text:result.text,replyTo:comment.id}):null;
                if(targetReply)changes.push(xSet(targetReply));
                const parents=new Map(thread.map(c=>[c.id,c.id]));
                parents.set('user_comment',comment.id);
                if(targetReply)parents.set('target_reply',targetReply.id);
                const usedAuthors=new Set(),savedKeys=new Set();
                for(const row of result.reactions){
                    const author=community.find(a=>a.id===row.accountId);
                    if(!author||usedAuthors.has(author.id))continue;
                    const parentKey=typeof row.replyTo==='string'&&row.replyTo?row.replyTo:'user_comment';
                    const parentId=parents.get(parentKey);
                    if(!parentId)continue;
                    const text=xText(row.text,1200),signature=xCommentKey(id,author.id,text,parentId);
                    if(!text||savedKeys.has(signature)||findComment(state,id,author.id,text,parentId))continue;
                    const reaction=xRecord('comment',{postId:id,author:author.id,text,replyTo:parentId});
                    changes.push(xSet(reaction));parents.set(row.key,reaction.id);
                    usedAuthors.add(author.id);savedKeys.add(signature);
                }
            }
            await commit(changes);
        });},
        send(id,value){return run(async(state,current,request,commit)=>{
            const a=known(state,xAccount(state,id));if(a.inboundRequest==='pending'||a.inboundRequest==='declined')throw Error('请先接受私信请求。');if(a.dmPolicy==='closed')throw Error('此账号暂不接收私信。');
            const context=getContext(),sceneTime=storyTime(context.chat),exactTime=exactStoryTime(context.chat);
            const m=xRecord('message',{accountId:id,role:'user',text:xRequired(value,'消息'),status:'pending',read:true,storyTime:sceneTime});
            const changes=[xSet(a),xSet(m)];
            const plan=Object.values(state.business||{}).find(p=>p?.accountId===id&&p.status==='invited'&&p.replyBy&&!p.lateReplyDecision);
            if(plan&&isLateBusinessReply(plan.replyBy,exactTime)){
                const outcome=businessLateReplyOutcome(plan.replyBy,exactTime,crypto.getRandomValues(new Uint16Array(1))[0]);
                if(outcome)changes.push({collection:'business',key:plan.id,value:{...plan,lateReplyDecision:outcome,lateReplyAt:exactTime}});
            }
            await commit(changes);
            const fresh=await memory.read(),ticket=await memory.begin();
            try{await answer(fresh.state,a,m,current,request,async changes=>{if(!current())throw Error('聊天已变化。');await memory.commit(ticket,changes);});}
            catch(error){if(current())await memory.commit(ticket,[xSet({...m,status:'failed'})]);throw error;}
        });},
        retryMessage(id){return run(async(state,current,request,commit)=>{const m=state.x[id];if(m?.type!=='message'||m.role!=='user'||!['failed','pending','request'].includes(m.status))throw Error('此消息不需要重试。');const a=xAccount(state,m.accountId);if(a.inboundRequest==='pending'||a.inboundRequest==='declined')throw Error('请先接受私信请求。');if(a.dmPolicy==='closed')throw Error('此账号暂不接收私信。');await answer(state,a,m,current,request,commit);});},
        deleteMessage(id){return run(async(state,_c,_r,_commit,ticket)=>{if(state.x[id]?.type!=='message')throw Error('这条私信已不存在。');await memory.eraseRecord(ticket,'x',id);});},
        deletePost(id){return run(async(state,_c,_r,_commit)=>{
            if(state.x[id]?.type!=='post')throw Error('这条推文已不存在。');
            // Erase path: journal null records with tombstones, so narrative sync
            // cannot resurrect the post and rollback can restore it. Each erase
            // takes a fresh ticket because erases advance the generation.
            const ids=[...xItems(state,'comment').filter(c=>c.postId===id).map(c=>c.id),
                ...Object.values(state.x).filter(r=>r.type==='influence'&&r.sourceId===id).map(r=>r.id),id];
            for(const rid of ids){const ticket=await memory.begin();await memory.eraseRecord(ticket,'x',rid);}
        });},
        toggleTrendInjection(index){return run(async(state,_c,_r,commit)=>{
            const edition=state.x['trend-edition'],topic=edition?.topics?.[Number(index)];
            if(!topic)throw Error('这期趋势已不存在。');
            await commit([xSet({...edition,topics:edition.topics.map((t,i)=>i===Number(index)?{...t,injected:!t.injected}:t)})]);
        });},
        completeComments(id){return run((state,current,request,commit)=>completeComments(state,current,request,commit,id));},
        markPostRead(id){return run(async(state,_c,_r,commit)=>{await commit([...(state.x[id]?.outreachMention?[xSet({...state.x[id],read:true})]:[]),...xItems(state,'comment').filter(c=>c.postId===id&&c.author!=='user'&&!c.read).map(c=>xSet({...c,read:true}))]);});},
        markRead(id){return run(async(state,_c,_r,commit)=>{await commit(xThread(state,id).filter(m=>m.role==='assistant'&&!m.read).map(m=>xSet({...m,read:true})));});},
    };
}
