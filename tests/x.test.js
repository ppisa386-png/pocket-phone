import test from 'node:test';
import {feedResult,worldTopics,fixtureCast} from './x-fixtures.js';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createPhoneMemory} from '../src/memory.js';
import {createPhoneService} from '../src/phone.js';
import {createX,xItems,xUnread,xCounts} from '../src/x.js';
import {normalizeSettings} from '../src/config.js';
import {buildContinuityPrompt} from '../src/continuity.js';
import {xStoryPrompt} from '../src/x-story.js';
import {xAudience, audienceChanges} from '../src/x-audience.js';

test('narrative X catalog contains only user original posts, excluding comments, NPC posts, private messages and trends',()=>{
 const state={x:{profile:{alias:'Moon'},mine:{id:'mine',type:'post',author:'user',text:'MY_PUBLISHED_POST',imageDescription:'MY_IMAGE',createdAt:1},
  npc:{id:'npc',type:'post',author:'another',text:'NPC_FEED_SECRET',createdAt:2},
  square:{id:'square',type:'post',author:'crowd',text:'SQUARE_SECRET',feed:'square',createdAt:3},
  reply:{id:'reply',type:'comment',postId:'mine',author:'another',text:'MY_COMMENTS_SECRET'},
  dm:{id:'dm',type:'message',accountId:'another',role:'assistant',text:'DM_SECRET'},
  'trend-edition':{id:'trend-edition',type:'trends',topics:[{title:'TREND_SECRET',injected:true}]}}};
 const prompt=xStoryPrompt(state);
 assert.match(prompt,/MY_PUBLISHED_POST/);assert.match(prompt,/MY_IMAGE/);
 for(const secret of ['NPC_FEED_SECRET','SQUARE_SECRET','MY_COMMENTS_SECRET','DM_SECRET','TREND_SECRET'])assert.doesNotMatch(prompt,new RegExp(secret));
 assert.equal(buildContinuityPrompt({contacts:{},messages:{},calls:{},x:state.x},{name:'Alex',nameIsUnique:true},{instruction:'Remember'}),'');
});

test('X launcher unread counts only incoming unread direct messages, never public mentions or comments',()=>{
 const state={x:{
  mention:{id:'mention',type:'post',author:'npc',outreachMention:true,read:false},
  reply:{id:'reply',type:'comment',author:'npc',postId:'mention',text:'Public reply',read:false},
  userMessage:{id:'userMessage',type:'message',accountId:'npc',role:'user',read:false},
  alreadyRead:{id:'alreadyRead',type:'message',accountId:'npc',role:'assistant',read:true}
 }};
 assert.equal(xUnread(state),0,'public mentions, comments and sent DMs never light the desktop badge');
 state.x.incoming={id:'incoming',type:'message',accountId:'npc',role:'assistant',text:'Unread DM',read:false};
 assert.equal(xUnread(state),1,'one unread incoming DM lights the desktop badge');
 state.x.anotherIncoming={id:'anotherIncoming',type:'message',accountId:'npc',role:'assistant',text:'Second DM',read:false};
 assert.equal(xUnread(state),2,'badge reflects the number of unread incoming DMs');
 state.x.incoming.read=true;
 state.x.anotherIncoming.read=true;
 assert.equal(xUnread(state),0,'reading both DMs clears the badge while public activity is still unread');
});

function setup(getGenerationState,independent=false){
 const bus=new EventEmitter();let response={},count=0,lastPrompt='';
 const context={chatId:'x-test',name1:'Sam',name2:'Alex',characterId:0,characters:[{name:'Alex',avatar:'alex.png',description:fixtureCast}],chat:[{mes:'Alex uses X.',name:'Alex'}],chatMetadata:{},saveMetadata:async()=>{},onlineStatus:'connected',eventSource:bus,event_types:Object.fromEntries(['CHAT_CHANGED','MESSAGE_DELETED','MESSAGE_EDITED','GENERATION_STARTED','GENERATION_ENDED'].map(x=>[x,x])),generateQuietPrompt:async o=>{count++;lastPrompt=o.quietPrompt;return typeof response==='function'?response(o):JSON.stringify(response);}};
 const settings=normalizeSettings({retries:0});if(independent)settings.api.mode='independent';const memory=createPhoneMemory({getContext:()=>context,getGenerationState});const phone=createPhoneService({memory,getContext:()=>context,getSettings:()=>settings,modelClient:independent?{generate:async prompt=>context.generateQuietPrompt({quietPrompt:prompt})}:null});const x=createX({memory,phone,getContext:()=>context,getSettings:()=>settings});
 return {x,memory,phone,context,settings,bus,state:()=>phone.snapshot(),reply:r=>{response=r;},count:()=>count,prompt:()=>lastPrompt,close(){phone.destroy();memory.destroy();}};
}
const ok=r=>assert.equal(r?.ok,true,r?.error);
const squareRows=(n,offset=0)=>Array.from({length:n},(_,i)=>({name:'路人'+(offset+i),handle:'local'+(offset+i),text:'街坊动态 '+(offset+i)+' 号。',publicBasis:{access:'background',summary:'Ordinary local life',involvesCharacters:false}}));
test('legacy duplicate roots display once, preserving their replies, different authors, and user-authored repeats',()=>{
 const post={id:'p',type:'post',author:'user',metrics:{replies:1}},x={p:post};
 const add=(id,author,text,fields={})=>{x[id]={id,type:'comment',postId:'p',author,text,...fields};};
 add('first','A','好看！');add('old','A','好看！',{replyTo:null,ambient:true});add('child','B','赞',{replyTo:'old'});
 add('other','B','好看！');add('thread','A','好看！',{replyTo:'child'});add('u1','user','好');add('u2','user','好');
 const before=JSON.stringify(x),list=xItems({x},'comment');assert.equal(list.length,6);assert.equal(list.find(c=>c.id==='child').replyTo,'first');
 assert.equal(xCounts({x},post).replies,6);assert.equal(JSON.stringify(x),before,'projection leaves saved evidence and journal IDs intact');
});

test('user post reach includes published evidence and story time, supports wider audiences and cumulative updates',async()=>{
 const f=setup();try{
  f.context.chat.push({mes:'2026-10-30 19:30\nAlex privately invited Sam backstage.'});await f.memory.read();
  const publicText='今晚。';ok(await f.x.publish(publicText));
  const post=xItems(f.state(),'post')[0];assert.equal(post.sourceIndex,1);
  f.context.chat.push({mes:'2026-10-30 22:00\nThe show is over.'});await f.memory.read();
  const update={postId:post.id,metrics:{likes:9800,reposts:770,replies:214},comments:[{name:'Fan',handle:'fan',text:'这个视角也太近了！'}]};
  f.reply(feedResult({posts:[],engagementUpdates:[update]}));ok(await f.x.refresh());
  assert.match(f.prompt(),/粉丝数不是热度上限/);assert.match(f.prompt(),/不额外根据经过多少剧情时间调整数据/);assert.doesNotMatch(f.prompt(),/以及经过了多少剧情时间/);assert.match(f.prompt(),/私人经过/);assert.match(f.prompt(),/"postedAtStory"/);assert.match(f.prompt(),/"publicText":"今晚。"/);
  assert.deepEqual(xCounts(f.state(),f.state().x[post.id]),update.metrics);assert.equal(xItems(f.state(),'comment').length,1);
  f.reply(feedResult({posts:[],engagementUpdates:[{postId:post.id,metrics:{likes:10,reposts:1,replies:0}}]}));ok(await f.x.refresh());assert.deepEqual(xCounts(f.state(),f.state().x[post.id]),update.metrics);
 }finally{f.close();}
});
test('same friend reply in both refresh channels is one thread and one counted response, including on refresh',async()=>{
 const f=setup();try{
  const id=await account(f);ok(await f.x.publish('近距离舞台照，画面里能认出演出者。'));const post=xItems(f.state(),'post')[0];
  f.reply(()=>JSON.stringify(feedResult({posts:[],replies:[{postId:post.id,accountId:id,text:'看到了！'}],engagementUpdates:[{postId:post.id,metrics:{likes:28,reposts:3,replies:2},comments:[{key:'same',accountId:id,text:'看到了！'},{key:'nested',name:'Bea',handle:'bea',text:'我也是。',replyTo:'same'}]}]})));
  ok(await f.x.refresh());ok(await f.x.refresh());const state=f.state(),comments=xItems(state,'comment');
  assert.equal(Object.values(state.x).filter(c=>c.type==='comment').length,2);
  const first=comments.find(c=>c.author===id);assert.equal(comments.find(c=>c.text==='我也是。').replyTo,first.id);
  assert.deepEqual(xCounts(state,state.x[post.id]),{likes:28,reposts:3,replies:2});
  assert.equal(xUnread(state),0,'public replies no longer light the X desktop icon');
 }finally{f.close();}
});
test('X account discovery accepts trailing commas once and keeps existing accounts on other syntax failures',async()=>{
 const f=setup();try{
  f.reply(()=>'{"accounts":[{"name":"Alex","handle":"alex","has_account":true,"dm_policy":"requests",},],}');
  ok(await f.x.discover('Alex'));assert.equal(f.count(),1);assert.equal(xItems(f.state(),'account').length,1);
  assert.match(f.prompt(),/字段名及字符串必须用英文双引号/);
  const before=structuredClone(f.state().x);
  f.reply(()=>'{accounts:[]}');const failure=await f.x.discover('Another');assert.equal(failure.ok,false);assert.equal(failure.code,'MODEL_JSON_SYNTAX');assert.deepEqual(f.state().x,before);assert.equal(f.count(),2);
  f.reply(()=>'{"accounts":[]}');ok(await f.x.discover('Nobody'));assert.deepEqual(f.state().x,before);
 }finally{f.close();}
});
async function account(f,policy='requests'){
 ok(await f.x.saveProfile({alias:'Moon',bio:'Music'}));
 f.reply({accounts:[{name:'Alex',handle:'alex',has_account:true,dm_policy:policy}]});const r=await f.x.discover('Alex');ok(r);return r.value.ids[0];
}

for(const independent of [false,true])test('X '+(independent?'independent':'host')+' comments receive latest unsummarized prose and target memory with current topic',async()=>{
 const f=setup(undefined,independent),original=globalThis.qqj_v3_public_bridge_v1;let calls=0,topic='';
 try{
  const id=await account(f);f.reply(feedResult({posts:[{accountId:id,text:'My afternoon'}]}));ok(await f.x.refresh());
  const post=xItems(f.state(),'post')[0];
  f.context.chat.push({mes:'Alex and Sam JUST_OPENED_THE_GIFT in private. Bea was absent.',name:'Alex'});await f.memory.read();
  const identity={hostChatId:'x-test'};
  globalThis.qqj_v3_public_bridge_v1={getPromptSnapshot:()=>({status:'empty'}),getSnapshot:()=>({status:'not-ready'}),getPeopleSnapshot:()=>({status:'ready',identity,people:{status:'ready',items:[{displayName:'Alex',entityId:'a'}]}}),readContext:async options=>{calls++;topic=options.query;assert.deepEqual(options.entityIds,['a']);return {status:'ready',identity,actors:[{entityId:'a',memoryText:'ALREADY_KNOWN, private; plan not completed'},{entityId:'b',memoryText:'OTHER_SECRET'}],routerText:'ROUTER_SECRET'};}};
  f.reply({text:'I remember.'});const before=f.count();ok(await f.x.comment(post.id,'CURRENT_COMMENT_TOPIC'));
  assert.equal(f.count(),before+1);assert.equal(calls,1);assert.match(topic,/CURRENT_COMMENT_TOPIC/);assert.doesNotMatch(topic,/JUST_OPENED_THE_GIFT/);
  assert.doesNotMatch(f.prompt(),/JUST_OPENED_THE_GIFT/);assert.match(f.prompt(),/ALREADY_KNOWN/);assert.doesNotMatch(f.prompt(),/OTHER_SECRET|ROUTER_SECRET/);
  assert.doesNotMatch(JSON.stringify(f.context.chatMetadata),/JUST_OPENED_THE_GIFT|ALREADY_KNOWN/);
  f.reply({posts:squareRows(10)});ok(await f.x.refresh('square'));assert.equal(calls,1,'crowd-only square never requests actors private state');
  f.settings.api.memorySource='none';f.reply({text:''});ok(await f.x.comment(post.id,'Another comment'));assert.doesNotMatch(f.prompt(),/JUST_OPENED_THE_GIFT/);assert.doesNotMatch(f.prompt(),/ALREADY_KNOWN/);
 }finally{globalThis.qqj_v3_public_bridge_v1=original;f.close();}
});

