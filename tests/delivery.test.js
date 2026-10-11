import test from 'node:test';
import assert from 'node:assert/strict';
import {dateDay,dayDate,readStoryClock} from '../src/story-clock.js';
import {deliveryReceipt,deliveryStatus,dueOrders,createDeliveryBridge,DELIVERY_KEY} from '../src/delivery.js';
import {JOURNAL_KEY,appendChange,revisionsFor,messageSignatures} from '../src/journal.js';
import {normalizeSettings} from '../src/config.js';
const msg=mes=>({mes,is_user:false,name:'Alex'});
const order={id:'order-1',type:'order',sourceIndex:0,createdDay:dateDay('2026-10-11'),createdHour:14,dueDay:dateDay('2026-10-13'),recipient:{id:'self',name:'Sam'},items:[{product:{name:'Coat',brand:'Brand'},variant:'Blue',quantity:1}]};
const receipt='快递员已把这件外套送到门口。';
const arrived=()=>msg(receipt+'<!--durian-delivery:'+JSON.stringify({id:order.id,arrived:true,evidence:receipt})+'-->');
const base=()=>[msg('日期：2026-10-11 14:00')];
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
test('receipt requires matching actual prose, correct order and eligible scene; deletion reopens delivery',()=>{
 const chat=[...base(),msg('2026-10-13 10:00'),arrived()];assert.equal(deliveryStatus(order,chat).delivered,true);assert.equal(dueOrders({orders:{o:order}},chat).length,0);
 chat.pop();assert.equal(deliveryStatus(order,chat).delivered,false);assert.equal(dueOrders({orders:{o:order}},chat).length,1);
 for(const m of [msg(arrived().mes.slice(receipt.length)),{...arrived(),is_user:true},{...arrived(),is_system:true},msg(arrived().mes.replace('order-1','wrong')),msg(arrived().mes.replace(receipt,'Unrelated scene.')),msg('预计明天送达这件外套。<!--durian-delivery:{"id":"order-1","arrived":true,"evidence":"预计明天送达这件外套。"}-->')])assert.equal(deliveryReceipt(order,[...chat,m]),null);
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
 const f=await fixture();try{const before=JSON.stringify(f.context.chatMetadata);await f.generate();const p=f.prompts[DELIVERY_KEY];assert.match(p.value,/Coat/);assert.match(p.value,/自然写出货物抵达/);assert.equal(p.scan,false);assert.equal(p.filter(),true);assert.equal(before,JSON.stringify(f.context.chatMetadata));await f.generate('quiet');assert.equal(f.prompts[DELIVERY_KEY].value,'');await f.generate();await f.bus.emit('GENERATION_ENDED');assert.equal(f.prompts[DELIVERY_KEY].value,'');f.settings.apps.amazon=false;await f.generate();assert.equal(f.prompts[DELIVERY_KEY].value,'');assert.equal(f.errors.length,0);}finally{f.bridge.destroy();}
});
test('delivered orders do not reinject; regeneration/deletion of arrival makes them pending again',async()=>{
 const f=await fixture();try{f.context.chat.push(arrived());await f.generate();assert.equal(f.prompts[DELIVERY_KEY].value,'');await f.generate('regenerate');assert.match(f.prompts[DELIVERY_KEY].value,/Coat/);f.context.chat.pop();await f.bus.emit('MESSAGE_DELETED');await f.generate();assert.match(f.prompts[DELIVERY_KEY].value,/Coat/);f.context.chat[0].mes='New opening';await f.generate();assert.equal(f.prompts[DELIVERY_KEY].value,'');}finally{f.bridge.destroy();}
});
test('pending bridge work and prompt filters cannot leak across chats',async()=>{
 const f=await fixture();try{await f.generate();const old=f.prompts[DELIVERY_KEY];f.context.chatMetadata={};assert.equal(old.filter(),false);await f.generate();assert.equal(f.prompts[DELIVERY_KEY].value,'');}finally{f.bridge.destroy();}
});
