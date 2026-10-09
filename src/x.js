// Story-local X simulation. No real social-network API or account is used.
export const xItems = (state,type) => Object.values(state.x || {}).filter(item=>item.type===type);
export const xProfile = (state,name='user') => state.x?.profile || {id:'profile',type:'profile',alias:name,bio:''};
export const xUnread = state => xItems(state,'message').filter(m=>m.role==='assistant'&&!m.read).length + xItems(state,'comment').filter(c=>c.author!=='user'&&!c.read).length;
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
        return getSettings().prompts.general+'\n'+getSettings().prompts.x+
            '\n这是 X 文字扮演任务，不执行真实网络操作。只输出本任务指定 JSON，内容语言遵守酒馆预设；不替 user 发言。user 的公开个人资料：'+JSON.stringify({alias:p.alias,bio:p.bio})+
            '\n真实剧情/人设/千千结记忆只作背景；私人电话、短信、其他 App 内容不能凭空变成公开消息。每人一个 X 账号，发现账号不等于认识真人。'+
            (a?'\n当前对方：'+JSON.stringify({name:a.name,handle:a.handle})+'。'+(a.identityKnown?'此前已确认 user 账号对应的真实身份，改网名不会遗忘。':'对方不知道此网名是谁。不能凭后台 user 对应关系、角色卡、人设、正文中的私人称呼或私下经历认出 user；只知道网名及本账号公开过或本私信提供的信息。'):'\n逐个人物区分知情范围，不把后台账号对应关系当作人物已知。')+
            '\nuser 最近公开帖子：'+JSON.stringify(xItems(state,'post').filter(p=>p.author==='user').slice(-15).map(({id,text})=>({id,text})))+'\n'+task;
    }
    const ask=(state,a,request,current,task,validate)=>request(prompt(state,a,task),validate,current,a?{id:a.characterId||a.id,name:a.name,channel:'x',alias:profile(state).alias,identityKnown:!!a.identityKnown}:null);
    function register(state,item,changes) {
        const name=xText(item?.name,100),handle=xText(item?.handle,60).replace(/^@/,'');
        if(!name||!handle||/[\s<>]/.test(handle)||name===getContext().name1||item.has_account===false)return null;
        const cards=(getContext().characters||[]).filter(c=>c.name===name);const characterId=cards.length===1?'card:'+cards[0].avatar:null;
        const existing=xItems(state,'account').find(a=>(characterId&&a.characterId===characterId)||a.name===name||a.handle.toLowerCase()===handle.toLowerCase());
        if(existing)return existing;
        const a=xRecord('account',{name,handle,characterId,bio:xText(item.bio,500),dmPolicy:['open','requests','closed'].includes(item.dm_policy)?item.dm_policy:'requests',following:false,blocked:false,identityKnown:false});
        state.x[a.id]=a;changes.push(xSet(a));return a;
    }
    const list=(data,key,max)=>{if(!Array.isArray(data?.[key])||data[key].length>max)throw Error('返回内容格式不正确，请重试。');return data[key];};
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
        refresh(following=false){return run(async(state,current,request,commit)=>{
            const accounts=xItems(state,'account').filter(a=>!a.blocked&&(!following||a.following));
            if(following&&!accounts.length)return {added:0};
            const results=await ask(state,null,request,current,'当前任务：X 动态。'+(following?'仅生成已关注账号的公开帖子，不能添加列表外账号。':'生成相关人物或陌生创作者的公开帖子。')+'已知账号：'+JSON.stringify(accounts.map(({id,name,handle,identityKnown})=>({id,name,handle,identityKnown})))+'。已加载帖子（避免重复）：'+JSON.stringify(xItems(state,'post').slice(-15).map(p=>p.text))+
                '\n输出 {"posts":[{"accountId":"已知账号 ID；新作者留空","name":"新作者真名或创作者名称","handle":"新作者账号","text":"公开帖子内容"}],"replies":[{"postId":"给出的 user 公开帖子 ID","accountId":"已知账号 ID；新作者留空","name":"新作者名称","handle":"新作者账号","text":"角色对这条 user 帖子的公开回复"}]}。posts 与 replies 各最多 5 条；可以为空，不强制回应。不得替 user 发帖，不泄漏私人剧情；已知账号发言遵守该人物知情范围。',d=>({posts:list(d,'posts',5),replies:d.replies===undefined?[]:list(d,'replies',5)}));
            state=structuredClone(state);state.x||={};const changes=[];let added=0;
            for(const item of results.posts){if(!xText(item?.text))continue;let a=item.accountId?state.x[item.accountId]:null;if(a?.type!=='account')a=null;if(!a&&!following)a=register(state,item,changes);if(!a||a.blocked||following&&!a.following)continue;
                if(xItems(state,'post').some(p=>p.author===a.id&&p.text===xText(item.text)))continue;
                const post=xRecord('post',{author:a.id,text:xText(item.text),liked:false,reposted:false});state.x[post.id]=post;changes.push(xSet(post));added++;
            }
            for(const item of results.replies){
                const post=state.x[item?.postId];if(post?.type!=='post'||post.author!=='user'||!xText(item.text))continue;
                let a=item.accountId?state.x[item.accountId]:null;if(a?.type!=='account')a=null;
                if(!a&&!following)a=register(state,item,changes);if(!a||a.blocked||following&&!a.following)continue;
                if(xItems(state,'comment').some(c=>c.postId===post.id&&c.author===a.id&&c.text===xText(item.text)))continue;
                a=known(state,a);state.x[a.id]=a;changes.push(xSet(a));
                const reply=xRecord('comment',{postId:post.id,author:a.id,text:xText(item.text)});state.x[reply.id]=reply;changes.push(xSet(reply));
            }
            await commit(changes);return {added};
        });},
        react(id,kind){return run(async(state,_c,_r,commit)=>{const p=state.x[id];if(p?.type!=='post'||!['liked','reposted'].includes(kind))throw Error('帖子不可用。');if(p.author!=='user')xAccount(state,p.author);await commit([xSet({...p,[kind]:!p[kind]})]);});},
        comment(id,value){return run(async(state,current,request,commit)=>{
            const p=state.x[id];if(p?.type!=='post')throw Error('帖子不存在。');const body=xRequired(value,'回复内容');const comment=xRecord('comment',{postId:id,author:'user',alias:profile(state).alias,text:body});const changes=[xSet(comment)];
            if(p.author!=='user'){
                const a=known(state,xAccount(state,p.author));
                const reply=await ask(state,a,request,current,'当前任务：X 评论。公开帖子：'+JSON.stringify(p.text)+'；此前评论：'+JSON.stringify(xItems(state,'comment').filter(c=>c.postId===id).slice(-20))+'；user 本次评论：'+JSON.stringify(body)+'。仅生成作者对此评论的回复或保持沉默，输出 {"text":"回复或空字符串"}。不得使用你与 user 的私信作为公开已知，除非对方在这次公开评论中明确透露。',d=>{if(typeof d.text!=='string')throw Error('评论格式不正确。');return {text:xText(d.text)};});
                changes.push(xSet(a));if(reply.text)changes.push(xSet(xRecord('comment',{postId:id,author:a.id,text:reply.text,replyTo:comment.id})));
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
