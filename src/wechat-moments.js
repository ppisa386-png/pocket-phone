import { TASK_SCHEMAS } from './task-contracts.js?v=1.2.100';
import { readStoryClock } from './story-clock.js?v=1.2.100';
import { parseAppObject } from './model-json.js?v=1.2.79';

const MAX_POSTS = 5;
const plain = (value, max) => String(value ?? '').trim().slice(0,max);
const allowedModes = new Set(['all','private','include','exclude']);
export const wxMoments = state => Object.values(state.wechat||{}).filter(item=>item.type==='moment');
// A single legacy image stays a string; a gallery keeps each supplied picture
// separately. The synthesized string remains available to older consumers.
export const momentImages = moment => Array.isArray(moment?.images)&&moment.images.length
    ?moment.images.filter(image=>typeof image==='string'&&image.trim())
    :typeof moment?.imageDescription==='string'&&moment.imageDescription.trim()?[moment.imageDescription]:[];
const momentMedia = (item,max=1500) => {
    const raw=item?.images??item?.imageDescriptions??item?.imageDescription??'';
    const images=Array.isArray(raw)?raw:typeof raw==='string'?(raw.trim()?[raw]:[]):null;
    if(!images||images.length>9||images.some(image=>typeof image!=='string'||!image.trim()||image.length>max))
        throw Error('朋友圈图片描述无效。');
    return images.map(image=>image.trim());
};
export const wxFriends = state => Object.values(state.wechat||{}).filter(x=>x.type==='account').filter(a=>a.friend==='friends'&&!a.blocked);

export function canViewWxMoment(moment,accountId) {
    if(moment?.type!=='moment')return false;
    if(moment.authorId==='user') {
        if(accountId==='user')return true;
        const visibility=moment.visibility||'all',list=moment.audienceIds||[];
        if(visibility==='private')return false;
        if(visibility==='include')return list.includes(accountId);
        if(visibility==='exclude')return !list.includes(accountId);
        return true;
    }
    return accountId==='user'||moment.authorId===accountId;
}

const norm = value => String(value||'').normalize('NFKC').trim().toLowerCase();
const validMoment = moment => moment?.type==='moment' && (moment.text||momentImages(moment).length);
const recentMoments = state => wxMoments(state).filter(validMoment).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
const shownComments = (moment,actorId) => (moment.comments||[]).filter(c=>c.authorId==='user'||c.authorId===actorId);

// A direct WeChat conversation is also scoped to the one real friend who can
// see the post. Never attach another friend's exclusive Moments to this chat.
export function wechatMomentsAccountPrompt(state,accountId,chat) {
    const friend=wxFriends(state).find(a=>a.id===accountId);
    if(!friend)return '';
    const now=readStoryClock(chat);
    const rows=recentMoments(state).filter(m=>m.authorId==='user'&&canViewWxMoment(m,friend.id))
        .filter(m=>!(Number.isInteger(now.day)&&Number.isInteger(m.storyTime?.day)&&now.day-m.storyTime.day>3))
        .slice(0,8).map(m=>({
            id:m.id,text:plain(m.text,600),imageDescription:plain(m.imageDescription,200),
            ...(Array.isArray(m.images)?{images:m.images.map(image=>plain(image,160))}:{}),
            storyTime:m.storyTime||null,
            comments:shownComments(m,friend.id).slice(-6).map(c=>({
                author:c.authorId==='user'?'user':friend.name,text:plain(c.text,250),replyTo:c.replyTo||null,
            })),
        }));
    if(!rows.length)return '';
    return '\n本次微信聊天对象有权限看到的用户朋友圈（仅此账号知情，不作为私信）：'+
        JSON.stringify({friend:friend.name,userAlias:state.wechat?.profile?.alias||'user',moments:rows})+
        '。可以自然回应或完全不提，不强制生成朋友圈评论或重复旧帖子。' +
        (friend.identityKnown===true?'':'当前账号不一定知道网名背后的真人身份，不得凭后台信息识破匿名。');
}

