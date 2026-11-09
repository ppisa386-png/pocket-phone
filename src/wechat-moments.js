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
        const friends=wxFriends(state);
        if(!friends.length)return {added:0};
        // Deliberately exclude users' posts from the shared prompt. Even with
        // restricted visibility, one multi-actor model call must never expose
        // a post to somebody outside its audience.
        const inputs=friends.slice(0,25).map(a=>({id:a.id,name:a.name,aliases:(a.aliases||[]).slice(0,3)}));
        const recent=wxMoments(state).filter(m=>m.authorId!=='user').slice(-18).map(m=>({authorId:m.authorId,text:m.text}));
        const prompt=getSettings().prompts.general+'\n'+getSettings().prompts.wechat+
            '\n当前任务：刷新虚构微信朋友圈，仅生成当前微信好友愿意公开给 user 看的日常朋友圈，不能编造 user 的发言。'+
            '\n目前可以发布的好友账号：'+JSON.stringify(inputs)+
            '\n此前已存在的好友动态（不要重复）：'+JSON.stringify(recent)+
            '\n尊重角色所在地域、年代、性格、实际可知信息和剧情时间。不虚构 private user 朋友圈，不能看到未授权的内容，也不要把私人剧情当成公开信息。图片用可选的文字描述，不要引用真实图片网址。没有合理新动态返回空数组。'+
            '\n只输出 JSON：{"moments":[{"authorId":"好友账号原始id","text":"朋友圈正文","imageDescription":"可选的图片描述"}]}，最多5条；正文1至300字，图片描述可为空。';
        const result=await request(prompt,data=>{
            if(!Array.isArray(data.moments)||data.moments.length>MAX_POSTS)throw new Error('朋友圈数据格式不正确。');
            const byId=new Map(inputs.map(a=>[a.id,a]));
            return data.moments.map(item=>{
                const author=byId.get(item?.authorId);
                if(!author||typeof item.text!=='string'||!item.text.trim()||item.text.length>300||
                    (item.imageDescription!=null&&(typeof item.imageDescription!=='string'||item.imageDescription.length>600)))
                    throw new Error('朋友圈作者或正文无效。');
                return {authorId:author.id,authorName:author.name,text:item.text.trim(),imageDescription:plain(item.imageDescription,600)};
            });
        },current,null,{retries:0,skipExternalMemory:true,skipSMSClassification:true,
            parseResponse:parseModelObject,finalOutputContract:'只返回一个合法 JSON 对象，不输出解释、小说正文或标记。'});
        const now=Date.now(),clock=readStoryClock(getContext().chat);
        const changes=result.map((item,i)=>{
            const value={...item,id:'wx-moment:'+crypto.randomUUID(),type:'moment',
                visibility:'all',audienceIds:[],likes:[],comments:[],createdAt:now+i,storyTime:clock};
            return {collection:'wechat',key:value.id,value};
        });
        await commit(changes);
        return {added:changes.length};
    });

    const likeMoment=id=>run(async(state,current,request,commit)=>{
        const item=state.wechat?.[id],friends=wxFriends(state);
        if(!item||item.type!=='moment'||(item.authorId!=='user'&&!friends.some(a=>a.id===item.authorId)))throw new Error('朋友圈动态不可用。');
        const likes=Array.isArray(item.likes)?item.likes:[];
        const next=likes.includes('user')?likes.filter(a=>a!=='user'):[...likes,'user'];
        await commit([{collection:'wechat',key:id,value:{...item,likes:next}}]);
        return {liked:next.includes('user')};
    });
    const commentMoment=(id,comment)=>run(async(state,current,request,commit)=>{
        const item=state.wechat?.[id],friends=wxFriends(state),text=plain(comment,500);
        if(!item||item.type!=='moment'||(item.authorId!=='user'&&!friends.some(a=>a.id===item.authorId)))throw new Error('朋友圈动态不可用。');
        if(!text||String(comment||'').trim().length>500)throw new Error('请填写有效评论（最多500字）。');
        const record={id:'wx-comment:'+crypto.randomUUID(),authorId:'user',
            name:plain(state.wechat?.profile?.alias||getContext().name1,60),text,createdAt:Date.now()};
        await commit([{collection:'wechat',key:id,value:{...item,comments:[...(item.comments||[]),record]}}]);
        return {id:record.id};
    });
    return {publish,refreshMoments,likeMoment,commentMoment};
}
