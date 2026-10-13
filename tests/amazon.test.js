import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createPhoneMemory} from '../src/memory.js';
import {createPhoneService} from '../src/phone.js';
import {createAmazon,shopItems,validateProducts} from '../src/amazon.js';
import {normalizeSettings} from '../src/config.js';
import {dateDay} from '../src/story-clock.js';
const product={name:'Alhambra necklace',brand:'Van Cleef & Arpels',luxury:true,price:'2800.50',currency:'USD',variants:['Gold','Silver'],reviews:[{name:'Ivy',rating:4,text:'Lovely clasp.'}]};
function setup(){
 const bus=new EventEmitter();let response={products:[product]},count=0,prompt='';
 const context={chatId:'shopping',name1:'Sam',name2:'Alex',characterId:0,characters:[{name:'Alex',avatar:'alex.png'}],chat:[{mes:'日期：2026-10-11 14:00\nAlex gives you a number.',is_user:false}],chatMetadata:{},saveMetadata:async()=>{},onlineStatus:'connected',eventSource:bus,event_types:Object.fromEntries(['CHAT_CHANGED','MESSAGE_DELETED','MESSAGE_EDITED','GENERATION_STARTED','GENERATION_ENDED'].map(x=>[x,x])),generateQuietPrompt:async o=>{count++;prompt=o.quietPrompt;return typeof response==='function'?response():JSON.stringify(response);}};
 const settings=normalizeSettings({retries:0}),memory=createPhoneMemory({getContext:()=>context}),phone=createPhoneService({memory,getContext:()=>context,getSettings:()=>settings}),amazon=createAmazon({memory,phone,getContext:()=>context,getSettings:()=>settings});
 return {context,bus,settings,memory,phone,amazon,state:()=>phone.snapshot(),reply:r=>response=r,count:()=>count,prompt:()=>prompt,close(){phone.destroy();memory.destroy();}};
}
const ok=r=>assert.equal(r?.ok,true,r?.error);
async function fill(f){const ticket=await f.memory.begin();await f.memory.commit(ticket,[{collection:'assets',key:'wallet',value:{id:'wallet',type:'wallet',openingMinor:1000000,included:[],startDay:0}}]);ok(await f.amazon.search('项链'));const p=shopItems(f.state(),'product')[0];ok(await f.amazon.add(p.id,'Gold',2));return p;}
test('shopping search uses one shared request, preserves cart snapshots across catalogs, and local checkout needs no API',async()=>{
 const f=setup();try{
 await f.amazon.open();assert.equal(f.count(),0);const p=await fill(f);assert.equal(f.count(),1);assert.match(f.prompt(),/消费水平/);assert.match(f.prompt(),/奢侈品必须/);
 f.reply({products:[{...product,name:'Another necklace',price:'100'}]});ok(await f.amazon.search('别的项链'));assert.equal(f.state().orders.cart.items[0].product.name,p.name);
 ok(await f.amazon.checkout());const order=shopItems(f.state(),'order')[0];assert.equal(order.totals.USD,560100);assert.equal(order.dueDay,dateDay('2026-10-13'));assert.equal(order.recipient.name,'Sam');assert.equal(f.state().orders.cart.items.length,0);assert.equal(f.count(),2);
 }finally{f.close();}
});
test('gift requires an existing telephone contact but not digits or address; legacy non-USD quotes cannot bypass USD balance',async()=>{
 const f=setup();try{
 await fill(f);assert.equal((await f.amazon.checkout('unknown')).ok,false);const ticket=await f.memory.begin();await f.memory.commit(ticket,[{collection:'contacts',key:'alex',value:{id:'alex',name:'Alex',number:null}}]);
 f.reply({products:[{...product,price:'50.25',currency:'EUR'}]});assert.equal((await f.amazon.search('礼物')).ok,false);f.reply({products:[{...product,price:'50.25',currency:'USD'}]});ok(await f.amazon.search('礼物'));const p=shopItems(f.state(),'product')[0];ok(await f.amazon.add(p.id,'Silver',1));ok(await f.amazon.checkout('alex'));const order=shopItems(f.state(),'order')[0];assert.deepEqual(order.totals,{USD:565125});assert.equal(order.recipient.name,'Alex');assert.equal(f.count(),3);
 }finally{f.close();}
});
test('unknown date requires checkout date, quantities are constrained, disabled app cannot buy',async()=>{
 const f=setup();try{f.context.chat[0].mes='No date specified';const p=await fill(f);assert.equal((await f.amazon.checkout()).ok,false);assert.equal((await f.amazon.add(p.id,'Gold',100)).ok,false);assert.equal((await f.amazon.checkout('self','2026-02-30')).ok,false);ok(await f.amazon.checkout('self','2026-12-31','23:30'));const order=shopItems(f.state(),'order')[0];assert.equal(order.dueDay,dateDay('2027-01-02'));f.settings.apps.amazon=false;assert.equal((await f.amazon.search('coat')).ok,false);}finally{f.close();}
});
test('delete checkout floor restores cart; deletion and chat switch reject pending products',async()=>{
 const f=setup();try{
 await fill(f);f.context.chat.push({mes:'日期：2026-10-12 12:00',is_user:false});await f.memory.read();ok(await f.amazon.checkout());assert.equal(shopItems(f.state(),'order').length,1);
 f.context.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();assert.equal(shopItems(f.state(),'order').length,0);assert.equal(f.state().orders.cart.items.length,1);
 let finish,start;const started=new Promise(r=>start=r);f.reply(()=>{start();return new Promise(r=>finish=r);});const request=f.amazon.search('coat');await started;f.context.chatId='other';f.context.chatMetadata={};f.bus.emit('CHAT_CHANGED');await f.memory.read();finish(JSON.stringify({products:[product]}));assert.equal((await request).ok,false);assert.equal(shopItems(f.state(),'product').length,0);
 }finally{f.close();}
});
test('invalid prices and missing luxury brand are rejected',()=>{for(const p of [{...product,price:'-1'},{...product,price:'1.001'},{...product,brand:''}])assert.throws(()=>validateProducts({products:[p]}));});
