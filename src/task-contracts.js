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
    assetsUpdate:schema('assets_update',obj([],{
        date:str,currency:str,residenceChange:{anyOf:[{type:'null'},obj(['sourceIndex','subject','status','region','currency'],{sourceIndex:integer,subject:str,status:str,region:str,currency:str,place:str})]},
        events:arr({type:'object'}),salaries:arr({type:'object'}),valuations:arr({type:'object'}),
        living:obj(['total','bookedIds'],{total:{type:['number','string']},bookedIds:arr(str)}),
        business:arr({type:'object'}),ownership:arr({type:'object'}),classifications:arr({type:'object'}),recoveredAssets:arr({type:'object'}),note:str,
    })),
    assetsRecovery:schema('assets_recovery',obj(['recoveredAssets'],{recoveredAssets:arr({type:'object'})})),
    daily:schema('daily',obj(['publication','location','articles'],{publication:str,location:str,articles:arr(article,9,9)})),
    amazon:schema('amazon_search',obj(['products'],{products:arr(product,4,6)})),
    sms:schema('sms_reply',obj(['status','text'],{status:{type:'string',enum:['reply','no_reply']},text:str})),
    call:schema('call_reply',obj(['status','text'],{status:{type:'string',enum:['answered','no_answer','declined']},text:str})),
    payment:schema('npc_payment',obj(['accept'],{accept:bool})),
    snapComment:schema('social_comment_reply',obj(['text'],{text:str})),
    wechatMoments:schema('wechat_moments',obj(['moments','interactions'],{moments:arr({type:'object'}),interactions:arr({type:'object'})})),
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
export function assertTaskResponse(data,contract,{optionalMissing=[]}={}) {
    if(!contract?.value?.required?.length)return data;
    const missing=contract.value.required.filter(key=>!optionalMissing.includes(key)&&
        (!data||typeof data!=='object'||Array.isArray(data)||!Object.hasOwn(data,key)||data[key]===undefined));
    if(missing.length)throw modelProtocolError(contract.name,missing);
    return data;
}
export function commonTaskSchema(app,prompt) {
    if(String(prompt).includes('当前任务：NPC 代付判断。'))return TASK_SCHEMAS.payment;
    if(app==='messages')return TASK_SCHEMAS.sms;
    if(app==='phone'||app==='incoming')return TASK_SCHEMAS.call;
    return null;
}
