import { SQUARE_RULES, squareClock, recentSquareProse, squareBasis, squareStatus } from './square-core.js?v=0.24.4';
import { localizedPerson, sameNamedPerson } from './names.js?v=0.24.4';
// Story-local X simulation. No real social-network API or account is used.
export const xItems = (state,type) => Object.values(state.x || {}).filter(item=>item.type===type);
export const xProfile = (state,name='user') => state.x?.profile || {id:'profile',type:'profile',alias:name,bio:''};
export const xUnread = state => xItems(state,'message').filter(m=>m.role==='assistant'&&!m.read).length + xItems(state,'comment').filter(c=>c.author!=='user'&&!c.read&&!c.ambient).length;
const metric = n => Number.isFinite(Number(n)) ? Math.min(1000000000,Math.max(0,Math.floor(Number(n)))) : 0;
export function xCounts(state,post) {
    const comments=xItems(state,'comment').filter(c=>c.postId===post.id);
    return {likes:metric(post.metrics?.likes)+(post.liked?1:0),reposts:metric(post.metrics?.reposts)+(post.reposted?1:0),
        replies:Math.max(metric(post.metrics?.replies),comments.filter(c=>c.ambient).length)+comments.filter(c=>!c.ambient).length};
}
const xSet = value => ({collection:'x',key:value.id,value});
const xText = (s,max=6000) => typeof s==='string'?s.trim().slice(0,max):'';
const xRequired = (s,label,max=6000) => {const value=xText(s,max);if(!value)throw Error('请填写'+label+'。');return value;};
const xRecord = (type,data) => ({id:crypto.randomUUID(),type,createdAt:Date.now(),...data});
const xAccount = (state,id,unblocked=true) => {const a=state.x?.[id];if(a?.type!=='account')throw Error('账号不存在。');if(unblocked&&a.blocked)throw Error('此账号已被拉黑。');return a;};
const xThread = (state,id) => xItems(state,'message').filter(m=>m.accountId===id).sort((a,b)=>a.createdAt-b.createdAt);

