// Projects and counters live in the rollback journal. Only the private draw
// survives removal of its source floor, so a replay of the same plan cannot reroll it.
import {socialContact} from './outreach.js?v=1.1.12';
import {effectiveReply} from './contact-policy.js?v=1.1.13';
import {appendChange,replayJournal} from './journal.js?v=1.1.13';
import {dateDay,dayDate,readStoryClock} from './story-clock.js?v=1.1.12';

const write=(key,value)=>({collection:'business',key,value});
const projects=state=>Object.values(state.business||{}).filter(p=>p.id);
const publicPlan=({id,brand,project,terms,status,investigated})=>({id,brand,project,terms,status,investigated});
const word=s=>typeof s==='string'?s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' '):'';
const projectKey=(brand,project)=>'plan:'+JSON.stringify([word(brand),word(project)]);
function windowFor(day){
    if(!Number.isInteger(day))return null;
    const date=dayDate(day),year=Number(date.slice(0,4))+1;
    const last=dateDay(year+date.slice(4))??dateDay(year+'-02-28');
    return {first:day+3,last};
}
export function dealDecision(p,kind,turn,day,risky,terms){
    if(!p||p.status!=='invited')return [];
    if(kind==='investigate')return [write(p.id,{...p,investigated:true})];
    if(kind==='reject')return [write(p.id,{...p,status:'declined'})];
    if(kind!=='accept')return [];
    return [write(p.id,{...p,status:'active',terms:typeof terms==='string'&&terms.trim()?terms.trim():p.terms,
        startTurn:turn,startDay:day,risk:risky&&!p.investigated?'tracking':null})];
}
export function dmDealTask(state,id){
    const plans=projects(state).filter(p=>p.accountId===id&&p.status==='invited').map(publicPlan);
    return plans.length?'\n本账号的合作邀约：'+JSON.stringify(plans)+'。若本条user私信明确同意并实际成立合作或明确拒绝，在JSON加 deal:{id,kind:"accept或reject",evidence:"user本条私信逐字引文",terms:"实际约定"}。询价、意向、回复和接受私信请求不等于合作。':'';
}
export function businessPrompt(state,settings,chat,user){
    if(!settings.apps.x)return '';
    const counter=state.business?.counter||{eligible:0,turn:0},followers=state.x?.audience?.followers||0;
    const plans=projects(state),profile=state.x?.profile||{alias:user},parts=[];
    if(followers>=1000&&(counter.eligible+1)%15===0){
        const records=Object.values(state.x);
        const posts=records.filter(p=>p.type==='post'&&p.author==='user').slice(-20).map(({text,metrics})=>({text,metrics}));
        const accounts=records.filter(a=>a.type==='account').map(({name,id,blocked,dmAccepted,inboundRequest})=>({name,id,blocked,dmAccepted,inboundRequest}));
        parts.push('本轮为X专项商业邀约机会。结合近期正文与世界年代地区、账号定位、粉丝受众和公开推文及互动，选择一家匹配的真实或虚构商家，无合理对象可留空。品牌只能知道公开账号资料，使用网名，不借私事识人。可邀体验、活动、推广或代言等。报价通常随影响力提高，按传播、工作量、预算及地区币值估算。私信以品牌口吻称呼并写明项目和报酬。遵守拉黑、待处理和拒绝状态；陌生私信关闭只联系已接受账号。不重复已发或拒绝企划。实际收到时附<!--durian-business:{"kind":"offer","brand":"品牌名","project":"可复用的企划名称","terms":"条件、报价与币种","text":"私信全文","evidence":"本楼逐字到达事实"}-->。只用商业标签。资料：'+JSON.stringify({alias:profile.alias,bio:profile.bio,followers,posts,accounts,requestsOpen:profile.requestsOpen!==false,history:plans.map(publicPlan)}));
    }
    const open=plans.filter(p=>p.status==='invited');
    if(open.length)parts.push('已有商业邀约 '+JSON.stringify(open.map(publicPlan))+'。仅对本楼实际发生的事实按顺序附<!--durian-business:{"kind":"investigate/accept/reject","id":"对应企划ID","terms":"成立时的约定","evidence":"本楼逐字依据"}-->。调查须已实际查证背景、产品或信誉（含委托完成）；浏览主页、询价不算。接受须明确达成合作，不替user决定。报价、签约及索赔均不等于资金收付，仅实际付款或已满足的结算条件沿用现有财务规则。');
    const undated=plans.filter(p=>p.status==='active'&&p.startDay===null);
    if(undated.length)parts.push('这些合作的成立日期尚未明确：'+JSON.stringify(undated.map(publicPlan))+'。若本楼明确提及实际签约日期，可附<!--durian-business:{"kind":"date","id":"企划ID","date":"YYYY-MM-DD","evidence":"含明确成立日期的逐字原句"}-->，不得推测或改用设备时间。');
    const day=readStoryClock(chat).day;
    for(const p of plans.filter(p=>p.risk==='tracking')){
        const age=counter.turn+1-p.startTurn,w=windowFor(p.startDay);
        if(age<=0||age%10||!w||day===null||day>w.last)continue;
        parts.push('隐藏商业风险（不可对读者披露机制）：'+JSON.stringify(publicPlan(p))+'，成立日 '+dayDate(p.startDay)+'，已过 '+(day-p.startDay)+' 天。只能在 '+dayDate(w.first)+' 至 '+dayDate(w.last)+' 内实际发生；不到日期不可提前，跳过期限不补写。可等待。事件须符合既有合作，不改写user行为。若实际发生，按争议严重度、推广深度、粉丝规模及曝光判断影响，同等条件下越近期声誉受损和掉粉通常越大，较久通常较轻；不凭索赔扣款。正文写明实际后果，附<!--durian-business:{"kind":"incident","id":"对应企划ID","loss":实际净掉粉整数,"evidence":"本楼已发生的争议及公众反应逐字原句"}-->。当前粉丝 '+followers);
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
                    const delivery=socialContact(state,{channel:'x_dm',sender:row.brand,text:row.text},'commercial:'+revisions[index],{date:dayDate(clock.day)},Date.parse(chat[index].send_date)||Date.now());
                    if(!delivery.length)continue;
                    const account=delivery[0].value;
                    if(!state.x[account.id])account.identityKnown=false;
                    const draws=journal.businessDraws??={};
                    if(!Object.hasOwn(draws,id))draws[id]=crypto.getRandomValues(new Uint8Array(1))[0]<128;
                    add(delivery);add([write(id,{id,brand:row.brand,project:row.project,terms:row.terms,accountId:account.id,status:'invited',investigated:false})]);
                    offered=true;continue;
                }
                const p=state.business[row.id];
                if(!p?.id)continue;
                if(row.kind==='date'&&p.status==='active'&&p.startDay===null){
                    const day=dateDay(row.date);
                    if(day!==null&&row.evidence.includes(row.date)&&(clock.day===null||day<=clock.day))
                        add([write(p.id,{...p,startDay:day,risk:p.risk==='tracking'&&clock.day>windowFor(day).last?'expired':p.risk})]);
                    continue;
                }
                if(row.kind!=='incident'){add(dealDecision(p,row.kind,counter.turn,clock.day,journal.businessDraws?.[p.id],row.terms));continue;}
                const w=windowFor(p.startDay);
                if(p.risk!=='tracking'||!w||clock.day===null||clock.day<w.first||clock.day>w.last||counter.turn-p.startTurn<10||!Number.isSafeInteger(row.loss)||row.loss<0)continue;
                const a=state.x.audience,loss=Math.min(a.followers,row.loss);
                add([write(p.id,{...p,risk:'triggered',incidentDate:dayDate(clock.day),loss}),{collection:'x',key:'audience',value:{...a,followers:a.followers-loss}}]);
            }
        }
        journal=appendChange(journal,revisions.slice(0,index+1),changes,'business:'+revisions[index]);
        if(changes.some(c=>c.collection==='x'&&c.key==='audience'))audienceEvents.push(journal.events.at(-1));
        state.business.counter=counter;changed=true;
    }
    return {journal,changed};
}
