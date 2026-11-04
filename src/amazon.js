import { walletCurrency, majorAmount, formatMoney, validCurrency } from './currency.js?v=1.1.17';
import { requireCash, moneyMinor, assetSet, cashRecord, cashBalance, reservedCash, assetRows } from './assets-core.js?v=1.1.17';
import { dateDay, readStoryClock } from './story-clock.js?v=1.1.12';
const shopText=(s,n=2000)=>typeof s==='string'?s.trim().slice(0,n):'';
export const shopItems=(state,type)=>Object.values(state.orders||{}).filter(x=>x.type===type);
export const shopMoney=(minor,currency)=>formatMoney(minor,currency)+' '+currency;
const shopSet=value=>({collection:'orders',key:value.id,value});
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
export function createAmazon({memory,phone,getContext,getSettings}) {
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
        checkout(recipientId='self',date='',time=''){return run(async(state,_c,_r,commit)=>{
            const items=state.orders.cart?.items||[];if(!items.length)throw Error('购物车是空的。');
            const c=recipientId==='self'?null:state.contacts[recipientId];if(recipientId!=='self'&&!c)throw Error('请先取得收件人的电话号码。');
            const context=getContext(),clock=readStoryClock(context.chat);
            const day=date?dateDay(date):clock.day;if(day===null)throw Error('请选择下单日期。');
            const match=time?.match(/^(\d{2}):(\d{2})$/);const hour=match&&+match[1]<24&&+match[2]<60?+match[1]+(+match[2]/60):clock.hour;
            const totals=Object.create(null);for(const i of items)totals[i.product.currency]=(totals[i.product.currency]||0)+i.product.priceMinor*i.quantity;
            if(Object.values(totals).some(n=>!Number.isSafeInteger(n)))throw Error('订单金额过大，请减少数量。');
            const currency=walletCurrency(state);
            if(currency && Object.keys(totals).some(c=>c!==currency))throw Error('购物车币种不同，请重新搜索 '+currency+' 商品。');
            requireCash(state,totals[currency],currency);
            const id=crypto.randomUUID(),recipient={id:recipientId,name:c?(c.targetName||c.name):context.name1||'user',phone:c?.number||null};
            await commit([shopSet({id,type:'order',items:structuredClone(items),totals,recipient,createdDay:day,createdHour:hour,dueDay:day+2,sourceIndex:context.chat.length-1,createdAt:Date.now()}),shopSet({id:'cart',type:'cart',items:[]}),assetSet(cashRecord('order:'+id,-totals[currency],'Amazon 购物',{currency,source:'amazon',orderId:id,day})),...items.filter(i=>recipientId==='self'&&i.product.luxury).map(i=>assetSet({id:'holding:order:'+id+':'+i.id,type:'holding',name:i.product.name+' × '+i.quantity,category:'luxury',active:true,valueMinor:null,purchaseMinor:i.quantity*i.product.priceMinor,startDay:day,orderId:id}))]);
            return {id};
        });},
    };
}
