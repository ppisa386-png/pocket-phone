import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createPhoneMemory} from '../src/memory.js';
import {createPhoneService} from '../src/phone.js';
import {createAmazon,shopItems,validateProducts} from '../src/amazon.js';
import {createAmazonPanel} from '../src/amazon-view.js';
import {assetRows} from '../src/assets-core.js';
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
async function fill(f,qty=2){const ticket=await f.memory.begin();await f.memory.commit(ticket,[{collection:'assets',key:'wallet',value:{id:'wallet',type:'wallet',openingMinor:1000000,included:[],startDay:0}}]);ok(await f.amazon.search('项链'));const p=shopItems(f.state(),'product')[0];ok(await f.amazon.add(p.id,'Gold',qty));return p;}
test('shopping search uses one shared request, preserves cart snapshots across catalogs, and local checkout needs no API',async()=>{
 const f=setup();try{
 await f.amazon.open();assert.equal(f.count(),0);const p=await fill(f);assert.equal(f.count(),1);assert.match(f.prompt(),/消费水平/);assert.match(f.prompt(),/奢侈品必须/);
 f.reply({products:[{...product,name:'Another necklace',price:'100'}]});ok(await f.amazon.search('别的项链'));assert.equal(f.state().orders.cart.items[0].product.name,p.name);
 ok(await f.amazon.checkout());const order=shopItems(f.state(),'order')[0];assert.equal(order.totals.USD,560100);assert.equal(order.dueDay,dateDay('2026-10-13'));assert.equal(order.recipient.name,'Sam');assert.equal(order.recipient.id,'self');assert.equal(f.state().orders.cart.items.length,0);assert.equal(f.count(),2);
 }finally{f.close();}
});
test('recipient matching works from cards, contacts and single names without contact records or phone numbers',async()=>{
 const f=setup();try{
  await fill(f);
  // 当前角色卡即为候选：完全没有联系人记录也能收礼。
  assert.deepEqual(await f.amazon.recipientMatches('alex'),{kind:'unique',matches:[{key:'card:0',name:'Alex'}]});
  assert.deepEqual(await f.amazon.recipientMatches('Alex'),{kind:'unique',matches:[{key:'card:0',name:'Alex'}]});
  ok(await f.amazon.checkout('card:0'));
  const card=shopItems(f.state(),'order')[0];
  assert.equal(card.recipient.name,'Alex');assert.equal(card.recipient.id,'card:0');assert.equal(card.recipient.phone,null);assert.equal(card.recipient.characterId,0);
  assert.equal(assetRows(f.state(),'holding').length,0); // 买给别人的奢侈品不计入 user 资产
  assert.equal(f.count(),1); // 匹配与下单均为本地计算，不新增模型请求
  // 联系人无号码也可收礼；单个名字、别名片段均可匹配完整姓名。
  const ticket=await f.memory.begin();await f.memory.commit(ticket,[
   {collection:'contacts',key:'alice',value:{id:'alice',name:'亚历山大·加兰',aliases:['Alex Garland'],number:'+1 555 0100'}},
   {collection:'contacts',key:'a1',value:{id:'a1',name:'小美一',aliases:['Mimi'],number:null}},
   {collection:'contacts',key:'a2',value:{id:'a2',name:'小美二',aliases:['Mimi'],number:null}}]);
  assert.deepEqual(await f.amazon.recipientMatches('加兰'),{kind:'unique',matches:[{key:'contact:alice',name:'亚历山大·加兰'}]});
  assert.deepEqual(await f.amazon.recipientMatches('garland'),{kind:'unique',matches:[{key:'contact:alice',name:'亚历山大·加兰'}]});
  assert.deepEqual(await f.amazon.recipientMatches('亚历山大·加兰'),{kind:'unique',matches:[{key:'contact:alice',name:'亚历山大·加兰'}]});
  // 重名：多个候选时返回 ambiguous 供气泡选择，不擅自下单。
  assert.deepEqual(await f.amazon.recipientMatches('小美'),{kind:'ambiguous',matches:[{key:'contact:a1',name:'小美一'},{key:'contact:a2',name:'小美二'}]});
  assert.deepEqual(await f.amazon.recipientMatches('alex'),{kind:'ambiguous',matches:[{key:'contact:alice',name:'亚历山大·加兰'},{key:'card:0',name:'Alex'}]});
  assert.deepEqual(await f.amazon.recipientMatches('不存在'),{kind:'none',matches:[]});
  // 地点联系人不是收件角色。
  await f.memory.commit(await f.memory.begin(),[{collection:'contacts',key:'loc:shop',value:{id:'loc:shop',name:'街角商店',contactKind:'location',number:null}}]);
  assert.deepEqual(await f.amazon.recipientMatches('街角商店'),{kind:'none',matches:[]});
  await fill(f,1);ok(await f.amazon.checkout('contact:alice'));
  const gift=shopItems(f.state(),'order').find(o=>o.recipient.id==='contact:alice');
  assert.equal(gift.recipient.name,'亚历山大·加兰');assert.equal(gift.recipient.phone,'+1 555 0100');assert.equal(gift.recipient.contactId,'alice');
  assert.equal(assetRows(f.state(),'holding').length,0);
  assert.equal((await f.amazon.checkout('nobody')).ok,false);
 }finally{f.close();}
});
test('unknown date requires checkout date, quantities are constrained, disabled app cannot buy',async()=>{
 const f=setup();try{f.context.chat[0].mes='No date specified';const p=await fill(f);assert.equal((await f.amazon.checkout()).ok,false);assert.equal((await f.amazon.add(p.id,'Gold',100)).ok,false);assert.equal((await f.amazon.checkout('self','2026-02-30')).ok,false);ok(await f.amazon.checkout('self','2026-12-31','23:30'));const order=shopItems(f.state(),'order')[0];assert.equal(order.dueDay,dateDay('2027-01-02'));assert.equal(assetRows(f.state(),'holding').length,1);f.settings.apps.amazon=false;assert.equal((await f.amazon.search('coat')).ok,false);}finally{f.close();}
});
test('delete checkout floor restores cart; deletion and chat switch reject pending products',async()=>{
 const f=setup();try{
 await fill(f);f.context.chat.push({mes:'日期：2026-10-12 12:00',is_user:false});await f.memory.read();ok(await f.amazon.checkout());assert.equal(shopItems(f.state(),'order').length,1);
 f.context.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();assert.equal(shopItems(f.state(),'order').length,0);assert.equal(f.state().orders.cart.items.length,1);
 let finish,start;const started=new Promise(r=>start=r);f.reply(()=>{start();return new Promise(r=>finish=r);});const request=f.amazon.search('coat');await started;f.context.chatId='other';f.context.chatMetadata={};f.bus.emit('CHAT_CHANGED');await f.memory.read();finish(JSON.stringify({products:[product]}));assert.equal((await request).ok,false);assert.equal(shopItems(f.state(),'product').length,0);
 }finally{f.close();}
});
test('gift order rolls back with its floor and keeps recipient matching local',async()=>{
 const f=setup();try{
  await fill(f);f.context.chat.push({mes:'日期：2026-10-12 12:00',is_user:false});await f.memory.read();
  ok(await f.amazon.checkout('card:0'));const before=f.count();
  assert.equal(shopItems(f.state(),'order').length,1);
  assert.deepEqual(await f.amazon.recipientMatches('alex'),{kind:'unique',matches:[{key:'card:0',name:'Alex'}]});
  assert.equal(f.count(),before); // 已有订单待配送时匹配仍是本地计算
  f.context.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();
  assert.equal(shopItems(f.state(),'order').length,0);assert.equal(f.state().orders.cart.items.length,1);assert.equal(f.count(),before);
 }finally{f.close();}
});
test('invalid prices and missing luxury brand are rejected',()=>{for(const p of [{...product,price:'-1'},{...product,price:'1.001'},{...product,brand:''}])assert.throws(()=>validateProducts({products:[p]}));});
test('checkout bubble: two steps, unique confirm, ambiguous pick and re-enter on miss',async()=>{
 const OriginalFormData=globalThis.FormData;
 let fields=new Map([['date','2026-10-11'],['time','14:00']]);
 globalThis.FormData=class{constructor(){return fields;}};
 let matches={kind:'none',matches:[]};const calls=[];
 const adapter={storyChat:()=>[{mes:'日期：2026-10-11 14:00',is_user:false}],userName:()=>'Sam',
  amazon:{async recipientMatches(query){calls.push(['match',query]);return matches;},
   async checkout(...args){calls.push(['checkout',...args]);return {ok:true,id:'o1'};}}};
 const state=()=>({busy:false,orders:{cart:{items:[{id:'i',product:{name:'项链',brand:'',luxury:true,priceMinor:1000,currency:'USD'},variant:'',quantity:1}]}}});
 const panel=createAmazonPanel({adapter,getView:state,redraw(){},notice:m=>{throw Error('不应出现提示：'+m);}});
 try{
  await panel.action('tab','cart');
  assert.doesNotMatch(panel.html(),/pp-shop-bubble/);
  // 点击确认结算先弹第一步气泡，不直接下单。
  await panel.submit({dataset:{shopForm:'checkout'}});
  let page=panel.html();
  assert.match(page,/role="dialog" aria-label="选择收货对象"/);assert.match(page,/寄到自己的地址/);assert.match(page,/收件人是 Sam/);assert.match(page,/买给别人/);
  assert.deepEqual(calls,[]);
  // 自己的地址：收件人 user，沿用表单中的剧情日期时间。
  await panel.action('gift-self');
  assert.deepEqual(calls,[['checkout','self','2026-10-11','14:00']]);calls.length=0;
  assert.doesNotMatch(panel.html(),/pp-shop-bubble/);
  // 买给别人：唯一匹配直接确认，输入查询原样传给本地匹配。
  matches={kind:'unique',matches:[{key:'card:0',name:'Alex'}]};
  await panel.action('tab','cart');
  await panel.submit({dataset:{shopForm:'checkout'}});
  await panel.action('gift-other');
  assert.match(panel.html(),/aria-label="买给别人"/);assert.match(panel.html(),/输入角色名/);
  fields=new Map([['date','2026-10-11'],['time','14:00'],['giftName','alex']]);
  await panel.submit({dataset:{shopForm:'gift-name'}});
  assert.deepEqual(calls,[['match','alex'],['checkout','card:0','2026-10-11','14:00']]);calls.length=0;
  assert.doesNotMatch(panel.html(),/pp-shop-bubble/);
  // 重名：弹出候选气泡，点击候选后以其 key 下单。
  fields=new Map([['date','2026-10-11'],['time','14:00'],['giftName','小美']]);
  matches={kind:'ambiguous',matches:[{key:'contact:a1',name:'小美一'},{key:'contact:a2',name:'小美二'}]};
  await panel.action('tab','cart');
  await panel.submit({dataset:{shopForm:'checkout'}});
  await panel.action('gift-other');
  panel.input({dataset:{shopField:'giftName'},value:'小美'});
  await panel.submit({dataset:{shopForm:'gift-name'}});
  page=panel.html();
  assert.match(page,/aria-label="选择角色"/);assert.match(page,/小美一/);assert.match(page,/小美二/);assert.match(page,/重新输入/);
  await panel.action('gift-pick','contact:a2');
  assert.deepEqual(calls,[['match','小美'],['checkout','contact:a2','2026-10-11','14:00']]);calls.length=0;
  // 找不到：停留在输入步并提示重新输入，不下单。
  matches={kind:'none',matches:[]};
  await panel.action('tab','cart');
  await panel.submit({dataset:{shopForm:'checkout'}});
  await panel.action('gift-other');
  await panel.submit({dataset:{shopForm:'gift-name'}});
  page=panel.html();
  assert.match(page,/没有找到这个角色，请重新输入/);assert.match(page,/aria-label="买给别人"/);
  assert.deepEqual(calls,[['match','小美']]);
  // 取消关闭气泡；上一步回到收货对象选择。
  await panel.action('gift-back');
  assert.match(panel.html(),/aria-label="选择收货对象"/);
  await panel.action('gift-cancel');
  assert.doesNotMatch(panel.html(),/pp-shop-bubble/);
  assert.deepEqual(calls,[['match','小美']]);
  // 失败反馈留在气泡内，状态可重试。
  adapter.amazon.checkout=async()=>({ok:false,error:'可用余额不足。'});
  matches={kind:'unique',matches:[{key:'card:0',name:'Alex'}]};
  await panel.action('tab','cart');
  await panel.submit({dataset:{shopForm:'checkout'}});
  await panel.action('gift-self');
  page=panel.html();
  assert.match(page,/可用余额不足/);assert.match(page,/aria-label="选择收货对象"/);
  panel.reset();
  assert.doesNotMatch(panel.html(),/pp-shop-bubble/);
 }finally{globalThis.FormData=OriginalFormData;}
});
