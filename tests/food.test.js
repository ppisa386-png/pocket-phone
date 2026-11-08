import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createPhoneMemory} from '../src/memory.js';
import {createPhoneService} from '../src/phone.js';
import {createFood,foodItems,validateShops,FOOD_SHOP_COUNT,FOOD_MENU_MIN,FOOD_MENU_MAX} from '../src/food.js';
import {createFoodPanel} from '../src/food-view.js';
import {assetRows} from '../src/assets-core.js';
import {normalizeSettings} from '../src/config.js';
import {dateDay} from '../src/story-clock.js';
const CATEGORIES=['主食','汤品','小食','饮品','甜品','特色'];
const cuisineNames=['意大利菜','日料','汉堡','奶茶甜品','泰国菜','墨西哥菜','中餐','印度菜','希腊菜','韩式炸鸡'];
const shopsPayload=(currency='USD',per=24)=>({currency,shops:Array.from({length:FOOD_SHOP_COUNT},(_,i)=>({name:'Shop '+i,cuisine:cuisineNames[i%cuisineNames.length],description:'Shop number '+i,menu:Array.from({length:per},(_,j)=>({name:'Dish '+i+'-'+j,category:CATEGORIES[j%CATEGORIES.length],description:'Tasty',price:String(3+(i+j)%17)+'.50'}))}))});
function setup(response=shopsPayload()){
 const bus=new EventEmitter();let count=0,prompt='';
 const context={chatId:'takeout',name1:'Sam',name2:'Alex',characterId:0,characters:[{name:'Alex',avatar:'alex.png'}],chat:[{mes:'日期：2026-10-11 12:00\nAlex 提到饿了。',is_user:false}],chatMetadata:{},saveMetadata:async()=>{},onlineStatus:'connected',eventSource:bus,event_types:Object.fromEntries(['CHAT_CHANGED','MESSAGE_DELETED','MESSAGE_EDITED','GENERATION_STARTED','GENERATION_ENDED'].map(x=>[x,x])),generateQuietPrompt:async o=>{count++;prompt=o.quietPrompt;return typeof response==='function'?response():JSON.stringify(response);}};
 const settings=normalizeSettings({retries:0}),memory=createPhoneMemory({getContext:()=>context}),phone=createPhoneService({memory,getContext:()=>context,getSettings:()=>settings}),food=createFood({memory,phone,getContext:()=>context,getSettings:()=>settings});
 return {context,bus,settings,memory,phone,food,state:()=>phone.snapshot(),reply:r=>response=r,count:()=>count,prompt:()=>prompt,close(){phone.destroy();memory.destroy();}};
}
const ok=r=>assert.equal(r?.ok,true,r?.error);
async function seedWallet(f,openingMinor=1000000){const ticket=await f.memory.begin();await f.memory.commit(ticket,[{collection:'assets',key:'wallet',value:{id:'wallet',type:'wallet',openingMinor,included:[],startDay:0}}]);}
async function fill(f,per=24){await seedWallet(f);ok(await f.food.search('夜宵'));return foodItems(f.state(),'foodShop');}