for(const independent of [false,true])test('X '+(independent?'independent':'host')+' request supplements recall with saved knowledge and existing public comments',async()=>{
 const f=setup(undefined,independent);const original=globalThis.qqj_v3_public_bridge_v1;
 let reads=0;
 try{
  globalThis.qqj_v3_public_bridge_v1={getPromptSnapshot:()=>({status:'empty'}),getSnapshot(){reads++;return {status:'ready',identity:{hostChatId:'x-test'},memory:{status:'ready',floors:[{messageIndex:0,summary:'Alex saw the gift and Sam told Alex about the planned journey. This was private.'}]}};}};
  f.reply(feedResult({posts:[{name:'Alex',handle:'alex',has_account:true,text:'Hello'}]}));ok(await f.x.refresh());
  const a=xItems(f.state(),'account')[0];assert.equal(a.identityKnown,false,'effective real-name identity need not rewrite journal');
  ok(await f.x.publish('A public update'));const post=xItems(f.state(),'post').find(p=>p.author==='user');
  f.reply(feedResult({posts:[],replies:[{postId:post.id,accountId:a.id,text:'We already talked about the journey.'}]}));ok(await f.x.refresh());
  f.reply(feedResult({posts:[]}));const before=f.count();ok(await f.x.refresh());
  assert.equal(f.count(),before+1);assert.equal(reads,f.count(),'one synchronous snapshot per existing model request');
  assert.doesNotMatch(f.prompt(),/Alex saw the gift|This was private/,'an unrelated public update does not retrieve a commenter’s private memories');
  assert.match(f.prompt(),/We already talked about the journey/);
  assert.match(f.prompt(),/"identityKnown":true/);assert.match(f.prompt(),/私下已知可以影响措辞/);
  assert.doesNotMatch(JSON.stringify(f.context.chatMetadata),/Alex saw the gift/,'do not persist copies of external memory');
  ok(await f.x.saveProfile({alias:'Moon',bio:''}));f.reply(feedResult({posts:[]}));ok(await f.x.refresh());
  assert.match(f.prompt(),/"identityKnown":true/,'prior public interaction keeps established identity after renaming');assert.match(f.prompt(),/其他账号保持匿名边界/);
  const reply=xItems(f.state(),'comment')[0];f.reply({text:'Understood'});ok(await f.x.comment(post.id,'Thanks',reply.id));
  assert.match(f.prompt(),/Alex saw the gift/);assert.match(f.prompt(),/此前已确认 user 账号对应的真实身份/);
  globalThis.qqj_v3_public_bridge_v1.getSnapshot=()=>({status:'ready',identity:{hostChatId:'other'},memory:{status:'ready',floors:[{messageIndex:0,summary:'STALE PRIVATE SECRET'}]}});
  f.reply(feedResult({posts:[]}));ok(await f.x.refresh());assert.doesNotMatch(f.prompt(),/STALE PRIVATE SECRET|Alex saw the gift/);
 }finally{globalThis.qqj_v3_public_bridge_v1=original;f.close();}
});

test('X home accepts one complete wrapped result and explains invalid fields without retrying',async()=>{
 const f=setup();try{
  f.settings.retries=4;
  f.reply(()=>'<think>choose topics</think>\n动态如下：<content>'+JSON.stringify(feedResult({posts:[{name:'Alex',handle:'alex',has_account:true,text:'Open day'}]}))+'</content>');
  ok(await f.x.refresh());assert.equal(f.count(),1);assert.equal(xItems(f.state(),'post').length,10);
  assert.match(f.prompt(),/最终只输出本任务要求的一个JSON对象/);
  const before=structuredClone(f.state().x);
  f.reply(()=>'{"posts":');const bad=await f.x.refresh();assert.equal(bad.ok,false);assert.match(bad.error,/X 数据返回格式不正确.*不完整/);
  assert.deepEqual(f.state().x,before);assert.equal(f.count(),2);
  f.reply({posts:'not-array'});const wrong=await f.x.refresh();assert.equal(wrong.ok,false);assert.match(wrong.error,/字段 posts/);assert.equal(f.count(),3);
  f.reply(()=>'{"posts":[]}\n{"posts":[]}');assert.equal((await f.x.refresh()).ok,false);assert.deepEqual(f.state().x,before);
 }finally{f.close();}
});

test('world-related recommendations do not auto-follow and explicit non-users never become authors or commenters',async()=>{
 const f=setup();try{
  f.reply({accounts:[{name:'School',handle:'school',has_account:true},{name:'Hermit',handle:'hermit',has_account:false}],posts:[{name:'Forest',handle:'forest',has_account:false,text:'No account'},{name:'Alex',handle:'alex',has_account:true,text:'Hello',comments:[{name:'Hermit',handle:'hermit',has_account:false,text:'Impossible'}]},...feedResult().posts]});
  ok(await f.x.refresh());const list=xItems(f.state(),'account');
  assert.equal(list.length,11);assert.ok(list.every(a=>a.recommended&&!a.following));assert.equal(xItems(f.state(),'post').length,11);assert.equal(xItems(f.state(),'comment').length,0);
  assert.match(f.prompt(),/明确身份并适合使用X的NPC/);assert.match(f.prompt(),/不创造人物冒充既有NPC/);assert.match(f.prompt(),/与世隔绝/);
  const id=list.find(a=>a.name==='Alex').id;ok(await f.x.follow(id,true));
  f.reply({posts:[{accountId:id,has_account:false,text:'Still impossible'}]});ok(await f.x.refresh(true));assert.equal(xItems(f.state(),'post').length,11);
  f.reply(feedResult({posts:[],accounts:[{name:'Work',handle:'work',has_account:true}]}));ok(await f.x.refresh());assert.equal(xItems(f.state(),'account').some(a=>a.name==='School'||a.name==='Work'),false);
 }finally{f.close();}
});

test('opening followers derive once from persona, reset is local and saves do not erase audience',async()=>{
 const f=setup();try{
  await f.x.open();assert.equal(xAudience(f.state()),null);assert.equal(f.count(),0);
  f.reply({initialFollowers:125});ok(await f.x.resetFollowers());assert.equal(xAudience(f.state()).followers,125);assert.equal(f.count(),1);
  assert.match(f.prompt(),/初始粉丝.*匿名账号/);
  ok(await f.x.saveProfile({alias:'Moon',bio:'Music'}));assert.equal(xAudience(f.state()).followers,125);
  f.reply({initialFollowers:9999});ok(await f.x.resetFollowers());assert.equal(f.count(),1);assert.equal(xAudience(f.state()).followers,125);
  f.reply(feedResult({posts:[],audience:{initialFollowers:9999}}));ok(await f.x.refresh());assert.equal(xAudience(f.state()).initialFollowers,125);
 }finally{f.close();}
});

test('comment response defers follower changes to public refresh',async()=>{
 const f=setup();try{
  f.reply(feedResult({posts:[{name:'Alex',handle:'alex',has_account:true,text:'My new work'}],audience:{initialFollowers:10}}));ok(await f.x.refresh());const post=xItems(f.state(),'post')[0];
  f.reply({text:'Great point',audience:{growth:[{sourceId:'comment',hot:true,totalGain:8,basis:'Public discussion'}]}});
  const calls=f.count();ok(await f.x.comment(post.id,'Interesting technique'));assert.equal(f.count(),calls+1);assert.equal(xAudience(f.state()).followers,10);
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

test('X opens locally; account search deduplicates and never imports phone or Snapchat contacts',async()=>{
 const f=setup();await f.x.open();assert.equal(f.count(),0);const id=await account(f);ok(await f.x.discover('Alex'));assert.equal(xItems(f.state(),'account').length,1);assert.equal(Object.keys(f.state().contacts).length,0);assert.equal(Object.keys(f.state().snapchat).length,0);
 const before=f.count();ok(await f.x.follow(id,true));ok(await f.x.publish('Hello world'));const p=xItems(f.state(),'post')[0];ok(await f.x.react(p.id,'liked'));ok(await f.x.react(p.id,'reposted'));assert.equal(f.count(),before);assert.equal(f.state().x[p.id].reposted,true);f.close();
});


test('X private messages save and display their story-local send and receive times',async()=>{
 const f=setup();try{
  f.context.chat.push({mes:'2026-11-10 09:30'});
  const id=await account(f,'open');
  f.reply({status:'reply',text:'收到。'});ok(await f.x.send(id,'你好'));
  const messages=xItems(f.state(),'message').filter(m=>m.accountId===id).sort((a,b)=>a.createdAt-b.createdAt);
  assert.equal(messages.length,2);
  assert.deepEqual(messages[0].storyTime,{date:'2026-11-10',time:'09:30',precision:'scene'});
  assert.deepEqual(messages[1].storyTime,{date:'2026-11-10',time:'09:30',precision:'scene'});
  const {createXPanel}=await import('../src/x-view.js');
  const panel=createXPanel({adapter:{userName:()=>f.context.name1},getView:()=>f.state(),redraw(){},notice(){}});
  await panel.action('tab','messages');
  assert.match(panel.html(),/pp-x-inbox-time/);
  await panel.action('thread',id);
  const html=panel.html();
  assert.match(html,/pp-x-message-time/);
  assert.equal((html.match(/2026-11-10 09:30/g)||[]).length,2);
 }finally{f.close();}
});

test('X private messages show pending without retry and failed messages with retry',async()=>{
 const f=setup();
 try{
  const id=await account(f,'open');
  const state=structuredClone(f.state());
  for(const [n,status] of ['pending','failed','request','no_reply'].entries()){
   const mid='status-'+status;
   state.x[mid]={id:mid,type:'message',role:'user',accountId:id,text:'Message '+status,status,createdAt:n+1,read:true};
  }
  const {createXPanel}=await import('../src/x-view.js');
  const panel=createXPanel({adapter:{userName:()=>f.context.name1},getView:()=>state,redraw(){},notice(){}});
  await panel.action('thread',id);
  const html=panel.html();
  for(const [status,label] of [['pending','等待回复…'],['failed','回复失败']]){
   const offset=html.indexOf('data-x-id="status-'+status+'"');
   const article=offset>=0?html.slice(html.lastIndexOf('<article',offset),html.indexOf('</article>',offset)+10):'';
   assert.ok(article,status+' bubble exists');
   assert.ok(article.includes(label),status+' status text is visible');
   if(status==='pending')assert.ok(!article.includes('<button'),status+' does not render a retry control');
   else assert.match(article,/重试回复/,'failed bubble retries the existing message');
  }
  assert.match(html,/data-x-action="retry"/);
  assert.match(html,/消息请求已发送/);
  assert.match(html,/查看回应/);
  assert.match(html,/已发送/);
 }finally{f.close();}
});

test('late replies to X commercial invitations store one 50% decision and apply a polite refusal when selected',async()=>{
 const f=setup();try{
  const id=await account(f,'open'),planId='plan:late-reply';
  const accountRecord=f.state().x[id];
  await f.memory.commit(await f.memory.begin(),[
   {collection:'x',key:id,value:{...accountRecord,dmAccepted:true,inboundRequest:'accepted'}},
   {collection:'business',key:planId,value:{id:planId,brand:'茶商',project:'春茶合作',terms:'一条品鉴推文',accountId:id,status:'invited',investigated:false,replyBy:'2026-11-10 18:00'}}
  ]);
  f.context.chat.push({mes:'2026-11-10 18:01'});
  const before=f.count();
  f.reply({status:'reply',text:'我愿意合作。'});
  ok(await f.x.send(id,'我愿意合作。'));
  const plan=f.state().business[planId],userMessage=xItems(f.state(),'message').find(m=>m.role==='user'&&m.text==='我愿意合作。');
  assert.ok(['declined','open'].includes(plan.lateReplyDecision));
  assert.ok(userMessage);
  const reply=f.state().x['reply:'+userMessage.id];assert.ok(reply);
  if(plan.lateReplyDecision==='declined'){
   assert.equal(plan.status,'declined');
   assert.match(reply.text,/回复期限|档期/);
   assert.equal(f.count(),before,'a deterministic refusal does not make a model request');
  }else{
   assert.equal(plan.status,'invited');
   assert.equal(f.count(),before+1,'the open half follows the normal DM reply path');
  }
  const decision=plan.lateReplyDecision;
  f.reply({status:'reply',text:'继续沟通。'});ok(await f.x.send(id,'再确认一下。'));
  assert.equal(f.state().business[planId].lateReplyDecision,decision,'later messages do not reroll the same invitation');
 }finally{f.close();}
});

test('X anonymous private replies stay scoped; failed messages retry once; rename preserves disclosure',async()=>{
 const f=setup(),id=await account(f,'open');f.reply(()=>{throw Error('offline');});assert.equal((await f.x.send(id,'Hi')).ok,false);let m=xItems(f.state(),'message')[0];assert.equal(m.status,'failed');
 f.reply({status:'reply',text:'Hello Moon'});ok(await f.x.retryMessage(m.id));assert.equal(xItems(f.state(),'message').length,2);assert.match(f.prompt(),/不知道此网名是谁/);assert.equal(xUnread(f.state()),1);
 const speaker={name:'Alex',avatar:'alex.png',nameIsUnique:true};assert.equal(buildContinuityPrompt(f.state(),speaker,{instruction:'Remember'}),'','private X DM stays within the phone');
 const incoming=xItems(f.state(),'message').find(message=>message.accountId===id&&message.role==='assistant');ok(await f.x.markRead(id));assert.equal(xUnread(f.state()),0);const readState=(await f.memory.read()).state;assert.equal(readState.commContext['x:'+incoming.id]?.read,true,'opening the X DM thread mirrors phone-read state');assert.equal(readState.commContext['x:'+incoming.id]?.shown,false,'phone reading does not mean the novel has shown the DM');assert.equal(buildContinuityPrompt(readState,speaker,{instruction:'Remember'}),'','X DM contents remain outside the narrative history');ok(await f.x.reveal(id));ok(await f.x.saveProfile({alias:'New alias',bio:''}));assert.equal(f.state().x[id].identityKnown,true);
 assert.equal(buildContinuityPrompt(f.state(),speaker,{instruction:'Remember'}),'');assert.equal(buildContinuityPrompt(f.state(),{name:'Bea',avatar:'bea.png',nameIsUnique:true},{instruction:'Remember'}),'');f.close();
});

test('blocking an X sender hides the unread badge without falsely marking the DM as read',async()=>{
 const f=setup(),id=await account(f,'open');
 f.reply({status:'reply',text:'A message not yet opened'});
 ok(await f.x.send(id,'Hello'));
 const incoming=xItems(f.state(),'message').find(m=>m.accountId===id&&m.role==='assistant');
 assert.equal(incoming.read,false);assert.equal(xUnread(f.state()),1);
 ok(await f.x.block(id,true));
 const blocked=(await f.memory.read()).state;
 assert.equal(blocked.x[incoming.id].read,false,'blocking is not opening the DM');
 assert.equal(blocked.commContext['x:'+incoming.id].read,false,'read sidecar remains false');
 assert.equal(xUnread(blocked),0,'blocked account does not keep the launcher badge lit');
 ok(await f.x.block(id,false));
 assert.equal(xUnread(f.state()),1,'unblocking restores the still-unread badge');
 ok(await f.x.markRead(id));
 const read=(await f.memory.read()).state;
 assert.equal(read.x[incoming.id].read,true);assert.equal(read.commContext['x:'+incoming.id].read,true);
 assert.equal(xUnread(read),0);
 f.close();
});

test('closed and blocked X accounts cannot receive messages; pending requests do not invent replies',async()=>{
 const f=setup(),id=await account(f,'closed');let before=f.count();assert.equal((await f.x.send(id,'Hi')).ok,false);assert.equal((await f.x.reveal(id)).ok,false);assert.equal(f.count(),before);f.close();
 const g=setup(),other=await account(g);g.reply({status:'request',text:''});ok(await g.x.send(other,'Hello'));assert.equal(xItems(g.state(),'message').length,1);assert.equal(xItems(g.state(),'message')[0].status,'request');ok(await g.x.block(other,true));before=g.count();assert.equal((await g.x.send(other,'Again')).ok,false);assert.equal(g.count(),before);g.close();
});

test('feed respects following, block and post IDs; public comments keep user aliases',async()=>{
 const f=setup(),id=await account(f);ok(await f.x.follow(id,true));ok(await f.x.publish('A new song'));const own=xItems(f.state(),'post')[0];
 f.reply({posts:[{accountId:id,text:'A public concert'},{name:'Intruder',handle:'other',text:'Unfollowed'}],replies:[{postId:own.id,accountId:id,text:'Sounds good'},{postId:'not-real',accountId:id,text:'Wrong post'}]});ok(await f.x.refresh(true));assert.equal(xItems(f.state(),'post').length,2);assert.equal(xItems(f.state(),'account').length,1);assert.equal(xItems(f.state(),'comment').length,1);assert.equal(xUnread(f.state()),0,'an unread public reply does not light the X launcher');ok(await f.x.markPostRead(own.id));assert.equal(xUnread(f.state()),0);
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
      comments:[{key:'one',name:'Rowan',handle:'rowan',text:'How crowded is it?'},{key:'two',isAuthor:true,replyTo:'one',text:'Quiet by the lake.'}]},...squareRows(9,100)]});
  ok(await f.x.refresh('square'));assert.equal(f.count(),before+1);
  const posts=xItems(f.state(),'post');assert.equal(posts.length,10);assert.ok(posts[0].feed==='square');
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
  f.reply({text:'See you there!',reactions:[{key:'alex',accountId:id,text:'我也想知道你们什么时候到。',replyTo:'user_comment'}]});ok(await f.x.comment(post.id,'When will you arrive?',parent.id));
  const comments=xItems(f.state(),'comment'),userComment=comments.find(c=>c.author==='user'),directReply=comments.find(c=>c.author===parent.author&&c.replyTo===userComment.id),communityReply=comments.find(c=>c.author===id&&c.replyTo===userComment.id);
  assert.ok(directReply&&communityReply);assert.equal(userComment.replyTo,parent.id);
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
  f.reply({posts:[{name:'Juniper',handle:'juniper',text:'A local park report',publicBasis:{access:'background',summary:'Local life',involvesCharacters:false},metrics:{likes:15,reposts:4,replies:0}},...squareRows(9,80)]});ok(await f.x.refresh('square'));
  const p=xItems(f.state(),'post').find(p=>p.feed==='square');ok(await f.x.react(p.id,'liked'));
  f.context.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();
  assert.equal(xItems(f.state(),'post').length,0);assert.equal(xItems(f.state(),'comment').length,0);
  assert.equal(xItems(f.state(),'account').length,1);assert.equal(f.state().x[id].following,true);
 }finally{f.close();}
});

