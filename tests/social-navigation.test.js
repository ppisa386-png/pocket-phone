import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnapPanel } from '../src/snapchat-view.js';
import { createXPanel } from '../src/x-view.js';

const account={id:'a',type:'account',name:'Alex',handle:'alex',friend:'friends',dmPolicy:'open'};
const state={snapchat:{a:account,m:{id:'m',type:'message',accountId:'a',role:'assistant',text:'Hello',kind:'text',createdAt:1},s:{id:'s',type:'story',author:'a',name:'Alex',kind:'image',text:'A story',createdAt:1,comments:[]}},x:{a:account,p:{id:'p',type:'post',author:'a',text:'A post',feed:'square'}}};
const options=()=>({adapter:{},getView:()=>state,redraw(){},notice(){}});

test('Snapchat top back unwinds editing, transfer and conversation before leaving the app',async()=>{
 const panel=createSnapPanel(options());assert.equal(panel.back(),false);
 await panel.action('thread','a');await panel.action('edit-message','m');
 assert.match(panel.html(),/data-snap-form="edit-message"/);
 assert.equal(panel.back(),true);assert.doesNotMatch(panel.html(),/data-snap-form="edit-message"/);assert.match(panel.html(),/data-snap-form="message"/);
 await panel.action('cash');assert.match(panel.html(),/data-snap-form="cash"/);
 assert.equal(panel.back(),true);assert.doesNotMatch(panel.html(),/data-snap-form="cash"/);assert.match(panel.html(),/data-snap-form="message"/);
 assert.equal(panel.back(),true);assert.match(panel.html(),/data-snap-form="search"/);assert.equal(panel.back(),false);
});

test('Snapchat account settings and story comments return to their own tab and do not revive old editors',async()=>{
 const panel=createSnapPanel(options());await panel.action('thread','a');await panel.action('edit-message','m');
 await panel.action('profile');assert.equal(panel.back(),true);assert.match(panel.html(),/data-snap-form="search"/);
 await panel.action('thread','a');assert.doesNotMatch(panel.html(),/data-snap-form="edit-message"/);
 await panel.action('tab','stories');await panel.action('comment','s');assert.match(panel.html(),/data-snap-form="comment"/);
 assert.equal(panel.back(),true);assert.doesNotMatch(panel.html(),/data-snap-form="comment"/);assert.match(panel.html(),/data-snap-tab="stories"/);assert.equal(panel.back(),false);
 await panel.action('profile');assert.equal(panel.back(),true);assert.match(panel.html(),/data-snap-tab="stories"/);
});

test('X top back returns conversations, profiles and comments to the relevant list',async()=>{
 const panel=createXPanel(options());assert.equal(panel.back(),false);
 await panel.action('thread','a');assert.match(panel.html(),/data-x-form="message"/);
 assert.equal(panel.back(),true);assert.match(panel.html(),/data-x-page="messages::"/);assert.equal(panel.back(),false);
 await panel.action('tab','search');await panel.action('account','a');assert.equal(panel.back(),true);assert.match(panel.html(),/data-x-form="search"/);
 await panel.action('tab','square');await panel.action('comments','p');assert.match(panel.html(),/data-x-form="comment"/);
 assert.equal(panel.back(),true);assert.doesNotMatch(panel.html(),/data-x-form="comment"/);assert.match(panel.html(),/data-x-page="square::"/);
 await panel.action('profile');assert.equal(panel.back(),true);assert.match(panel.html(),/data-x-page="square::"/);assert.equal(panel.back(),false);
});

test('late Snapchat queue completion cannot send a message after switching chats',async()=>{
 let finish,flushes=0;
 const panel=createSnapPanel({...options(),adapter:{snapchat:{queueMessage:()=>new Promise(r=>finish=r),flushMessages:async()=>{flushes++;return {ok:true};}}}});
 const OriginalFormData=globalThis.FormData;globalThis.FormData=class {constructor(){return new Map();}};
 try {
  await panel.action('thread','a');panel.input({dataset:{snapField:'message'},value:'Old chat message'});
  const pending=panel.submit({dataset:{snapForm:'message'}});panel.reset();finish({ok:true});await pending;
  assert.equal(flushes,0,'switching chats cancels the old send pipeline');
  assert.doesNotMatch(panel.html(),/Old chat message/);
  assert.match(panel.html(),/type="submit">新增联系人/, 'search is not locked by the retired request');
 }finally{globalThis.FormData=OriginalFormData;}
});

test('late Snapchat transfer result cannot settle money in another chat',async()=>{
 let finish,settlements=0;
 const panel=createSnapPanel({...options(),adapter:{snapchat:{transfer:()=>new Promise(r=>finish=r),settle:async()=>{settlements++;return {ok:true};}}}});
 const OriginalFormData=globalThis.FormData;globalThis.FormData=class {constructor(){return new Map([['amount','5'],['currency','USD'],['memo','Lunch']]);}};
 try {
  await panel.action('thread','a');await panel.action('cash');const pending=panel.submit({dataset:{snapForm:'cash'}});
  panel.reset();finish({ok:true,value:'old-transfer'});await pending;assert.equal(settlements,0);
 }finally{globalThis.FormData=OriginalFormData;}
});

test('late Snapchat failure and pending indicators stay in their original chat',async()=>{
 let finish;
 const panel=createSnapPanel({...options(),adapter:{snapchat:{refresh:()=>new Promise(r=>finish=r)}}});
 await panel.action('tab','stories');const pending=panel.action('refresh');panel.reset();
 assert.match(panel.html(),/type="submit">新增联系人/,'new chat search is not left waiting on a retired panel request');
 finish({ok:false,error:'OLD_CHAT_ERROR'});await pending;assert.doesNotMatch(panel.html(),/OLD_CHAT_ERROR/);
});

test('X reset clears the retired pending indicator without unlocking a newer request',async()=>{
 const releases=[];
 const panel=createXPanel({...options(),adapter:{x:{refresh:()=>new Promise(r=>releases.push(r))}}});
 const old=panel.action('refresh');panel.reset();assert.doesNotMatch(panel.html(),/正在处理/);
 const next=panel.action('refresh');assert.equal(releases.length,2);
 releases[0]({ok:true});await old;assert.match(panel.html(),/正在处理/,'the retired request cannot finish the current spinner');
 releases[1]({ok:true});await next;assert.doesNotMatch(panel.html(),/正在处理/);
});


test('Snapchat selection is local, retries retain selection, reset clears it',async()=>{
 let calls=0,selected;const state={snapchat:{a:{id:'a',type:'account',name:'A',handle:'a',friend:'none'},b:{id:'b',type:'account',name:'B',handle:'b',friend:'pending'}}};
 const panel=createSnapPanel({...options(),getView:()=>state,adapter:{snapchat:{inviteMany:async ids=>{calls++;selected=ids;return {ok:false,error:'Try later'};}}}});
 panel.input({dataset:{snapSelect:'a'},checked:true});panel.input({dataset:{snapSelect:'b'},checked:true});assert.equal(calls,0);assert.match(panel.html(),/添加（2）/);
 await panel.action('add-selected');assert.equal(calls,1);assert.deepEqual(selected,['a','b']);assert.match(panel.html(),/添加（2）/);
 panel.reset();assert.match(panel.html(),/添加（0）/);assert.doesNotMatch(panel.html(),/ checked/);
});
