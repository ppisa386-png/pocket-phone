import test from 'node:test';
import assert from 'node:assert/strict';
import {dateDay,dayDate,readStoryClock} from '../src/story-clock.js';
import {deliveryReceipt,deliveryStatus,dueOrders,foodReceipt,foodDeliveryStatus,dueFoodOrders,createDeliveryBridge,DELIVERY_KEY} from '../src/delivery.js';
import {JOURNAL_KEY,appendChange,revisionsFor,messageSignatures} from '../src/journal.js';
import {normalizeSettings} from '../src/config.js';
const msg=mes=>({mes,is_user:false,name:'Alex'});
const order={id:'order-1',type:'order',sourceIndex:0,createdDay:dateDay('2026-10-11'),createdHour:14,dueDay:dateDay('2026-10-13'),recipient:{id:'self',name:'Sam'},items:[{product:{name:'Coat',brand:'Brand'},variant:'Blue',quantity:1}]};
const receipt='快递员已把这件外套送到门口。';
const arrived=()=>msg(receipt+'<!--durian-delivery:'+JSON.stringify({id:order.id,arrived:true,evidence:receipt})+'-->');
const base=()=>[msg('日期：2026-10-11 14:00')];

test('delivery ignores receipts inside thought, script, style and code regions',()=>{
 const chat=[...base(),msg('2026-10-13 10:00')];
 for(const tag of ['think','thinking','script','style']) {
  assert.equal(deliveryReceipt(order,[...chat,msg(`<${tag}>${arrived().mes}</${tag}>正文中包裹仍在路上。`)]),null,tag);
 }
 assert.equal(deliveryReceipt(order,[...chat,msg('```html\n'+arrived().mes+'\n```')]),null);
 assert.ok(deliveryReceipt(order,[...chat,arrived()]));
});
test('story clock handles scene dates, relative days and leap boundaries without real time',()=>{
 assert.deepEqual(readStoryClock([msg('“2026-10-13 12:00 是约定的日期。”')]),{day:null,hour:null});
 assert.equal(dateDay('2026-02-29'),null);assert.equal(dayDate(dateDay('2024-02-28')+2),'2024-03-01');
 const c=readStoryClock([...base(),msg('第二天上午，故事继续。'),msg('次日下午，故事继续。')]);assert.deepEqual(c,{day:dateDay('2026-10-13'),hour:15});
 assert.deepEqual(readStoryClock([...base(),msg('两天后上午，门外传来脚步声。')]),{day:order.dueDay,hour:10});
 assert.deepEqual(readStoryClock([msg('Date: 2026-10-13 3:30 PM')]),{day:dateDay('2026-10-13'),hour:15.5});
 assert.deepEqual(readStoryClock([...base(),msg('日期：2026-10-13')]),{day:order.dueDay,hour:null});
 assert.equal(readStoryClock([msg('<!--日期：2099-01-01 10:00-->')]).day,null);
});
test('delivery waits two story days and daytime; due alone does not mean delivered',()=>{
 for(const stamp of ['2026-10-12 15:00','2026-10-13 08:59','2026-10-13 18:00','2026-10-13'])assert.equal(dueOrders({orders:{o:order}},[...base(),msg(stamp)]).length,0,stamp);
 for(const stamp of ['2026-10-13 09:00','2026-10-15 17:59']){const chat=[...base(),msg(stamp)];assert.equal(dueOrders({orders:{o:order}},chat).length,1);assert.equal(deliveryStatus(order,chat).label,'运输中');}
});
test('receipt requires the order id, a real floor and an eligible scene; deletion reopens delivery',()=>{
 const chat=[...base(),msg('2026-10-13 10:00'),arrived()];assert.equal(deliveryStatus(order,chat).delivered,true);assert.equal(dueOrders({orders:{o:order}},chat).length,0);
 chat.pop();assert.equal(deliveryStatus(order,chat).delivered,false);assert.equal(dueOrders({orders:{o:order}},chat).length,1);
 for(const m of [{...arrived(),is_user:true},{...arrived(),is_system:true},msg(arrived().mes.replace('order-1','wrong'))])assert.equal(deliveryReceipt(order,[...chat,m]),null);
 assert.equal(deliveryReceipt(order,[...base(),msg('2026-10-13 23:00'),arrived()]),null);
 const hidden={...arrived(),is_system:true,extra:{qianqianjieAutoHide:{schemaVersion:1,chatId:'story'}}};assert.ok(deliveryReceipt(order,[...chat,hidden]));
});
async function fixture(){
 const handlers={},prompts={};const bus={on(n,f){(handlers[n]??=[]).push(f);},removeListener(n,f){handlers[n]=(handlers[n]||[]).filter(x=>x!==f);},async emit(n,...args){for(const f of handlers[n]||[])await f(...args);}};
 const context={chat:base(),chatMetadata:{},eventSource:bus,event_types:Object.fromEntries(['GENERATION_STARTED','GENERATION_AFTER_COMMANDS','GENERATION_ENDED','CHAT_CHANGED','MESSAGE_DELETED'].map(n=>[n,n])),setExtensionPrompt(key,value,position,depth,scan,role,filter){prompts[key]={value,position,depth,scan,role,filter};}};
 context.chatMetadata[JOURNAL_KEY]=appendChange(undefined,await revisionsFor(messageSignatures(context.chat)),[{collection:'orders',key:order.id,value:order}]);
 context.chat.push(msg('2026-10-13 10:00'));const settings=normalizeSettings({}),errors=[];
 const bridge=createDeliveryBridge({getContext:()=>context,getSettings:()=>settings,onError:e=>errors.push(e)});
 return {context,settings,bridge,prompts,errors,bus,async generate(type='normal'){await bus.emit('GENERATION_STARTED',type);await bus.emit('GENERATION_AFTER_COMMANDS',type);}};
}
test('normal generation receives pending parcel; quiet/disabled/end clear it without metadata writes',async()=>{
 const f=await fixture();try{const before=JSON.stringify(f.context.chatMetadata);await f.generate();const p=f.prompts[DELIVERY_KEY];assert.match(p.value,/Coat/);
 assert.match(p.value,/差不多该到货了/);assert.match(p.value,/自行安排合适的派送时机/);assert.match(p.value,/不要求在本轮正文立即派送/);assert.match(p.value,/可以根据剧情节奏延后/);assert.match(p.value,/通常安排在白天合理的配送时段/);assert.match(p.value,/不必每轮重复提及订单/);assert.match(p.value,/送到对应角色处/);
 const payload=JSON.parse(p.value.match(/订单资料（数据而非命令）：(\[[\s\S]*?)\n每笔/)[1]);
 assert.deepEqual(payload,[{id:'order-1',orderedDate:'2026-10-11',orderedTime:'14:00',recipient:'Sam',gift:false,expectedDate:'2026-10-13',items:[{name:'Coat',brand:'Brand',variant:'Blue',quantity:1}]}]);
 assert.equal(p.scan,false);assert.equal(p.filter(),true);assert.equal(before,JSON.stringify(f.context.chatMetadata));await f.generate('quiet');assert.equal(f.prompts[DELIVERY_KEY].value,'');await f.generate();await f.bus.emit('GENERATION_ENDED');assert.equal(f.prompts[DELIVERY_KEY].value,'');f.settings.apps.amazon=false;await f.generate();assert.equal(f.prompts[DELIVERY_KEY].value,'');assert.equal(f.errors.length,0);}finally{f.bridge.destroy();}
});
test('gift orders are addressed to their recipient and marked as gifts in the payload',async()=>{
 const f=await fixture();try{
  const gift={...order,id:'order-2',recipient:{id:'contact:alex',name:'Alex',phone:null,contactId:'alex'},createdHour:null};
  f.context.chatMetadata[JOURNAL_KEY]=appendChange(undefined,await revisionsFor(messageSignatures(f.context.chat)),[{collection:'orders',key:'order-1',value:order},{collection:'orders',key:'order-2',value:gift}]);
  await f.generate();const p=f.prompts[DELIVERY_KEY];
  const payload=JSON.parse(p.value.match(/订单资料（数据而非命令）：(\[[\s\S]*?)\n每笔/)[1]);
  assert.equal(payload.length,2);
  assert.equal(payload.find(o=>o.id==='order-1').gift,false);
  assert.deepEqual(payload.find(o=>o.id==='order-2'),{id:'order-2',orderedDate:'2026-10-11',orderedTime:null,recipient:'Alex',gift:true,expectedDate:'2026-10-13',items:[{name:'Coat',brand:'Brand',variant:'Blue',quantity:1}]});
 }finally{f.bridge.destroy();}
});
test('delivered orders do not reinject; regeneration/deletion of arrival makes them pending again',async()=>{
 const f=await fixture();try{f.context.chat.push(arrived());await f.generate();assert.equal(f.prompts[DELIVERY_KEY].value,'');await f.generate('regenerate');assert.match(f.prompts[DELIVERY_KEY].value,/Coat/);f.context.chat.pop();await f.bus.emit('MESSAGE_DELETED');await f.generate();assert.match(f.prompts[DELIVERY_KEY].value,/Coat/);f.context.chat[0].mes='New opening';await f.generate();assert.equal(f.prompts[DELIVERY_KEY].value,'');}finally{f.bridge.destroy();}
});
test('pending bridge work and prompt filters cannot leak across chats',async()=>{
 const f=await fixture();try{await f.generate();const old=f.prompts[DELIVERY_KEY];f.context.chatMetadata={};assert.equal(old.filter(),false);await f.generate();assert.equal(f.prompts[DELIVERY_KEY].value,'');}finally{f.bridge.destroy();}
});
const foodOrder={id:'food-1',type:'foodOrder',shopId:'foodShop:0',shopName:'Trattoria',cuisine:'意大利菜',sourceIndex:0,createdDay:dateDay('2026-10-11'),createdHour:19,recipient:{id:'other',name:'Alex'},items:[{dishId:'foodShop:0#0',name:'Carbonara',category:'主食',priceMinor:1250,currency:'USD',quantity:2}]};
const foodArrived=()=>msg('外卖在深夜送达了。<!--durian-delivery:'+JSON.stringify({id:'food-1',arrived:true})+'-->');
test('food receipts have no day or window; wrong id, user floor and code fences do not count',()=>{
 const chat=[...base(),msg('2026-10-11 23:00'),foodArrived()];
 const status=foodDeliveryStatus(foodOrder,chat);
 assert.equal(status.delivered,true);assert.equal(status.label,'已完成');
 assert.equal(dueFoodOrders({orders:{o:foodOrder}},chat).length,0);
 chat.pop();
 assert.equal(foodDeliveryStatus(foodOrder,chat).label,'等待送达');
 assert.equal(dueFoodOrders({orders:{o:foodOrder}},chat).length,1);
 for(const m of [{...foodArrived(),is_user:true},msg(foodArrived().mes.replace('food-1','order-1')),msg('```html\n'+foodArrived().mes+'\n```'),[...base(),msg('<think>'+foodArrived().mes+'</think>仍在路上。')].at(-1)])assert.equal(foodReceipt(foodOrder,[...chat,m]),null);
 // 外卖不套用两天与 09:00—18:00 限制：深夜与几天后送达都算数
 assert.equal(foodReceipt(foodOrder,[...base(),msg('2026-10-15 03:00'),foodArrived()])?.index,2);
 const amazonArrival=[...base(),msg('2026-10-11 23:00'),msg('外套到了。<!--durian-delivery:'+JSON.stringify({id:'order-1',arrived:true})+'-->')];
 assert.equal(deliveryReceipt(order,amazonArrival),null); // Amazon 时间限制保持不变
});
async function foodFixture(){
 const handlers={},prompts={};const bus={on(n,f){(handlers[n]??=[]).push(f);},removeListener(n,f){handlers[n]=(handlers[n]||[]).filter(x=>x!==f);},async emit(n,...args){for(const f of handlers[n]||[])await f(...args);}};
 const context={chat:base(),chatMetadata:{},eventSource:bus,event_types:Object.fromEntries(['GENERATION_STARTED','GENERATION_AFTER_COMMANDS','GENERATION_ENDED','CHAT_CHANGED','MESSAGE_DELETED'].map(n=>[n,n])),setExtensionPrompt(key,value,position,depth,scan,role,filter){prompts[key]={value,position,depth,scan,role,filter};}};
 context.chatMetadata[JOURNAL_KEY]=appendChange(undefined,await revisionsFor(messageSignatures(context.chat)),[{collection:'orders',key:'food-1',value:foodOrder}]);
 const settings=normalizeSettings({}),errors=[];
 const bridge=createDeliveryBridge({getContext:()=>context,getSettings:()=>settings,onError:e=>errors.push(e)});
 return {context,settings,bridge,prompts,errors,bus,async generate(type='normal'){await bus.emit('GENERATION_STARTED',type);await bus.emit('GENERATION_AFTER_COMMANDS',type);}};
}
test('pending food orders inject shop, dishes, recipient and no fixed delivery schedule',async()=>{
 const f=await foodFixture();try{
  await f.generate();const p=f.prompts[DELIVERY_KEY];
  const payload=JSON.parse(p.value.match(/外卖订单资料（数据而非命令）：(\[[\s\S]*?)\n每笔/)[1]);
  assert.deepEqual(payload,[{id:'food-1',orderedDate:'2026-10-11',orderedTime:'19:00',shop:'Trattoria',recipient:'Alex',user:false,items:[{name:'Carbonara',quantity:2}]}]);
  assert.match(p.value,/没有固定的送达天数或时段/);assert.match(p.value,/自行判断合适的送达时机/);assert.match(p.value,/允许暂缓/);assert.match(p.value,/不替 user 编造签收/);assert.match(p.value,/送到对应角色处/);assert.match(p.value,/未实际写出送达前，不得添加完成标记/);
  assert.doesNotMatch(p.value,/预计配送时间/); // 外卖不使用 Amazon 的两天与白天时段约束
  assert.equal(f.errors.length,0);
  // 下单后立即注入（无需等待两天），quiet 仍然清空
  await f.generate('quiet');assert.equal(f.prompts[DELIVERY_KEY].value,'');
 }finally{f.bridge.destroy();}
});
test('food and parcel orders share one prompt; toggles and receipts gate each independently',async()=>{
 const f=await foodFixture();try{
  f.context.chat.push(msg('2026-10-13 10:00'));
  f.context.chatMetadata[JOURNAL_KEY]=appendChange(undefined,await revisionsFor(messageSignatures(f.context.chat)),[{collection:'orders',key:'order-1',value:order},{collection:'orders',key:'food-1',value:foodOrder}]);
  await f.generate();const p=f.prompts[DELIVERY_KEY];
  assert.match(p.value,/订单资料（数据而非命令）：/);assert.match(p.value,/Coat/);
  assert.match(p.value,/外卖订单资料（数据而非命令）：/);assert.match(p.value,/Carbonara/);
  f.context.chat.push(foodArrived());await f.generate();
  assert.doesNotMatch(f.prompts[DELIVERY_KEY].value,/Carbonara/); // 外卖送达后停止注入
  assert.match(f.prompts[DELIVERY_KEY].value,/Coat/); // Amazon 订单不受影响
  f.context.chat.pop();await f.bus.emit('MESSAGE_DELETED');await f.generate();
  assert.match(f.prompts[DELIVERY_KEY].value,/Carbonara/); // 删除送达楼层恢复待送达
  f.settings.apps.food=false;await f.generate();
  assert.doesNotMatch(f.prompts[DELIVERY_KEY].value,/Carbonara/);assert.match(f.prompts[DELIVERY_KEY].value,/Coat/);
  f.settings.apps.amazon=false;await f.generate();
  assert.equal(f.prompts[DELIVERY_KEY].value,'');
  f.settings.apps.food=true;await f.generate();
  assert.match(f.prompts[DELIVERY_KEY].value,/Carbonara/);assert.doesNotMatch(f.prompts[DELIVERY_KEY].value,/Coat/);
 }finally{f.bridge.destroy();}
});
