import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createPhoneMemory} from '../src/memory.js';
import {createPhoneService} from '../src/phone.js';
import {createX,xItems,xUnread,xCounts} from '../src/x.js';
import {normalizeSettings} from '../src/config.js';
import {buildContinuityPrompt} from '../src/continuity.js';
import {xAudience, audienceChanges, audienceSources} from '../src/x-audience.js';

function setup(getGenerationState){
 const bus=new EventEmitter();let response={},count=0,lastPrompt='';
 const context={chatId:'x-test',name1:'Sam',name2:'Alex',characterId:0,characters:[{name:'Alex',avatar:'alex.png'}],chat:[{mes:'Alex uses X.',name:'Alex'}],chatMetadata:{},saveMetadata:async()=>{},onlineStatus:'connected',eventSource:bus,event_types:Object.fromEntries(['CHAT_CHANGED','MESSAGE_DELETED','MESSAGE_EDITED','GENERATION_STARTED','GENERATION_ENDED'].map(x=>[x,x])),generateQuietPrompt:async o=>{count++;lastPrompt=o.quietPrompt;return typeof response==='function'?response(o):JSON.stringify(response);}};
 const settings=normalizeSettings({retries:0});const memory=createPhoneMemory({getContext:()=>context,getGenerationState});const phone=createPhoneService({memory,getContext:()=>context,getSettings:()=>settings});const x=createX({memory,phone,getContext:()=>context,getSettings:()=>settings});
 return {x,memory,phone,context,settings,bus,state:()=>phone.snapshot(),reply:r=>{response=r;},count:()=>count,prompt:()=>lastPrompt,close(){phone.destroy();memory.destroy();}};
}
const ok=r=>assert.equal(r?.ok,true,r?.error);
async function account(f,policy='requests'){
 ok(await f.x.saveProfile({alias:'Moon',bio:'Music'}));
 f.reply({accounts:[{name:'Alex',handle:'alex',has_account:true,dm_policy:policy}]});const r=await f.x.discover('Alex');ok(r);return r.value.ids[0];
}

test('X home accepts one complete wrapped result and explains invalid fields without retrying',async()=>{
 const f=setup();try{
  f.settings.retries=4;
  f.reply(()=>'<think>choose topics</think>\n动态如下：<content>'+JSON.stringify({posts:[{name:'School',handle:'school',text:'Open day'}]})+'</content>');
  ok(await f.x.refresh());assert.equal(f.count(),1);assert.equal(xItems(f.state(),'post').length,1);
  assert.match(f.prompt(),/最终只返回本任务要求的单个完整 JSON/);
  const before=structuredClone(f.state().x);
  f.reply(()=>'{"posts":');const bad=await f.x.refresh();assert.equal(bad.ok,false);assert.match(bad.error,/X 数据返回格式不正确.*不完整/);
  assert.deepEqual(f.state().x,before);assert.equal(f.count(),2);
  f.reply({posts:'not-array'});const wrong=await f.x.refresh();assert.equal(wrong.ok,false);assert.match(wrong.error,/字段 posts/);assert.equal(f.count(),3);
  f.reply(()=>'{"posts":[]}\n{"posts":[]}');assert.equal((await f.x.refresh()).ok,false);assert.deepEqual(f.state().x,before);
 }finally{f.close();}
});

test('world-related recommendations do not auto-follow and explicit non-users never become authors or commenters',async()=>{
 const f=setup();try{
  f.reply({accounts:[{name:'School',handle:'school',has_account:true},{name:'Hermit',handle:'hermit',has_account:false}],posts:[{name:'Forest',handle:'forest',has_account:false,text:'No account'},{name:'Alex',handle:'alex',has_account:true,text:'Hello',comments:[{name:'Hermit',handle:'hermit',has_account:false,text:'Impossible'}]}]});
  ok(await f.x.refresh());const list=xItems(f.state(),'account');
  assert.equal(list.length,2);assert.ok(list.every(a=>a.recommended&&!a.following));assert.equal(xItems(f.state(),'post').length,1);assert.equal(xItems(f.state(),'comment').length,0);
  assert.match(f.prompt(),/朋友、同学、同事/);assert.match(f.prompt(),/学校、职业、行业、城市、兴趣/);assert.match(f.prompt(),/与世隔绝/);
  const id=list.find(a=>a.name==='Alex').id;ok(await f.x.follow(id,true));
  f.reply({posts:[{accountId:id,has_account:false,text:'Still impossible'}]});ok(await f.x.refresh(true));assert.equal(xItems(f.state(),'post').length,1);
  f.reply({accounts:[{name:'Work',handle:'work',has_account:true}]});ok(await f.x.refresh());assert.equal(xItems(f.state(),'account').find(a=>a.name==='School').recommended,false);
 }finally{f.close();}
});

