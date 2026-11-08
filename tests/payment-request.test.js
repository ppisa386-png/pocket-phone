// NPC 代付：Amazon 与榴莲外卖共用的判断请求、结果处理与订单记录。
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createPhoneMemory} from '../src/memory.js';
import {createPhoneService} from '../src/phone.js';
import {createAmazon,shopItems} from '../src/amazon.js';
import {createFood,foodItems} from '../src/food.js';
import {createPaymentRequest} from '../src/payment-request.js';
import {assetRows} from '../src/assets-core.js';
import {normalizeSettings} from '../src/config.js';
const product={name:'Alhambra necklace',brand:'Van Cleef & Arpels',luxury:true,price:'2800.50',currency:'USD',variants:['Gold'],reviews:[]};
const shopsPayload=(currency='USD',per=24)=>({currency,shops:Array.from({length:10},(_,i)=>({name:'Shop '+i,cuisine:'C '+i,description:'s'+i,menu:Array.from({length:per},(_,j)=>({name:'Dish '+i+'-'+j,category:'类'+(j%6),description:'',price:String(3+(i+j)%17)+'.50'}))}))});
const ok=r=>assert.equal(r?.ok,true,r?.error);
// 共用底座：generateQuietPrompt 按提示词分派——代付判断返回 judgment，其余按需返回。
function setup({accept=true,fail=null,judgment}={}){
 const bus=new EventEmitter();const answers={judgment:judgment??{accept},fail};
 const respond=prompt=>prompt.includes('NPC 代付判断')?(answers.fail?Promise.reject(answers.fail):JSON.stringify(answers.judgment)):prompt.includes('榴莲外卖店铺搜索')?JSON.stringify(answers.shops??shopsPayload()):JSON.stringify({products:[product]});
 let count=0;const prompts=[];
 const context={chatId:'pay',name1:'Sam',name2:'Alex',characterId:0,characters:[{name:'Alex',avatar:'alex.png'}],chat:[{mes:'日期：2026-10-11 14:00\nAlex 和 Sam 吃饭。',is_user:false}],chatMetadata:{},saveMetadata:async()=>{},onlineStatus:'connected',eventSource:bus,event_types:Object.fromEntries(['CHAT_CHANGED','MESSAGE_DELETED','MESSAGE_EDITED','GENERATION_STARTED','GENERATION_ENDED'].map(x=>[x,x])),generateQuietPrompt:async o=>{count++;prompts.push(o.quietPrompt);return respond(o.quietPrompt);}};
 const settings=normalizeSettings({retries:0}),memory=createPhoneMemory({getContext:()=>context}),phone=createPhoneService({memory,getContext:()=>context,getSettings:()=>settings});
 const paymentRequest=createPaymentRequest({getContext:()=>context,getSettings:()=>settings});
 const amazon=createAmazon({memory,phone,getContext:()=>context,getSettings:()=>settings,paymentRequest});
 const food=createFood({memory,phone,getContext:()=>context,getSettings:()=>settings,paymentRequest});
 return {context,bus,settings,memory,phone,amazon,food,state:()=>phone.snapshot(),count:()=>count,prompts:()=>prompts,replyJudgment:j=>answers.judgment=j,replyFail:e=>answers.fail=e,replyShops:p=>answers.shops=p,close(){phone.destroy();memory.destroy();}};
}
async function seedWallet(f,openingMinor=1000000){const ticket=await f.memory.begin();await f.memory.commit(ticket,[{collection:'assets',key:'wallet',value:{id:'wallet',type:'wallet',openingMinor,included:[],startDay:0}}]);}
const judgmentPrompt=prompts=>prompts.find(p=>p.includes('NPC 代付判断'));

