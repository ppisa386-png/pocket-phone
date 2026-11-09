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
 const panel=createXPanel({...options(),adapter:{x:{refreshPublic:()=>new Promise(r=>releases.push(r))}}});
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

test('story refresh control locks, reopens only for unchecked user stories, and shows friend reactions',async()=>{
 const view={revision:'r',snapchat:{a:account}};const panel=createSnapPanel({adapter:{},getView:()=>view,redraw(){},notice(){}});await panel.action('tab','stories');
 assert.match(panel.html(),/刷新好友故事/);view.snapchat.storyRefresh={id:'storyRefresh',type:'story_refresh',revision:'r'};
 assert.match(panel.html(),/aria-label="本回合已刷新"[^>]*disabled/);
 view.snapchat.story={id:'story',type:'story',author:'user',name:'You',kind:'image',text:'Sunset',createdAt:Date.now(),comments:[]};assert.match(panel.html(),/查看新故事互动/);
 Object.assign(view.snapchat.story,{reactionsChecked:true,friendLikes:['a'],comments:[{accountId:'a',name:'Alex',text:'Great!（真棒！）'}]});
 assert.match(panel.html(),/aria-label="本回合已刷新"[^>]*disabled/);assert.match(panel.html(),/Alex 赞了这条故事/);assert.match(panel.html(),/Great!（真棒！）/);
 view.revision='next';assert.match(panel.html(),/刷新好友故事/);
});

test('X home displays posts without duplicate recommendation cards and opens account controls locally',async()=>{
 const view={x:{a:{...account,recommended:true,bio:'Account biography'},p:{id:'p',type:'post',author:'a',text:'Recommended post'}}};
 const panel=createXPanel({...options(),getView:()=>view});
 assert.match(panel.html(),/Recommended post/);assert.doesNotMatch(panel.html(),/Account biography|pp-x-recommendations|data-x-action="follow"/);
 assert.match(panel.html(),/class="pp-x-post-avatar" data-x-action="account" data-x-id="a"/);
 await panel.action('account','a');assert.match(panel.html(),/Account biography/);assert.match(panel.html(),/data-x-action="follow"/);assert.match(panel.html(),/data-x-action="thread"/);
 panel.back();assert.match(panel.html(),/Recommended post/);assert.doesNotMatch(panel.html(),/Account biography/);
 await panel.action('tab','search');assert.match(panel.html(),/查看主页/);assert.doesNotMatch(panel.html(),/data-x-action="follow"|data-x-action="thread"/);
});

test('X search trends open original user posts and return locally, with escaped content and no automatic refresh',async()=>{
 let calls=0;const state={x:{p:{id:'p',type:'post',author:'user',text:'My original post'},'trend-edition':{id:'trend-edition',type:'trends',topics:[{title:'<img src=x>',summary:'<script>no</script>',scope:'Local',postCount:1000,sourcePostIds:['p']}]}}};
 const panel=createXPanel({getView:()=>state,redraw(){},notice(){},adapter:{x:{refreshTrends:async()=>{calls++;return {ok:true};}}}});
 await panel.action('tab','search');assert.match(panel.html(),/趋势/);assert.match(panel.html(),/&lt;img/);assert.doesNotMatch(panel.html(),/<script>/);assert.equal(calls,0);
 await panel.action('comments','p');assert.match(panel.html(),/My original post/);assert.equal(panel.back(),true);assert.match(panel.html(),/data-x-trend="0"/);assert.equal(calls,0);
 await panel.action('edit-page');assert.match(panel.html(),/保存修改/);assert.equal(calls,0);panel.reset();assert.doesNotMatch(panel.html(),/data-x-trend="0"/);
});

test('X home lock persists on user turns; pencils on home, square, search and only a specific DM conversation',async()=>{
 const chat=[{mes:'scene'},{is_user:true,mes:'wait'}];
 const state={x:{'public-refresh':{floor:0},a:{id:'a',type:'account',name:'A',handle:'a'},m:{id:'m',type:'message',accountId:'a',role:'user',text:'private thread'}}};
 const p=createXPanel({getView:()=>state,adapter:{storyChat:()=>chat},redraw(){},notice(){}});
 assert.doesNotMatch(p.html(),/data-x-action="refresh"[^>]*disabled/),'legacy marker does not lock the first floor settlement');
 state.x['follower-floor-ledger']={id:'follower-floor-ledger',type:'floor-ledger',ranges:[[0,0]]};
 assert.match(p.html(),/data-x-action="refresh"[^>]*disabled/);assert.doesNotMatch(p.html(),/data-x-action="edit-page"/);
 assert.deepEqual(p.press({dataset:{press:'x-account',xId:'a'}}).map(a=>a.icon),['edit']);
 chat.push({mes:'new'});assert.doesNotMatch(p.html(),/data-x-action="refresh"[^>]*disabled/);
 for(const tab of ['square','search']){await p.action('tab',tab);assert.doesNotMatch(p.html(),/data-x-action="edit-page"/);assert.doesNotMatch(p.html(),/data-x-action="(?:square-refresh|trends-refresh|refresh)"/);}
 await p.action('tab','messages');assert.doesNotMatch(p.html(),/data-x-action="edit-page"/);await p.action('thread','a');
 const messageActions=p.press({dataset:{press:'x-message',xId:'m'}});assert.deepEqual(messageActions.map(a=>a.icon),['edit','delete']);
 await messageActions.find(a=>a.icon==='edit').run();
 assert.match(p.html(),/private thread<\/textarea>/);assert.match(p.html(),/保存修改/);p.back();assert.doesNotMatch(p.html(),/保存修改/);
});