test('opening followers derive once from persona, reset is local and saves do not erase audience',async()=>{
 const f=setup();try{
  await f.x.open();assert.equal(xAudience(f.state()),null);assert.equal(f.count(),0);
  f.reply({initialFollowers:125});ok(await f.x.resetFollowers());assert.equal(xAudience(f.state()).followers,125);assert.equal(f.count(),1);
  assert.match(f.prompt(),/初始人设.*匿名小号/);
  ok(await f.x.saveProfile({alias:'Moon',bio:'Music'}));assert.equal(xAudience(f.state()).followers,125);
  f.reply({initialFollowers:9999});ok(await f.x.resetFollowers());assert.equal(f.count(),1);assert.equal(xAudience(f.state()).followers,125);
  f.reply({posts:[],audience:{initialFollowers:9999}});ok(await f.x.refresh());assert.equal(xAudience(f.state()).initialFollowers,125);
 }finally{f.close();}
});

test('hot post follower totals deduplicate, grow by difference, and reset retains consumed exposure',async()=>{
 const f=setup();try{
  ok(await f.x.publish('Public project'));const post=xItems(f.state(),'post')[0];
  const response=total=>({posts:[],audience:{initialFollowers:100,growth:[{sourceId:'post:'+post.id,hot:true,totalGain:total,basis:'Public discussion of this project'}]},engagementUpdates:[{postId:post.id,metrics:{likes:300,reposts:40,replies:0}}]});
  f.reply(response(20));ok(await f.x.refresh());assert.equal(xAudience(f.state()).followers,120);assert.equal(xCounts(f.state(),f.state().x[post.id]).likes,300);
  ok(await f.x.refresh());assert.equal(xAudience(f.state()).followers,120);
  f.reply(response(25));ok(await f.x.refresh());assert.equal(xAudience(f.state()).followers,125);
  const calls=f.count();ok(await f.x.resetFollowers());assert.equal(f.count(),calls);assert.equal(xAudience(f.state()).followers,100);
  ok(await f.x.refresh());assert.equal(xAudience(f.state()).followers,100);
  f.reply(response(30));ok(await f.x.refresh());assert.equal(xAudience(f.state()).followers,105);
 }finally{f.close();}
});

test('ordinary activity, unknown sources and non-hot results do not award followers',async()=>{
 const f=setup();try{
  f.reply({initialFollowers:10});ok(await f.x.resetFollowers());ok(await f.x.publish('Lunch'));const post=xItems(f.state(),'post')[0],calls=f.count();
  ok(await f.x.react(post.id,'liked'));ok(await f.x.react(post.id,'reposted'));assert.equal(f.count(),calls);assert.equal(xAudience(f.state()).followers,10);
  f.reply({posts:[],audience:{growth:[{sourceId:'post:'+post.id,hot:false,totalGain:99,basis:'ordinary'},{sourceId:'unknown',hot:true,totalGain:999,basis:'fake'}]}});
  ok(await f.x.refresh());assert.equal(xAudience(f.state()).followers,10);
 }finally{f.close();}
});