test('一次搜索只发一次请求，十家店铺与完整菜单进入缓存，重开手机不重复请求',async()=>{
 const f=setup();try{
  await f.food.open();assert.equal(f.count(),0);
  ok(await f.food.search('意大利菜'));assert.equal(f.count(),1);
  assert.match(f.prompt(),/一次性返回 10 家/);assert.match(f.prompt(),/20—30 道独立菜品/);assert.match(f.prompt(),/至少 5 个有实际区别的品类/);assert.match(f.prompt(),/菜品名称不得重复/);assert.match(f.prompt(),/不能用同一种菜的口味、配料或烹饪变化凑数量/);
  const shops=foodItems(f.state(),'foodShop');
  assert.equal(shops.length,FOOD_SHOP_COUNT);
  for(const shop of shops){
   assert.ok(shop.menu.length>=FOOD_MENU_MIN&&shop.menu.length<=FOOD_MENU_MAX,shop.name+' menu size');
   assert.ok(new Set(shop.menu.map(d=>d.category)).size>=5,shop.name+' categories');
   assert.ok(shop.menu.every(d=>Number.isSafeInteger(d.priceMinor)&&d.priceMinor>0));
  }
  assert.equal(f.state().orders.foodSearch.query,'意大利菜');
  await f.memory.read();await f.food.open();await f.memory.read();
  assert.equal(f.count(),1); // 进店铺、回首页、重开手机都不再请求
 }finally{f.close();}
});
test('独立 API 下搜索使用本次请求级输出上限且不自动重试',async()=>{
 const calls=[];let payload=shopsPayload();
 const bus=new EventEmitter();
 const context={chatId:'food',name1:'Sam',name2:'Alex',characterId:0,characters:[{name:'Alex',avatar:'a.png'}],chat:[{mes:'日期：2026-10-11 12:00',is_user:false}],chatMetadata:{},saveMetadata:async()=>{},onlineStatus:'connected',eventSource:bus,event_types:{},getRequestHeaders:()=>({'Content-Type':'application/json'})};
 const settings=normalizeSettings({retries:0,api:{mode:'independent',baseUrl:'https://api.example/v1',model:'fixture'}});
 const modelClient={async generate(prompt,contact,isCurrent,report,options){calls.push({prompt,options});return JSON.stringify(payload);}};
 const memory=createPhoneMemory({getContext:()=>context}),phone=createPhoneService({memory,getContext:()=>context,getSettings:()=>settings,modelClient});
 const food=createFood({memory,phone,getContext:()=>context,getSettings:()=>settings});
 try{
  ok(await food.search('奶茶'));
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.maxTokens,32768); // 本次请求级输出上限
  const state=phone.snapshot();
  assert.equal(foodItems(state,'foodShop').length,FOOD_SHOP_COUNT);
  assert.equal(state.orders.foodSearch.currency,'USD');
 }finally{phone.destroy();memory.destroy();}
});
test('菜单校验拒绝数量、品类、重复名称与价格问题',()=>{
 const good=shopsPayload();
 assert.equal(validateShops(good).length,FOOD_SHOP_COUNT);
 assert.throws(()=>validateShops({...good,shops:good.shops.slice(0,9)}),/10 家店铺/);
 const few=structuredClone(good);few.shops[0].menu=few.shops[0].menu.slice(0,19);assert.throws(()=>validateShops(few),/20—30 道菜/);
 const many=structuredClone(good);many.shops[2].menu.push(...many.shops[2].menu.slice(0,7));assert.throws(()=>validateShops(many),/20—30 道菜/);
 const cats=structuredClone(good);for(const dish of cats.shops[4].menu)dish.category='主食';assert.throws(()=>validateShops(cats),/5 个有区别的品类/);
 const dup=structuredClone(good);dup.shops[3].menu[5].name=dup.shops[3].menu[4].name;assert.throws(()=>validateShops(dup),/重复菜品/);
 assert.throws(()=>validateShops({...good,currency:'XXY'}),/币种/);
 assert.throws(()=>validateShops(shopsPayload('EUR'),'USD'),/菜单币种与账本不一致/); // 返回币种必须与账本一致
 const bad=structuredClone(good);bad.shops[1].menu[0].price='0';assert.throws(()=>validateShops(bad));
 const neg=structuredClone(good);neg.shops[1].menu[0].price='-3';assert.throws(()=>validateShops(neg));
 const unnamed=structuredClone(good);unnamed.shops[1].menu[0].name='  ';assert.throws(()=>validateShops(unnamed));
 const uncategorized=structuredClone(good);uncategorized.shops[1].menu[0].category='';assert.throws(()=>validateShops(uncategorized));
});
test('每家店铺独立选菜与结算，本人下单和点给别人都不需要联系人记录',async()=>{
 const f=setup();try{
  const shops=await fill(f);
  const a=shops[0],b=shops[1];
  ok(await f.food.add(a.id,a.menu[0].id,2));
  ok(await f.food.add(a.id,a.menu[1].id));
  ok(await f.food.update(a.id,a.menu[0].id,3));
  ok(await f.food.add(b.id,b.menu[0].id));
  const cart=()=>f.state().orders.foodCart.items;
  assert.equal(cart().find(i=>i.dishId===a.menu[0].id).quantity,3);
  ok(await f.food.checkout(a.id));
  const order=foodItems(f.state(),'foodOrder')[0];
  const expected=a.menu[0].priceMinor*3+a.menu[1].priceMinor;
  assert.equal(order.type,'foodOrder');
  assert.equal(order.totals.USD,expected);
  assert.equal(order.shopId,a.id);assert.equal(order.shopName,a.name);assert.equal(order.cuisine,a.cuisine);
  assert.equal(order.recipient.id,'self');assert.equal(order.recipient.name,'Sam');
  assert.equal(order.createdDay,dateDay('2026-10-11'));
  assert.equal(order.sourceIndex,0);
  assert.equal(cart().length,1);assert.equal(cart()[0].shopId,b.id); // 只清空本店已选
  const cash=assetRows(f.state(),'cash_transaction');
  assert.equal(cash.length,1);assert.equal(cash[0].deltaMinor,-expected);assert.equal(cash[0].source,'food');assert.equal(cash[0].orderId,order.id);assert.equal(cash[0].currency,'USD');
  assert.equal(f.count(),1); // 选菜、合计与结算均为本地计算
  ok(await f.food.checkout(b.id,'other','Alex'));
  const gift=foodItems(f.state(),'foodOrder').find(o=>o.recipient.id==='other');
  assert.equal(gift.recipient.name,'Alex'); // 输入的名字原样保存
  assert.ok(gift.items.every(i=>i.dishId.startsWith(b.id+'#'))); // 一笔订单不混合店铺
  assert.equal(cart().length,0);
  assert.equal(f.count(),1);
 }finally{f.close();}
});
test('余额不足不创建订单不扣款；未建账与待结算支出沿用小榴莲提示',async()=>{
 const f=setup();try{
  ok(await f.food.search('外卖'));
  const shop=foodItems(f.state(),'foodShop')[0];
  ok(await f.food.add(shop.id,shop.menu[0].id));
  const noWallet=await f.food.checkout(shop.id);
  assert.equal(noWallet.ok,false);assert.match(noWallet.error,/建立账本/);
  assert.equal(foodItems(f.state(),'foodOrder').length,0);
  await seedWallet(f,100); // $1.00，不够一份 3.50 起的菜
  const failed=await f.food.checkout(shop.id);
  assert.equal(failed.ok,false);assert.equal(failed.error,'支付失败，余额不足。');
  assert.equal(foodItems(f.state(),'foodOrder').length,0);
  assert.equal(assetRows(f.state(),'cash_transaction').length,0);
  assert.equal(f.state().orders.foodCart.items.length,1); // 已选保留，可充值后再买
  const ticket=await f.memory.begin();
  await f.memory.commit(ticket,[{collection:'assets',key:'ev',value:{id:'ev',type:'story_event',kind:'expense',processed:false,currency:'USD',amountMinor:null,day:null}}]);
  const pending=await f.food.checkout(shop.id);
  assert.equal(pending.ok,false);assert.match(pending.error,/待结算的支出/);
 }finally{f.close();}
});
test('无法确定剧情日期时不能下单',async()=>{
 const f=setup();try{
  f.context.chat[0].mes='Alex 提到饿了。';await f.memory.read();
  const shops=await fill(f);
  ok(await f.food.add(shops[0].id,shops[0].menu[0].id));
  const result=await f.food.checkout(shops[0].id);
  assert.equal(result.ok,false);assert.match(result.error,/剧情日期/);
  assert.equal(foodItems(f.state(),'foodOrder').length,0);
 }finally{f.close();}
});
test('删除下单楼层时订单与扣款随剧情回退，已选状态恢复',async()=>{
 const f=setup();try{
  const shops=await fill(f);
  ok(await f.food.add(shops[0].id,shops[0].menu[0].id,2));
  f.context.chat.push({mes:'日期：2026-10-11 13:00',is_user:false});await f.memory.read();
  ok(await f.food.checkout(shops[0].id));
  assert.equal(foodItems(f.state(),'foodOrder').length,1);
  assert.equal(assetRows(f.state(),'cash_transaction').length,1);
  f.context.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();
  assert.equal(foodItems(f.state(),'foodOrder').length,0);
  assert.equal(assetRows(f.state(),'cash_transaction').length,0);
  assert.equal(f.state().orders.foodCart.items.length,1);
 }finally{f.close();}
});
test('新搜索替换店铺与菜单并清空已选，但不影响已有订单和扣款',async()=>{
 const f=setup();try{
  const shops=await fill(f);
  ok(await f.food.add(shops[0].id,shops[0].menu[0].id));
  ok(await f.food.checkout(shops[0].id));
  f.reply(shopsPayload('USD',25));
  ok(await f.food.search('火锅'));
  assert.equal(f.state().orders.foodSearch.query,'火锅');
  assert.equal(foodItems(f.state(),'foodShop').length,FOOD_SHOP_COUNT);
  assert.ok(foodItems(f.state(),'foodShop').every(shop=>shop.menu.length===25));
  assert.equal(foodItems(f.state(),'foodOrder').length,1); // 订单保留
  assert.equal(assetRows(f.state(),'cash_transaction').length,1); // 扣款保留
  assert.ok(!f.state().orders.foodCart?.items?.length); // 未结算的已选随菜单替换清空
  assert.equal(f.count(),2);
 }finally{f.close();}
});
test('未建账时按剧情货币浏览，结算前必须建账并重新搜索；账本币种不一致同样拒绝',async()=>{
 const f=setup();try{
  f.reply(shopsPayload('SGD'));
  ok(await f.food.search('外卖')); // 未建账：允许按剧情货币生成菜单
  assert.equal(f.state().orders.foodSearch.currency,'SGD');
  const shops=foodItems(f.state(),'foodShop');
  ok(await f.food.add(shops[0].id,shops[0].menu[0].id,2));
  const blocked=await f.food.checkout(shops[0].id);
  assert.equal(blocked.ok,false);assert.match(blocked.error,/建立账本/);assert.match(blocked.error,/重新搜索/);
  assert.equal(foodItems(f.state(),'foodOrder').length,0);
  await seedWallet(f); // 建账后账本币种为 USD，与 SGD 菜单不一致，仍不能结算
  const mismatch=await f.food.checkout(shops[0].id);
  assert.equal(mismatch.ok,false);assert.match(mismatch.error,/菜单币种与账本不一致/);
  assert.equal(assetRows(f.state(),'cash_transaction').length,0);
  f.reply(shopsPayload('USD'));
  ok(await f.food.search('外卖')); // 重新搜索后菜单币种与账本一致
  assert.equal(f.state().orders.foodSearch.currency,'USD');
  const fresh=foodItems(f.state(),'foodShop');
  ok(await f.food.add(fresh[0].id,fresh[0].menu[0].id));
  ok(await f.food.checkout(fresh[0].id));
  assert.equal(foodItems(f.state(),'foodOrder').length,1);
 }finally{f.close();}
});
test('店铺页选菜、底栏合计与两步收件气泡',async()=>{
 const OriginalFormData=globalThis.FormData;
 let fields=new Map();
 globalThis.FormData=class{constructor(){return fields;}};
 const calls=[];let checkoutFail=false,cartLines=[];
 const shopRecord={id:'foodShop:0',type:'foodShop',name:'Trattoria',cuisine:'意大利菜',description:'Home pasta',currency:'USD',menu:[
  {id:'foodShop:0#0',name:'Carbonara',category:'主食',description:'Egg and guanciale',priceMinor:1250},
  {id:'foodShop:0#1',name:'Tiramisu',category:'甜品',description:'',priceMinor:650}]};
 const adapter={storyChat:()=>[{mes:'日期：2026-10-11 12:00',is_user:false}],userName:()=>'Sam',
  food:{
   async add(shopId,dishId,quantity){calls.push(['add',shopId,dishId,quantity]);
    const dish=shopRecord.menu.find(d=>d.id===dishId),line=cartLines.find(i=>i.dishId===dishId);
    if(line)line.quantity+=quantity;else cartLines.push({dishId,shopId,shopName:shopRecord.name,cuisine:shopRecord.cuisine,name:dish.name,category:dish.category,priceMinor:dish.priceMinor,currency:'USD',quantity});
    return {ok:true};},
   async update(shopId,dishId,quantity){calls.push(['update',shopId,dishId,quantity]);
    if(!quantity)cartLines=cartLines.filter(i=>i.dishId!==dishId);
    else{const line=cartLines.find(i=>i.dishId===dishId);if(line)line.quantity=quantity;}
    return {ok:true};},
   async search(...args){calls.push(['search',...args]);return {ok:true};},
   async checkout(shopId,recipient,name,method,payerName){calls.push(['checkout',shopId,recipient,name,method,payerName]);
    if(checkoutFail)return {ok:false,error:'支付失败，余额不足。'};
    cartLines=cartLines.filter(i=>i.shopId!==shopId);return {ok:true,id:'o1'};}}};
 const state=()=>({busy:false,error:'',errorKind:null,orders:{foodSearch:{query:'pasta'},'foodShop:0':shopRecord,foodCart:{id:'foodCart',type:'foodCart',items:cartLines}}});
 const panel=createFoodPanel({adapter,getView:state,redraw(){},notice:m=>{throw Error('不应出现提示：'+m);}});
 try{
  let page=panel.html();
  assert.match(page,/今天想吃什么呢/);assert.match(page,/Trattoria/);assert.match(page,/低至 \$6\.50/);
  await panel.action('shop','foodShop:0');
  page=panel.html();
  assert.match(page,/Carbonara/);assert.match(page,/Egg and guanciale/);assert.match(page,/\$12\.50/);
  assert.match(page,/aria-label="加一份 Carbonara"/);
  assert.doesNotMatch(page,/pp-shop-bubble/);
  await panel.action('inc','foodShop:0#0');
  await panel.action('inc','foodShop:0#0');
  page=panel.html();
  assert.match(page,/aria-label="已选 2 份"/);
  assert.match(page,/\$25\.00/); // 底栏合计 12.50 × 2
  await panel.action('inc','foodShop:0#1');
  await panel.action('dec','foodShop:0#0');
  page=panel.html();
  assert.match(page,/aria-label="已选 1 份"/);
  assert.match(page,/\$19\.00/); // 12.50 + 6.50
  // 购买先弹收件气泡，再弹付款方式气泡，不直接下单
  await panel.action('buy');
  page=panel.html();
  assert.match(page,/role="dialog" aria-label="选择收件人"/);assert.match(page,/送到这里来/);assert.match(page,/收件人：Sam/);assert.match(page,/点给别人吃/);
  assert.deepEqual(calls.filter(c=>c[0]==='checkout'),[]);
  await panel.action('gift-self');
  page=panel.html();
  assert.match(page,/role="dialog" aria-label="选择付款方式"/);assert.match(page,/自己付款/);assert.match(page,/请 TA 代付/);
  await panel.action('pay-self');
  assert.deepEqual(calls.filter(c=>c[0]==='checkout'),[['checkout','foodShop:0','self','','self','']]);
  assert.doesNotMatch(panel.html(),/pp-shop-bubble/);
  assert.match(panel.html(),/你的订单/);
  // 点给别人：空名字留在气泡内提示；填名字进付款方式；NPC 代付输入名字原样传给下单
  await panel.action('tab','home');await panel.action('shop','foodShop:0');
  await panel.action('inc','foodShop:0#0'); // 上一单成功后清空了本店已选，重新选一份
  await panel.action('buy');
  await panel.action('gift-other');
  page=panel.html();
  assert.match(page,/aria-label="点给别人吃"/);assert.match(page,/收件人名字/);assert.match(page,/上一步/);
  fields=new Map([['foodName','   ']]);
  await panel.submit({dataset:{foodForm:'gift-name'}});
  assert.match(panel.html(),/请填写收件人的名字/);
  assert.equal(calls.filter(c=>c[0]==='checkout').length,1);
  fields=new Map([['foodName','Alex']]);
  panel.input({dataset:{foodField:'foodName'},value:'Alex'});
  await panel.submit({dataset:{foodForm:'gift-name'}});
  assert.match(panel.html(),/aria-label="选择付款方式"/);
  await panel.action('pay-npc');
  page=panel.html();
  assert.match(page,/aria-label="请 NPC 代付"/);assert.match(page,/代付角色名字/);
  fields=new Map([['foodName','Alex'],['payerName','小美']]);
  panel.input({dataset:{foodField:'payerName'},value:'小美'});
  await panel.submit({dataset:{foodForm:'payer-name'}});
  assert.deepEqual(calls.filter(c=>c[0]==='checkout'),[['checkout','foodShop:0','self','','self',''],['checkout','foodShop:0','other','Alex','npc','小美']]);
  assert.doesNotMatch(panel.html(),/pp-shop-bubble/);
  // NPC 拒绝：回到付款方式选择，可换方式重试
  checkoutFail=true;
  adapter.food.checkout=async(...args)=>{calls.push(['checkout',...args]);return checkoutFail?{ok:true,value:{rejected:true}}:{ok:true,id:'o1'};};
  await panel.action('tab','home');await panel.action('shop','foodShop:0');
  cartLines=[{dishId:'foodShop:0#0',shopId:'foodShop:0',shopName:shopRecord.name,name:'Carbonara',category:'主食',priceMinor:1250,currency:'USD',quantity:1}];
  await panel.action('buy');await panel.action('gift-self');
  await panel.action('pay-npc');
  fields=new Map([['payerName','小美']]);
  await panel.submit({dataset:{foodForm:'payer-name'}});
  page=panel.html();
  assert.match(page,/对方拒绝了你的代付要求/);assert.match(page,/aria-label="选择付款方式"/);
  checkoutFail=false;
  await panel.action('pay-self');
  assert.doesNotMatch(panel.html(),/pp-shop-bubble/);
  // 请求失败：真实错误留在气泡内，可重试；取消和上一步正常
  adapter.food.checkout=async(...args)=>{calls.push(['checkout',...args]);return {ok:false,error:'连接已超时'};};
  await panel.action('tab','home');await panel.action('shop','foodShop:0');
  cartLines=[{dishId:'foodShop:0#0',shopId:'foodShop:0',shopName:shopRecord.name,name:'Carbonara',category:'主食',priceMinor:1250,currency:'USD',quantity:1}];
  await panel.action('buy');await panel.action('gift-self');
  await panel.action('pay-self');
  page=panel.html();
  assert.match(page,/连接已超时/);assert.match(page,/aria-label="选择付款方式"/);
  await panel.action('gift-cancel');
  assert.doesNotMatch(panel.html(),/pp-shop-bubble/);
  panel.reset();
  assert.doesNotMatch(panel.html(),/pp-shop-bubble/);
 }finally{globalThis.FormData=OriginalFormData;}
});