for(const feed of ['home','square'])for(const author of ['user','npc'])test('comment profiles use IDs and return to '+author+' post in '+feed,async()=>{
 const view={x:{
  profile:{id:'profile',type:'profile',alias:'Moon',bio:'User bio'},
  a:{id:'a',type:'account',name:'同名',handle:'first',bio:'First account',dmPolicy:'open'},
  b:{id:'b',type:'account',name:'同名',handle:'second',bio:'Second account',dmPolicy:'open'},
  npc:{id:'npc',type:'account',name:'发帖人',handle:'writer'},
  p:{id:'p',type:'post',author,text:'Original thread',feed},
  other:{id:'other',type:'post',author:'b',text:'Second author post'},
  ca:{id:'ca',type:'comment',postId:'p',author:'a',text:'First reply'},
  cb:{id:'cb',type:'comment',postId:'p',author:'b',text:'Second reply'},
  cu:{id:'cu',type:'comment',postId:'p',author:'user',text:'My reply'},
  missing:{id:'missing',type:'comment',postId:'p',author:'gone',text:'Old reply'}
 }};
 const before=JSON.stringify(view);let calls=0;
 const panel=createXPanel({getView:()=>view,redraw(){},notice(){},adapter:{x:{discover(){calls++;}}}});
 await panel.action('tab',feed==='square'?'square':'home');await panel.action('comments','p');
 panel.input({dataset:{xField:'comment'},value:'Unsent reply'});
 await panel.action('reply-comment','cb');
 const html=panel.html();
 assert.match(html,/type="button" class="pp-x-comment-author" data-x-action="comment-author" data-x-id="b"/);
 assert.match(html,/同名 @second/);assert.doesNotMatch(html,/data-x-action="comment-author" data-x-id="gone"/);
 await panel.action('comment-author','b');assert.match(panel.html(),/Second account/);assert.doesNotMatch(panel.html(),/First account/);
 assert.match(panel.html(),/Second author post/);assert.match(panel.html(),/data-x-action="follow"/);assert.match(panel.html(),/data-x-action="thread"/);
 assert.equal(panel.back(),true);assert.match(panel.html(),/data-x-comment="cb"/);assert.match(panel.html(),/Unsent reply/);assert.match(panel.html(),/回复 @同名/);
 await panel.action('comment-author','user');assert.match(panel.html(),/data-x-form="profile"/);assert.match(panel.html(),/User bio/);
 await panel.action('back');assert.match(panel.html(),/data-x-comment="cu"/);
 const same=panel.html();await panel.action('comment-author','gone');assert.equal(panel.html(),same);
 await panel.action('comment-author','a');delete view.x.a;assert.doesNotThrow(()=>panel.html());panel.back();assert.match(panel.html(),/Original thread/);
 view.x.a=JSON.parse(before).x.a;assert.deepEqual(view,JSON.parse(before));assert.equal(calls,0);
 panel.reset();assert.equal(panel.back(),false);
});

test('legacy trend counts disappear from display and editor, original post links remain',async()=>{
 const view={x:{p:{id:'p',type:'post',author:'user',text:'Original'},'trend-edition':{type:'trends',id:'trend-edition',topics:[
  {title:'Old trend',summary:'Public life',scope:'Town',postCount:420,sourcePostIds:['p']},
  {title:'New trend',summary:'World topic',sourcePostIds:[]}
 ]}}};
 const panel=createXPanel({adapter:{},getView:()=>view,redraw(){},notice(){}});
 await panel.action('tab','search');assert.match(panel.html(),/Old trend/);assert.match(panel.html(),/New trend/);assert.doesNotMatch(panel.html(),/条讨论|420|undefined/);
 await panel.action('comments','p');assert.match(panel.html(),/Original/);panel.back();
 await panel.action('edit-page');assert.doesNotMatch(panel.html(),/讨论数|420/);
});

test('recognized legacy institution posts move between lists without publication metadata, unknown accounts and all original records survive',async()=>{
 const view={x:{org:{id:'org',type:'account',name:'环球度假区快讯',handle:'park',following:true},
  old:{id:'old',type:'post',author:'org',feed:'home',text:'Legacy notice',metrics:{likes:40,reposts:5,replies:1}},
  c:{id:'c',type:'comment',postId:'old',author:'user',text:'Old comment'},
  a:{id:'a',type:'account',name:'Unclassified',handle:'u'},p:{id:'p',type:'post',author:'a',feed:'home',text:'Ambiguous old post'},
  'square-edition':{id:'square-edition',editionId:'current',clock:{day:null,hour:null}}}};
 const before=structuredClone(view);
 const panel=createXPanel({adapter:{},getView:()=>view,redraw(){},notice(){}});
 assert.doesNotMatch(panel.html(),/Legacy notice/);assert.match(panel.html(),/Ambiguous old post/);
 await panel.action('tab','square');assert.match(panel.html(),/Legacy notice/);assert.doesNotMatch(panel.html(),/data-x-action="inject"/);
 await panel.action('comments','old');assert.match(panel.html(),/Old comment/);assert.match(panel.html(),/赞 40/);
 assert.deepEqual(view,before);
});