test('Amazon NPC 代付被接受：订单创建为已支付，不动用户余额，判断请求只发一次且带记忆与人名',async()=>{
 const f=setup();try{
  await seedWallet(f);
  ok(await f.amazon.search('项链'));const p=shopItems(f.state(),'product')[0];
  ok(await f.amazon.add(p.id,'Gold',1));
  const balanceBefore=assetRows(f.state(),'cash_transaction').reduce((s,t)=>s+t.deltaMinor,0);
  ok(await f.amazon.checkout('self','2026-10-11','14:00','npc','小美'));
  assert.equal(f.count(),2); // 搜索一次＋代付判断一次
  const order=shopItems(f.state(),'order')[0];
  assert.equal(order.paymentMethod,'npc');assert.equal(order.payerName,'小美');assert.equal(order.paymentStatus,'paid');
  assert.equal(order.totals.USD,280050);
  assert.equal(assetRows(f.state(),'cash_transaction').length,0); // 不扣款、不记收入、不虚构转账
  assert.equal(f.state().orders.cart.items.length,0); // 购物车正常清空
  const prompt=judgmentPrompt(f.prompts());
  assert.match(prompt,/请付款人 "小美" 代为支付/);assert.match(prompt,/付款人：小美/);assert.match(prompt,/收件人：Sam/);assert.match(prompt,/Alhambra necklace/);assert.match(prompt,/2,800\.50/);assert.match(prompt,/"accept":true/);
  assert.match(prompt,/已保存剧情记忆补充/); // readXMemory 结果经 xMemoryPrompt 纳入同一次请求
 }finally{f.close();}
});
test('Amazon NPC 拒绝：指定文案返回 rejected，订单、购物车与余额原状；换自己付款照常扣款',async()=>{
 const f=setup({accept:false});try{
  await seedWallet(f,500000);
  ok(await f.amazon.search('项链'));const p=shopItems(f.state(),'product')[0];
  ok(await f.amazon.add(p.id,'Gold',1));
  const refused=await f.amazon.checkout('self','2026-10-11','14:00','npc','小美');
  assert.equal(refused.ok,true);assert.equal(refused.value.rejected,true);
  assert.equal(shopItems(f.state(),'order').length,0); // 不创建订单
  assert.equal(f.state().orders.cart.items.length,1); // 购物车保留
  assert.equal(assetRows(f.state(),'cash_transaction').length,0); // 不扣款
  ok(await f.amazon.checkout('self','2026-10-11','14:00','self'));
  assert.equal(shopItems(f.state(),'order')[0].paymentMethod,'self');assert.equal(shopItems(f.state(),'order')[0].payerName,'');
  assert.equal(assetRows(f.state(),'cash_transaction').length,1); // 自己付款照常扣款
 }finally{f.close();}
});
test('AI 请求失败或格式错误：真实错误透传且不是拒绝，无订单无付款记录',async()=>{
 const f=setup({fail:new Error('等待酒馆生成回复超时')});try{
  await seedWallet(f);ok(await f.amazon.search('项链'));const p=shopItems(f.state(),'product')[0];ok(await f.amazon.add(p.id,'Gold',1));
  const failed=await f.amazon.checkout('self','2026-10-11','14:00','npc','小美');
  assert.equal(failed.ok,false);assert.match(failed.error,/等待酒馆生成回复超时/);
  assert.equal(shopItems(f.state(),'order').length,0);assert.equal(f.state().orders.cart.items.length,1);
  f.replyFail(null);f.replyJudgment({accept:'yes'});
  const bad=await f.amazon.checkout('self','2026-10-11','14:00','npc','小美');
  assert.equal(bad.ok,false);assert.match(bad.error,/代付回应格式不正确/);
  assert.equal(shopItems(f.state(),'order').length,0);assert.equal(assetRows(f.state(),'cash_transaction').length,0);
  // 拒绝与失败都保留原选择：可换自己付款完成
  f.replyJudgment({accept:true});
  ok(await f.amazon.checkout('self','2026-10-11','14:00','self'));
  assert.equal(shopItems(f.state(),'order').length,1);
 }finally{f.close();}
});
test('Amazon 收件人与付款人独立：买给 Alex 由小美代付，奢侈品登记仍按收件人判断',async()=>{
 const f=setup();try{
  await seedWallet(f);
  ok(await f.amazon.search('项链'));const p=shopItems(f.state(),'product')[0];
  ok(await f.amazon.add(p.id,'Gold',1));
  ok(await f.amazon.checkout('card:0','2026-10-11','14:00','npc','小美'));
  const order=shopItems(f.state(),'order')[0];
  assert.equal(order.recipient.name,'Alex');assert.equal(order.recipient.id,'card:0');
  assert.equal(order.payerName,'小美');assert.equal(order.paymentMethod,'npc');
  assert.equal(assetRows(f.state(),'holding').length,0); // 买给别人的奢侈品不计入 user 资产（按收货人判断，与付款人无关）
  assert.equal(assetRows(f.state(),'cash_transaction').length,0);
  // NPC 代付、user 收货：商品资产照常登记给 user
  ok(await f.amazon.add(p.id,'Gold',1));
  ok(await f.amazon.checkout('self','2026-10-11','14:00','npc','小美'));
  assert.equal(assetRows(f.state(),'holding').length,1); // 奢侈品由 user 收取即登记
  assert.equal(assetRows(f.state(),'cash_transaction').length,0); // 但费用由 NPC 承担
 }finally{f.close();}
});
test('榴莲外卖 NPC 代付：币种校验先于判断请求；接受后建单免扣款；拒绝保留已选',async()=>{
 const f=setup();try{
  await seedWallet(f);
  ok(await f.food.search('外卖'));const shops=foodItems(f.state(),'foodShop');
  const shop=shops[0];
  ok(await f.food.add(shop.id,shop.menu[0].id,2));
  // 余额不足本会阻止自己付款，但代付判断在扣款检查之前发起，接受即建单
  ok(await f.food.checkout(shop.id,'other','Alex','npc','小美'));
  assert.equal(f.count(),2); // 搜索一次＋判断一次
  let order=foodItems(f.state(),'foodOrder')[0];
  assert.equal(order.paymentMethod,'npc');assert.equal(order.payerName,'小美');assert.equal(order.paymentStatus,'paid');
  assert.equal(order.recipient.name,'Alex');assert.equal(order.recipient.id,'other');
  assert.equal(assetRows(f.state(),'cash_transaction').length,0);
  assert.equal(f.state().orders.foodCart.items.length,0);
  const prompt=judgmentPrompt(f.prompts());
  assert.match(prompt,/请付款人 "小美" 代为支付/);assert.match(prompt,/收件人：Alex/);assert.match(prompt,/Dish 0-0/);assert.match(prompt,/已保存剧情记忆补充/);
  // 拒绝：已选保留、无订单
  ok(await f.food.add(shop.id,shop.menu[1].id));
  f.replyJudgment({accept:false});
  const refused=await f.food.checkout(shop.id,'self','','npc','小美');
  assert.equal(refused.ok,true);assert.equal(refused.value.rejected,true);
  assert.equal(foodItems(f.state(),'foodOrder').length,1);
  assert.equal(f.state().orders.foodCart.items.length,1);
  assert.equal(assetRows(f.state(),'cash_transaction').length,0);
  // 自己付款不受影响：扣款照旧
  ok(await f.food.checkout(shop.id,'self','','self'));
  assert.equal(foodItems(f.state(),'foodOrder').length,2);
  assert.equal(foodItems(f.state(),'foodOrder')[1].paymentMethod,'self');
  assert.equal(assetRows(f.state(),'cash_transaction').length,1);
 }finally{f.close();}
});
test('外卖账本或菜单币种不一致时直接拒绝结算，不发起代付判断请求',async()=>{
 const f=setup();try{
  f.replyShops(shopsPayload('SGD'));
  ok(await f.food.search('外卖')); // 未建账，按剧情货币 SGD 生成
  assert.equal(f.state().orders.foodSearch.currency,'SGD');
  const shop=foodItems(f.state(),'foodShop')[0];
  ok(await f.food.add(shop.id,shop.menu[0].id));
  await seedWallet(f); // 建账为 USD
  const before=f.count();
  const blocked=await f.food.checkout(shop.id,'self','','npc','小美');
  assert.equal(blocked.ok,false);assert.match(blocked.error,/菜单币种与账本不一致/);
  assert.equal(f.count(),before); // 不发判断请求
  assert.equal(foodItems(f.state(),'foodOrder').length,0);
 }finally{f.close();}
});
test('付款人名字缺失被拒绝且不请求模型；NPC 代付订单随楼层回退',async()=>{
 const f=setup();try{
  await seedWallet(f);ok(await f.food.search('外卖'));const shop=foodItems(f.state(),'foodShop')[0];
  ok(await f.food.add(shop.id,shop.menu[0].id));
  const missing=await f.food.checkout(shop.id,'self','','npc','  ');
  assert.equal(missing.ok,false);assert.match(missing.error,/请填写代付角色的名字/);
  assert.equal(f.count(),1); // 未发判断请求
  f.context.chat.push({mes:'日期：2026-10-11 15:00',is_user:false});await f.memory.read();
  ok(await f.food.checkout(shop.id,'self','','npc','小美'));
  assert.equal(foodItems(f.state(),'foodOrder').length,1);
  f.context.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();
  assert.equal(foodItems(f.state(),'foodOrder').length,0); // 订单与回退照常
  assert.equal(assetRows(f.state(),'cash_transaction').length,0);
 }finally{f.close();}
});