export function createX({memory,phone,getContext,getSettings}) {
    const profile=state=>xProfile(state,getContext().name1);
    const known=(state,a)=>({...a,identityKnown:a.identityKnown===true||profile(state).alias===getContext().name1});
    const run=work=>phone.appTask(async(view,current,request)=>{
        if(!current())throw Error('X 已关闭或聊天已变化。');
        const ticket=await memory.begin();
        const commit=async changes=>{if(!current())throw Error('聊天已变化，本次操作已取消。');if(changes.length)await memory.commit(ticket,changes);};
        return work(view.state,current,request,commit);
    },'x');
    function prompt(state,a,task) {
        const p=profile(state);
        return getSettings().prompts.general+'\n'+getSettings().prompts.x+'\n'+getSettings().prompts.xStyle+
            '\n这是 X 文字扮演任务，不执行真实网络操作。只输出本任务指定 JSON，内容语言遵守酒馆预设；不替 user 发言。user 的公开个人资料：'+JSON.stringify({alias:p.alias,bio:p.bio})+
            '\n真实剧情/人设/千千结记忆只作背景；私人电话、短信、其他 App 内容不能凭空变成公开消息。每人一个 X 账号，发现账号不等于认识真人。'+
            (a?'\n当前对方：'+JSON.stringify({name:a.name,handle:a.handle})+'。'+(a.identityKnown?'此前已确认 user 账号对应的真实身份，改网名不会遗忘。':'对方不知道此网名是谁。不能凭后台 user 对应关系、角色卡、人设、正文中的私人称呼或私下经历认出 user；只知道网名及本账号公开过或本私信提供的信息。'):'\n逐个人物区分知情范围，不把后台账号对应关系当作人物已知。')+
            '\nuser 最近公开帖子：'+JSON.stringify(xItems(state,'post').filter(p=>p.author==='user').slice(-15).map(({id,text})=>({id,text})))+'\nuser 最近公开转发（不代表赞同）：'+JSON.stringify(xItems(state,'post').filter(p=>p.reposted&&p.author!=='user').slice(-10).map(p=>({author:state.x[p.author]?.name,text:p.text})))+'\n'+task;
    }
    const ask=(state,a,request,current,task,validate,options)=>request(prompt(state,a,task),validate,current,a?{id:a.characterId||a.id,name:a.name,channel:'x',alias:profile(state).alias,identityKnown:!!a.identityKnown}:null,options);
    function register(state,item,changes,crowdOnly=false) {
        const identity=localizedPerson(item,getContext(),xItems(state,'account')),name=identity.name,handle=xText(item?.handle,60).replace(/^@/,'');
        if(!name||!handle||/[\s<>]/.test(handle)||name===getContext().name1||item.has_account===false)return null;
        const normalize=s=>String(s||'').normalize('NFKC').trim().toLowerCase();
        const cards=(getContext().characters||[]).filter(c=>sameNamedPerson(c,identity));const characterId=identity.cardId;
        const existing=xItems(state,'account').find(a=>(characterId&&a.characterId===characterId)||sameNamedPerson(a,identity)||a.handle.toLowerCase()===handle.toLowerCase());
        if(crowdOnly&&(cards.length||normalize(name)===normalize(getContext().name1)||existing&&!existing.crowd))return null;
        if(existing){if(existing.name!==name||(!existing.characterId&&characterId)||identity.aliases.some(alias=>!existing.aliases?.includes(alias))){const next={...existing,name,aliases:identity.aliases,characterId:existing.characterId||characterId};state.x[next.id]=next;changes.push(xSet(next));return next;}return existing;}
        const a=xRecord('account',{name,aliases:identity.aliases,handle,characterId,bio:xText(item.bio,500),dmPolicy:['open','requests','closed'].includes(item.dm_policy)?item.dm_policy:'requests',following:false,blocked:false,identityKnown:false,crowd:crowdOnly});
        state.x[a.id]=a;changes.push(xSet(a));return a;
    }
    const list=(data,key,max)=>{if(!Array.isArray(data?.[key])||data[key].length>max)throw Error('返回内容格式不正确，请重试。');return data[key];};
    const engagementRules = () => '\n'+getSettings().prompts.xInteractions;
    const engagementShape = '\n每条 post 可附 metrics:{"likes":0,"reposts":0,"replies":0} 以及 comments:[{"key":"本帖内唯一标记","accountId":"已知评论者账号 ID，未知留空","name":"评论者姓名或网名","handle":"账号名","text":"评论内容","replyTo":"回复本帖某条 comment 的 key；回复帖子留空","isAuthor":false}]。作者发言用 isAuthor:true，不必再给姓名。每帖最多 8 条可见评论（可为零），先给原评论再给它的回复；metrics.replies 至少涵盖这些评论，可以有更多未展示的讨论。评论只属于本帖。';
    function addEngagement(state,post,item,changes) {
        const raw=item.metrics||{};
        post.metrics={likes:metric(raw.likes),reposts:metric(raw.reposts),replies:metric(raw.replies)};
        const keys=new Map();let added=0;
        for(const row of Array.isArray(item.comments)?item.comments.slice(0,8):[]){
            if(!xText(row?.text))continue;
            const parent=row.replyTo?keys.get(String(row.replyTo)):null;
            if(row.replyTo&&!parent)continue;
            let a=row.isAuthor===true?state.x[post.author]:row.accountId?state.x[row.accountId]:null;
            if(a?.type!=='account')a=null;
            if(!a&&row.isAuthor!==true)a=register(state,row,changes);
            if(!a||a.blocked)continue;
            const c=xRecord('comment',{postId:post.id,author:a.id,text:xText(row.text),replyTo:parent||null,ambient:true,read:true});
            state.x[c.id]=c;changes.push(xSet(c));added++;
            if(row.key&&!keys.has(String(row.key)))keys.set(String(row.key),c.id);
        }
        post.metrics.replies=Math.max(post.metrics.replies,added);
        changes.push(xSet(post));
    }
    function resolvePostAuthor(state,item,changes,following,square) {
        let a=item.accountId?state.x[item.accountId]:null;
        if(a?.type!=='account')a=null;
        if(square&&a&&!a.crowd)return null;
        if(!a&&!following)a=register(state,item,changes,square);
        if(!a||a.blocked||following&&!a.following||square&&a.characterId)return null;
        return a;
    }
    async function answer(state,a,m,current,request,commit) {
        const result=await ask(state,a,request,current,'当前任务：X 私信。仅回应本会话最后一条 user 消息，不查看其他账号的私信。对方的私信设置：'+a.dmPolicy+'；会话此前已通过：'+!!a.dmAccepted+'；记录：'+JSON.stringify(xThread(state,a.id).slice(-40).map(({role,text})=>({role,text})))+
            '\n根据角色判断是否接受并回复。输出 {"status":"reply/no_reply/request","text":"回复内容；不回复时为空"}。requests 且未通过时可返回 request（等待对方接受），reply 表示本次同意并回复，no_reply 表示保持沉默。',d=>{if(!['reply','no_reply','request'].includes(d.status)||d.status==='reply'&&!xText(d.text))throw Error('私信回复格式不正确。');return {status:d.status,text:xText(d.text)};});
        const changes=[xSet({...a,dmAccepted:a.dmAccepted||result.status==='reply'}),xSet({...m,status:result.status==='reply'?'answered':result.status})];
        if(result.status==='reply')changes.push(xSet({id:'reply:'+m.id,type:'message',accountId:a.id,role:'assistant',text:result.text,createdAt:Date.now(),read:false}));
        await commit(changes);
    }
    return {
        open:()=>memory.read(),
        saveProfile(values){return run(async(state,_c,_r,commit)=>{await commit([xSet({...profile(state),alias:xRequired(values.alias,'名称',60),bio:xText(values.bio,500)})]);});},
        discover(query){return run(async(state,current,request,commit)=>{
            const results=await ask(state,null,request,current,'当前任务：X 搜索账号。搜索词：'+JSON.stringify(xText(query,100))+'。根据角色和世界设定查找使用 X 的人物，char 默认用真名；不能因为已有电话号码或 Snapchat 好友就假定有 X 账号。输出 {"accounts":[{"name":"姓名","handle":"唯一账号名","bio":"简介","has_account":true,"dm_policy":"open/requests/closed"}]}，最多 10 个，不合适返回空数组。',d=>list(d,'accounts',10));
            state=structuredClone(state);state.x||={};const changes=[],ids=[];
            for(const item of results){if(item?.has_account!==true)continue;const a=register(state,item,changes);if(a&&!ids.includes(a.id))ids.push(a.id);}
            await commit(changes);return {ids};
        });},
        follow(id,value){return run(async(state,_c,_r,commit)=>{const a=xAccount(state,id);await commit([xSet({...known(state,a),following:value===true})]);});},
        block(id,value){return run(async(state,_c,_r,commit)=>{const a=xAccount(state,id,false);await commit([xSet({...a,blocked:value===true}),...xThread(state,id).filter(m=>!m.read).map(m=>xSet({...m,read:true}))]);});},
        reveal(id){return run(async(state,_c,_r,commit)=>{const a=xAccount(state,id);if(a.dmPolicy==='closed')throw Error('此账号暂不接收私信。');await commit([xSet({...a,identityKnown:true}),xSet(xRecord('message',{accountId:id,role:'user',text:'我是 '+getContext().name1+'。',status:'sent',read:true}))]);});},
        publish(value){return run(async(state,_c,_r,commit)=>{await commit([xSet(xRecord('post',{author:'user',alias:profile(state).alias,text:xRequired(value,'帖子内容'),liked:false,reposted:false}))]);});},
        toggleInjection(id){return run(async(state,_c,_r,commit)=>{
            const p=state.x[id],chat=getContext().chat;
            if(p?.type!=='post'||p.feed!=='square'||squareStatus(p,state,chat)!=='active')throw Error('这条内容已采用、过期或时间不明确，无法注入。');
            await commit([xSet({...p,publication:{...p.publication,selected:!p.publication.selected,selectedIndex:chat.length-1}})]);
        });},
        refresh(following=false){const square=following==='square';following=following===true;return run(async(state,current,request,commit)=>{
            const chat=structuredClone(getContext().chat||[]),prose=recentSquareProse(chat);
            const edition=square?{id:'square-edition',type:'edition',editionId:crypto.randomUUID(),clock:squareClock(chat),postIds:[]}:null;
            const accounts=xItems(state,'account').filter(a=>!a.blocked&&(!following||a.following));
            if(following&&!accounts.length)return {added:0};
            const task=square?'当前任务：X 广场。无需关注任何人。'+getSettings().prompts.xSquare+'\n'+SQUARE_RULES+'\nrecentProse：'+JSON.stringify(prose)+'禁止用作广场作者的角色姓名：'+JSON.stringify((getContext().characters||[]).map(c=>c.name)):
                '当前任务：X 动态。'+(following?'仅生成已关注账号的公开帖子，不能添加列表外发帖账号；评论者不受关注列表限制。':'生成相关人物或陌生创作者的公开帖子。');
            const results=await ask(state,null,request,current,task+'已知账号：'+JSON.stringify(xItems(state,'account').filter(a=>!a.blocked).map(({id,name,handle,identityKnown,following,crowd})=>({id,name,handle,identityKnown,following,crowd})))+'。已加载帖子（避免重复）：'+JSON.stringify(xItems(state,'post').slice(-20).map(p=>p.text))+
                '\n输出 {"posts":[{"accountId":"已知账号 ID；新作者留空","name":"新作者名称","handle":"新作者账号","text":"公开帖子内容"}],"replies":[{"postId":"给出的 user 公开帖子 ID","accountId":"已知账号 ID；新作者留空","name":"新作者名称","handle":"新作者账号","text":"对这条 user 帖子的公开回复"}]}。posts 与 replies 各最多 5 条；可以为空，不强制回应。广场任务只填 posts，replies 为空。不得替 user 发帖，不泄漏私人剧情。'+engagementRules()+engagementShape+(square?'\n每条广场帖子必须附 publicBasis:{access:"background/public/limited",summary:"公众知情途径及实际可见范围",sourceIndex:近期原文索引,evidence:"recentProse 中对应 assistant 原文的连续逐字句子",witnessEvidence:"limited 时另填原文已发生外部目击的逐字句子，不能只写可能被看见",involvesCharacters:false}。background 仅为无剧情人物的普通背景帖子，不需引用；public/limited 必须有有效引用，private 内容不得生成。':''),d=>({posts:list(d,'posts',5),replies:d.replies===undefined?[]:list(d,'replies',5)}),square?{retries:0}:undefined);
            state=structuredClone(state);state.x||={};const changes=[];let added=0;
            for(const item of results.posts){if(!xText(item?.text))continue;
                const basis=square?squareBasis(item,prose):null;if(square&&!basis)continue;
                const a=resolvePostAuthor(state,item,changes,following,square);if(!a)continue;
                if(xItems(state,'post').some(p=>p.author===a.id&&p.text===xText(item.text)))continue;
                const post=xRecord('post',{author:a.id,text:xText(item.text),liked:false,reposted:false,feed:square?'square':'home'});
                if(square){post.publication={editionId:edition.editionId,clock:edition.clock,publicBasis:basis,selected:false,sourceIndex:chat.length-1};edition.postIds.push(post.id);}
                state.x[post.id]=post;addEngagement(state,post,item,changes);
                added++;
            }
            for(const item of square?[]:results.replies){
                const post=state.x[item?.postId];if(post?.type!=='post'||post.author!=='user'||!xText(item.text))continue;
                let a=item.accountId?state.x[item.accountId]:null;if(a?.type!=='account')a=null;
                if(!a)a=register(state,item,changes);if(!a||a.blocked)continue;
                if(xItems(state,'comment').some(c=>c.postId===post.id&&c.author===a.id&&c.text===xText(item.text)))continue;
                a=known(state,a);state.x[a.id]=a;changes.push(xSet(a));
                const reply=xRecord('comment',{postId:post.id,author:a.id,text:xText(item.text)});state.x[reply.id]=reply;changes.push(xSet(reply));
            }
            if(square){if(results.posts.length&&!added)throw Error('这批帖子缺少有效公开依据，原广场已保留，请重试。');changes.push(xSet(edition));}
            await commit(changes);return {added};
        });},
        react(id,kind){return run(async(state,_c,_r,commit)=>{const p=state.x[id];if(p?.type!=='post'||!['liked','reposted'].includes(kind))throw Error('帖子不可用。');if(p.author!=='user')xAccount(state,p.author);await commit([xSet({...p,[kind]:!p[kind],[kind+'At']:Date.now()})]);});},
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
                const reply=await ask(state,target,request,current,'当前任务：X 评论。你是被回复的账号：'+JSON.stringify({name:target.name,handle:target.handle})+'；帖子作者：'+JSON.stringify(p.author==='user'?profile(state).alias:state.x[p.author]?.name)+'；公开帖子：'+JSON.stringify(p.text)+'；此前评论：'+JSON.stringify(xItems(state,'comment').filter(c=>c.postId===id).slice(-30).map(c=>({id:c.id,name:c.author==='user'?profile(state).alias:state.x[c.author]?.name,text:c.text,replyTo:c.replyTo})))+'；user 回复的目标评论：'+JSON.stringify(parent?.text||null)+'；user 本次评论：'+JSON.stringify(body)+'。仅决定本账号是否回应 user，可保持沉默，不强制帖子作者出面。输出 {"text":"回复或空字符串"}。不得用私信或未公开剧情作为公众已知。'+engagementRules(),d=>{if(typeof d.text!=='string')throw Error('评论格式不正确。');return {text:xText(d.text)};});
                changes.push(xSet(target));if(reply.text)changes.push(xSet(xRecord('comment',{postId:id,author:target.id,text:reply.text,replyTo:comment.id})));
            }
            await commit(changes);
        });},
        send(id,value){return run(async(state,current,request,commit)=>{
            const a=known(state,xAccount(state,id));if(a.dmPolicy==='closed')throw Error('此账号暂不接收私信。');
            const m=xRecord('message',{accountId:id,role:'user',text:xRequired(value,'消息'),status:'pending',read:true});await commit([xSet(a),xSet(m)]);
            const fresh=await memory.read(),ticket=await memory.begin();
            try{await answer(fresh.state,a,m,current,request,async changes=>{if(!current())throw Error('聊天已变化。');await memory.commit(ticket,changes);});}
            catch(error){if(current())await memory.commit(ticket,[xSet({...m,status:'failed'})]);throw error;}
        });},
        retryMessage(id){return run(async(state,current,request,commit)=>{const m=state.x[id];if(m?.type!=='message'||m.role!=='user'||!['failed','pending','request'].includes(m.status))throw Error('此消息不需要重试。');const a=xAccount(state,m.accountId);if(a.dmPolicy==='closed')throw Error('此账号暂不接收私信。');await answer(state,a,m,current,request,commit);});},
        markPostRead(id){return run(async(state,_c,_r,commit)=>{await commit(xItems(state,'comment').filter(c=>c.postId===id&&c.author!=='user'&&!c.read).map(c=>xSet({...c,read:true})));});},
        markRead(id){return run(async(state,_c,_r,commit)=>{await commit(xThread(state,id).filter(m=>m.role==='assistant'&&!m.read).map(m=>xSet({...m,read:true})));});},
    };
}