test('reposted posts appear on the personal profile and canceling removes them',async()=>{
 const {createXPanel}=await import('../src/x-view.js');const f=setup();try{
  f.reply({posts:[{name:'Juniper',handle:'juniper',text:'My favorite park',publicBasis:{access:'background',summary:'Local life',involvesCharacters:false}},...squareRows(9,60)]});ok(await f.x.refresh('square'));
  const post=xItems(f.state(),'post')[0];ok(await f.x.react(post.id,'reposted'));
  const panel=createXPanel({adapter:{userName:()=>f.context.name1},getView:f.state,redraw(){},notice(){}});
  await panel.action('profile');assert.match(panel.html(),/你转发了/);assert.match(panel.html(),/My favorite park/);
  ok(await f.x.react(post.id,'reposted'));assert.doesNotMatch(panel.html(),/My favorite park/);
 }finally{f.close();}
});

test('one square refresh carries style instructions and never records automatic opinion, all with rollback',async()=>{
 const f=setup();try{
 const impact={significant:true,topic:'The record',summary:'Critics debate the new album.',publicBasis:'Published reviews',stakes:'Possible interview questions'};
 f.reply({posts:[{name:'Rowan',handle:'r1',text:'nice park',publicBasis:{access:'background',summary:'Local life',involvesCharacters:false},impact:{...impact,significant:false}},{name:'Ivy',handle:'i1',text:'reviews are split',publicBasis:{access:'background',summary:'Local life',involvesCharacters:false},impact},...squareRows(8,70)]});ok(await f.x.refresh('square'));
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


test('X feed requests preset dialogue translation and keeps original and translation together',async()=>{
 const f=setup();try{
 const text='Guten Morgen.\n（早上好。）';f.reply(feedResult({posts:[{name:'Alex',handle:'alex',has_account:true,text}]}));ok(await f.x.refresh());
 assert.match(f.prompt(),/帖子、转帖附言、评论、回复及私信/);assert.match(f.prompt(),/单语预设保持单语/);assert.match(f.prompt(),/不统一英语/);assert.equal(xItems(f.state(),'post')[0].text,text);
 }finally{f.close();}
});

for (const independent of [false,true]) test('X binds short captions to their own earlier events in feed and thread, '+(independent?'independent':'host'),async()=>{
 const f=setup(undefined,independent);
 try {
  const id=await account(f);
  f.context.chat.push({mes:'校队在决赛最后一秒反超，拿下首个冠军。'});await f.memory.read();
  ok(await f.x.publish('终于。'));const first=xItems(f.state(),'post')[0];
  for(let i=0;i<7;i++)f.context.chat.push({mes:'之后的日常 '+i});
  f.context.chat.push({mes:'两位室友私下和解了，约好暂时不告诉别人。'});await f.memory.read();
  ok(await f.x.publish('终于。'));const second=xItems(f.state(),'post')[1];
  for(let i=0;i<8;i++)f.context.chat.push({mes:'几天后 '+i});await f.memory.read();
  f.reply(feedResult({posts:[],replies:[{postId:first.id,accountId:id,text:'我还记得最后一秒。'}]}));ok(await f.x.refresh());
  assert.ok(f.prompt().includes(first.id)&&f.prompt().includes(second.id));assert.doesNotMatch(f.prompt(),/首个冠军|私下和解/);
  f.reply({text:''});const comment=xItems(f.state(),'comment')[0];ok(await f.x.comment(first.id,'是啊。',comment.id));
  assert.ok(f.prompt().includes(first.id));assert.doesNotMatch(f.prompt(),/首个冠军/);
  assert.doesNotMatch(JSON.stringify(f.context.chatMetadata),/校队在决赛|两位室友/);
 } finally {f.close();}
});

const trendResult=(posts,eligible=true,title='公开项目引发讨论')=>({
 topics:worldTopics(eligible?[{title,summary:'围绕公开内容的讨论',scope:'本地社区',sourcePostIds:posts.map(p=>p.id)}]:[]),
 evaluations:posts.map(p=>({postId:p.id,eligible,reason:eligible?'内容与公共生活相关，具有传播价值':'目前只涉及日常问候，没有持续讨论'})),
});
for(const independent of [false,true])test('X trends '+(independent?'independent':'host')+' evaluates recent user posts with original scenes, reputation, counts and current progress in one call',async()=>{
 const f=setup(undefined,independent);try{
  f.context.powerUserSettings={persona_description:'Sam is a well-known athlete. PRIVATE_PERSONA_DETAIL is not public.'};
  f.context.chat.push({mes:'2026-10-30 19:30\nSam WON_THE_PUBLIC_CHAMPIONSHIP. The victory is broadcast live.'});await f.memory.read();
  ok(await f.x.publish('终于。'));const victory=xItems(f.state(),'post').at(-1);
  f.context.chat.push({mes:'2026-10-30 20:00\nSam PRIVATELY_RECONCILED at home, without public witnesses.'});await f.memory.read();
  ok(await f.x.publish('终于。'));const personal=xItems(f.state(),'post').at(-1);
  for(let i=0;i<8;i++)f.context.chat.push({mes:'Unrelated later event '+i});await f.memory.read();
  const before=structuredClone(f.state().x),response=trendResult([victory]);response.evaluations.push({postId:personal.id,eligible:false,reason:'匿名短句未公开私人和解，不能把私人经过当作话题'});
  f.reply(response);ok(await f.x.refreshTrends());assert.equal(f.count(),1);
  const prompt=f.prompt();assert.doesNotMatch(prompt,/WON_THE_PUBLIC_CHAMPIONSHIP|PRIVATELY_RECONCILED/);assert.ok(prompt.includes(victory.id)&&prompt.includes(personal.id));
  assert.match(prompt,/well-known athlete/);assert.match(prompt,/"audience":null/);assert.match(prompt,/"counts":\{"likes":0/);
  assert.match(prompt,/匿名账号不能继承真人名气/);assert.match(prompt,/不设置粉丝或互动门槛/);assert.match(prompt,/知名人物的普通日常也可不上榜/);
  assert.match(prompt,/"sourcePostIds"/);assert.equal(f.state().x['trend-edition'].topics[0].sourcePostIds[0],victory.id);
  assert.equal(xAudience(f.state()),null);for(const [id,value] of Object.entries(before))assert.deepEqual(f.state().x[id],value,'ranking never fabricates post engagement');
  f.reply(response);ok(await f.x.refreshTrends());assert.equal(f.count(),2);assert.match(f.prompt(),/"previous":\{"clock"/);
  assert.equal(xItems(f.state(),'trends').length,1);assert.deepEqual(f.state().x['trend-edition'].topics,response.topics);
  f.reply(trendResult([victory,personal],false));ok(await f.x.refreshTrends());assert.equal(f.state().x['trend-edition'].topics.length,10);assert.ok(f.state().x['trend-edition'].topics.every(t=>!t.sourcePostIds.length),'posts can leave the list');
 }finally{f.close();}
});

test('X trend candidates are the last 15 current user posts; merged topics preserve original sources and known followers',async()=>{
 const f=setup();try{
  for(let i=0;i<17;i++)ok(await f.x.publish('Post '+i));
  f.reply({initialFollowers:70000});ok(await f.x.resetFollowers());
  const posts=xItems(f.state(),'post').slice(-15),result=trendResult(posts,false);
  result.topics=worldTopics([{title:'One event',summary:'Two posts concern the same event',scope:'Sports',sourcePostIds:posts.slice(-2).map(p=>p.id)}]);
  for(const evaluation of result.evaluations.slice(-2))evaluation.eligible=true;
  f.reply(result);const n=f.count();ok(await f.x.refreshTrends());assert.equal(f.count(),n+1);
  const payload=JSON.parse(f.prompt().split('趋势评估资料（人设用于判断身份和公开知名度，不等于向网友公开）：')[1].split('\n')[0]);
  assert.equal(payload.candidates.length,15);assert.equal(payload.candidates[0].publicText,'Post 2');assert.equal(payload.audience.followers,70000);
  assert.equal(f.state().x['trend-edition'].topics.length,10);assert.equal(xAudience(f.state()).followers,70000);
  assert.equal(xItems(f.state(),'post').length,17);assert.equal(xItems(f.state(),'account').length,0);
 }finally{f.close();}
});

test('X trends reject missing/duplicate assessments and invented/mismatched sources atomically without automatic retries',async()=>{
 const f=setup();try{
  ok(await f.x.publish('Public project'));const posts=xItems(f.state(),'post'),valid=trendResult(posts);f.reply(valid);ok(await f.x.refreshTrends());
  const before=structuredClone(f.state().x);
  const bad=[{topics:[],evaluations:[]},{...valid,evaluations:[...valid.evaluations,...valid.evaluations]},
   {...valid,evaluations:[{...valid.evaluations[0],postId:'fake'}]}, {...valid,evaluations:[{...valid.evaluations[0],eligible:false}]},
   {...valid,topics:[]}, {...valid,topics:[{...valid.topics[0],sourcePostIds:['fake']}]},
   {...valid,topics:worldTopics([],7)}, {...valid,topics:[valid.topics[0],{...valid.topics[0],title:'Other'}]},
   {...valid,topics:[...valid.topics,{...valid.topics[0],sourcePostIds:[]}]}, {...valid,topics:[{...valid.topics[0],sourcePostIds:[posts[0].id,posts[0].id]}]}];
  for(const reply of bad){f.reply(reply);const n=f.count();assert.equal((await f.x.refreshTrends()).ok,false);assert.equal(f.count(),n+1);assert.deepEqual(f.state().x,before);}
  f.reply(()=>'{"topics":');assert.equal((await f.x.refreshTrends()).ok,false);assert.deepEqual(f.state().x,before);
 }finally{f.close();}
});

test('X trends accept empty candidates, persist per chat and roll back their source floor',async()=>{
 const f=setup();try{
  f.reply({topics:worldTopics([{title:'Local fair',summary:'A community event',scope:'Town',sourcePostIds:[]}]),evaluations:[]});ok(await f.x.refreshTrends());
  const previous=structuredClone(f.state().x['trend-edition']);
  f.context.chat.push({mes:'2026-11-01 10:00\nA new day'});await f.memory.read();ok(await f.x.publish('New project'));
  f.reply(trendResult(xItems(f.state(),'post')));ok(await f.x.refreshTrends());
  await f.memory.read();assert.equal(f.state().x['trend-edition'].topics[0].title,'公开项目引发讨论');
  f.context.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();assert.deepEqual(f.state().x['trend-edition'],previous);assert.equal(xItems(f.state(),'post').length,0);
  f.context.chatId='another';f.context.chatMetadata={};f.bus.emit('CHAT_CHANGED');await f.memory.read();assert.equal(f.state().x['trend-edition'],undefined);
 }finally{f.close();}
});
for(const change of ['persona','chat','disabled'])test('X trends discard delayed results after '+change+' changes',async()=>{
 const f=setup();try{
  let start,finish;const ready=new Promise(r=>start=r);f.reply(()=>{start();return new Promise(r=>finish=r);});
  const pending=f.x.refreshTrends();await ready;
  if(change==='persona')f.context.powerUserSettings={persona_description:'A different public identity'};
  if(change==='disabled')f.settings.apps.x=false;
  if(change==='chat'){f.context.chat[0].mes='Edited story';f.bus.emit('MESSAGE_EDITED');await f.memory.read();}
  finish(JSON.stringify({topics:[],evaluations:[]}));assert.equal((await pending).ok,false);assert.equal(f.state().x['trend-edition'],undefined);assert.equal(f.count(),1);
 }finally{f.close();}
});

test('anonymous brand request, negotiation and explicit X contract use distinct transitions',async()=>{
 const f=setup();try{
  f.context.chat[0].mes='2026-11-03';ok(await f.x.saveProfile({alias:'tea diary',bio:'茶评'}));
  await f.memory.commit(await f.memory.begin(),audienceChanges(f.state(),{initialFollowers:1200}));
  const evidence='茶商发来春茶合作邀约。';
  const row={kind:'offer',brand:'山茶',project:'春茶品鉴',terms:'品鉴后发帖，500元',text:'您好，请问愿意为春茶写一条品鉴推文吗？预算500元。',evidence};
  for(let i=0;i<14;i++)f.context.chat.push({mes:'故事继续。'});
  f.context.chat.push({mes:evidence+'<!--durian-business:'+JSON.stringify(row)+'-->'});
  await f.memory.read();
  const p=Object.values(f.state().business).find(p=>p.id);
  ok(await f.x.decideRequest(p.accountId,true));assert.equal(f.state().business[p.id].status,'invited');
  f.reply({status:'reply',text:'样品明天可以寄出。'});ok(await f.x.send(p.accountId,'样品何时寄出？'));
  assert.equal(f.state().business[p.id].status,'invited');assert.match(f.prompt(),/不等于合作/);
  f.reply({status:'reply',text:'成交。',deal:{kind:'accept',id:p.id,evidence:'我接受这项合作',terms:'500元品鉴推文'}});
  ok(await f.x.send(p.accountId,'我接受这项合作'));assert.equal(f.state().business[p.id].status,'active');assert.deepEqual(f.state().assets,{});
 }finally{f.close();}
});

test('atomic refresh saves the five numbers without review, never asks for other posts’ metrics and rolls back on regeneration',async()=>{
 const f=setup();try{
  f.context.chat[0].mes='2026-06-01';ok(await f.x.publish('A player singing.'));
  const p=xItems(f.state(),'post')[0],stat={postId:p.id,likes:850,reposts:96,replies:43,gained:58,lost:3};
  const trends={topics:worldTopics(),evaluations:[{postId:p.id,eligible:false}]};
  const replies=stats=>[feedResult(),{initialFollowers:5,stats}];
  let seq=replies([{...stat,likes:-5}]);f.reply(()=>JSON.stringify(seq.shift()));assert.equal((await f.x.refreshPublic()).ok,false);
  assert.equal(f.state().x['public-refresh'],undefined);
  seq=replies([stat]);f.reply(()=>JSON.stringify(seq.shift()));ok(await f.x.refreshPublic());
  assert.equal(f.state().x.audience.followers,60);assert.deepEqual(f.state().x[p.id].metrics,{likes:850,reposts:96,replies:43});
  const calls=f.count();assert.equal((await f.x.refreshPublic()).ok,false);assert.equal(f.count(),calls);
  f.context.chat.push({mes:'same day'});ok(await f.x.publish('Second post'));const q=xItems(f.state(),'post').at(-1);
  seq=[feedResult(),{stats:[{...stat,postId:q.id,likes:1,gained:0,lost:1}]},{effects:[]}];
  f.reply(({quietPrompt})=>{
   if(quietPrompt.includes('逐条独立估计')){assert.doesNotMatch(quietPrompt,/A player singing|"likes":850|传播理由|trendEvaluations/);assert.ok(quietPrompt.includes(q.id));}
   return JSON.stringify(seq.shift());
  });
  ok(await f.x.refreshPublic());assert.equal(f.state().x.audience.followers,59);
  f.context.chat.pop();await f.memory.read();assert.equal(f.state().x.audience.followers,60);assert.equal(f.state().x['public-refresh'].floor,0);
 }finally{f.close();}
});

test('privilege is classified when publishing, levels are frozen, opposite stances replace and expire with the source timeline',async()=>{
 const {privilegeLevel,privilegePrompt}=await import('../src/x-privilege.js');
 assert.deepEqual([99999,100000,499999,500000,1000000,1000001].map(privilegeLevel),[null,'low','low','medium','medium','high']);
 const f=setup();try{
  f.context.chat[0].mes='2026-06-01';ok(await f.x.saveProfile({alias:'Moon'}));
  const audience=n=>({collection:'x',key:'audience',value:{type:'audience',id:'audience',initialFollowers:n,followers:n}});
  await f.memory.commit(await f.memory.begin(),[audience(100000)]);f.reply({stance:'praise',target:'云茶',identity:'本地茶店'});
  ok(await f.x.publish('推荐云茶！'));const first=xItems(f.state(),'privilege')[0];assert.equal(first.level,'low');assert.equal(first.followers,100000);
  assert.match(privilegePrompt(f.state(),first.start),/大众推崇/);assert.match(privilegePrompt(f.state(),first.start),/Moon/);
  f.context.chat.push({mes:'2026-06-02'});await f.memory.read();await f.memory.commit(await f.memory.begin(),[audience(1000001)]);
  f.reply({stance:'attack',target:'云茶店',identity:'同一茶店',targetId:first.targetId});ok(await f.x.publish('反对云茶的做法'));
  const [old,second]=xItems(f.state(),'privilege');assert.equal(old.status,'superseded');assert.equal(old.level,'low');assert.equal(second.level,'high');assert.equal(second.followers,1000001);
  assert.match(privilegePrompt(f.state(),second.start+6),/大众孤立攻击/);assert.doesNotMatch(privilegePrompt(f.state(),second.start+6),/大众推崇/);
  f.reply({stance:'none'});ok(await f.x.publish('云茶几点开门？'));assert.equal(xItems(f.state(),'privilege').length,2);
  f.context.chat.push({mes:'2026-06-09'});await f.memory.read();assert.equal(xItems(f.state(),'privilege')[1].status,'expired');assert.equal(f.state().x.audience.followers,990001);
  const count=f.count();await f.memory.read();assert.equal(f.count(),count);assert.equal(f.state().x.audience.followers,990001);
  f.context.chat.pop();await f.memory.read();assert.equal(f.state().x.audience.followers,1000001);assert.equal(xItems(f.state(),'privilege')[1].status,'active');
  f.context.chat.pop();await f.memory.read();assert.equal(xItems(f.state(),'privilege').length,1);assert.equal(f.state().x[first.id].status,'active');
 }finally{f.close();}
});

test('reactions leave the inactivity anchor alone and publishing resets it after charging due cycles',async()=>{
 const f=setup();try{
  f.context.chat[0].mes='2026-06-01';await f.memory.commit(await f.memory.begin(),audienceChanges(f.state(),{initialFollowers:10000}));
  ok(await f.x.publish('first'));const p=xItems(f.state(),'post')[0];
  f.context.chat.push({mes:'2026-06-06'});ok(await f.x.react(p.id,'liked'));ok(await f.x.react(p.id,'reposted'));ok(await f.x.comment(p.id,'comment'));
  f.context.chat.push({mes:'2026-06-15'});ok(await f.x.publish('second'));assert.equal(f.state().x.audience.followers,9801);
  f.context.chat.push({mes:'2026-06-21'});await f.memory.read();assert.equal(f.state().x.audience.followers,9801);
  f.context.chat.push({mes:'2026-06-22'});await f.memory.read();assert.equal(f.state().x.audience.followers,9703);assert.equal(f.count(),0);
 }finally{f.close();}
});


test('initial post stats include visible source prose without reading QQJ on the first refresh',async()=>{
 const f=setup(),previous=globalThis.qqj_v3_public_bridge_v1,lookups=[];
 try{
  const identity={hostChatId:'x-test'};
  f.context.chat[0].mes='2026-06-01。柯林在舞台唱歌。艾达在营地做饭。';
  globalThis.qqj_v3_public_bridge_v1={
   getPeopleSnapshot:()=>({status:'ready',identity,people:{status:'ready',items:[{entityId:'c',displayName:'柯林'},{entityId:'a',displayName:'艾达'}]}}),
   readContext:async o=>{lookups.push(o);return {status:'ready',identity,actors:[{entityId:'c',memoryText:'KNOWN_PERFORMER'},{entityId:'a',memoryText:'UNRELATED_CHEF'}]};}
  };
  ok(await f.x.publish('他在舞台唱歌。'));const post=xItems(f.state(),'post')[0];
  f.reply(({quietPrompt})=>{
   if(quietPrompt.includes('逐条独立估计')){
    assert.match(quietPrompt,/柯林在舞台唱歌/);assert.doesNotMatch(quietPrompt,/KNOWN_PERFORMER|UNRELATED_CHEF/);
    return JSON.stringify({initialFollowers:4,stats:[{postId:post.id,likes:5000,reposts:43,replies:9,gained:41,lost:2}]});
   }
   if(quietPrompt.includes('趋势评估资料'))return JSON.stringify({topics:worldTopics(),evaluations:[{postId:post.id,eligible:false}]});
   return JSON.stringify(quietPrompt.includes('当前任务：X 广场')?{posts:[],replies:[]}:feedResult());
  });
  ok(await f.x.refreshPublic());assert.equal(f.count(),2);assert.equal(f.state().x.audience.followers,43);
  assert.equal(lookups.length,0,'first floor assessment uses visible story only');
  assert.equal((await f.x.refreshPublic()).ok,false);assert.equal(f.count(),2);assert.equal(lookups.length,0);
 }finally{globalThis.qqj_v3_public_bridge_v1=previous;f.close();}
});

for(const size of [10,15])test('recommended feed saves '+size+' distinct established NPC accounts in one request',async()=>{
 const f=setup();
 try{
  const npc=await account(f),before=f.count();
  const posts=Array.from({length:size},(_,i)=>i===0?{accountId:npc,text:'NPC public update'}:
   {name:'同学'+i,handle:'actor_'+i,authorKind:'npc',npcEvidence:'同学'+i+'是校园乐队成员。',bio:'乐队成员 '+i,has_account:true,text:'不同生活话题 '+i});
  f.reply({posts,accounts:posts.slice(1).map(({name,handle,bio})=>({name,handle,bio,has_account:true}))});
  ok(await f.x.refresh());
  const saved=xItems(f.state(),'post');
  assert.equal(f.count(),before+1);assert.equal(saved.length,size);assert.equal(new Set(saved.map(p=>p.author)).size,size);
  assert.equal(xItems(f.state(),'account').length,size);
  assert.match(f.prompt(),/10～15/);assert.match(f.prompt(),/每位作者一条/);assert.doesNotMatch(f.prompt(),/posts和replies各最多5条|推荐最多8/);
  const original=f.state().x[saved.at(-1).author];assert.equal(original.identityKnown,false);assert.equal(original.following,false);
  const {createXPanel}=await import('../src/x-view.js');
  const panel=createXPanel({adapter:{userName:()=>f.context.name1},getView:f.state,redraw(){},notice(){}});
  await panel.action('account',original.id);assert.match(panel.html(),/乐队成员/);assert.ok(panel.html().includes(saved.at(-1).text));
  assert.match(panel.html(),/data-x-action="follow"/);assert.match(panel.html(),/data-x-action="thread"/);
  const snapshot=structuredClone(f.state().x),count=f.count();
  f.reply({posts});const duplicate=await f.x.refresh();assert.equal(duplicate.ok,false);assert.match(duplicate.error,/有效新增 0 条/);
  assert.equal(f.count(),count+1);assert.deepEqual(f.state().x,snapshot);
  f.reply({posts:[...posts.slice(0,5),...feedResult().posts]});ok(await f.x.refresh());
  assert.equal(xItems(f.state(),'post').length,size+10);
 }finally{f.close();}
});

test('short NPC batches are valid; unsupported, duplicate-only or oversized batches do not commit',async()=>{
 const f=setup();
 try{
  const good=feedResult().posts;
  f.reply({posts:good.slice(0,9)});ok(await f.x.refresh());assert.equal(xItems(f.state(),'post').length,9);
  for(const posts of [good.map(p=>({...p,name:'Same',handle:'same'})),good.map(p=>({...p,handle:''})),[...good,...good]]){
   const before=structuredClone((await f.memory.read()).state.x),count=f.count();f.reply({posts});
   const result=await f.x.refresh();assert.equal(result.ok,false);
   assert.match(result.error,/有效新增 0 条|最多 15/);assert.equal(f.count(),count+1);assert.deepEqual(f.state().x,before);
  }
  f.reply({accounts:good});assert.equal((await f.x.refresh()).ok,false);
 }finally{f.close();}
});

test('legacy accounts without classification fields keep home posting rights and get card links backfilled',async()=>{
 const f=setup();
 try{
  f.context.characters.push({name:'Nora',avatar:'nora.png'});
  const cardLegacy={id:'legacy-card',type:'account',name:'Alex',handle:'legacy_alex',dmPolicy:'requests'};
  const proseLegacy={id:'legacy-prose',type:'account',name:'Bea',handle:'legacy_bea',dmPolicy:'requests'};
  const seeded=[cardLegacy,proseLegacy,
   {id:'legacy-card-post',type:'post',author:'legacy-card',text:'旧版首页动态一',feed:'home',liked:false,reposted:false},
   {id:'legacy-prose-post',type:'post',author:'legacy-prose',text:'旧版首页动态二',feed:'home',liked:false,reposted:false}];
  await f.memory.commit(await f.memory.begin(),seeded.map(value=>({collection:'x',key:value.id,value})));
  f.reply({posts:[{accountId:'legacy-card',authorKind:'npc',text:'乐队日常'},{accountId:'legacy-prose',authorKind:'npc',text:'摄影师日常'},
   {name:'Nora',handle:'nora',authorKind:'npc',has_account:true,text:'非当前主角色也可以发帖'}]});
  ok(await f.x.refresh());
  assert.ok(f.prompt().includes('已确立NPC账号直接用 accountId 发帖并附 authorKind:"npc"：[{"id":"legacy-card","name":"Alex"},{"id":"legacy-prose","name":"Bea"}]'),'the prompt hands the model the program-verified identity roster');
  assert.ok(f.prompt().includes('尚无账号的设定角色可作为新作者附 name/handle/has_account:true/authorKind:"npc"：["Nora"]'));
  const fresh=xItems(f.state(),'post').filter(p=>!p.id.startsWith('legacy-'));
  assert.deepEqual(fresh.map(p=>p.text),['乐队日常','摄影师日常','非当前主角色也可以发帖']);
  assert.ok(fresh.every(p=>p.feed==='home'));
  assert.equal(f.state().x['legacy-card'].authorKind,'npc');
  assert.equal(f.state().x['legacy-card'].characterId,'card:alex.png','card match backfills the missing link');
  assert.equal(f.state().x['legacy-prose'].authorKind,'npc');
  assert.equal(f.state().x['legacy-prose'].characterId,undefined,'no card, no invented link');
  assert.equal(f.state().x[fresh.at(-1).author].characterId,'card:nora.png','non-current card NPC links to its own card');
 }finally{f.close();}
});

test('NPC evidence matching tolerates layout drift while paraphrases and missing account fields are still rejected',async()=>{
 const f=setup();
 try{
  f.context.chat.push({mes:'Bea 在后台和 Sam 聊起了新专辑。'});
  f.reply({posts:[
   {name:'Bea',handle:'bea',authorKind:'npc',has_account:'true',npcEvidence:'Ｂｅａ　在后台和 Sam 聊起了新专辑！！',text:'封面定稿。'},
   {name:'Cara',handle:'cara',authorKind:'npc',has_account:true,npcEvidence:'Cara 随口聊起了巡演安排',text:'没有依据的帖子。'},
   {name:'Dana',handle:'dana',authorKind:'npc',text:'缺少账号字段的帖子。'}]});
  ok(await f.x.refresh());
  const saved=xItems(f.state(),'post');
  assert.deepEqual(saved.map(p=>p.text),['封面定稿。']);
  assert.equal(saved[0].feed,'home');assert.equal(f.state().x[saved[0].author].authorKind,'npc');
  assert.equal(xItems(f.state(),'account').length,1,'rejected authors create no accounts');
 }finally{f.close();}
});

test('known accounts post with accountId, fabricated authors report the reason without post text, and empty batches are normal zero adds',async()=>{
 const f=setup();
 try{
  f.context.chat.push({mes:'Bea 在后台和 Sam 聊起了新专辑。'});
  const bea={id:'bea-known',type:'account',name:'Bea',handle:'bea',dmPolicy:'requests'};
  await f.memory.commit(await f.memory.begin(),[{collection:'x',key:bea.id,value:bea}]);
  f.reply({posts:[{accountId:'bea-known',authorKind:'npc',text:'正常的剧情更新'}]});
  ok(await f.x.refresh());
  assert.deepEqual(xItems(f.state(),'post').map(p=>p.text),['正常的剧情更新']);
  assert.equal(f.state().x['bea-known'].authorKind,'npc');
  assert.ok(f.prompt().includes('其余已知个人账号发帖须用 accountId 并附 authorKind:"npc"：[{"id":"bea-known","name":"Bea"}]'));
  f.reply({posts:[{name:'陌生人',handle:'stranger',authorKind:'npc',has_account:true,text:'来历不明的帖子'}]});
  const failed=await f.x.refresh();
  assert.equal(failed.ok,false);
  assert.match(failed.error,/有效新增 0 条（身份不符 1 条）/);
  assert.doesNotMatch(failed.error,/来历不明的帖子/,'diagnostics count reasons only, never quote post text');
  assert.equal(xItems(f.state(),'post').length,1,'the failed stage keeps existing data');
  f.reply({posts:[]});const empty=await f.x.refresh();ok(empty);assert.equal(empty.value.added,0);
 }finally{f.close();}
});

test('duplicate-only recommended batches report the duplicate reason and keep the home feed',async()=>{
 const f=setup();
 try{
  const posts=[{name:'同学0',handle:'dup',authorKind:'npc',has_account:true,npcEvidence:'同学0是校园乐队成员。',text:'同一条动态'}];
  f.reply({posts});ok(await f.x.refresh());
  const snapshot=structuredClone(f.state().x);
  f.reply({posts});const again=await f.x.refresh();
  assert.equal(again.ok,false);
  assert.match(again.error,/有效新增 0 条（重复帖子 1 条）/);
  assert.doesNotMatch(again.error,/同一条动态/);
  assert.deepEqual(f.state().x,snapshot);
 }finally{f.close();}
});

test('home refresh saves recommendations and follower data without touching square or trends',async()=>{
 const f=setup();
 try{
  f.context.chat[0].mes='2026-11-05 10:00';await f.memory.read();
  f.context.chat.push({mes:'2026-11-05 12:00'});ok(await f.x.publish('A plain lunch.'));
  const post=xItems(f.state(),'post')[0],batch=feedResult(),trends=worldTopics();
  const notice={name:'学校公告',handle:'news',authorKind:'organization',text:'图书馆周末开放。',publicBasis:{access:'background',summary:'校园资讯',involvesCharacters:false}};
  batch.posts.push(notice);
  f.reply(({quietPrompt})=>{
   if(quietPrompt.includes('当前任务：X 广场'))return JSON.stringify({posts:[notice,{name:'Alex',handle:'alex',authorKind:'public',text:'错误分区',publicBasis:notice.publicBasis},...Array.from({length:9},(_,i)=>({name:'路人'+i,handle:'crowd'+i,text:'街区动态 '+i+'。',publicBasis:notice.publicBasis}))]});
   if(quietPrompt.includes('趋势评估资料'))return JSON.stringify({topics:trends,evaluations:[{postId:post.id,eligible:false}]});
   if(quietPrompt.includes('逐条独立估计'))return JSON.stringify({initialFollowers:20,stats:[{postId:post.id,likes:1,reposts:0,replies:0,gained:0,lost:0}]});
   return JSON.stringify(batch);
  });
  ok(await f.x.refreshPublic());
  assert.equal(f.count(),2);
  const home=xItems(f.state(),'post').filter(p=>p.feed==='home'),square=xItems(f.state(),'post').filter(p=>p.feed==='square');
  assert.equal(home.length,10);assert.equal(new Set(home.map(p=>p.author)).size,10);
  assert.equal(square.length,0,'home refresh must not create square posts');
  assert.equal(f.state().x['trend-edition'],undefined,'home refresh must not create trends');
  const snapshot=structuredClone(f.state().x);assert.equal((await f.x.refreshPublic()).ok,false);assert.equal(f.count(),2);assert.deepEqual(f.state().x,snapshot);
  f.context.chat.pop();await f.memory.read();assert.equal(xItems(f.state(),'post').length,0);assert.equal(f.state().x['public-refresh'],undefined);
  f.context.chat.push({mes:'2026-11-05 12:00 revised'});ok(await f.x.publish('A plain lunch.'));
  f.reply(()=>JSON.stringify({posts:[{name:'虚构网友',handle:'random',text:'无依据'}]}));const failed=await f.x.refreshPublic();
  assert.equal(failed.ok,false);assert.match(failed.error,/有效新增 0 条/);assert.equal(f.count(),3);
  assert.equal(f.state().x['public-refresh'],undefined);assert.equal(xItems(f.state(),'account').length,0);
 }finally{f.close();}
});

test('X home, square and search trend refresh have isolated data',async()=>{
 const f=setup();try{
  f.context.chat[0].mes='2026-11-06 09:00';await f.memory.read();
  const prompts=[];f.reply(({quietPrompt})=>{prompts.push(quietPrompt);return JSON.stringify(quietPrompt.includes('逐条独立估计')?{initialFollowers:12,stats:[]}:feedResult());});
  ok(await f.x.refreshPublic());assert.equal(f.count(),2);
  assert.equal(f.state().x.audience.followers,12);
  assert.equal(f.state().x['square-edition'],undefined);assert.equal(f.state().x['trend-edition'],undefined);
  const homeIds=xItems(f.state(),'post').map(p=>p.id),audience=structuredClone(f.state().x.audience);
  f.reply({posts:squareRows(10)});ok(await f.x.refresh('square'));assert.equal(f.count(),3);
  const squareEdition=structuredClone(f.state().x['square-edition']);assert.equal(squareEdition.postIds.length,10);
  assert.equal(f.state().x['trend-edition'],undefined);assert.deepEqual(f.state().x.audience,audience);
  assert.deepEqual(xItems(f.state(),'post').filter(p=>p.feed==='home').map(p=>p.id),homeIds);
  f.reply({topics:worldTopics(),evaluations:[]});ok(await f.x.refreshTrends());assert.equal(f.count(),4);
  assert.equal(f.state().x['trend-edition'].topics.length,10);
  assert.deepEqual(f.state().x['square-edition'],squareEdition);assert.deepEqual(f.state().x.audience,audience);
  assert.deepEqual(xItems(f.state(),'post').filter(p=>p.feed==='home').map(p=>p.id),homeIds);
  assert.ok(prompts.every(s=>!s.includes('当前任务：X 广场')&&!s.includes('趋势评估资料')));
 }finally{f.close();}
});

test('following feed rejects un-followed authors and the square requires ten to fifteen posts',async()=>{
 const f=setup();
 try{
  const id=await account(f);ok(await f.x.follow(id,true));
  f.reply({posts:[]});ok(await f.x.refresh(true));
  f.reply({posts:squareRows(10)});ok(await f.x.refresh('square'));
  f.reply({posts:Array.from({length:5},(_,i)=>({accountId:id,text:'Followed post '+i}))});ok(await f.x.refresh(true));
  assert.equal(xItems(f.state(),'post').filter(p=>p.feed==='square').length,10);
  assert.equal(xItems(f.state(),'post').filter(p=>p.feed==='home').length,5);
  f.reply({posts:feedResult().posts});ok(await f.x.refresh(true));
  assert.equal(xItems(f.state(),'post').filter(p=>p.feed==='home').length,5,'un-followed authors are rejected by the following feed');
  const squareRejected=await f.x.refresh('square');assert.equal(squareRejected.ok,false);assert.match(squareRejected.error,/广场作者/);
  f.reply({posts:[{name:'街区店铺',handle:'square_shop',text:'今天店里有新品。',publicBasis:{access:'background',summary:'日常街区生活',involvesCharacters:false}}]});
  const short=await f.x.refresh('square');assert.equal(short.ok,false);assert.match(short.error,/广场刷新需要 10～15 条/);
  f.reply({posts:squareRows(10,20)});ok(await f.x.refresh('square'));
  assert.equal(xItems(f.state(),'post').filter(p=>p.feed==='square').length,20);
 }finally{f.close();}
});

test('trends accept ten to fifteen unique topics without counts or reasons and preserve model order',async()=>{
 const {validateTrends}=await import('../src/x-trends.js');
 const candidates=[{id:'ordinary'},{id:'special'}];
 for(const count of [10,15]){
  const topics=worldTopics([],count);topics.at(-1).sourcePostIds=['special'];
  const result=validateTrends({topics,evaluations:[{postId:'ordinary',eligible:false},{postId:'special',eligible:true}]},candidates);
  assert.deepEqual(result.topics,topics);assert.equal(result.topics.at(-1).sourcePostIds[0],'special');
  assert.ok(result.topics.every(t=>!('postCount' in t)));
 }
 for(const topics of [worldTopics([],9),[...worldTopics([],15),{title:'Another',summary:'Other',sourcePostIds:[]}],[...worldTopics().slice(0,7),{...worldTopics()[0],title:'#'+worldTopics()[0].title}]]){
  assert.throws(()=>validateTrends({topics,evaluations:[]},[]));
 }
 const legacy=worldTopics().map(t=>({...t,postCount:420}));
 assert.ok(validateTrends({topics:legacy,evaluations:[]},[]).topics.every(t=>!('postCount' in t)));
});

test('narrative 4000 replies remain visible through both first stats and later refresh, without extra follower impacts',async()=>{
 const f=setup();
 try{
  f.context.chat[0].mes='2026-11-05 09:00';ok(await f.x.publish('Yesterday performance'));
  ok(await f.x.publish('Another unrelated post'));
  const [post,other]=xItems(f.state(),'post');
  const evidence='她打开 X，发现昨天那条演出推文的评论突破四千。';
  f.context.chat.push({mes:evidence+'<!--durian-x:'+JSON.stringify({action:'metrics',postId:post.id,postText:post.text,evidence,metrics:{replies:{value:4000,evidence}}})+'-->'});
  await f.memory.read();assert.equal(f.count(),0);assert.equal(xCounts(f.state(),f.state().x[post.id]).replies,4000);
  const {createXPanel}=await import('../src/x-view.js');
  const panel=createXPanel({adapter:{storyChat:()=>f.context.chat},getView:f.state,redraw(){},notice(){}});
  assert.match(panel.html(),/回复 4000/);assert.equal(xItems(f.state(),'comment').length,0);
  let estimates=0;
  f.reply(({quietPrompt})=>{
   if(quietPrompt.includes('当前任务：X 广场'))return JSON.stringify({posts:[]});
   if(quietPrompt.includes('趋势评估资料'))return JSON.stringify(trendResult([post,other],false));
   if(quietPrompt.includes('逐条独立估计')){estimates++;return JSON.stringify({initialFollowers:100,stats:[post,other].map(p=>({postId:p.id,likes:120,reposts:15,replies:35,gained:4,lost:1}))});}
   if(quietPrompt.includes('当前任务：X 未结算剧情楼层'))return JSON.stringify({effects:[]});
   return JSON.stringify(feedResult({posts:[],engagementUpdates:[{postId:post.id,metrics:{likes:140,reposts:20,replies:50}}]}));
  });
  ok(await f.x.refreshPublic());
  assert.deepEqual(f.state().x[post.id].metrics,{likes:120,reposts:15,replies:4000});assert.equal(f.state().x[other.id].metrics.replies,35);
  assert.equal(f.state().x.audience.followers,106);assert.equal(estimates,1);assert.equal(f.count(),2);
  const impact=structuredClone(xItems(f.state(),'influence'));
  f.context.chat.push({mes:'Still the same day.'});ok(await f.x.refreshPublic());
  assert.deepEqual(f.state().x[post.id].metrics,{likes:140,reposts:20,replies:4000});
  assert.equal(f.state().x.audience.followers,106);assert.deepEqual(xItems(f.state(),'influence'),impact);assert.equal(estimates,1);assert.equal(f.count(),4);
  f.reply(feedResult({posts:[],engagementUpdates:[{postId:post.id,metrics:{likes:150,reposts:25,replies:5000}}]}));ok(await f.x.refresh());
  assert.equal(f.state().x[post.id].metrics.replies,5000);assert.equal(f.state().x.audience.followers,106);
  f.context.chat.pop();await f.memory.read();assert.equal(f.state().x[post.id].metrics.replies,4000);
  f.context.chat.pop();await f.memory.read();assert.equal(f.state().x[post.id].metrics,undefined);assert.equal(f.state().x.audience,undefined);
 }finally{f.close();}
});

for(const total of [0,1,8,10,15,16,100,4000])test('detail fills and displays min(15,'+total+') once, leaves totals intact, persists and rolls back',async()=>{
 const f=setup();
 try{
  const id='saved',post={id,type:'post',author:total%2?'user':'alex',text:'Public event',feed:'home',metrics:{likes:80,reposts:9,replies:total}};
  const account={id:'alex',type:'account',name:'Alex',handle:'alex',dmPolicy:'requests'};
  await f.memory.commit(await f.memory.begin(),[post,account].map(value=>({collection:'x',key:value.id,value})));
  f.context.chat.push({mes:'Another day.'});await f.memory.read();
  const originalPost=structuredClone(f.state().x[id]);
  const target=Math.min(15,total),comments=Array.from({length:target},(_,i)=>({accountId:'alex',key:'c'+i,text:'Sample '+i,...(i===1?{replyTo:'c0'}:{})}));
  f.reply({comments});
  const {createXPanel}=await import('../src/x-view.js');
  const panel=createXPanel({adapter:{x:f.x},getView:f.state,redraw(){},notice(){}});
  await panel.action('comments',id);
  assert.equal((panel.html().match(/data-x-comment="/g)||[]).length,target);
  const saved=xItems(f.state(),'comment');assert.equal(saved.length,target);
  if(target>=2)assert.equal(saved[1].replyTo,saved[0].id);
  assert.deepEqual(xCounts(f.state(),f.state().x[id]),post.metrics);
  assert.deepEqual(f.state().x[id],originalPost);assert.equal(xAudience(f.state()),null);assert.deepEqual(xItems(f.state(),'influence'),[]);
  const snapshot=structuredClone(saved);panel.back();await panel.action('comments',id);ok(await f.x.completeComments(id));
  assert.equal(f.count(),total?1:0);assert.deepEqual(xItems(f.state(),'comment'),snapshot);
  f.context.chatMetadata=JSON.parse(JSON.stringify(f.context.chatMetadata));await f.memory.read();assert.deepEqual(xItems(f.state(),'comment'),snapshot);
  f.context.chat.pop();await f.memory.read();assert.equal(xItems(f.state(),'comment').length,0);assert.deepEqual(xCounts(f.state(),f.state().x[id]),post.metrics);
 }finally{f.close();}
});

test('detail fill commits partial progress, never saves duplicates, follows stored parent IDs and never counts samples twice',async()=>{
 const f=setup();
 try{
  const id=await account(f);ok(await f.x.publish('Public question'));const post=xItems(f.state(),'post')[0];
  ok(await f.x.comment(post.id,'My repeat'));ok(await f.x.comment(post.id,'My repeat'));
  const originals=xItems(f.state(),'comment');assert.equal(originals.length,2);
  await f.memory.commit(await f.memory.begin(),[{collection:'x',key:post.id,value:{...post,metrics:{likes:6,reposts:3,replies:8},includedDirectReplies:1}}]);
  const before=xCounts(f.state(),f.state().x[post.id]);assert.equal(before.replies,9);
  const rows=Array.from({length:7},(_,i)=>({accountId:id,text:'Reply '+i,replyTo:i===0?originals[0].id:null}));
  // A duplicate among the rows no longer wipes the batch: valid rows commit,
  // the duplicate is saved once and the remaining gap stays on the 补齐 button.
  f.reply({comments:[rows[0],rows[0],...rows.slice(2)]});const partial=await f.x.completeComments(post.id);
  ok(partial);assert.equal(partial.value.completed,false);assert.equal(partial.value.saved,8);assert.equal(partial.value.target,9);
  const afterPartial=xItems(f.state(),'comment');
  assert.equal(afterPartial.length,8);assert.equal(afterPartial.filter(c=>c.text==='Reply 0').length,1,'duplicates display once');
  assert.deepEqual(afterPartial.slice(0,2),originals);assert.equal(afterPartial[2].replyTo,originals[0].id);
  f.reply({comments:rows});ok(await f.x.completeComments(post.id));
  const visible=xItems(f.state(),'comment');assert.equal(visible.length,9);assert.equal(visible[2].replyTo,originals[0].id);
  assert.deepEqual(visible.slice(0,2),originals);assert.deepEqual(xCounts(f.state(),f.state().x[post.id]),before);
  assert.equal(f.state().x[post.id].includedDirectReplies,1);
 }finally{f.close();}
});

test('a model returning the full fifteen rows still fills posts whose aggregate exceeds fifteen; other posts stay untouched',async()=>{
 const f=setup();
 try{
  const account={id:'alex',type:'account',name:'Alex',handle:'alex',dmPolicy:'requests'};
  const big={id:'big',type:'post',author:'alex',text:'Viral post',feed:'home',metrics:{likes:300,reposts:40,replies:300},includedDirectReplies:1};
  const other={id:'other',type:'post',author:'alex',text:'Quiet post',feed:'home'};
  const sample={id:'s1',type:'comment',postId:'big',author:'alex',text:'Nice weather.',ambient:true,read:true,replyTo:null};
  await f.memory.commit(await f.memory.begin(),[big,other,account,sample].map(value=>({collection:'x',key:value.id,value})));
  await f.memory.read();
  // The standing shape says "超过15条时选15条": the model returns fifteen rows
  // while only fourteen are missing — previously this discarded the whole fill
  // and the detail page stayed on its single sample comment.
  const rows=Array.from({length:15},(_,i)=>({accountId:'alex',text:'Fresh comment '+i}));
  f.reply({comments:rows});
  const {createXPanel}=await import('../src/x-view.js');
  const panel=createXPanel({adapter:{x:f.x},getView:f.state,redraw(){},notice(){}});
  await panel.action('comments','big');
  assert.equal((panel.html().match(/data-x-comment="/g)||[]).length,15);
  const saved=xItems(f.state(),'comment').filter(c=>c.postId==='big');
  assert.equal(saved.length,15);assert.equal(new Set(saved.map(c=>c.text)).size,15,'no duplicate display');
  assert.equal(xItems(f.state(),'comment').filter(c=>c.postId==='other').length,0,'cross-post isolation');
  assert.deepEqual(xCounts(f.state(),f.state().x.big),big.metrics);
  const calls=f.count();await panel.action('comments','big');assert.equal(f.count(),calls,'a completed post never re-fills');
 }finally{f.close();}
});

test('new feed accepts fifteen concrete comments and full posts do not collect another ambient batch on refresh',async()=>{
 const f=setup();
 try{
  const samples=Array.from({length:15},(_,i)=>({name:'评论者'+i,handle:'c'+i,text:'Reply '+i,key:'k'+i,replyTo:i===1?'k0':null}));
  f.reply({posts:[{name:'Alex',handle:'alex',has_account:true,text:'Concert',metrics:{likes:123,reposts:7,replies:100},comments:samples}]});
  ok(await f.x.refresh());const npc=xItems(f.state(),'post')[0];assert.equal(xItems(f.state(),'comment').length,15);
  assert.deepEqual(xCounts(f.state(),npc),{likes:123,reposts:7,replies:100});
  ok(await f.x.publish('User event'));const mine=xItems(f.state(),'post').at(-1);
  const update={postId:mine.id,metrics:{likes:8,reposts:1,replies:100},comments:samples};
  f.reply({posts:[],engagementUpdates:[update]});ok(await f.x.refresh());
  const before=xItems(f.state(),'comment').filter(c=>c.postId===mine.id);assert.equal(before.length,15);
  f.reply({posts:[],engagementUpdates:[{...update,comments:samples.map(c=>({...c,text:c.text+'!' }))}]});ok(await f.x.refresh());
  assert.deepEqual(xItems(f.state(),'comment').filter(c=>c.postId===mine.id),before);
  ok(await f.x.comment(mine.id,'My new comment',null));ok(await f.x.comment(mine.id,'My new comment',null));
  const {createXPanel}=await import('../src/x-view.js');const panel=createXPanel({adapter:{x:f.x},getView:f.state,redraw(){},notice(){}});
  const count=f.count();await panel.action('comments',mine.id);
  assert.equal((panel.html().match(/data-x-comment="/g)||[]).length,15);assert.equal((panel.html().match(/My new comment/g)||[]).length,2);
  assert.equal(xItems(f.state(),'comment').filter(c=>c.postId===mine.id).length,17);assert.equal(f.count(),count);
 }finally{f.close();}
});

test('home validates NPC provenance, allows small and empty feeds, square admits public and institution authors without card conflation',async()=>{
 const f=setup();
 try{
  f.context.characters[0].data={character_book:{entries:[{enabled:true,content:'周宁是学校的同学。'}]}};
  f.context.characters.push({name:'华京大学',avatar:'location.png'});f.context.chat.push({mes:'小乔是当地的摄影师。'});
  const npc={name:'小乔',handle:'qiao',has_account:true,authorKind:'npc',npcEvidence:'小乔是当地的摄影师。',text:'今天尝试了一款旧镜头。'};
  const book={name:'周宁',handle:'ning',has_account:true,authorKind:'npc',npcEvidence:'周宁是学校的同学。',text:'排练结束了。'};
  const org={name:'华京大学',handle:'university',authorKind:'organization',has_account:true,text:'校内阅览室周五开放。'};
  f.reply({posts:[npc,book,org,{name:'捏造的同学',handle:'fake',authorKind:'npc',npcEvidence:'不存在的剧情。',text:'hello'}]});ok(await f.x.refresh());
  assert.deepEqual(xItems(f.state(),'post').map(p=>p.text),[npc.text,book.text]);assert.equal(xItems(f.state(),'account').length,2);
  f.reply({posts:[]});const empty=await f.x.refresh();ok(empty);assert.equal(empty.value.added,0);
  const publicBasis={access:'background',summary:'普通公共背景',involvesCharacters:false};
  f.reply({posts:[{...org,publicBasis},{name:'慢走',handle:'walking',authorKind:'public',text:'雨后散步。',publicBasis},
   {...npc,authorKind:'public',publicBasis},{name:'KPL 赛事速报',handle:'kpl',authorKind:'organization',text:'本周常规赛赛程。',publicBasis},...squareRows(7,200)]});
  ok(await f.x.refresh('square'));const square=xItems(f.state(),'post').filter(p=>p.feed==='square');assert.equal(square.length,10);
  const school=xItems(f.state(),'account').find(a=>a.handle==='university');assert.equal(school.characterId,null);assert.equal(school.authorKind,'organization');
  const joe=xItems(f.state(),'account').find(a=>a.handle==='qiao');ok(await f.x.follow(school.id,true));ok(await f.x.follow(joe.id,true));
  f.reply({posts:[{accountId:school.id,text:'Official notice'}, {accountId:joe.id,text:'New photo'}]});ok(await f.x.refresh(true));
  assert.equal(xItems(f.state(),'post').some(p=>p.text==='Official notice'),false);assert.equal(f.state().x[school.id].following,true);
  assert.equal(xItems(f.state(),'post').at(-1).author,joe.id);
 }finally{f.close();}
});

test('X direct messages delete one record permanently and long-press never rerolls',async()=>{
 const f=setup();try{
  const id=await account(f,'open');f.reply({status:'reply',text:'Hello'});ok(await f.x.send(id,'Hi'));
  const all=xItems(f.state(),'message'),theirs=all.find(m=>m.role==='assistant'),mine=all.find(m=>m.role==='user');
  ok(await f.x.deleteMessage(theirs.id));assert.equal(f.state().x[theirs.id],undefined);
  assert.deepEqual(xItems(f.state(),'message').map(m=>m.id),all.map(m=>m.id).filter(m=>m!==theirs.id));
  assert.equal(f.state().x[mine.id].text,'Hi');
  const reload=createPhoneMemory({getContext:()=>f.context});try{assert.equal((await reload.read()).state.x[theirs.id],undefined);}finally{reload.destroy();}
  assert.equal((await f.x.deleteMessage(theirs.id)).ok,false);
  ok(await f.x.deleteMessage(mine.id));assert.equal(xItems(f.state(),'message').length,0);
  assert.equal(Object.keys(f.state().x).filter(k=>f.state().x[k].type==='account').length,1);
 }finally{f.close();}
});

test('a stale ticket cannot restore a deleted X DM or its in-flight reply',async()=>{
 const f=setup();try{
  const id=await account(f,'open');f.reply({status:'reply',text:'Hello'});ok(await f.x.send(id,'Hi'));
  const msg=xItems(f.state(),'message').find(m=>m.role==='assistant');
  const stale=await f.memory.begin();
  ok(await f.x.deleteMessage(msg.id));
  await assert.rejects(f.memory.commit(stale,[{collection:'x',key:msg.id,value:msg}]));
  assert.equal(f.state().x[msg.id],undefined);
  const reload=createPhoneMemory({getContext:()=>f.context});try{assert.equal((await reload.read()).state.x[msg.id],undefined);}finally{reload.destroy();}
 }finally{f.close();}
});


// ---- Post deletion and trend injection (1.1.29) ----

test('deleting a post removes it with its comments and influence, other posts and accounts stay, rollback restores everything',async()=>{
 const f=setup();try{
  const id=await account(f);ok(await f.x.follow(id,true));
  f.reply({posts:[{accountId:id,text:'The park post',comments:[{key:'a',name:'Bea',handle:'bea',text:'A friend remark'}]},...squareRows(10,300)]});
  ok(await f.x.refresh(true));
  const homePost=xItems(f.state(),'post').find(p=>p.text==='The park post');
  ok(await f.x.react(homePost.id,'liked'));
  const before=xItems(f.state(),'post').length,commentsBefore=xItems(f.state(),'comment').length;
  assert.ok(commentsBefore>=1);
  const result=await f.x.deletePost(homePost.id);ok(result);
  assert.equal(f.state().x[homePost.id],undefined);
  assert.equal(xItems(f.state(),'post').length,before-1);
  assert.equal(xItems(f.state(),'comment').filter(c=>c.postId===homePost.id).length,0);
  assert.equal(f.state().x[id]?.type,'account','accounts are not deleted');
  // Deletion is tracked and permanent: the erase rewrites the import event.
  f.context.chatMetadata=JSON.parse(JSON.stringify(f.context.chatMetadata));await f.memory.read();
  assert.equal(f.state().x[homePost.id],undefined,'deleted post never resurrects after reload');
 }finally{f.close();}
});

test('square and user posts can be deleted the same way and trend injection toggles persist and roll back',async()=>{
 const f=setup();try{
  f.reply({posts:squareRows(10,400)});ok(await f.x.refresh('square'));
  const squarePost=xItems(f.state(),'post').at(-1);
  ok(await f.x.deletePost(squarePost.id));
  assert.equal(f.state().x[squarePost.id],undefined);
  ok(await f.x.publish('My own post'));
  const mine=xItems(f.state(),'post').find(p=>p.author==='user');
  ok(await f.x.comment(mine.id,'A comment on mine'));
  ok(await f.x.deletePost(mine.id));
  assert.equal(f.state().x[mine.id],undefined);
  assert.equal(xItems(f.state(),'comment').filter(c=>c.postId===mine.id).length,0);
  ok(await f.x.publish('A post for the trend candidates.'));
  const trendCandidate=xItems(f.state(),'post').find(p=>p.author==='user');
  f.reply(({quietPrompt})=>{
   if(quietPrompt.includes('趋势评估资料'))return JSON.stringify({topics:worldTopics([{title:'注入测试话题',summary:'A trend used for injection',scope:'本地',sourcePostIds:[]}]),evaluations:[{postId:trendCandidate.id,eligible:false}]});
   return JSON.stringify({posts:[]});
  });
  ok(await f.x.refreshTrends());
  assert.equal(f.state().x['trend-edition'].topics[0].injected,undefined);
  ok(await f.x.toggleTrendInjection(0));
  let topics=f.state().x['trend-edition'].topics;
  assert.equal(topics[0].injected,true);
  const {buildOpinionPrompt}=await import('../src/x-opinion.js');
  assert.equal(buildOpinionPrompt(f.state(),[{mes:'2026-01-01'}],''),'','selected trends are stored but never injected into narrative');
  ok(await f.x.toggleTrendInjection(0));
  assert.equal(f.state().x['trend-edition'].topics[0].injected,false);
  assert.doesNotMatch(buildOpinionPrompt(f.state(),[{mes:'2026-01-01'}],''),/注入测试话题/);
  f.context.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();
  assert.equal(f.state().x['trend-edition'],undefined,'the whole trend edition rolls back with its floor');
 }finally{f.close();}
});


test('first floor refresh ignores QQJ, upgrades work on the same legacy floor, and later floors add followers once',async()=>{
 const f=setup(),previous=globalThis.qqj_v3_public_bridge_v1;let reads=0;
 try{
  f.context.chat[0].mes='2026-06-01\nA first public X post.';
  ok(await f.x.publish('A song is released.'));const post=xItems(f.state(),'post')[0];
  const results=[feedResult(),{initialFollowers:100,stats:[{postId:post.id,likes:120,reposts:14,replies:5,gained:20,lost:0}]}];
  f.reply(()=>JSON.stringify(results.shift()));
  globalThis.qqj_v3_public_bridge_v1={getSnapshot(){reads++;throw Error('First refresh must not read QQJ');},
   getPeopleSnapshot(){reads++;throw Error('First refresh must not read QQJ');}};
  ok(await f.x.refreshPublic());assert.equal(reads,0);
  assert.equal(f.state().x.audience.followers,120);
  assert.deepEqual(f.state().x['follower-floor-ledger'].ranges,[[0,0]]);
  f.context.chat.push({mes:'2026-06-02\nThe song remains viral. More people follow its singer.'});await f.memory.read();
  const update=[feedResult(),{effects:[{postId:post.id,gained:17,lost:2}]}];
  f.reply(()=>JSON.stringify(update.shift()));
  ok(await f.x.refreshPublic());
  assert.equal(f.state().x.audience.followers,149); // 120 + 14 scheduled day-two reach + 15 new floor impact
  assert.deepEqual(f.state().x['follower-floor-ledger'].ranges,[[0,1]]);
  const count=f.count();assert.equal((await f.x.refreshPublic()).ok,false);assert.equal(f.count(),count);
  f.context.chat.pop();await f.memory.read();
  assert.equal(f.state().x.audience.followers,120);
  assert.deepEqual(f.state().x['follower-floor-ledger'].ranges,[[0,0]]);
 }finally{globalThis.qqj_v3_public_bridge_v1=previous;f.close();}
});
test('legacy refreshed chat without a floor ledger is allowed to initialize without QQJ',async()=>{
 const f=setup(),previous=globalThis.qqj_v3_public_bridge_v1;let reads=0;
 try{
  f.context.chat[0].mes='2026-06-01\nStory.';
  await f.memory.commit(await f.memory.begin(),[
   {collection:'x',key:'audience',value:{id:'audience',type:'audience',initialFollowers:90,followers:90}},
   {collection:'x',key:'public-refresh',value:{id:'public-refresh',type:'refresh',floor:0}}
  ]);
  globalThis.qqj_v3_public_bridge_v1={getSnapshot(){reads++;throw Error('QQJ must be skipped');}};
  const seq=[feedResult()];
  f.reply(()=>JSON.stringify(seq.shift()));
  ok(await f.x.refreshPublic());assert.equal(reads,0);
  assert.deepEqual(f.state().x['follower-floor-ledger'].ranges,[[0,0]]);
 }finally{globalThis.qqj_v3_public_bridge_v1=previous;f.close();}
});

test('previous floor ledger is reconciled once for existing discussions of a viral tweet',async()=>{
 const f=setup(),oldBridge=globalThis.qqj_v3_public_bridge_v1;let reads=0;
 try{
  f.context.chat[0].mes='2026-06-01\n很多人正在讨论山姆的公开推文，朋友们不断转发，推文持续走红。';
  ok(await f.x.publish('山姆发布了公开的演出视频。'));
  const post=xItems(f.state(),'post')[0];
  const impact={id:'impact:post:'+post.id,type:'influence',sourceId:'post:'+post.id,
      start:null,end:null,gained:20,lost:0,total:20,settled:1,expired:true};
  await f.memory.commit(await f.memory.begin(),[
   {collection:'x',key:'audience',value:{id:'audience',type:'audience',initialFollowers:100,followers:120}},
   {collection:'x',key:impact.id,value:impact},
   {collection:'x',key:'public-refresh',value:{id:'public-refresh',type:'refresh',floor:0}},
   {collection:'x',key:'follower-floor-ledger',value:{id:'follower-floor-ledger',type:'floor-ledger',ranges:[[0,0]]}}
  ]);
  globalThis.qqj_v3_public_bridge_v1={getSnapshot(){reads++;throw Error('catch-up must skip QQJ');},
     getPeopleSnapshot(){reads++;throw Error('catch-up must skip QQJ');}};
  const results=[feedResult(),{effects:[{postId:post.id,gained:38,lost:2}]}];
  f.reply(({quietPrompt})=>{
   if(quietPrompt.includes('当前任务：X 未结算剧情楼层')){
     assert.match(quietPrompt,/很多人正在讨论山姆的公开推文/);
     assert.match(quietPrompt,/不要求正文明确写出/);
     assert.match(quietPrompt,/"metricsBefore"/);
   }
   return JSON.stringify(results.shift());
  });
  ok(await f.x.refreshPublic());
  assert.equal(reads,0);assert.equal(f.state().x.audience.followers,156);
  assert.equal(f.state().x['follower-floor-ledger'].version,2);
  assert.deepEqual(f.state().x['follower-floor-ledger'].ranges,[[0,0]]);
  const count=f.count();assert.equal((await f.x.refreshPublic()).ok,false);assert.equal(f.count(),count);
 }finally{globalThis.qqj_v3_public_bridge_v1=oldBridge;f.close();}
});
test('old refresh marker with no floor ledger also permits missed follower catch-up',async()=>{
 const f=setup(),oldBridge=globalThis.qqj_v3_public_bridge_v1;let reads=0;
 try{
  f.context.chat[0].mes='2026-06-01\n同学都在聊这条公开推文，热度一直很高。';
  ok(await f.x.publish('公开的视频片段'));
  const post=xItems(f.state(),'post')[0];
  await f.memory.commit(await f.memory.begin(),[
   {collection:'x',key:'audience',value:{id:'audience',type:'audience',initialFollowers:20,followers:30}},
   {collection:'x',key:'impact:post:'+post.id,value:{id:'impact:post:'+post.id,type:'influence',sourceId:'post:'+post.id,
     start:null,end:null,gained:10,lost:0,total:10,settled:1,expired:true}},
   {collection:'x',key:'public-refresh',value:{id:'public-refresh',type:'refresh',floor:0}}
  ]);
  globalThis.qqj_v3_public_bridge_v1={getSnapshot(){reads++;throw Error('first marked refresh skips QQJ')}};
  const seq=[feedResult(),{effects:[{postId:post.id,gained:8,lost:1}]}];
  f.reply(()=>JSON.stringify(seq.shift()));
  ok(await f.x.refreshPublic());
  assert.equal(reads,0);assert.equal(f.state().x.audience.followers,37);
  assert.equal(f.state().x['follower-floor-ledger'].version,2);
  assert.equal((await f.x.refreshPublic()).ok,false);
 }finally{globalThis.qqj_v3_public_bridge_v1=oldBridge;f.close();}
});


test('manual X composer has an optional separate photo description and persists it without altering tweet text',async()=>{
 const f=setup();try{
  const {createXPanel}=await import('../src/x-view.js');
  const panel=createXPanel({adapter:{userName:()=>f.context.name1},getView:f.state,redraw(){},notice(){}});
  const form=panel.html();
  assert.match(form,/data-x-field="imageDescription"[^>]*placeholder="图片描述，不带也可以～"/);
  assert.ok(form.indexOf('data-x-field="imageDescription"')<form.indexOf('data-x-field="post"'));
  const css=(await import('node:fs')).readFileSync(new URL('../style.css',import.meta.url),'utf8');
  assert.match(css,/textarea\[data-x-field="imageDescription"\]:focus::placeholder\{opacity:0\}/);
  assert.match(css,/min-height:30px!important/);
  assert.match(css,/background:transparent!important;border:0!important/);
  assert.doesNotMatch(css,/background:#f7f9f9!important;border:1px solid #e1e8ed!important/);
  const description='你拿着黑胶唱片站在暖色灯光下。';
  const tweet='雨天的黑胶唱片店，听见了最爱的老歌。';
  ok(await f.x.publish(tweet,description));
  ok(await f.x.publish('只有文字的随手一帖。'));
  const [withPicture,withoutPicture]=xItems(f.state(),'post');
  assert.equal(withPicture.text,tweet);
  assert.equal(withPicture.imageDescription,description);
  assert.equal(withoutPicture.text,'只有文字的随手一帖。');
  assert.equal(Object.hasOwn(withoutPicture,'imageDescription'),false);
  await panel.action('profile');
  assert.match(panel.html(),/配图描述/);
  assert.match(panel.html(),/你拿着黑胶唱片站在暖色灯光下/);
  assert.equal(f.count(),0,'normal publishing does not add model requests');
 }finally{f.close();}
});

test('NPC home and square posts independently keep optional image descriptions',async()=>{
 const f=setup();try{
  const home=feedResult({posts:[
    {name:'Alex',handle:'alex',has_account:true,text:'The local record store.',imageDescription:'木制唱片架前摆着一张老黑胶。'},
    {name:'同学1',handle:'fixture_1',authorKind:'npc',has_account:true,npcEvidence:'同学1是校园乐队成员。',text:'A text-only update.'}
  ]});
  f.reply(home);
  ok(await f.x.refresh());
  assert.match(f.prompt(),/imageDescription/);
  assert.match(f.prompt(),/可按自身习惯、当下内容与情境发布纯文字或附图帖/);
  const alex=xItems(f.state(),'post').find(p=>p.text==='The local record store.');
  const bea=xItems(f.state(),'post').find(p=>p.text==='A text-only update.');
  assert.equal(alex.imageDescription,'木制唱片架前摆着一张老黑胶。');
  assert.equal(Object.hasOwn(bea,'imageDescription'),false);
  const rows=squareRows(10);
  rows[0].imageDescription='路边摄影者拍下了刚开的橱窗。';
  f.reply({posts:rows,replies:[]});
  ok(await f.x.refresh('square'));
  assert.match(f.prompt(),/广场帖子可纯文字，也可附图/);
  const square=xItems(f.state(),'post').find(p=>p.text===rows[0].text);
  assert.equal(square.imageDescription,rows[0].imageDescription);
  assert.equal(Object.hasOwn(xItems(f.state(),'post').find(p=>p.text===rows[1].text),'imageDescription'),false);
  const {createXPanel}=await import('../src/x-view.js');
  const panel=createXPanel({adapter:{userName:()=>f.context.name1},getView:f.state,redraw(){},notice(){}});
  assert.match(panel.html(),/木制唱片架前摆着一张老黑胶。/);
  await panel.action('tab','square');
  assert.match(panel.html(),/路边摄影者拍下了刚开的橱窗。/);
 }finally{f.close();}
});


test('X feed consumes a complete posts array without another model request',async()=>{
 const f=setup();try{
  const id=await account(f);const before=f.count();
  f.reply(()=>'<think>drafting feed</think>\\n'+JSON.stringify([{accountId:id,text:'今天的排练刚结束。'}]));
  const result=await f.x.refresh();
  ok(result);assert.equal(f.count(),before+1);
  assert.equal(xItems(f.state(),'post').length,1);
  assert.equal(xItems(f.state(),'post')[0].text,'今天的排练刚结束。');
 }finally{f.close();}
});

for(const independent of [false,true])test('X '+(independent?'independent':'host')+' malformed non-JSON response gets one contract-only retry',async()=>{
 const f=setup(undefined,independent);try{
  let replies=0;
  f.reply(()=>++replies===1?'这是本期动态的说明，缺少JSON。':JSON.stringify(feedResult()));
  ok(await f.x.refresh());
  assert.equal(f.count(),2);assert.equal(replies,2);
  assert.match(f.prompt(),/X 格式恢复/);
  assert.equal(xItems(f.state(),'post').length,10);
 }finally{f.close();}
});

test('X wrong-shape array is retried once, repeated bad results are not saved or retried forever',async()=>{
 const f=setup();try{
  let n=0;
  f.reply(()=>++n===1?'[{"text":"只有内容没有作者"}]':JSON.stringify(feedResult()));
  ok(await f.x.refresh());assert.equal(n,2);
  const prior=JSON.stringify(f.state().x);
  f.reply(()=>'抱歉，本次未能按要求输出数据。');
  const failed=await f.x.refresh();
  assert.equal(failed.ok,false);assert.equal(failed.code,'MODEL_JSON_MISSING');
  assert.equal(n,2);assert.equal(f.count(),4);
  assert.match(failed.error,/未返回 JSON/);
  assert.equal(JSON.stringify(f.state().x),prior);
 }finally{f.close();}
});

test('X truncated or syntactically invalid JSON is not repaired by guessing or extra requests',async()=>{
 const f=setup();try{
  for(const [raw,code] of [['{"posts":','MODEL_JSON_TRUNCATED'],['{posts:[]}','MODEL_JSON_SYNTAX']]){
   const count=f.count();f.reply(()=>raw);
   const result=await f.x.refresh();
   assert.equal(result.ok,false);assert.equal(result.code,code);assert.equal(f.count(),count+1);
  }
 }finally{f.close();}
});


test('public X follow, unfollow, like and repost form non-directed one-shot home pulse',async()=>{
 const {xPendingPublicActivities}=await import('../src/x.js');
 const f=setup();try{
  f.context.chat[0].mes='2026-11-05 10:00';await f.memory.read();
  const id=await account(f);const initialCount=f.count();
  ok(await f.x.follow(id,true));
  const initial=xPendingPublicActivities(f.state());
  assert.equal(initial.length,1);assert.equal(initial[0].action,'follow');
  assert.equal(initial[0].shown,false);assert.equal(f.count(),initialCount,'following never calls a model');
  const seen=[];
  f.reply(({quietPrompt})=>{
    seen.push(quietPrompt);
    if(quietPrompt.includes('逐条独立估计'))return JSON.stringify({initialFollowers:10,stats:[]});
    return JSON.stringify(feedResult({activityReactions:[]}));
  });
  ok(await f.x.refreshPublic());
  assert.equal(xPendingPublicActivities(f.state()).length,0);
  assert.ok(seen[0].includes('本次首页刷新新增的一次性公开社交动态'));
  assert.ok(seen[0].includes('"action":"follow"'));
  assert.match(seen[0],/不是发送给某个NPC的私信/);
  assert.ok(!seen[0].includes('user 最近公开转发'), 'old public reposts must not be repeated in every generic X task');
  const displayed=Object.values(f.state().x).find(row=>row.type==='public-activity');
  assert.equal(displayed.shown,true);
  assert.equal((await f.x.refreshPublic()).ok,false,'same floor has no new story or public activity');
  const oldCalls=f.count();
  const post=xItems(f.state(),'post')[0];
  ok(await f.x.react(post.id,'liked'));
  ok(await f.x.react(post.id,'reposted'));
  ok(await f.x.follow(id,false));
  assert.equal(f.count(),oldCalls,'actions are local until next home refresh');
  assert.deepEqual(xPendingPublicActivities(f.state()).map(x=>x.action).sort(),['like','repost','unfollow']);
  const panel=(await import('../src/x-view.js')).createXPanel({adapter:{userName:()=>f.context.name1,storyChat:()=>f.context.chat},getView:f.state,redraw(){},notice(){}});
  const button=panel.html().match(/<button[^>]+data-x-action="refresh"[^>]*>/)?.[0];
  assert.ok(button);assert.doesNotMatch(button,/\sdisabled\b/,'activity unlocks home refresh on an already refreshed floor');
  const before=seen.length;
  ok(await f.x.refreshPublic());
  assert.ok(seen[before].includes('"action":"unfollow"'));
  assert.ok(seen[before].includes('"action":"like"'));
  assert.ok(seen[before].includes('"action":"repost"'));
  assert.ok(!seen[before].includes('向 Alex 发私信'));
  assert.equal(xPendingPublicActivities(f.state()).length,0);
  const count=f.count();
  assert.equal((await f.x.refreshPublic()).ok,false);
  assert.equal(f.count(),count);
  // Reversing an already-shown action starts a fresh public pulse.
  ok(await f.x.react(post.id,'liked'));
  ok(await f.x.react(post.id,'reposted'));
  assert.deepEqual(xPendingPublicActivities(f.state()).map(x=>x.action).sort(),['unlike','unrepost']);
 }finally{f.close();}
});

test('public X social pulse cannot be consumed by square, trends, followed feed or a failed home refresh',async()=>{
 const {xPendingPublicActivities}=await import('../src/x.js');
 const f=setup();try{
  f.context.chat[0].mes='2026-11-06 09:00';await f.memory.read();
  const id=await account(f);
  ok(await f.x.follow(id,true));
  const captured=[];
  f.reply(({quietPrompt})=>{
    captured.push(quietPrompt);
    if(quietPrompt.includes('趋势评估资料'))return JSON.stringify({topics:worldTopics(),evaluations:[]});
    if(quietPrompt.includes('当前任务：X 广场'))return JSON.stringify({posts:squareRows(10)});
    return JSON.stringify({posts:[]});
  });
  ok(await f.x.refresh('square'));ok(await f.x.refreshTrends());ok(await f.x.refresh(true));
  assert.equal(xPendingPublicActivities(f.state()).length,1);
  assert.ok(captured.every(p=>!p.includes('本次首页刷新新增的一次性公开社交动态')));
  const story=xStoryPrompt(f.state());
  assert.doesNotMatch(story,/public-activity|新关注|本次首页刷新新增的一次性公开社交动态/);
  f.reply(()=>'{posts:');
  const failed=await f.x.refreshPublic();assert.equal(failed.ok,false);assert.equal(failed.code,'MODEL_JSON_TRUNCATED');
  assert.equal(xPendingPublicActivities(f.state()).length,1);
  f.reply(({quietPrompt})=>quietPrompt.includes('逐条独立估计')?JSON.stringify({initialFollowers:5,stats:[]}):JSON.stringify({posts:[],activityReactions:[]}));
  ok(await f.x.refreshPublic());
  assert.equal(xPendingPublicActivities(f.state()).length,0);
  assert.ok(Object.values(f.state().x).some(row=>row.type==='public-activity'&&row.shown===true));
 }finally{f.close();}
});

test('public X like/follow events create one or two related NPC timeline reactions on the next home refresh',async()=>{
 const {xPendingPublicActivities}=await import('../src/x.js');
 const f=setup();try{
  const accounts=[
   {id:'npc-a',type:'account',name:'Alex',handle:'alex',characterId:'card:alex.png',authorKind:'npc',following:false,blocked:false},
   {id:'npc-b',type:'account',name:'校园男神B',handle:'campus_b',characterId:'card:b.png',authorKind:'npc',following:false,blocked:false},
   {id:'npc-c',type:'account',name:'Bea',handle:'bea',characterId:'card:bea.png',authorKind:'npc',following:false,blocked:false},
  ];
  const post={id:'post-b',type:'post',author:'npc-b',feed:'home',text:'今天在图书馆待了一下午。',metrics:{likes:3,reposts:0,replies:1},liked:false,reposted:false};
  const oldComment={id:'comment-c',type:'comment',postId:post.id,author:'npc-c',text:'效率真高。',replyTo:null};
  await f.memory.commit(await f.memory.begin(),[...accounts,post,oldComment].map(value=>({collection:'x',key:value.id,value})));
  await f.memory.read();
  ok(await f.x.react(post.id,'liked'));
  const event=xPendingPublicActivities(f.state())[0];assert.equal(event.action,'like');
  const prompts=[];
  f.reply(({quietPrompt})=>{
   prompts.push(quietPrompt);
   if(quietPrompt.includes('逐条独立估计'))return JSON.stringify({initialFollowers:20,stats:[]});
   return JSON.stringify(feedResult({posts:[],activityReactions:[
    {eventId:event.id,accountId:'npc-a',text:'有人最近挺关注图书馆那位啊。'},
    {eventId:event.id,accountId:'npc-c',text:'我也看到这条点赞了，什么情况？'}
   ]}));
  });
  const result=await f.x.refreshPublic();ok(result);
  assert.match(prompts[0],/至少生成1条、通常1～2条公开反应推文/);
  assert.match(prompts[0],/当前剧情角色/);
  const reactions=xItems(f.state(),'post').filter(row=>row.publicActivityId===event.id);
  assert.equal(reactions.length,2);
  assert.deepEqual(new Set(reactions.map(row=>row.author)),new Set(['npc-a','npc-c']));
  assert.ok(reactions.every(row=>row.feed==='home'&&row.type==='post'));
  assert.equal(xPendingPublicActivities(f.state()).length,0);
  assert.equal(f.state().x[event.id].shown,true);
  assert.equal(result.value.activityReactions,2);
 }finally{f.close();}
});

test('commenting on an NPC post adds one or two related NPC replies to the same public thread',async()=>{
 const f=setup();
 try{
  const accounts=[
   {id:'npc-a',type:'account',name:'Alex',handle:'alex',characterId:'card:alex.png',authorKind:'npc',following:false,blocked:false},
   {id:'npc-b',type:'account',name:'校园男神B',handle:'campus_b',characterId:'card:b.png',authorKind:'npc',following:false,blocked:false},
   {id:'npc-c',type:'account',name:'Bea',handle:'bea',characterId:'card:bea.png',authorKind:'npc',following:false,blocked:false},
  ];
  const post={id:'thread-post',type:'post',author:'npc-b',feed:'home',text:'今天在图书馆待了一下午。',metrics:{likes:2,reposts:0,replies:1}};
  const existing={id:'existing-comment',type:'comment',postId:post.id,author:'npc-c',text:'真有毅力。',replyTo:null};
  await f.memory.commit(await f.memory.begin(),[...accounts,post,existing].map(value=>({collection:'x',key:value.id,value})));
  await f.memory.read();
  f.reply({text:'确实挺意外的。',reactions:[
   {key:'a',accountId:'npc-a',text:'他平时可坐不住。',replyTo:'user_comment'},
   {key:'c',accountId:'npc-c',text:'你俩怎么还聊上了？',replyTo:'a'}
  ]});
  ok(await f.x.comment(post.id,'你居然真的能坐一下午？'));
  const comments=xItems(f.state(),'comment').filter(row=>row.postId===post.id);
  const userComment=comments.find(row=>row.author==='user');
  const targetReply=comments.find(row=>row.author==='npc-b');
  const aReply=comments.find(row=>row.author==='npc-a');
  const cReply=comments.find(row=>row.author==='npc-c'&&row.id!=='existing-comment');
  assert.ok(userComment&&targetReply&&aReply&&cReply);
  assert.equal(targetReply.replyTo,userComment.id);
  assert.equal(aReply.replyTo,userComment.id);
  assert.equal(cReply.replyTo,aReply.id,'NPCs can join the same thread by replying to another NPC');
  assert.match(f.prompt(),/其他相关NPC是否加入同一公开讨论串/);
  assert.match(f.prompt(),/必须生成至少1条/);
  const {createXPanel}=await import('../src/x-view.js');
  const panel=createXPanel({adapter:{x:f.x},getView:f.state,redraw(){},notice(){}});
  await panel.action('comments',post.id);
  assert.equal((panel.html().match(/data-x-comment="/g)||[]).length,4);
  assert.match(panel.html(),/你俩怎么还聊上了/);
 }finally{f.close();}
});

test('multiple changes to one public X action before the next home refresh only expose latest state',async()=>{
 const {xPendingPublicActivities}=await import('../src/x.js');
 const f=setup();try{
  const id=await account(f);
  ok(await f.x.follow(id,true));ok(await f.x.follow(id,false));ok(await f.x.follow(id,true));
  assert.deepEqual(xPendingPublicActivities(f.state()).map(x=>x.action),['follow']);
  const current=f.count();ok(await f.x.follow(id,true));
  assert.equal(f.count(),current);assert.equal(xPendingPublicActivities(f.state()).length,1);
 }finally{f.close();}
});
