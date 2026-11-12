import {xUserReplyContext} from './x-comments.js?v=1.2.55';
import {brandImpact} from './x-influence.js?v=1.2.55';
// Projects and counters live in the rollback journal. Only the private draw
// survives removal of its source floor, so a replay of the same plan cannot reroll it.
import {socialContact} from './outreach.js?v=1.2.55';
import {effectiveReply} from './contact-policy.js?v=1.2';
import {appendChange,replayJournal} from './journal.js?v=1.2';
import {dateDay,dayDate,readStoryClock,exactStoryTime,storyTime} from './story-clock.js?v=1.2';

const write=(key,value)=>({collection:'business',key,value});
const projects=state=>Object.values(state.business||{}).filter(p=>p.id);
const publicPlan=({id,brand,project,terms,status,investigated,riskRate,mitigations,replyBy,lateReplyDecision})=>({
    id,brand,project,terms,status,investigated,
    ...(replyBy?{replyBy}:{}),
    ...(lateReplyDecision==='open'?{lateReplyDecision:'open'}:{}),
    ...(investigated&&Number.isInteger(riskRate)?{riskRate}:{}),
    ...(mitigations?.length?{mitigations:mitigations.slice(-5)}:{})
});
const word=s=>typeof s==='string'?s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' '):'';
const projectKey=(brand,project)=>'plan:'+JSON.stringify([word(brand),word(project)]);
function windowFor(day){
    if(!Number.isInteger(day))return null;
    const date=dayDate(day),year=Number(date.slice(0,4))+1;
    const last=dateDay(year+date.slice(4))??dateDay(year+'-02-28');
    return {first:day+3,last};
}
// A shop's initial risk flag is private and stable across narrative rollback.
// Investigation reveals it; effective countermeasures can lower it before the
// deal formally starts. A second fixed draw decides whether risk enters the
// existing delayed-incident pipeline, never on each attempt to regenerate.
const legacyRoll=id=>{
    let hash=2166136261;
    for(const char of id){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}
    return (hash>>>0)%65536;
};
export const initialHighRiskForRoll=roll=>Number.isInteger(roll)&&roll>=0&&roll<65536&&roll<30*65536/100;
export function parseBusinessReplyDeadline(value){
    const match=String(value??'').trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})$/);
    if(!match||dateDay(match[1])===null||Number(match[2])>23||Number(match[3])>59)return null;
    return match[1]+' '+match[2]+':'+match[3];
}
export function isLateBusinessReply(replyBy,sentAt){
    const deadline=parseBusinessReplyDeadline(replyBy),date=String(sentAt?.date||'');
    if(!deadline||dateDay(date)===null)return false;
    const dueDate=deadline.slice(0,10);
    if(date>dueDate)return true;
    if(date<dueDate)return false;
    const time=String(sentAt?.time||'');
    return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)&&time>deadline.slice(11);
}
export function businessLateReplyOutcome(replyBy,sentAt,roll){
    if(!isLateBusinessReply(replyBy,sentAt)||!Number.isInteger(roll)||roll<0||roll>65535)return null;
    return roll<32768?'declined':'open';
}
const validRate=n=>Number.isInteger(n)&&n>=0&&n<=100;
export function dealDecision(p,kind,turn,day,risky,terms,details={},roll=null){
    if(!p||p.status!=='invited')return [];
    const baseline=risky===true?100:1;
    if(kind==='investigate')return p.investigated?[]:[
        write(p.id,{...p,investigated:true,riskRate:baseline,
            ...(typeof details.findings==='string'&&details.findings.trim()?{findings:details.findings.trim().slice(0,1200)}:{})})
    ];
    if(kind==='mitigate'){
        if(!p.investigated||risky!==true)return [];
        const previous=validRate(p.riskRate)?p.riskRate:baseline;
        const measure=typeof details.measure==='string'?details.measure.trim().slice(0,500):'';
        const existing=p.mitigations||[];
        if(!measure||previous===0||existing.some(m=>word(m.measure)===word(measure)))return [];
        const next=validRate(details.riskRate)&&details.riskRate<previous?details.riskRate:
            Number.isInteger(details.reduction)&&details.reduction>0&&details.reduction<=100?
                Math.max(0,previous-details.reduction):null;
        if(next===null||next>=previous)return [];
        return [write(p.id,{...p,riskRate:next,
            mitigations:[...existing,{measure,reduction:previous-next,riskRate:next}]})];
    }
    if(kind==='reject')return [write(p.id,{...p,status:'declined'})];
    if(kind!=='accept')return [];
    const rate=validRate(p.riskRate)&&p.investigated?p.riskRate:baseline;
    const ticket=Number.isInteger(roll)&&roll>=0&&roll<65536?roll:legacyRoll(p.id);
    const selected=ticket<rate*65536/100;
    return [write(p.id,{...p,status:'active',terms:typeof terms==='string'&&terms.trim()?terms.trim():p.terms,
        startTurn:turn,startDay:day,decisionRate:rate,risk:selected?'tracking':null})];
}
export function dmDealTask(state,id){
    const plans=projects(state).filter(p=>p.accountId===id&&p.status==='invited').map(publicPlan);
    return plans.length?'\n本账号的合作邀约：'+JSON.stringify(plans)+'。若本条user私信明确同意并实际成立合作或明确拒绝，在JSON加 deal:{id,kind:"accept或reject",terms:"实际约定"}。询价、意向、回复和接受私信请求不等于合作。replyBy仅表示明确的回复截止时间；是否逾期及逾期后的50%婉拒由程序按剧情时间一次性判定，模型不得自行抽签、重复判定或因截止时间自行改写结果。若企划字段 lateReplyDecision 为 open，说明程序已判定逾期后仍保留机会，应继续正常协商，不得再以逾期为由婉拒。':'';
}
export function businessPrompt(state,settings,chat,user,privateDraws={}){
    if(!settings.apps.x)return '';
    const counter=state.business?.counter||{eligible:0,turn:0},followers=state.x?.audience?.followers||0;
    const plans=projects(state),profile=state.x?.profile||{alias:user},parts=[];
    const currentTime=exactStoryTime(chat),currentClock=currentTime.date?(currentTime.date+(currentTime.time?' '+currentTime.time:'')):'剧情日期时间未明确';
    if(followers>=1000&&(counter.eligible+1)%15===0){
        const records=Object.values(state.x);
        const posts=records.filter(p=>p.type==='post'&&p.author==='user').slice(-20).map(p=>({id:p.id,text:p.text,metrics:p.metrics,userReplies:xUserReplyContext(state,p.id)}));
        const accounts=records.filter(a=>a.type==='account').map(({name,id,blocked,dmAccepted,inboundRequest})=>({name,id,blocked,dmAccepted,inboundRequest}));
        parts.push('本轮为X专项商业邀约机会。结合近期正文与世界年代地区、账号定位、粉丝受众和公开推文及互动，选择一家匹配的真实或虚构商家，无合理对象可留空。品牌只能知道公开账号资料，使用网名，不借私事识人。可邀体验、活动、推广或代言等。报价通常随影响力提高，按传播、工作量、预算及地区币值估算。私信以品牌口吻称呼并写明项目和报酬；可结合真实档期在私信中明确设置回复截止时间，但不必每次都设置。若正文明确写出“请于某日某时前回复”或“报价有效至某日某时”等回复期限，必须在正文写清完整日期和时刻，并在标记中附 replyBy:"YYYY-MM-DD HH:mm"。replyBy只表示回复截止时间，不得把活动举办、样品寄送、交付或见面时间误当成回复期限；相对表达须依据当前剧情时刻换算为完整日期，正文与字段一致；没有明确回复期限或无法确定日期时分则省略。截止时间不得早于邀约发出时刻。遵守拉黑、待处理和拒绝状态；陌生私信关闭只联系已接受账号。不重复已发或拒绝企划。实际收到时附<!--durian-business:{"kind":"offer","brand":"品牌名","project":"可复用的企划名称","terms":"条件、报价与币种","text":"私信全文"}-->；只有正文明确给出回复期限时，才在该JSON对象额外添加 replyBy:"YYYY-MM-DD HH:mm"。只用商业标签。当前剧情时刻：'+currentClock+'。资料：'+JSON.stringify({alias:profile.alias,bio:profile.bio,followers,posts,accounts,requestsOpen:profile.requestsOpen!==false,history:plans.map(publicPlan)}));
    }
    const open=plans.filter(p=>p.status==='invited');
    if(open.length)parts.push('隐藏商业背调事实（仅供本次正文模型在user实际完成背调时写出结果，绝不可在背调前向角色泄漏或自动替user调查）：'+JSON.stringify(open.map(p=>({id:p.id,problematic:privateDraws?.[p.id]===true})))+'。problematic=true 的商家经真实完成的背调会查出与合作相关的实质隐患，后台翻车率为100%；problematic=false 的商家不属于预设高风险对象，但合作正式成立时仍有1%翻车率。此处只决定故事内合作风险，不代表现实品牌的经核实事实。调查完成后正文应自然呈现实际发现，不要把后台随机机制写入正文，文尾按规则记录。');
    if(open.length){
        parts.push('已有商业邀约 '+JSON.stringify(open.map(publicPlan))+'。只有user实际完成调查、打听或委托背调并获得有依据的结果，才在本楼末尾附<!--durian-business:{"kind":"investigate","id":"企划ID","findings":"实际查出的情况","riskRate":100}-->（实际后台初始风险为100或1，按对应风险如实填写）；只表达打算调查、浏览主页、询价或尚未拿到结果不算背调。对实际成功落实的风险防范措施，单独附<!--durian-business:{"kind":"mitigate","id":"企划ID","measure":"已成功落实的具体措施","reduction":20,"riskRate":80}-->；降低多少由本轮实际措施的效果决定，可逐次降低，未生效、仅建议或计划中的措施不能标记。仅在合作正式开始前允许降风险。正式签约/合作开始才附<!--durian-business:{"kind":"accept","id":"企划ID","terms":"实际成立的约定"}-->；仅表示兴趣、询价或接受私信请求不算成立；拒绝时附kind=reject。程序在正式开始时对每个企划只按当时剩余风险进行一次随机判定：初始高风险商家未经减险为100%，减险后按新概率；非高风险商家也有1%概率。判中后沿用现有成立满三剧情日以后的翻车流程；本轮标记不得预先宣布后续事故。报价、签约及索赔不等于实际资金收付，财务按原规则。');
    }
    const undated=plans.filter(p=>p.status==='active'&&p.startDay===null);
    if(undated.length)parts.push('这些合作的成立日期尚未明确：'+JSON.stringify(undated.map(publicPlan))+'。若本楼明确提及实际签约日期，可附<!--durian-business:{"kind":"date","id":"企划ID","date":"YYYY-MM-DD"}，不得推测或改用设备时间。');
    const day=readStoryClock(chat).day;
    for(const p of plans.filter(p=>p.risk==='tracking')){
        const age=counter.turn+1-p.startTurn,w=windowFor(p.startDay);
        if(age<=0||age%10||!w||day===null||day>w.last)continue;
        parts.push('隐藏商业风险（不可对读者披露机制）：'+JSON.stringify(publicPlan(p))+'，成立日 '+dayDate(p.startDay)+'，已过 '+(day-p.startDay)+' 天。只能在 '+dayDate(w.first)+' 至 '+dayDate(w.last)+' 内实际发生；不到日期不可提前，跳过期限不补写。可等待。事件须符合既有合作，不改写user行为。若实际发生，按争议严重度、推广深度、粉丝规模及曝光判断影响，同等条件下越近期声誉受损和掉粉通常越大，较久通常较轻；不凭索赔扣款。正文写明实际后果，附<!--durian-business:{"kind":"incident","id":"对应企划ID","loss":首日实际净掉粉整数,"longTail":有明确持续传播时才填true}。当前粉丝 '+followers);
    }
    return parts.join('\n');
}
export function importBusiness(raw,revisions,chat,settings,annotations){
    // Evaluate each new floor against audience changes anchored BEFORE it.
    const audienceEvents=raw?.events.filter(e=>e.changes.some(c=>c.collection==='x'&&c.key==='audience'))||[];
    if(!audienceEvents.length)return {journal:raw,changed:false};
    let journal=raw,state=replayJournal(raw),changed=false;
    const first=Math.min(...audienceEvents.map(e=>e.source.index))+1;
    const begin=Math.max(first,(state.business.counter?.index??-1)+1);
    if(begin>=chat.length)return {journal,changed};
    let clock=readStoryClock(chat.slice(0,begin));
    for(let index=begin;index<chat.length;index++){
        clock=readStoryClock([chat[index]],clock);
        if(!effectiveReply(chat[index]))continue;
        const prior=state.business.counter||{turn:0,eligible:0};
        const enabled=settings.apps.x;
        const audience=audienceEvents.filter(e=>e.source.index<index).at(-1)?.changes.findLast(c=>c.collection==='x'&&c.key==='audience')?.value;
        const eligible=enabled&&audience?.followers>=1000;
        if(!eligible&&!state.business.counter&&!projects(state).length)continue;
        const counter={index,turn:prior.turn+Number(!!enabled),eligible:eligible?prior.eligible+1:(enabled?0:prior.eligible)};
        const changes=[write('counter',counter)];
        const add=rows=>{for(const c of rows){changes.push(c);state[c.collection][c.key]=c.value;}};
        if(enabled){
            for(const p of projects(state)){
                const w=windowFor(p.startDay);
                if(p.risk==='tracking'&&w&&clock.day!==null&&clock.day>w.last)add([write(p.id,{...p,risk:'expired'})]);
            }
            let offered=false;
            for(const row of annotations(chat[index],'durian-business')){
                if(row.kind==='offer'){
                    if(offered||!eligible||counter.eligible%15||![row.brand,row.project,row.terms,row.text].every(s=>word(s)&&s.length<=6000))continue;
                    const id=projectKey(row.brand,row.project);
                    if(state.business[id])continue;
                    const sourceChat=chat.slice(0,index+1),sceneTime=storyTime(sourceChat);
                    const parsedDeadline=parseBusinessReplyDeadline(row.replyBy);
                    const replyBy=parsedDeadline&&!isLateBusinessReply(parsedDeadline,exactStoryTime(sourceChat))?parsedDeadline:null;
                    const delivery=socialContact(state,{channel:'x_dm',sender:row.brand,text:row.text},'commercial:'+revisions[index],sceneTime,Date.parse(chat[index].send_date)||Date.now());
                    if(!delivery.length)continue;
                    if(replyBy&&delivery.at(-1)?.value?.type==='message')delivery.at(-1).value.replyBy=replyBy;
                    const account=delivery[0].value;
                    if(!state.x[account.id])account.identityKnown=false;
                    const draws=journal.businessDraws??={};
                    if(!Object.hasOwn(draws,id))draws[id]=initialHighRiskForRoll(crypto.getRandomValues(new Uint16Array(1))[0]);
                    const rolls=journal.businessRolls??={};
                    if(!Object.hasOwn(rolls,id))rolls[id]=crypto.getRandomValues(new Uint16Array(1))[0];
                    add(delivery);add([write(id,{id,brand:row.brand,project:row.project,terms:row.terms,accountId:account.id,status:'invited',investigated:false,...(replyBy?{replyBy}:{})})]);
                    offered=true;continue;
                }
                const p=state.business[row.id];
                if(!p?.id)continue;
                if(row.kind==='date'&&p.status==='active'&&p.startDay===null){
                    const day=dateDay(row.date);
                    if(day!==null&&(clock.day===null||day<=clock.day))
                        add([write(p.id,{...p,startDay:day,risk:p.risk==='tracking'&&clock.day>windowFor(day).last?'expired':p.risk})]);
                    continue;
                }
                if(row.kind!=='incident'){add(dealDecision(p,row.kind,counter.turn,clock.day,journal.businessDraws?.[p.id],row.terms,row,journal.businessRolls?.[p.id]));continue;}
                const w=windowFor(p.startDay);
                if(p.risk!=='tracking'||!w||clock.day===null||clock.day<w.first||clock.day>w.last||counter.turn-p.startTurn<10||!Number.isSafeInteger(row.loss)||row.loss<0)continue;
                const a=state.x.audience,loss=Math.min(a.followers,row.loss);
                const impact=brandImpact(p.id,clock.day,loss,index,row.longTail===true);
                add([{collection:'x',key:impact.id,value:impact},write(p.id,{...p,risk:'triggered',incidentDate:dayDate(clock.day),loss}),{collection:'x',key:'audience',value:{...a,followers:a.followers-loss}}]);
            }
        }
        journal=appendChange(journal,revisions.slice(0,index+1),changes,'business:'+revisions[index]);
        if(changes.some(c=>c.collection==='x'&&c.key==='audience'))audienceEvents.push(journal.events.at(-1));
        state.business.counter=counter;changed=true;
    }
    return {journal,changed};
}
