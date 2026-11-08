import { walletCurrency, majorAmount, formatMoney, validCurrency } from './currency.js?v=1.2';
import { requireCash, moneyMinor, assetSet, cashRecord, cashBalance, reservedCash, assetRows } from './assets-core.js?v=1.2';
import { dateDay, readStoryClock } from './story-clock.js?v=1.2';
const shopText=(s,n=2000)=>typeof s==='string'?s.trim().slice(0,n):'';
export const shopItems=(state,type)=>Object.values(state.orders||{}).filter(x=>x.type===type);
export const shopMoney=(minor,currency)=>formatMoney(minor,currency)+' '+currency;
const shopSet=value=>({collection:'orders',key:value.id,value});
const nameKey=s=>String(s||'').normalize('NFKC').trim().toLowerCase().replace(/[\s·.・'’_-]+/g,'');
const nameParts=s=>String(s||'').split(/[\s·.・'’_-]+/).map(t=>t.normalize('NFKC').trim().toLowerCase()).filter(Boolean);
const hanText=s=>/\p{Script=Han}/u.test(s||'');
// Gift recipients resolve locally from character cards and contact names —
// no phone number, address or contact record is required.
export function giftCandidates(state,context){
    const list=[],usedCards=new Set();
    for(const c of Object.values(state.contacts||{})){
        if(!c||c.contactKind==='location')continue;
        const characterId=Number.isInteger(c.characterId)?c.characterId:null;
        if(characterId!==null)usedCards.add(characterId);
        const names=[c.name,...(Array.isArray(c.aliases)?c.aliases:[])].filter(n=>typeof n==='string'&&n.trim());
        if(c.name&&names.length)list.push({key:'contact:'+c.id,names,name:String(c.name),contactId:c.id,characterId});
    }
    const grouped=context.groupId!=null&&context.groupId!=='';
    const members=grouped?context.groups?.find(g=>String(g.id)===String(context.groupId))?.members||[]:[];
    (context.characters||[]).forEach((card,index)=>{
        if(usedCards.has(index))return;
        const active=grouped?members.includes(card?.avatar):context.characterId!=null&&context.characterId!==''&&index===Number(context.characterId);
        if(!active)return;
        const names=[card?.name,...(Array.isArray(card?.data?.aliases)?card.data.aliases:[])].filter(n=>typeof n==='string'&&n.trim());
        if(!names.length||names.some(n=>nameKey(n)===nameKey(context.name1)))return;
        list.push({key:'card:'+index,names,name:String(card.name||names[0]),contactId:null,characterId:index});
    });
    return list;
}
export function matchGiftRecipients(query,state,context){
    const q=nameKey(query);
    if(!q||q.length>60)return[];
    return giftCandidates(state,context).filter(c=>c.names.some(n=>{
        const full=nameKey(n);
        if(!full)return false;
        if(full===q)return true;
        if(q.length>=2&&nameParts(n).includes(q))return true;
        return q.length>=2&&hanText(q)&&full.includes(q);
    })).map(({key,name})=>({key,name}));
}
export function resolveGiftRecipient(key,state,context){
    if(typeof key!=='string'||!key||key==='self')return null;
    const candidate=giftCandidates(state,context).find(c=>c.key===key);
    if(!candidate)return null;
    const contact=candidate.contactId?state.contacts[candidate.contactId]:null;
    return {id:candidate.key,name:candidate.name,phone:contact?.number||null,
        ...(candidate.contactId?{contactId:candidate.contactId}:{}),
        ...(candidate.characterId!==null?{characterId:candidate.characterId}:{})};
}
export function validateProducts(data,currency = null) {
    if(!Array.isArray(data?.products)||data.products.length>8)throw Error('商品信息格式不正确，请重试。');
    return data.products.map(p=>{
        const amount=String(p.price??'');if(!validCurrency(p.currency)||p.currency!==(currency||data.products[0]?.currency))throw Error('商品币种与当地账本不一致。');
        if(!shopText(p.name,150)||!shopText(p.currency,20)||!/^\d{1,10}(\.\d{1,4})?$/.test(amount)||Number(amount)<=0)throw Error('商品价格或名称不完整，请重新搜索。');
        if(p.luxury===true&&!shopText(p.brand,100))throw Error('品牌信息不完整，请重新搜索。');
        return {id:crypto.randomUUID(),type:'product',name:shopText(p.name,150),brand:shopText(p.brand,100),luxury:p.luxury===true,description:shopText(p.description),
            priceMinor:moneyMinor(amount,false,p.currency),currency:shopText(p.currency,20),variants:(Array.isArray(p.variants)?p.variants:[]).map(v=>shopText(v,100)).filter(Boolean).slice(0,12),
            reviews:(Array.isArray(p.reviews)?p.reviews:[]).slice(0,4).map(r=>({name:shopText(r.name,80),text:shopText(r.text,500),rating:Math.max(1,Math.min(5,Math.round(Number(r.rating)||4)))}))};
    });
}
export function createAmazon({memory,phone,getContext,getSettings,paymentRequest}) {
    const run=work=>phone.appTask(async(view,current,request)=>{
        const ticket=await memory.begin(view);
        const commit=async changes=>{if(!current())throw Error('聊天已变化，请重试。');await memory.commit(ticket,changes);};
        return work(view.state,current,request,commit);
    },'amazon');
    return {
        open:()=>memory.read(),
        search(query){return run(async(state,current,request,commit)=>{
            const q=shopText(query,300);if(!q)throw Error('请输入想买的分类或商品。');
            const balance=cashBalance(state),reserved=reservedCash(state);
            const currency=walletCurrency(state);
            const economy={currency,userPersona:!currency?getContext().powerUserSettings?.persona_description:undefined,balance:balance===null?null:majorAmount(balance,currency),reserved:currency?majorAmount(reserved,currency):null,available:balance===null?null:majorAmount(balance-reserved,currency),
                pendingExpenses:assetRows(state,'story_event').some(e=>e.kind==='expense'&&!e.processed),
                holdings:assetRows(state,'holding').filter(h=>h.active!==false).map(({name,category,valueMinor})=>({name,category,value:valueMinor==null||!currency?null:majorAmount(valueMinor,currency)})),
                jobs:assetRows(state,'job').filter(j=>j.endDay==null).map(({name,monthlyMinor})=>({name,monthlySalary:monthlyMinor==null||!currency?null:majorAmount(monthlyMinor,currency)}))};
            const prompt=getSettings().prompts.general+'\n'+getSettings().prompts.amazon+'\n'+getSettings().prompts.amazonShopping+
                '\n当前任务：Amazon 商品搜索。商品按 '+(currency||'user 人设和正文的常住地当地币种（不依据语言或旅行地点）')+' 定价。购物需求：'+JSON.stringify(q)+'。当前经济资料：'+JSON.stringify(economy)+'。余额为 null 表示尚未建账，不能当成零或臆造已知余额；推荐档次结合人设、已有财产和可用资金，用户明确预算/偏好优先。'+
                '\n给出 4—6 件可选择的具体商品，不需要生成图片。输出 {"products":[{"name":"款式/系列与品名","brand":"品牌名；无品牌商品可空","luxury":false,"description":"材质、特点与商品说明","price":"单件价格数字，按币种精度","currency":"符合剧情的货币","variants":["规格/颜色/尺寸，可选项均为同一价格"],"reviews":[{"name":"买家网名","rating":5,"text":"简短买家评价"}]}]}。不返回 user 已购买、付款、收货或新增资产等结论，不替 user 决定。';
            const products=await request(prompt,data=>validateProducts(data,currency),current);
            const changes=shopItems(state,'product').map(p=>({collection:'orders',key:p.id,value:null}));
            changes.push(...products.map(shopSet),shopSet({id:'catalog',type:'catalog',query:q}));await commit(changes);
        });},
        add(id,variant,quantity=1){return run(async(state,_c,_r,commit)=>{
            const p=state.orders[id];if(p?.type!=='product')throw Error('商品已更新，请重新选择。');
            const qty=Number(quantity);if(!Number.isInteger(qty)||qty<1||qty>99)throw Error('数量需为 1—99。');
            const v=p.variants.length?(p.variants.includes(variant)?variant:p.variants[0]):'';
            const items=structuredClone(state.orders.cart?.items||[]);const old=items.find(x=>x.product.id===id&&x.variant===v);
            if(old){if(old.quantity+qty>99)throw Error('同一商品最多 99 件。');old.quantity+=qty;}else items.push({id:crypto.randomUUID(),product:structuredClone(p),variant:v,quantity:qty});
            await commit([shopSet({id:'cart',type:'cart',items})]);
        });},
        remove(id){return run(async(state,_c,_r,commit)=>{await commit([shopSet({id:'cart',type:'cart',items:(state.orders.cart?.items||[]).filter(i=>i.id!==id)})]);});},
        // paymentMethod: 'self' deducts the ledger as before; 'npc' asks the
        // named NPC first — acceptance creates a paid order without touching
        // the user's ledger, a refusal returns {rejected:true} for the bubble,
        // and any request failure throws so the real error reaches the view.
        checkout(recipient='self',date='',time='',paymentMethod='self',payerName=''){return run(async(state,current,request,commit)=>{
            const items=state.orders.cart?.items||[];if(!items.length)throw Error('购物车是空的。');
            if(paymentMethod!=='self'&&paymentMethod!=='npc')throw Error('付款方式不正确，请重新选择。');
            const npcPay=paymentMethod==='npc';
            const payer=npcPay?shopText(payerName,80):'';
            if(npcPay&&!payer)throw Error('请填写代付角色的名字。');
            const context=getContext(),clock=readStoryClock(context.chat);
            const self=recipient==='self';
            const gift=self?null:resolveGiftRecipient(shopText(recipient,120),state,context);
            if(!self&&!gift)throw Error('没有找到这个收件角色，请重新选择。');
            const day=date?dateDay(date):clock.day;if(day===null)throw Error('请选择下单日期。');
            const match=time?.match(/^(\d{2}):(\d{2})$/);const hour=match&&+match[1]<24&&+match[2]<60?+match[1]+(+match[2]/60):clock.hour;
            const totals=Object.create(null);for(const i of items)totals[i.product.currency]=(totals[i.product.currency]||0)+i.product.priceMinor*i.quantity;
            if(Object.values(totals).some(n=>!Number.isSafeInteger(n)))throw Error('订单金额过大，请减少数量。');
            const currency=walletCurrency(state);
            if(currency && Object.keys(totals).some(c=>c!==currency))throw Error('购物车币种不同，请重新搜索 '+currency+' 商品。');
            if(!currency)throw Error('请先在小榴莲点击「一键更新」建立账本。'); // 订单金额始终使用账本币种
            const id=crypto.randomUUID(),receiver=gift||{id:'self',name:context.name1||'user',phone:null};
            if(npcPay){
                const answer=await paymentRequest.judge({request,current,app:'amazon',npc:payer,totalMinor:totals[currency],currency,items:items.map(i=>({name:i.product.name,quantity:i.quantity})),recipientName:receiver.name});
                if(!current())throw Error('剧情或设置已变化，本次下单已取消。');
                if(!answer.accept)return {rejected:true};
            } else {
                requireCash(state,totals[currency],currency);
            }
            await commit([shopSet({id,type:'order',items:structuredClone(items),totals,recipient:receiver,createdDay:day,createdHour:hour,dueDay:day+2,sourceIndex:context.chat.length-1,createdAt:Date.now(),paymentMethod:npcPay?'npc':'self',payerName:payer,paymentStatus:'paid'}),shopSet({id:'cart',type:'cart',items:[]}),...(npcPay?[]:[assetSet(cashRecord('order:'+id,-totals[currency],'Amazon 购物',{currency,source:'amazon',orderId:id,day}))]),...items.filter(i=>self&&i.product.luxury).map(i=>assetSet({id:'holding:order:'+id+':'+i.id,type:'holding',name:i.product.name+' × '+i.quantity,category:'luxury',active:true,valueMinor:null,purchaseMinor:i.quantity*i.product.priceMinor,startDay:day,orderId:id}))]);
            return {id};
        });},
        async recipientMatches(query){const view=await memory.read();const matches=matchGiftRecipients(shopText(query,60),view.state,getContext());return {kind:matches.length===1?'unique':matches.length?'ambiguous':'none',matches};},
    };
}