test('public mentions can earn followers once, but missing @ and private messages cannot',async()=>{
 const f=setup();try{
  ok(await f.x.saveProfile({alias:'Moon',bio:''}));
  const reply={posts:[{name:'Singer',handle:'singer',text:'Listen to @Moon tonight',mentionsUser:true,followers:200000}],audience:{initialFollowers:100,growth:[{sourceId:'mention:new:0',hot:true,totalGain:80,basis:'Public recommendation'}]}};
  f.reply(reply);ok(await f.x.refresh());assert.equal(xAudience(f.state()).followers,180);
  ok(await f.x.refresh());assert.equal(xAudience(f.state()).followers,180);
  f.reply({...reply,posts:[{name:'Singer',handle:'singer',text:'Private knowledge of someone',mentionsUser:true}]});
  ok(await f.x.refresh());assert.equal(xAudience(f.state()).followers,180);
  f.reply({status:'reply',text:'Hello',audience:{growth:[{sourceId:'mention:new:0',hot:true,totalGain:999,basis:'Private'}]}});
  ok(await f.x.send(xItems(f.state(),'account')[0].id,'Hi'));assert.equal(xAudience(f.state()).followers,180);
 }finally{f.close();}
});

test('comment response can update followers in its single existing call',async()=>{
 const f=setup();try{
  f.reply({posts:[{name:'Artist',handle:'artist',text:'My new work'}],audience:{initialFollowers:10}});ok(await f.x.refresh());const post=xItems(f.state(),'post')[0];
  f.reply(o=>{const id=o.quietPrompt.match(/"sourceId":"(comment:[^"]+)"/)[1];return JSON.stringify({text:'Great point',audience:{growth:[{sourceId:id,hot:true,totalGain:8,basis:'Public comment brought attention'}]}});});
  const calls=f.count();ok(await f.x.comment(post.id,'Interesting technique'));assert.equal(f.count(),calls+1);assert.equal(xAudience(f.state()).followers,18);
 }finally{f.close();}
});

test('repost exposure has its own stable key and repeated toggles do not award the same followers again',async()=>{
 const f=setup();try{
  f.reply({posts:[{name:'Artist',handle:'artist',text:'New project'}],audience:{initialFollowers:10}});ok(await f.x.refresh());const post=xItems(f.state(),'post')[0];
  ok(await f.x.react(post.id,'reposted'));
  f.reply({posts:[],audience:{growth:[{sourceId:'repost:'+post.id,hot:true,totalGain:5,basis:'User repost became a discussion'}]}});ok(await f.x.refresh());assert.equal(xAudience(f.state()).followers,15);
  ok(await f.x.react(post.id,'reposted'));ok(await f.x.react(post.id,'reposted'));ok(await f.x.refresh());assert.equal(xAudience(f.state()).followers,15);
 }finally{f.close();}
});

test('follower gains roll back with story deletion and late initialization cannot leak to another chat',async()=>{
 const f=setup();try{
  f.reply({initialFollowers:10});ok(await f.x.resetFollowers());
  f.context.chat.push({mes:'Later'});await f.memory.read();ok(await f.x.publish('News'));const post=xItems(f.state(),'post')[0];
  f.reply({posts:[],audience:{growth:[{sourceId:'post:'+post.id,hot:true,totalGain:20,basis:'Public news'}]}});ok(await f.x.refresh());assert.equal(xAudience(f.state()).followers,30);
  f.context.chat.pop();await f.memory.read();assert.equal(xAudience(f.state()).followers,10);
  f.context.chatId='second';f.context.chatMetadata={};await f.memory.read();let finish,start;const begun=new Promise(r=>start=r);
  f.reply(()=>{start();return new Promise(r=>finish=r);});const pending=f.x.resetFollowers();await begun;
  f.context.chatId='third';f.context.chatMetadata={};await f.memory.read();finish('{"initialFollowers":100}');assert.equal((await pending).ok,false);assert.equal(xAudience(f.state()),null);
 }finally{f.close();}
});

test('invalid follower counts fail atomically and unknown followers are not displayed as zero',async()=>{
 const f=setup();try{
  const {createXPanel}=await import('../src/x-view.js');
  const panel=createXPanel({adapter:{x:f.x,userName:()=>f.context.name1},getView:f.state,redraw(){},notice(){}});
  await panel.action('profile');assert.match(panel.html(),/data-x-followers>—/);
  for(const value of [-1,'1,000',1.5,Infinity]){f.reply({initialFollowers:value});assert.equal((await f.x.resetFollowers()).ok,false);assert.equal(xAudience(f.state()),null);}
  f.reply({initialFollowers:0});ok(await f.x.resetFollowers());assert.match(panel.html(),/data-x-followers>0/);
  assert.match(panel.html(),/还原初始粉丝/);
  assert.throws(()=>audienceChanges(f.state(),[]));
 }finally{f.close();}
});

test('invalid growth never partly saves a generated feed or corrupts the previous follower balance',async()=>{
 const f=setup();try{
  f.reply({initialFollowers:50});ok(await f.x.resetFollowers());ok(await f.x.publish('Public work'));
  const post=xItems(f.state(),'post')[0],before=structuredClone(f.state().x);
  f.reply({posts:[{name:'New account',handle:'new',text:'New post'}],audience:{growth:[{sourceId:'post:'+post.id,hot:true,totalGain:-10,basis:'Invalid total'}]}});
  assert.equal((await f.x.refresh()).ok,false);assert.deepEqual(f.state().x,before);
 }finally{f.close();}
});

test('new public posts are not displaced by old comments in the bounded audience context',()=>{
 const state={x:{root:{id:'root',type:'post',author:'user',text:'Old',createdAt:1},latest:{id:'latest',type:'post',author:'user',text:'New',createdAt:100}}};
 for(let n=0;n<50;n++)state.x['c'+n]={id:'c'+n,type:'comment',author:'user',postId:'root',text:'Old comment',createdAt:n+2};
 assert.equal(audienceSources(state).slice(-40).at(-1).sourceId,'post:latest');
});

test('X opens locally; account search deduplicates and never imports phone or Snapchat contacts',async()=>{
 const f=setup();await f.x.open();assert.equal(f.count(),0);const id=await account(f);ok(await f.x.discover('Alex'));assert.equal(xItems(f.state(),'account').length,1);assert.equal(Object.keys(f.state().contacts).length,0);assert.equal(Object.keys(f.state().snapchat).length,0);
 const before=f.count();ok(await f.x.follow(id,true));ok(await f.x.publish('Hello world'));const p=xItems(f.state(),'post')[0];ok(await f.x.react(p.id,'liked'));ok(await f.x.react(p.id,'reposted'));assert.equal(f.count(),before);assert.equal(f.state().x[p.id].reposted,true);f.close();
});

test('X anonymous private replies stay scoped; failed messages retry once; rename preserves disclosure',async()=>{
 const f=setup(),id=await account(f,'open');f.reply(()=>{throw Error('offline');});assert.equal((await f.x.send(id,'Hi')).ok,false);let m=xItems(f.state(),'message')[0];assert.equal(m.status,'failed');
 f.reply({status:'reply',text:'Hello Moon'});ok(await f.x.retryMessage(m.id));assert.equal(xItems(f.state(),'message').length,2);assert.match(f.prompt(),/不知道此网名是谁/);assert.equal(xUnread(f.state()),1);
 const speaker={name:'Alex',avatar:'alex.png',nameIsUnique:true};assert.match(buildContinuityPrompt(f.state(),speaker,{instruction:'Remember'}),/Hello Moon/);assert.match(buildContinuityPrompt(f.state(),speaker,{instruction:'Remember'}),/\"identityKnown\":false/);
 ok(await f.x.markRead(id));assert.equal(xUnread(f.state()),0);ok(await f.x.reveal(id));ok(await f.x.saveProfile({alias:'New alias',bio:''}));assert.equal(f.state().x[id].identityKnown,true);
 assert.match(buildContinuityPrompt(f.state(),speaker,{instruction:'Remember'}),/Hello Moon/);assert.equal(buildContinuityPrompt(f.state(),{name:'Bea',avatar:'bea.png',nameIsUnique:true},{instruction:'Remember'}),'');f.close();
});

test('closed and blocked X accounts cannot receive messages; pending requests do not invent replies',async()=>{
 const f=setup(),id=await account(f,'closed');let before=f.count();assert.equal((await f.x.send(id,'Hi')).ok,false);assert.equal((await f.x.reveal(id)).ok,false);assert.equal(f.count(),before);f.close();
 const g=setup(),other=await account(g);g.reply({status:'request',text:''});ok(await g.x.send(other,'Hello'));assert.equal(xItems(g.state(),'message').length,1);assert.equal(xItems(g.state(),'message')[0].status,'request');ok(await g.x.block(other,true));before=g.count();assert.equal((await g.x.send(other,'Again')).ok,false);assert.equal(g.count(),before);g.close();
});

test('feed respects following, block and post IDs; public comments keep user aliases',async()=>{
 const f=setup(),id=await account(f);ok(await f.x.follow(id,true));ok(await f.x.publish('A new song'));const own=xItems(f.state(),'post')[0];
 f.reply({posts:[{accountId:id,text:'A public concert'},{name:'Intruder',handle:'other',text:'Unfollowed'}],replies:[{postId:own.id,accountId:id,text:'Sounds good'},{postId:'not-real',accountId:id,text:'Wrong post'}]});ok(await f.x.refresh(true));assert.equal(xItems(f.state(),'post').length,2);assert.equal(xItems(f.state(),'account').length,1);assert.equal(xItems(f.state(),'comment').length,1);assert.equal(xUnread(f.state()),1);ok(await f.x.markPostRead(own.id));assert.equal(xUnread(f.state()),0);
 const post=xItems(f.state(),'post').find(p=>p.author===id);f.reply({text:'See you there'});ok(await f.x.comment(post.id,'When?'));assert.equal(xItems(f.state(),'comment').length,3);assert.match(f.prompt(),/不知道此网名是谁/);assert.equal(xItems(f.state(),'comment').find(c=>c.author==='user').alias,'Moon');
 ok(await f.x.block(id,true));const n=f.count();assert.equal((await f.x.comment(post.id,'Again')).ok,false);assert.equal(f.count(),n);f.close();
});

test('X state and in-flight output roll back after deleting narrative or switching chats',async()=>{
 const f=setup(),id=await account(f,'open');f.context.chat.push({mes:'Later.'});await f.memory.read();ok(await f.x.follow(id,true));ok(await f.x.publish('Later post'));
 let finish,start;const ready=new Promise(r=>start=r);f.reply(()=>{start();return new Promise(r=>finish=r);});const sending=f.x.send(id,'Wait');await ready;
 f.context.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();finish('{"status":"reply","text":"late"}');assert.equal((await sending).ok,false);assert.equal(xItems(f.state(),'message').length,0);assert.equal(xItems(f.state(),'post').length,0);assert.equal(f.state().x[id].following,false);
 f.context.chatId='another';f.context.chatMetadata={};f.bus.emit('CHAT_CHANGED');await f.memory.read();assert.equal(Object.keys(f.state().x).length,0);f.close();
});

test('disabling X prevents even local changes without disabling Snapchat',async()=>{
 const f=setup();f.settings.apps.x=false;assert.equal((await f.x.publish('No')).ok,false);assert.equal(xItems(f.state(),'post').length,0);assert.equal(f.settings.apps.snapchat,true);assert.equal(f.count(),0);f.close();
});


test('X recovers from a missed generation-end event through the shared host state',async()=>{
 let hostBusy=false;const f=setup(()=>hostBusy);
 try {
  f.bus.emit('GENERATION_STARTED','normal');
  f.context.streamingProcessor={isFinished:false,isStopped:false};
  const id=await account(f,'open');
  ok(await f.x.publish('Available after the story ended'));
  f.reply({status:'reply',text:'Hello again'});ok(await f.x.send(id,'Hi'));
  hostBusy=true;
  assert.equal((await f.x.publish('Still generating')).ok,false);
  hostBusy=false;
  ok(await f.x.publish('Ready again without an end event'));
  assert.equal(xItems(f.state(),'post').length,2);
  f.context.chatId=undefined;
  assert.equal((await f.x.publish('No chat')).ok,false);
 } finally {f.close();}
});


test('square refresh needs no following and rejects character authors while creating world-local crowd posts',async()=>{
 const f=setup();try{
  const before=f.count();await f.x.open();assert.equal(f.count(),before);
  f.reply({posts:[{name:'Alex',handle:'alex_new',text:'Not a square author'},
    {name:'alex',handle:'a2',text:'Still the character'},
    {name:'Juniper',handle:'juniper_walks',text:'The park is lovely today.',metrics:{likes:12,reposts:2,replies:6},publicBasis:{access:'background',summary:'Ordinary local park visitor',involvesCharacters:false},
      comments:[{key:'one',name:'Rowan',handle:'rowan',text:'How crowded is it?'},{key:'two',isAuthor:true,replyTo:'one',text:'Quiet by the lake.'}]}]});
  ok(await f.x.refresh('square'));assert.equal(f.count(),before+1);
  const posts=xItems(f.state(),'post');assert.equal(posts.length,1);assert.equal(posts[0].feed,'square');
  assert.equal(xItems(f.state(),'account').some(a=>a.following),false);assert.equal(f.state().x[posts[0].author].crowd,true);
  assert.equal(xItems(f.state(),'comment').length,2);assert.equal(xUnread(f.state()),0);
  assert.deepEqual(xCounts(f.state(),posts[0]),{likes:12,reposts:2,replies:6});
  assert.match(f.prompt(),/秘密/);assert.match(f.prompt(),/无需关注/);assert.match(f.prompt(),/不围绕 user 转/);
 }finally{f.close();}
});

test('followed characters have un-followed commenters and may remain completely silent',async()=>{
 const f=setup();try{
  const id=await account(f);ok(await f.x.follow(id,true));
  f.reply({posts:[{accountId:id,text:'A quiet walk.',metrics:{likes:2,reposts:0,replies:1},comments:[{key:'friend',name:'Bea',handle:'bea',text:'Nice weather.'}]}]});
  ok(await f.x.refresh(true));const p=xItems(f.state(),'post')[0],c=xItems(f.state(),'comment')[0];
  assert.equal(f.state().x[c.author].name,'Bea');assert.equal(f.state().x[c.author].following,false);
  assert.equal(xItems(f.state(),'comment').some(c=>c.author===id),false);assert.match(f.prompt(),/可以一条都不回复/);
  const before=f.count();ok(await f.x.react(p.id,'liked'));ok(await f.x.react(p.id,'reposted'));
  assert.equal(f.count(),before);assert.deepEqual(xCounts(f.state(),f.state().x[p.id]),{likes:3,reposts:1,replies:1});
  ok(await f.x.react(p.id,'liked'));assert.equal(xCounts(f.state(),f.state().x[p.id]).likes,2);
  f.reply({text:''});ok(await f.x.comment(p.id,'Enjoy your day.'));assert.equal(xItems(f.state(),'comment').length,2);
  assert.equal(xCounts(f.state(),f.state().x[p.id]).replies,2);
 }finally{f.close();}
});

test('replying to a comment addresses that commenter and rejects a parent from another post',async()=>{
 const f=setup();try{
  const id=await account(f);ok(await f.x.follow(id,true));
  f.reply({posts:[{accountId:id,text:'Concert tonight',comments:[{key:'one',name:'Bea',handle:'bea',text:'I am going too.'}]}]});
  ok(await f.x.refresh(true));const post=xItems(f.state(),'post')[0],parent=xItems(f.state(),'comment')[0];
  f.reply({text:'See you there!'});ok(await f.x.comment(post.id,'When will you arrive?',parent.id));
  const comments=xItems(f.state(),'comment');assert.equal(comments.at(-1).author,parent.author);
  assert.equal(comments.at(-2).replyTo,parent.id);assert.equal(comments.at(-1).replyTo,comments.at(-2).id);
  assert.match(f.prompt(),/被回复的账号：.*Bea/);assert.match(f.prompt(),/不强制帖子作者出面/);
  ok(await f.x.publish('Other post'));const own=xItems(f.state(),'post').find(p=>p.author==='user');
  const count=f.count();assert.equal((await f.x.comment(own.id,'Wrong parent',parent.id)).ok,false);assert.equal(f.count(),count);
  ok(await f.x.block(parent.author,true));assert.equal((await f.x.comment(post.id,'Blocked',parent.id)).ok,false);
 }finally{f.close();}
});

test('square contents and engagement roll back and unrelated crowd threads stay out of character memory',async()=>{
 const f=setup();try{
  const id=await account(f);ok(await f.x.follow(id,true));ok(await f.x.reveal(id));
  f.context.chat.push({mes:'At the park.'});await f.memory.read();
  f.reply({posts:[{accountId:id,text:'The park',comments:[{key:'a',name:'Bea',handle:'bea',text:'A friend remark'},{key:'b',isAuthor:true,replyTo:'a',text:'Reply only to Bea'}]}]});ok(await f.x.refresh(true));
  const speaker={name:'Alex',avatar:'alex.png',nameIsUnique:true};
  assert.doesNotMatch(buildContinuityPrompt(f.state(),speaker,{instruction:'Remember'}),/Reply only to Bea/);
  f.reply({posts:[{name:'Juniper',handle:'juniper',text:'A local park report',publicBasis:{access:'background',summary:'Local life',involvesCharacters:false},metrics:{likes:15,reposts:4,replies:0}}]});ok(await f.x.refresh('square'));
  const p=xItems(f.state(),'post').find(p=>p.feed==='square');ok(await f.x.react(p.id,'liked'));
  f.context.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();
  assert.equal(xItems(f.state(),'post').length,0);assert.equal(xItems(f.state(),'comment').length,0);
  assert.equal(xItems(f.state(),'account').length,1);assert.equal(f.state().x[id].following,true);
 }finally{f.close();}
});

test('reposted posts appear on the personal profile and canceling removes them',async()=>{
 const {createXPanel}=await import('../src/x-view.js');const f=setup();try{
  f.reply({posts:[{name:'Juniper',handle:'juniper',text:'My favorite park',publicBasis:{access:'background',summary:'Local life',involvesCharacters:false}}]});ok(await f.x.refresh('square'));
  const post=xItems(f.state(),'post')[0];ok(await f.x.react(post.id,'reposted'));
  const panel=createXPanel({adapter:{userName:()=>f.context.name1},getView:f.state,redraw(){},notice(){}});
  await panel.action('profile');assert.match(panel.html(),/你转发了/);assert.match(panel.html(),/My favorite park/);
  ok(await f.x.react(post.id,'reposted'));assert.doesNotMatch(panel.html(),/My favorite park/);
 }finally{f.close();}
});

test('one square refresh carries style instructions and never records automatic opinion, all with rollback',async()=>{
 const f=setup();try{
 const impact={significant:true,topic:'The record',summary:'Critics debate the new album.',publicBasis:'Published reviews',stakes:'Possible interview questions'};
 f.reply({posts:[{name:'Rowan',handle:'r1',text:'nice park',publicBasis:{access:'background',summary:'Local life',involvesCharacters:false},impact:{...impact,significant:false}},{name:'Ivy',handle:'i1',text:'reviews are split',publicBasis:{access:'background',summary:'Local life',involvesCharacters:false},impact}]});ok(await f.x.refresh('square'));
 assert.equal(f.count(),1);assert.match(f.prompt(),/禁止每条末尾统一缀两三个/);assert.match(f.prompt(),/不擅自强制英语/);assert.equal(xItems(f.state(),'opinion').length,0);
 f.context.chat[0].mes='Changed starting scene';f.bus.emit('MESSAGE_EDITED');await f.memory.read();assert.equal(xItems(f.state(),'opinion').length,0);
 }finally{f.close();}
});


test('X Chinese display names retain follow status and original character identity',async()=>{
 const f=setup();try{
 const id=await account(f);ok(await f.x.follow(id,true));f.context.powerUserSettings={persona_description:'亚历克斯与 Sam 是朋友。'};
 f.reply({accounts:[{name:'亚历克斯',aliases:['Alex'],handle:'alex',has_account:true},{name:'Alex',aliases:['亚历克斯'],handle:'another_handle',has_account:true}]});ok(await f.x.discover('Alex'));
 const accounts=xItems(f.state(),'account');assert.equal(accounts.length,1);assert.equal(accounts[0].id,id);assert.equal(accounts[0].name,'亚历克斯');assert.equal(accounts[0].handle,'alex');assert.equal(accounts[0].following,true);assert.equal(accounts[0].characterId,'card:alex.png');assert.equal(f.state().x.profile.alias,'Moon');assert.match(f.prompt(),/不改变短信、帖子、对白/);
 }finally{f.close();}
});
