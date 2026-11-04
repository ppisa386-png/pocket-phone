import {dayDate} from './story-clock.js?v=1.1.12';

const strength={
    low:{praise:'在目标原有受众和相关圈层形成一波明显的好评、推荐或新客。',attack:'部分网友集中批评、嘲讽、差评或抵制，影响超出熟人范围。'},
    medium:{praise:'突破原有圈层，显著提高知名度与社会认可，可明显增加客流或购买兴趣。',attack:'跨圈层引发较大规模的批评与抵制，明显影响人际处境、商业客流或公众形象。'},
    high:{praise:'大规模追捧，可使原本默默无闻的目标迅速走红，带来广泛推荐、客流或商业机会。',attack:'强烈且广泛的社会排斥、抵制或差评，可使目标声誉迅速恶化并造成显著现实冲击。'}
};
export function privilegeLevel(n){
    if(n>1000000)return 'high';
    if(n>=500000)return 'medium';
    if(n>=100000)return 'low';
    return null;
}
const normalize=s=>s.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
export const privilegeRows=state=>Object.values(state.x||{}).filter(r=>r.type==='privilege');
export const privilegeContract='识别这一条公开推文本身对可准确辨认的具体人物、商店、品牌或机构的明确态度。推荐、赞扬、支持为praise，抨击、贬低、反对为attack。普通提及、提问、态度不明或目标不明为none。不得根据后台私事添加态度。仅返回 {"stance":"none/praise/attack","target":"对象名称","identity":"足以区分同名对象的公开身份","targetId":"同一对象已有ID，无则省略"}。';
export function privilegeChanges(state,post,result){
    const level=privilegeLevel(post.followersAtPublication);
    if(!level||result?.stance==='none')return [];
    if(!['praise','attack'].includes(result?.stance)||![result.target,result.identity].every(s=>typeof s==='string'&&s.trim()&&s.length<=200))throw Error('推文态度或目标不明确，未发布。');
    const rows=privilegeRows(state);
    if(rows.some(r=>r.postId===post.id))return [];
    const target=result.target.trim(),identity=result.identity.trim();
    const same=rows.find(r=>normalize(r.target)===normalize(target)&&normalize(r.identity)===normalize(identity));
    const linked=result.targetId?rows.find(r=>r.targetId===result.targetId):null;
    if(result.targetId&&!linked)throw Error('推文目标编号无效。');
    const targetId=linked?.targetId||same?.targetId||JSON.stringify([normalize(target),normalize(identity)]);
    const day=post.postedAtStory.day;
    const record={id:'privilege:'+post.id,type:'privilege',postId:post.id,targetId,target,identity,stance:result.stance,level,
        followers:post.followersAtPublication,alias:post.alias,start:day,end:day===null?null:day+6,status:day===null?'undated':'active'};
    return [...rows.filter(r=>r.targetId===targetId&&['active','undated'].includes(r.status)).map(r=>({...r,status:'superseded'})),record]
        .map(value=>({collection:'x',key:value.id,value}));
}
export function privilegePrompt(state,day){
    if(day===null)return '';
    const active=privilegeRows(state).filter(r=>r.status==='active'&&r.start<=day&&day<=r.end);
    if(!active.length)return '';
    return '\nX 公开舆论（隐藏的叙事资料）。仅涉及相关目标与公众环境时体现，保持个人知情边界。影响范围符合故事地域、年代和目标性质，地方商家不必成为全球新闻。影响来自公开账号，不由此识破账号主人，不直接修改粉丝数。到期后不延续压力，已发生的后果照常保留。\n'+
        JSON.stringify(active.map(r=>({account:r.alias,target:r.target,identity:r.identity,effect:r.stance==='praise'?'大众推崇':'大众孤立攻击',tier:r.level,scale:strength[r.level][r.stance],through:dayDate(r.end)})));
}
