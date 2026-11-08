import { walletCurrency, validCurrency } from './currency.js?v=1.2';
import { requireCash, moneyMinor, cashRecord, assetSet } from './assets-core.js?v=1.2';
import { readStoryClock } from './story-clock.js?v=1.2';
const foodText=(s,n=200)=>typeof s==='string'?s.trim().slice(0,n):'';
export const foodItems=(state,type)=>Object.values(state.orders||{}).filter(x=>x.type===type);
export const FOOD_SHOP_COUNT=10,FOOD_MENU_MIN=20,FOOD_MENU_MAX=30,FOOD_CATEGORY_MIN=5;
const dishNameKey=s=>String(s||'').normalize('NFKC').trim().toLowerCase();
const dishPrice=(value,currency)=>{
    const amount=String(value??'');
    if(!/^\d{1,10}(\.\d{1,4})?$/.test(amount)||Number(amount)<=0)throw Error('菜品价格格式不正确，请重新搜索。');
    return moneyMinor(amount,false,currency);
};
// One search returns every shop with its full menu; the program only checks
// counts, prices and obvious padding — variety itself stays a prompt contract.
// The ledger currency is the single settlement currency: with a ledger, the
// API must echo exactly that currency; without one, any story currency is
// allowed but checkout waits for a ledger and a fresh search.
export function validateShops(data,ledgerCurrency=null){
    const shops=data?.shops;
    if(!Array.isArray(shops)||shops.length!==FOOD_SHOP_COUNT)throw Error(`需要一次返回 ${FOOD_SHOP_COUNT} 家店铺，请重新搜索。`);
    const returned=foodText(data?.currency,20);
    if(ledgerCurrency&&returned!==ledgerCurrency)throw Error('菜单币种与账本不一致，请重新搜索。');
    const currency=ledgerCurrency||returned;
    if(!validCurrency(currency))throw Error('菜单币种无效，请重新搜索。');
    return shops.map((shop,index)=>{
        const name=foodText(shop?.name,100),cuisine=foodText(shop?.cuisine,60),description=foodText(shop?.description,200);
        if(!name)throw Error('店铺信息不完整，请重新搜索。');
        const menu=Array.isArray(shop?.menu)?shop.menu:[];
        if(menu.length<FOOD_MENU_MIN||menu.length>FOOD_MENU_MAX)throw Error(`${name} 的菜单需要 ${FOOD_MENU_MIN}—${FOOD_MENU_MAX} 道菜，请重新搜索。`);
        const seen=new Set(),categories=new Set();
        const dishes=menu.map((dish,position)=>{
            const dishName=foodText(dish?.name,150),category=foodText(dish?.category,60);
            if(!dishName||!category)throw Error(`${name} 的菜品名称或分类不完整，请重新搜索。`);
            const key=dishNameKey(dishName);
            if(seen.has(key))throw Error(`${name} 存在重复菜品，请重新搜索。`);
            seen.add(key);categories.add(dishNameKey(category));
            return {id:`foodShop:${index}#${position}`,name:dishName,category,description:foodText(dish?.description,200),priceMinor:dishPrice(dish?.price,currency)};
        });
        if(categories.size<FOOD_CATEGORY_MIN)throw Error(`${name} 的菜单至少需要 ${FOOD_CATEGORY_MIN} 个有区别的品类，请重新搜索。`);
        return {id:`foodShop:${index}`,type:'foodShop',name,cuisine,description,currency,menu:dishes};
    });
}
export function createFood({memory,phone,getContext,getSettings,paymentRequest}){
    const run=work=>phone.appTask(async(view,current,request)=>{
        const ticket=await memory.begin(view);
        const commit=async changes=>{if(!current())throw Error('聊天已变化，请重试。');await memory.commit(ticket,changes);};
        return work(view.state,current,request,commit);
    },'food');
    const foodSet=value=>({collection:'orders',key:value.id,value});
    // Selections live in one cart record; lines are snapshots, so later
    // searches never rewrite the price of something already picked.
    function changesFor(state,shopId,dishId,quantity,mode){
        if(typeof shopId!=='string'||typeof dishId!=='string')throw Error('菜品已更新，请重新选择。');
        const shop=state.orders[shopId];
        if(shop?.type!=='foodShop')throw Error('店铺已更新，请重新搜索。');
        const dish=shop.menu.find(d=>d.id===dishId);
        if(!dish)throw Error('菜品已更新，请重新选择。');
        const cart=state.orders.foodCart??{id:'foodCart',type:'foodCart',items:[]};
        const items=structuredClone(cart.items||[]);
        const line=items.find(i=>i.dishId===dishId);
        const next=mode==='add'?((line?.quantity??0)+quantity):quantity;
        if(!Number.isInteger(next)||next<0||next>99)throw Error('数量需为 0—99。');
        if(next===0){const index=items.findIndex(i=>i.dishId===dishId);if(index>=0)items.splice(index,1);}
        else if(line)line.quantity=next;
        else items.push({dishId,shopId,shopName:shop.name,cuisine:shop.cuisine,name:dish.name,category:dish.category,priceMinor:dish.priceMinor,currency:shop.currency,quantity:next});
        return [foodSet({...cart,items})];
    }
    return {
        open:()=>memory.read(),
        search(query){return run(async(state,current,request,commit)=>{
            const q=foodText(query,300);if(!q)throw Error('请输入想吃的菜系或菜品。');
            const currency=walletCurrency(state);
            const economy={currency,persona:!currency?getContext().powerUserSettings?.persona_description:undefined};
            const prompt=getSettings().prompts.general+'\n'+getSettings().prompts.food+'\n'+getSettings().prompts.foodShopping+
                '\n当前任务：榴莲外卖店铺搜索。'+(currency?'返回结果的 currency 字段必须是 '+currency+'，所有菜品一律按 '+currency+' 定价，不做汇率换算。':'尚未建立账本，请按剧情所在地和人物背景确定一个合理币种，写入返回结果的 currency 字段；结算前需要先建立账本并重新搜索。')+'想吃的东西：'+JSON.stringify(q)+'。当前资料：'+JSON.stringify(economy)+'。'+
                '\n一次性返回 '+FOOD_SHOP_COUNT+' 家符合当前世界观、地域、年代的店铺，每家 '+FOOD_MENU_MIN+'—'+FOOD_MENU_MAX+' 道独立菜品，每家覆盖至少 '+FOOD_CATEGORY_MIN+' 个有实际区别的品类；不能用同一种菜的口味、配料或烹饪变化凑数量；同一家店内菜品名称不得重复。每家店有各自的经营特色、菜系和价格档次，符合人物消费水平。菜单描述保持简短，不写买家评价。'+
                '\n只输出 JSON：{"currency":"三位货币代码","shops":[{"name":"店铺名称","cuisine":"菜系","description":"一句话简介","menu":[{"name":"菜品名称","category":"品类","description":"简短介绍","price":"数字价格"}]}]}。输出必须完整包含全部店铺和菜单，不要省略任何一家。不返回 user 已下单或付款等结论，不替 user 决定。';
            const shops=await request(prompt,data=>validateShops(data,currency),current,null,{retries:0,maxTokens:32768});
            const changes=[...foodItems(state,'foodShop').map(s=>({collection:'orders',key:s.id,value:null})),...foodItems(state,'foodCart').map(c=>({collection:'orders',key:c.id,value:null}))];
            changes.push(...shops.map(foodSet),foodSet({id:'foodSearch',type:'foodSearch',query:q,currency:shops[0]?.currency??currency}));
            await commit(changes);
        });},
        add(shopId,dishId,quantity=1){return run(async(state,_c,_r,commit)=>{await commit(changesFor(state,shopId,dishId,Number(quantity)||0,'add'));});},
        update(shopId,dishId,quantity){return run(async(state,_c,_r,commit)=>{await commit(changesFor(state,shopId,dishId,Number(quantity)||0,'set'));});},
        checkout(shopId,recipient='self',name='',paymentMethod='self',payerName=''){return run(async(state,current,request,commit)=>{
            const lines=(state.orders.foodCart?.items||[]).filter(i=>i.shopId===shopId);
            if(!lines.length)throw Error('还没有选择菜品，先挑几样想吃的吧。');
            if(paymentMethod!=='self'&&paymentMethod!=='npc')throw Error('付款方式不正确，请重新选择。');
            const npcPay=paymentMethod==='npc';
            const payer=npcPay?foodText(payerName,80):'';
            if(npcPay&&!payer)throw Error('请填写代付角色的名字。');
            const currency=walletCurrency(state);
            if(!currency)throw Error('请先在小榴莲点击「一键更新」建立账本，再重新搜索外卖。');
            if(state.orders.foodSearch?.currency!==currency)throw Error('菜单币种与账本不一致，请先重新搜索外卖再结算。');
            const context=getContext(),clock=readStoryClock(context.chat);
            if(clock.day===null)throw Error('无法确定当前剧情日期，请先在正文中写明日期再下单。');
            const self=recipient!=='other';
            const receiver=self?{id:'self',name:context.name1||'user'}:{id:'other',name:foodText(name,80)};
            if(!self&&!receiver.name)throw Error('请填写收件人的名字。');
            const totals=Object.create(null);
            for(const i of lines)totals[i.currency]=(totals[i.currency]||0)+i.priceMinor*i.quantity;
            if(Object.values(totals).some(n=>!Number.isSafeInteger(n)))throw Error('订单金额过大，请减少数量。');
            if(Object.keys(totals).some(c=>c!==currency))throw Error('菜单币种与账本不一致，请先重新搜索外卖再结算。');
            const total=totals[currency];
            const id=crypto.randomUUID(),shop=state.orders[shopId];
            if(npcPay){
                // 收件人与付款人相互独立：由 AI 判断被点名的 NPC 是否愿意代付。
                const answer=await paymentRequest.judge({request,current,app:'food',npc:payer,totalMinor:total,currency,items:lines.map(({name,quantity})=>({name,quantity})),recipientName:receiver.name});
                if(!current())throw Error('剧情或设置已变化，本次下单已取消。');
                if(!answer.accept)return {rejected:true};
            } else {
                try{requireCash(state,total,currency);}
                catch(error){
                    if(/余额不足/.test(error.message))throw Error('支付失败，余额不足。');
                    throw error;
                }
            }
            await commit([foodSet({id,type:'foodOrder',shopId,shopName:shop?.name||lines[0].shopName,cuisine:shop?.cuisine||lines[0].cuisine||'',items:lines.map(({dishId,name,category,priceMinor,currency,quantity})=>({dishId,name,category,priceMinor,currency,quantity})),totals,recipient:receiver,createdDay:clock.day,createdHour:clock.hour,sourceIndex:context.chat.length-1,createdAt:Date.now(),paymentMethod:npcPay?'npc':'self',payerName:payer,paymentStatus:'paid'}),
                foodSet({id:'foodCart',type:'foodCart',items:(state.orders.foodCart?.items||[]).filter(i=>i.shopId!==shopId)}),
                ...(npcPay?[]:[assetSet(cashRecord('foodOrder:'+id,-total,'榴莲外卖 · '+(shop?.name||lines[0].shopName),{currency,source:'food',orderId:id,day:clock.day}))])]);
            return {id};
        });},
    };
}
