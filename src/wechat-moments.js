import { readStoryClock } from './story-clock.js?v=1.2';
import { parseModelObject } from './model-json.js?v=1.2';

const MAX_POSTS = 5;
const plain = (value, max) => String(value ?? '').trim().slice(0,max);
const allowedModes = new Set(['all','private','include','exclude']);
export const wxMoments = state => Object.values(state.wechat||{}).filter(item=>item.type==='moment');
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
const validMoment = moment => moment?.type==='moment' && (moment.text||moment.imageDescription);
const recentMoments = state => wxMoments(state).filter(validMoment).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
const shownComments = (moment,actorId) => (moment.comments||[]).filter(c=>c.authorId==='user'||c.authorId===actorId);

export function wechatMomentsStoryPrompt(state,context,chat) {
    // The narrative speaker is one actual chat character. Do not expose a
    // restricted Moment to any other speaker merely because the author is user.
    const actor=context.characters?.[context.characterId];
    if(!actor?.name)return '';
    const unique=context.characters.filter(c=>norm(c.name)===norm(actor.name)).length===1;
    const accounts=wxFriends(state).filter(a=>a.characterId==='card:'+actor.avatar||
        (!a.characterId&&unique&&norm(a.name)===norm(actor.name)));
    if(accounts.length!==1)return '';
    const friend=accounts[0],now=readStoryClock(chat);
    const moments=recentMoments(state).filter(m=>m.authorId==='user'&&canViewWxMoment(m,friend.id))
        .filter(m=>!(Number.isInteger(now.day)&&Number.isInteger(m.storyTime?.day)&&now.day-m.storyTime.day>3))
        .slice(0,8).map(m=>({
            id:m.id,author:m.authorName,identityKnown:friend.identityKnown===true,
            text:plain(m.text,600),imageDescription:plain(m.imageDescription,220),
            storyTime:m.storyTime||null,
            comments:shownComments(m,friend.id).slice(-6).map(c=>({id:c.id,author:c.authorId==='user'?m.authorName:friend.name,text:plain(c.text,300),replyTo:c.replyTo||null})),
        }));
    if(!moments.length)return '';
    return '\n微信朋友圈·当前人物可见记录：'+JSON.stringify({account:friend.name,userAlias:state.wechat?.profile?.alias||context.name1,moments})+
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
                text:plain(m.text,600),imageDescription:plain(m.imageDescription,200),storyTime:m.storyTime||null,
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
                '\n只输出一个 JSON 对象：{"moments":[{"authorId":"本批好友账号id","text":"新朋友圈内容","imageDescription":"可选图片文字描述"}],"interactions":[{"momentId":"可见朋友圈id","authorId":"本批好友账号id","kind":"like 或 comment","text":"评论正文；like 时为空字符串","replyTo":"回复的已有 user 评论id；普通评论留空"}]}。'+
                'moments 最多'+remaining+'条，正文1～300字；interactions最多12条。作者和目标必须使用提供的准确ID，不需要互动时返回空数组。';
            const data=await request(prompt,value=>{
                if(!Array.isArray(value.moments)||value.moments.length>remaining||
                    (value.interactions!==undefined&&(!Array.isArray(value.interactions)||value.interactions.length>12)))
                    throw Error('朋友圈数据格式不正确。');
                const accounts=new Map(cohort.friends.map(a=>[a.id,a]));
                const posts=value.moments.map(item=>{
                    const a=accounts.get(item?.authorId);
                    if(!a||typeof item.text!=='string'||!item.text.trim()||item.text.length>300||
                        (item.imageDescription!=null&&(typeof item.imageDescription!=='string'||item.imageDescription.length>600)))
                        throw Error('朋友圈作者或正文无效。');
                    return {authorId:a.id,authorName:a.name,text:item.text.trim(),imageDescription:plain(item.imageDescription,600)};
                });
                const visibleIds=new Map(cohort.visible.map(m=>[m.id,m]));
                const interactions=(value.interactions||[]).map(item=>{
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
                parseResponse:parseModelObject,finalOutputContract:'仅返回一个合法 JSON 对象，根字段 moments 和 interactions 均为数组。不能输出正文、说明或隐藏标记。'});
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
            mutated.set(row.momentId,next);
        }
        for(const [id,value]of mutated)changes.push({collection:'wechat',key:id,value});
        await commit(changes);
        return {added:newPosts.length,interactions:[...mutated.values()].reduce((sum,m)=>sum+(m.comments?.length||0)+(m.likes?.length||0),0)};
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