export function wechatMomentsStoryPrompt(state,context,chat) {
    // The narrative speaker is one actual chat character. Do not expose a
    // restricted Moment to any other speaker merely because the author is user.
    const actor=context.characters?.[context.characterId];
    const userRules='\n【微信朋友圈文尾同步】仅当本楼小说正文确实写出 user 已经在微信朋友圈发表新动态，正文末尾必须附一条 <!--durian-wechat-moment:{"action":"published","authorId":"user","text":"已实际发布的文字，纯图片可为空","images":["第一张照片的画面描述","第二张照片的画面描述"],"visibility":"all"}-->。单张照片仅填 imageDescription 字符串，多张照片必须仍用同一条标记中的 images 数组逐张按顺序记录；无图省略配图字段，纯图片帖 text 可为空。仅保存实际写出的照片，不凭空补充；不是每张照片各输出一条朋友圈。默认公开可省略 visibility；明确仅自己可见须填 private；部分可见/不给谁看须填 include/exclude 和真实微信好友 audienceIds，否则不要同步成公开。准备、草稿、取消、回忆、已存旧动态均不记，绝不为了标记额外安排 user 发文；没有本楼真实新发表就不输出。';
    if(!actor?.name)return userRules;
    const unique=context.characters.filter(c=>norm(c.name)===norm(actor.name)).length===1;
    const accounts=wxFriends(state).filter(a=>a.characterId==='card:'+actor.avatar||
        (!a.characterId&&unique&&norm(a.name)===norm(actor.name)));
    if(accounts.length!==1)return userRules;
    const friend=accounts[0],now=readStoryClock(chat);
    const moments=recentMoments(state).filter(m=>m.authorId==='user'&&canViewWxMoment(m,friend.id))
        .filter(m=>!(Number.isInteger(now.day)&&Number.isInteger(m.storyTime?.day)&&now.day-m.storyTime.day>3))
        .slice(0,8).map(m=>({
            id:m.id,author:m.authorName,identityKnown:friend.identityKnown===true,
            text:plain(m.text,600),imageDescription:plain(m.imageDescription,220),
            ...(Array.isArray(m.images)?{images:m.images.map(image=>plain(image,160))}:{}),
            storyTime:m.storyTime||null,
            comments:shownComments(m,friend.id).slice(-6).map(c=>({id:c.id,author:c.authorId==='user'?m.authorName:friend.name,text:plain(c.text,300),replyTo:c.replyTo||null})),
        }));
    const rules=userRules+'\n当前微信好友正文同步：仅当本楼确实写出当前人物实际发表一条新朋友圈，末尾附 <!--durian-wechat-moment:{"action":"published","authorId":"'+friend.id+'","text":"实际发表的文字，纯图片可为空","images":["第一张照片画面","第二张照片画面"]}-->；单张仍填 imageDescription 字符串，多张必须仍输出一条标记并逐张记录 images，不为每张照片制造新帖；仅描写该人物在以下可见朋友圈发表评论时附 <!--durian-wechat-moment:{"action":"comment","authorId":"'+friend.id+'","momentId":"以下已有朋友圈准确ID","text":"实际已发表的评论文字","replyTo":"回复已有评论ID或不填写"}-->。仅记录真实完成的发帖及评论；打算、草稿、回忆、手机已有内容不重记。没有发生就不输出。';
    if(!moments.length)return rules;
    return rules+'\n微信朋友圈·当前人物可见记录：'+JSON.stringify({account:friend.name,userAlias:state.wechat?.profile?.alias||context.name1,moments})+
        '。这些朋友圈已经发表且对当前人物可见，不是尚待发送的消息；只供自然延续人物认知，' +
        '可以在剧情相关时提起，也可以完全不理会；不得让未授权的人物知晓仅部分好友可见的内容。' +
        (friend.identityKnown===true?'':'本账号不一定知道网名对应的现实 user，不得仅凭后台关系认出真人。')+
        '不要将旧朋友圈重新写成刚发布，也不要为了展示朋友圈强行安排 user 打开微信；正文明确发生新的朋友圈评论时才描述，不凭空补写 user 的发言。';
}


