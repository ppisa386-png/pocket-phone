export const xAudience = state => state.x?.audience || null;
export const AUDIENCE_RULES='初始粉丝结合账号所在地、已公开身份和知名度估算；匿名账号不能自动继承真人的名气。';
export function audienceChanges(state,data){
    if(data==null)return [];
    if(typeof data!=='object'||Array.isArray(data))throw Error('X 粉丝数据需要对象。');
    if(xAudience(state)||data.initialFollowers==null)return [];
    const n=data.initialFollowers;
    if(!Number.isSafeInteger(n)||n<0)throw Error('初始粉丝数无效。');
    return [{collection:'x',key:'audience',value:{id:'audience',type:'audience',initialFollowers:n,followers:n}}];
}
