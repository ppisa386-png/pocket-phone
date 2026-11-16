// Business-specific envelopes for SillyTavern's existing json_schema channel.
// Non-strict schemas leave semantic validity to the original App validators.
const str={type:'string'}, integer={type:'integer'}, bool={type:'boolean'};
const obj=(required,properties)=>({type:'object',required,properties,additionalProperties:true});
const arr=(items,minItems=0,maxItems)=>({type:'array',items,minItems,...(maxItems===undefined?{}:{maxItems})});
const schema=(name,value)=>({name:'phone_'+name,strict:false,value});
const holiday=obj(['date','name'],{date:str,name:str,note:str});
const article=obj(['headline','body','summary','section','placement','subject'],{
    headline:str,body:str,summary:str,section:str,placement:{type:'string',enum:['lead','feature','brief']},
    subject:{type:'string',enum:['world','character']},publicBasis:obj(['access','summary'],{access:str,summary:str,sourceIndex:integer}),
});
const residence=obj(['region','currency'],{region:str,currency:str,place:str,inferred:bool});
const holding=obj(['name','category'],{name:str,category:str,value:{type:['string','number','null']},details:str,rights:{type:'object'}});
const job=obj(['name'],{name:str,monthlySalary:{type:['number','string','null']}});
const product=obj(['name','brand','luxury','description','image','price','currency','variants','reviews'],{
    name:str,brand:str,luxury:bool,description:str,image:str,price:{type:['number','string']},currency:str,
    variants:arr(str),reviews:arr(obj(['name','rating','text'],{name:str,rating:integer,text:str})),
});
export const TASK_SCHEMAS={
    calendar:schema('calendar',obj(['region','timezone','years','holidays'],{
        region:str,timezone:{type:['string','null']},years:arr(integer,2,2),
        holidays:arr({anyOf:[arr(str,2,3),holiday]},0,240),
    })),
    xInitial:schema('x_initial_followers',obj(['initialFollowers'],{initialFollowers:{type:'integer',minimum:0}})),
    assetsInitial:schema('assets_initial',obj(['residence','initial'],{
        date:str,currency:str,residence:{anyOf:[{type:'null'},residence]},
        initial:obj(['balance','holdings','jobs'],{balance:{type:['string','number']},holdings:arr(holding),jobs:arr(job)}),note:str,
    })),
    assetsUpdate:schema('assets_update',{
        ...obj([],{
        date:str,currency:str,residenceChange:{anyOf:[{type:'null'},obj(['sourceIndex','subject','status','region','currency'],{sourceIndex:integer,subject:str,status:str,region:str,currency:str,place:str})]},
        events:arr({type:'object'}),salaries:arr({type:'object'}),valuations:arr({type:'object'}),
        living:obj(['total','bookedIds'],{total:{type:['number','string']},bookedIds:arr(str)}),
        business:arr({type:'object'}),ownership:arr({type:'object'}),classifications:arr({type:'object'}),recoveredAssets:arr({type:'object'}),note:str,
        }),
        // Migration to another currency is a deliberate early-return task:
        // it only proposes the new residence until the user supplies a rate.
        anyOf:[{required:['events','living','business']},{required:['residenceChange']}],
    }),
    assetsRecovery:schema('assets_recovery',obj(['recoveredAssets'],{recoveredAssets:arr({type:'object'})})),
    assetsResidence:schema('assets_residence_repair',obj(['residence'],{residence:{anyOf:[{type:'null'},residence]},date:str,currency:str})),
    daily:schema('daily',obj(['publication','location','articles'],{publication:str,location:str,articles:arr(article,9,9)})),
    amazon:schema('amazon_search',obj(['products'],{products:arr(product,4,6)})),
    sms:schema('sms_reply',obj(['status','text'],{status:{type:'string',enum:['reply','no_reply']},text:str})),
    call:schema('call_reply',obj(['status','text'],{status:{type:'string',enum:['answered','no_answer','declined']},text:str})),
    payment:schema('npc_payment',obj(['accept'],{accept:bool})),
    snapComment:schema('social_comment_reply',obj(['text'],{text:str})),
    wechatMoments:schema('wechat_moments',obj(['moments','interactions'],{moments:arr({type:'object'}),interactions:arr({type:'object'})})),
    xDm:schema('x_dm',obj(['status'],{status:{type:'string',enum:['reply','no_reply','request']},text:str,category:str,deal:{type:'object'}})),
    xFeed:schema('x_feed',{...obj([],{posts:arr({type:'object'}),replies:arr({type:'object'}),accounts:arr({type:'object'}),activityReactions:arr({type:'object'}),engagementUpdates:arr({type:'object'})}),anyOf:[{required:['posts']},{required:['accounts']}]}),
    xComments:schema('x_comments',obj(['comments'],{comments:arr({type:'object'})})),
    xPublic:schema('x_public_comment',obj(['text'],{text:str,reactions:arr({type:'object'})})),
    xTrends:schema('x_trends',obj(['topics'],{topics:arr({type:'object'})})),
    xStats:schema('x_post_impact',obj(['stats'],{stats:arr({type:'object'}),initialFollowers:integer})),
    xFloor:schema('x_floor_impact',obj(['effects'],{effects:arr({type:'object'}),noGrowthReview:arr({type:'object'})})),
    xPrivilege:schema('x_privilege',obj(['stance'],{stance:{type:'string',enum:['none','praise','attack']},target:str,identity:str,targetId:str})),
    snapChat:schema('social_chat',obj(['status'],{status:{type:'string',enum:['reply','no_reply']},messages:arr({type:'object'}),text:str,kind:str,transfer:{anyOf:[{type:'null'},{type:'object'}]}})),
    snapInvite:schema('social_invite',obj(['status'],{status:{type:'string',enum:['friends','pending','declined']}})),
    snapBatch:schema('social_invites_batch',obj(['results'],{results:arr({type:'object'})})),
    snapSearch:schema('social_accounts',obj(['accounts'],{accounts:arr({type:'object'})})),
    snapFeed:schema('social_feed',obj(['items'],{items:arr({type:'object'}),reactions:arr({type:'object'})})),
    snapCall:schema('social_call',obj(['status'],{status:{type:'string',enum:['answered','no_answer']},text:str,category:str})),
    snapTransfer:schema('social_transfer',obj(['status'],{status:{type:'string',enum:['accepted','declined','pending']}})),
    textRewrite:schema('message_rewrite',obj(['text'],{text:str})),
    friends:schema('friends_response',{...obj([],{accepted:bool,name:str,aliases:arr(str),ambiguous:bool}),anyOf:[{required:['accepted']},{required:['ambiguous']}]}),
    contacts:schema('contacts',obj(['contacts'],{contacts:arr({type:'object'})})),
    food:schema('food_search',obj(['currency','shops'],{currency:str,shops:arr({type:'object'})})),

    accounts:schema('accounts_search',obj(['accounts'],{accounts:arr({type:'object'})})),
    contacts:schema('contacts_import',obj(['contacts'],{contacts:arr({type:'object'})})),
};
export function modelProtocolError(task,fields,reason='模型未返回完整任务数据') {
    const missing=Array.isArray(fields)?fields.filter(x=>typeof x==='string').slice(0,30):[];
    return Object.assign(new Error(reason+(missing.length?'（缺少 '+missing.join('、')+'）':'')+'，本次未保存。'),{
        code:'PHONE_DATA_MISSING',retryable:true,missingFields:missing,
        diagnostic:'错误分类：模型任务协议缺字段；任务：'+task+'；缺少字段：'+(missing.join('、')||'无'),
    });
}
export function assertTaskResponse(data,contract,{optionalMissing=[],currentCurrency=null}={}) {
    if(!contract?.value)return data;
    const migration=contract.name==='phone_assets_update' && data?.residenceChange?.status==='completed' &&
        data.residenceChange.subject==='user' && !!currentCurrency && !!data.residenceChange.currency &&
        currentCurrency!==data.residenceChange.currency;
    const required=contract.name==='phone_assets_update' && !migration
        ? ['events','living','business'] : migration ? ['residenceChange'] : (contract.value.required||[]);
    if(contract.name==='phone_x_feed'&&!Array.isArray(data?.posts)&&!Array.isArray(data?.accounts))
        throw modelProtocolError(contract.name,['posts 或 accounts'],'字段 posts 缺失');
    if(contract.name==='phone_friends_response'&&typeof data?.accepted!=='boolean'&&data?.ambiguous!==true)
        throw modelProtocolError(contract.name,['accepted 或 ambiguous']);
    const missing=required.filter(key=>!optionalMissing.includes(key)&&
        (!data||typeof data!=='object'||Array.isArray(data)||!Object.hasOwn(data,key)||data[key]===undefined));
    if(missing.length)throw modelProtocolError(contract.name,missing,
        contract.name==='phone_assets_update' && missing.includes('living') ? '缺少本期生活开销' : '模型未返回完整任务数据');
    return data;
}
export function commonTaskSchema(app,prompt) {
    if(String(prompt).includes('当前任务：NPC 代付判断。'))return TASK_SCHEMAS.payment;
    if(app==='messages') {
        if(prompt.includes('仅基于此前交流重写'))return TASK_SCHEMAS.textRewrite;
        if(/只输出 JSON：[\\s\\S]*?\\{"status":"reply 或 no_reply"/.test(prompt))return TASK_SCHEMAS.sms;
    }
    if((app==='phone'||app==='incoming')&&/只输出 JSON：[\\s\\S]*?\\{"status":"answered 或 no_answer 或 declined"/.test(prompt))return TASK_SCHEMAS.call;
    if(app==='x') {
        if(prompt.includes('当前任务：X 私信。'))return TASK_SCHEMAS.xDm;
        if(prompt.includes('当前任务：X 公开评论区互动。'))return TASK_SCHEMAS.xPublic;
        if(prompt.includes('当前任务：X 未结算剧情楼层'))return TASK_SCHEMAS.xFloor;
        if(prompt.includes('stats 数组必须恰好覆盖列出的每个 postId'))return TASK_SCHEMAS.xStats;
        if(prompt.includes('当前任务：补齐此帖已有公开评论。'))return TASK_SCHEMAS.xComments;
        if(prompt.includes('趋势评估资料（人设用于判断身份'))return TASK_SCHEMAS.xTrends;
        if(prompt.includes('识别这一条公开推文本身'))return TASK_SCHEMAS.xPrivilege;
        if(prompt.includes('输出 {"posts":[{'))return TASK_SCHEMAS.xFeed;
    }
    if(['snapchat','whatsapp','wechat'].includes(app)) {
        const name={snapchat:'Snapchat',whatsapp:'WhatsApp',wechat:'微信'}[app];
        if(prompt.includes('当前任务：'+name+' stories 刷新。')||
            prompt.includes('当前任务：'+name+' spotlight 刷新。')||
            prompt.includes('当前任务：'+name+' map 刷新。'))return TASK_SCHEMAS.snapFeed;
        if(prompt.includes('当前任务：'+name+' 动态评论。'))return TASK_SCHEMAS.snapComment;
        if(prompt.includes('当前任务：仅重写选中的一条 '+name+' 消息。'))return TASK_SCHEMAS.textRewrite;
        if(prompt.includes('当前任务：'+name+' 新增联系人。'))return TASK_SCHEMAS.snapSearch;
        if(prompt.includes('当前任务：批量 '+name+' 好友邀请。'))return TASK_SCHEMAS.snapBatch;
        if(prompt.includes('当前任务：'+name+' 好友邀请。'))return TASK_SCHEMAS.snapInvite;
        if(prompt.includes('当前任务：'+name+' 聊天。'))return TASK_SCHEMAS.snapChat;
        if(prompt.includes('当前任务：'+name+' 语音通话')||prompt.includes('当前任务：'+name+' 视频通话'))return TASK_SCHEMAS.snapCall;
        if(prompt.includes('当前任务：'+(app==='snapchat'?'Snapcash':name+' 转账')+' 收款判断。'))return TASK_SCHEMAS.snapTransfer;
    }
    return null;
}