export function createWechatMoments({memory,phone,getContext,getSettings}) {
    const run = work => phone.appTask(async (view,current,request) => {
        const ticket=await memory.begin(view);
        const commit=async changes=>{
            if(!current())throw new Error('聊天已变化，朋友圈操作已取消。');
            if(changes.length)await memory.commit(ticket,changes);
        };
        return work(view.state,current,request,commit);
    },'wechat');

    const publish=(body,imageDescription,visibility='all',audienceIds=[])=>run(async (state,current,request,commit)=>{
        const text=plain(body,6000),image=plain(imageDescription,1500);
        if(!text&&!image)throw new Error('请输入正文或图片描述。');
        if(String(body??'').trim().length>6000||String(imageDescription??'').trim().length>1500)throw new Error('朋友圈内容过长。');
        if(!allowedModes.has(visibility))throw new Error('朋友圈可见范围无效。');
        if(!Array.isArray(audienceIds)||audienceIds.length>300||audienceIds.some(id=>typeof id!=='string'))throw new Error('请选择有效的好友。');
        const friends=new Set(wxFriends(state).map(a=>a.id));
        const audience=[...new Set(audienceIds)];
        if(audience.some(id=>!friends.has(id)))throw new Error('所选好友已经不可用，请重新选择。');
        if(['include','exclude'].includes(visibility)&&!audience.length)throw new Error('请至少选择一位好友。');
        const item={id:'wx-moment:'+crypto.randomUUID(),type:'moment',authorId:'user',
            authorName:plain(state.wechat?.profile?.alias||getContext().name1,60)||'user',
            text,imageDescription:image,visibility,audienceIds:['include','exclude'].includes(visibility)?audience:[],
            likes:[],comments:[],createdAt:Date.now(),storyTime:readStoryClock(getContext().chat)};
        await commit([{collection:'wechat',key:item.id,value:item}]);
        return {id:item.id};
    });

    const refreshMoments=()=>run(async(state,current,request,commit)=>{
        const friends=wxFriends(state).slice(0,25);
        if(!friends.length)return {added:0,interactions:0};
        const existing=recentMoments(state).slice(0,22);
        // A multi-actor prompt MUST only contain moments visible to every actor
        // in that cohort. Split by the exact visible set, never attach a
        // restricted post to a prompt containing an unauthorized friend.
        const cohorts=new Map();
        for(const friend of friends){
            const visible=existing.filter(m=>canViewWxMoment(m,friend.id));
            const key=visible.map(m=>m.id).sort().join('|');
            if(!cohorts.has(key))cohorts.set(key,{friends:[],visible});
            cohorts.get(key).friends.push(friend);
        }
        const staged=structuredClone(state),changes=[],newPosts=[],newInteractions=[];
        const usedPosts=new Set();
        const acceptedReactions=new Set();
        const now=Date.now(),clock=readStoryClock(getContext().chat);
        for(const cohort of cohorts.values()){
            if(!current())throw Error('朋友圈刷新已取消。');
            const remaining=MAX_POSTS-newPosts.length;
            const candidates=cohort.friends.map(a=>({id:a.id,name:a.name,aliases:(a.aliases||[]).slice(0,3)}));
            const visible=cohort.visible.map(m=>({
                id:m.id,authorId:m.authorId,authorName:m.authorName,
                text:plain(m.text,600),imageDescription:plain(m.imageDescription,200),
                ...(Array.isArray(m.images)?{images:m.images.map(image=>plain(image,160))}:{}),storyTime:m.storyTime||null,
                comments:(m.comments||[]).filter(c=>c.authorId==='user')
                    .slice(-8).map(c=>({id:c.id,authorId:'user',text:plain(c.text,300),replyTo:c.replyTo||null})),
            }));
            const previous=wxMoments(state).filter(m=>m.authorId!=='user'&&cohort.friends.some(a=>a.id===m.authorId))
                .slice(-14).map(m=>({authorId:m.authorId,text:plain(m.text,250)}));
            const prompt=getSettings().prompts.general+'\n'+getSettings().prompts.wechat+
                '\n当前任务：刷新虚构微信朋友圈，允许好友自行发新朋友圈，也允许他们对当前确实可见的旧朋友圈点赞、评论、回复 user 已写出的评论。不替 user 发言，不自动生成新的 user 帖子。'+
                '\n本批可以生成的微信好友：'+JSON.stringify(candidates)+
                '\n仅本批好友有权限看到的朋友圈：'+JSON.stringify(visible)+
                '\n这些好友此前的朋友圈（避免重复）：'+JSON.stringify(previous)+
                '\n可见范围由程序按好友预先分组；只依据本次可见列表，不能推断私人、仅其他好友可见、聊天私信或隐藏身份的内容。'+
                '人物可以不发表评论、不点赞或不发新动态；不要让所有人围着 user 转，也不要重复旧评论。'+
                '\n只输出一个 JSON 对象：{"moments":[{"authorId":"本批好友账号id","text":"新朋友圈内容","imageDescription":"单张图片描述；无图省略","images":["多图时第一张画面","第二张画面"]}],"interactions":[{"momentId":"可见朋友圈id","authorId":"本批好友账号id","kind":"like 或 comment","text":"评论正文；like 时为空字符串","replyTo":"回复的已有 user 评论id；普通评论留空"}]}。单张仅填 imageDescription，多张仅填 images 数组且按顺序，不把一条多图朋友圈拆成多条，也不为图片编造内容。'+
                'moments 最多'+remaining+'条，正文1～300字；interactions最多12条。作者和目标必须使用提供的准确ID，不需要互动时返回空数组。';
            const data=await request(prompt,value=>{
                if(!Array.isArray(value.moments)||value.moments.length>remaining||
                    (!Array.isArray(value.interactions)||value.interactions.length>12))
                    throw Error('朋友圈数据格式不正确。');
                const accounts=new Map(cohort.friends.map(a=>[a.id,a]));
                const posts=value.moments.map(item=>{
                    const a=accounts.get(item?.authorId);
                    if(!a||typeof item.text!=='string'||!item.text.trim()||item.text.length>300)
                        throw Error('朋友圈作者或正文无效。');
                    const images=momentMedia(item,600);
                    return {authorId:a.id,authorName:a.name,text:item.text.trim(),
                        imageDescription:images.join('\n'),...(images.length>1?{images}:{})};
                });
                const visibleIds=new Map(cohort.visible.map(m=>[m.id,m]));
                const interactions=value.interactions.map(item=>{
                    const friend=accounts.get(item?.authorId),target=visibleIds.get(item?.momentId);
                    if(!friend||!target||!canViewWxMoment(target,friend.id)||!['like','comment'].includes(item.kind))
                        throw Error('朋友圈互动账号或可见目标无效。');
                    const body=typeof item.text==='string'?item.text.trim():'';
                    if(item.kind==='comment'&&(!body||body.length>500)||item.kind==='like'&&body)
                        throw Error('朋友圈评论内容无效。');
                    const replyTo=item.replyTo||null;
                    if(replyTo&&(!target.comments?.some(c=>c.id===replyTo&&c.authorId==='user')||item.kind!=='comment'))
                        throw Error('朋友圈回复目标无效。');
                    return {authorId:friend.id,name:friend.name,momentId:target.id,kind:item.kind,text:body,replyTo};
                });
                return {posts,interactions};
            },current,null,{retries:0,skipExternalMemory:true,skipSMSClassification:true,
                jsonSchema:TASK_SCHEMAS.wechatMoments,parseResponse:parseAppObject,finalOutputContract:'仅返回一个合法 JSON 对象，根字段 moments 和 interactions 均为数组。不能输出正文、说明或隐藏标记。'});
            for(const p of data.posts){
                const dedupe=p.authorId+':'+p.text;
                if(usedPosts.has(dedupe)||wxMoments(state).some(m=>m.authorId===p.authorId&&m.text===p.text))continue;
                usedPosts.add(dedupe);newPosts.push(p);
            }
            for(const a of data.interactions){
                const key=[a.momentId,a.authorId,a.kind,a.text,a.replyTo||''].join('|');
                if(acceptedReactions.has(key))continue;
                acceptedReactions.add(key);newInteractions.push(a);
            }
        }
        for(const [i,post] of newPosts.entries()){
            const value={...post,id:'wx-moment:'+crypto.randomUUID(),type:'moment',
                visibility:'all',audienceIds:[],likes:[],comments:[],createdAt:now+i,storyTime:clock};
            changes.push({collection:'wechat',key:value.id,value});
        }
        const mutated=new Map();
        let savedInteractions=0;
        for(const row of newInteractions){
            const old=mutated.get(row.momentId)||staged.wechat?.[row.momentId];
            if(old?.type!=='moment')continue;
            let next;
            if(row.kind==='like'){
                if((old.likes||[]).includes(row.authorId))continue;
                next={...old,likes:[...(old.likes||[]),row.authorId]};
            }else{
                if((old.comments||[]).some(c=>c.authorId===row.authorId&&c.text===row.text&&
                    (c.replyTo||null)===(row.replyTo||null)))continue;
                const comment={id:'wx-comment:'+crypto.randomUUID(),authorId:row.authorId,
                    name:row.name,text:row.text,replyTo:row.replyTo||null,createdAt:now+changes.length,
                    storyTime:clock};
                next={...old,comments:[...(old.comments||[]),comment]};
            }
            mutated.set(row.momentId,next);savedInteractions++;
        }
        for(const [id,value]of mutated)changes.push({collection:'wechat',key:id,value});
        await commit(changes);
        return {added:newPosts.length,interactions:savedInteractions};
    });

    const likeMoment=id=>run(async(state,current,request,commit)=>{
        const item=state.wechat?.[id],friends=wxFriends(state);
        if(!item||item.type!=='moment'||(item.authorId!=='user'&&!friends.some(a=>a.id===item.authorId)))throw new Error('朋友圈动态不可用。');
        const likes=Array.isArray(item.likes)?item.likes:[];
        const next=likes.includes('user')?likes.filter(a=>a!=='user'):[...likes,'user'];
        await commit([{collection:'wechat',key:id,value:{...item,likes:next}}]);
        return {liked:next.includes('user')};
    });
    const commentMoment=(id,comment,replyTo=null)=>run(async(state,current,request,commit)=>{
        const item=state.wechat?.[id],friends=wxFriends(state),text=plain(comment,500);
        if(!item||item.type!=='moment'||(item.authorId!=='user'&&!friends.some(a=>a.id===item.authorId)))throw new Error('朋友圈动态不可用。');
        if(!text||String(comment||'').trim().length>500)throw new Error('请填写有效评论（最多500字）。');
        if(replyTo&&!(item.comments||[]).some(c=>c.id===replyTo))throw Error('回复的朋友圈评论已不存在。');
        const record={id:'wx-comment:'+crypto.randomUUID(),authorId:'user',
            name:plain(state.wechat?.profile?.alias||getContext().name1,60),text,replyTo:replyTo||null,
            storyTime:readStoryClock(getContext().chat),createdAt:Date.now()};
        await commit([{collection:'wechat',key:id,value:{...item,comments:[...(item.comments||[]),record]}}]);
        return {id:record.id};
    });
    return {publish,refreshMoments,likeMoment,commentMoment};
}
