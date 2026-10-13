import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createPhoneMemory} from '../src/memory.js';
import {createPhoneService} from '../src/phone.js';
import {createX,xItems} from '../src/x.js';
import {normalizeSettings} from '../src/config.js';
import {recentSquareProse,squareBasis,squareClock,squareExpiry,squareStatus,buildSquarePrompt} from '../src/square-core.js';
import {createXPanel} from '../src/x-view.js';
import {buildContinuityPrompt} from '../src/continuity.js';
const background={access:'background',summary:'Ordinary local life',involvesCharacters:false};
const row=(text='The park is quiet.')=>({name:'路人',handle:'local',text,publicBasis:background});
function fixture(){
 const bus=new EventEmitter();let calls=0,response={posts:[row()]},prompt='';
 const c={chatId:'square',chatMetadata:{},name1:'Sam',name2:'Alex',characters:[{name:'Alex',avatar:'a'}],characterId:0,
  chat:[{mes:'2003-07-24 14:30\nA public park is open.',is_user:false}],saveMetadata:async()=>{},onlineStatus:'connected',eventSource:bus,
  event_types:Object.fromEntries(['CHAT_CHANGED','MESSAGE_EDITED','MESSAGE_DELETED','GENERATION_STARTED','GENERATION_ENDED'].map(n=>[n,n])),
  generateQuietPrompt:async o=>{calls++;prompt=o.quietPrompt;return typeof response==='function'?response():JSON.stringify(response);}};
 const settings=normalizeSettings({retries:5});const memory=createPhoneMemory({getContext:()=>c});const phone=createPhoneService({memory,getContext:()=>c,getSettings:()=>settings});
 const x=createX({memory,phone,getContext:()=>c,getSettings:()=>settings});
 return {c,bus,settings,memory,phone,x,state:()=>phone.snapshot(),calls:()=>calls,prompt:()=>prompt,reply:r=>response=r,close(){phone.destroy();memory.destroy();}};
}
const ok=r=>assert.equal(r.ok,true,r.error);
const post=f=>xItems(f.state(),'post').at(-1);

test('recent source window counts twenty character replies, includes hidden memory floors, excludes older/private annotations',()=>{
 const chat=[];for(let i=0;i<24;i++){chat.push({is_user:true,mes:'user '+i});chat.push({is_user:false,mes:'reply '+i});}
 chat[11]={is_system:true,extra:{qianqianjieAutoHide:{schemaVersion:1,chatId:'qq'}},mes:'reply 5'};
 chat.push({is_system:true,mes:'SYSTEM_SECRET'},{is_user:true,mes:'next request'});
 chat[9].mes+='<!--PRIVATE_MARKER--><think>PRIVATE_THOUGHT</think>```PRIVATE_CODE```';
 const p=recentSquareProse(chat);assert.equal(p.filter(x=>x.role==='assistant').length,20);assert.equal(p[0].text,'user 4');
 assert.ok(p.some(x=>x.text==='reply 5'));assert.equal(p.at(-1).text,'next request');assert.doesNotMatch(JSON.stringify(p),/PRIVATE_|SYSTEM_SECRET|reply 3/);
});
test('private, missing, out-of-window and speculative limited sighting evidence is rejected',()=>{
 const prose=[{index:4,role:'assistant',text:'The terrace is visible. A passerby saw two silhouettes.'}];
 const b={access:'public',summary:'Visible public scene',sourceIndex:4,evidence:'The terrace is visible.'};
 assert.ok(squareBasis({publicBasis:b},prose));assert.equal(squareBasis({publicBasis:{...b,access:'private'}},prose),null);
 assert.equal(squareBasis({publicBasis:{...b,access:'limited'}},prose),null);
 assert.equal(squareBasis({publicBasis:{...b,sourceIndex:3}},prose),null);
 assert.equal(squareBasis({publicBasis:{...b,evidence:'Invented witness'}},prose),null);
 assert.ok(squareBasis({publicBasis:{...b,access:'limited',witnessEvidence:'A passerby saw two silhouettes.'}},prose));
 assert.equal(squareBasis({publicBasis:{...background,involvesCharacters:true}},prose),null);
});
test('twenty-four story hours are exact; unknown hours never use device time or guessed morning time',()=>{
 const start=squareClock([{mes:'2003-07-24 14:30'}]),p={clock:start};
 assert.equal(squareExpiry(p,[{mes:'2003-07-25 14:29'}]),'active');assert.equal(squareExpiry(p,[{mes:'2003-07-25 14:30'}]),'expired');
 assert.equal(squareExpiry(p,[{mes:'2003-07-25'}]),'unknown');assert.equal(squareExpiry(p,[{mes:'2003-07-26'}]),'expired');
 assert.equal(squareClock([{mes:'2003-07-24 上午'}]).hour,null);assert.equal(squareExpiry({clock:{day:start.day,hour:null}},[{mes:'2003-07-24 16:00'}]),'unknown');
 assert.equal(squareExpiry(p,[]),'unknown');
});
test('manual refresh has one attempt, opening and selecting cost zero; failed refresh preserves edition',async()=>{
 const f=fixture();try{
  await f.x.open();assert.equal(f.calls(),0);ok(await f.x.refresh('square'));assert.equal(f.calls(),1);
  assert.equal(buildSquarePrompt(f.state(),f.c.chat),'');const p=post(f);ok(await f.x.toggleInjection(p.id));assert.match(buildSquarePrompt(f.state(),f.c.chat),/The park is quiet/);
  ok(await f.x.toggleInjection(p.id));assert.equal(buildSquarePrompt(f.state(),f.c.chat),'');assert.equal(f.calls(),1);
  const edition=f.state().x['square-edition'];f.reply(()=>{throw Error('offline');});assert.equal((await f.x.refresh('square')).ok,false);assert.equal(f.calls(),2);assert.deepEqual(f.state().x['square-edition'],edition);
  f.reply({posts:[{...row(),publicBasis:{...background,access:'private'}}]});assert.equal((await f.x.refresh('square')).ok,false);assert.equal(f.calls(),3);assert.deepEqual(f.state().x['square-edition'],edition);
  assert.match(f.prompt(),/recentProse/);assert.match(f.prompt(),/私密场所/);
 }finally{f.close();}
});
test('adoption requires a later real narrative evidence marker; deleting adoption restores selected item',async()=>{
 const f=fixture();try{
  ok(await f.x.refresh('square'));const p=post(f);ok(await f.x.toggleInjection(p.id));const evidence='Alex read the park post.';
  const marker='<!--durian-square-used:'+JSON.stringify({id:p.id,used:true,evidence})+'-->';
  for(const m of [{mes:evidence+marker,is_user:true},{mes:'<think>'+evidence+marker+'</think>'},{mes:marker},{mes:'```'+evidence+marker+'```'}]){f.c.chat.push(m);assert.match(buildSquarePrompt(f.state(),f.c.chat),/The park is quiet/);f.c.chat.pop();}
  f.c.chat.push({mes:evidence+marker});await f.memory.read();assert.equal(buildSquarePrompt(f.state(),f.c.chat),'');assert.equal(squareStatus(post(f),f.state(),f.c.chat),'used');assert.equal((await f.x.toggleInjection(p.id)).ok,false);
  f.c.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();assert.match(buildSquarePrompt(f.state(),f.c.chat),/The park is quiet/);assert.equal(f.calls(),1);
 }finally{f.close();}
});
test('expired selected posts remain readable but cannot inject; deleting time jump restores validity',async()=>{
 const f=fixture();try{
  ok(await f.x.refresh('square'));const p=post(f);ok(await f.x.toggleInjection(p.id));
  f.c.chat.push({mes:'2003-07-25 14:30'});await f.memory.read();assert.equal(buildSquarePrompt(f.state(),f.c.chat),'');assert.equal((await f.x.toggleInjection(p.id)).ok,false);
  const panel=createXPanel({adapter:{storyChat:()=>f.c.chat},getView:f.state,redraw(){},notice(){}});await panel.action('tab','square');
  assert.match(panel.html(),/pp-square-expired/);assert.match(panel.html(),/aria-label="已过期"[^>]* disabled/);assert.match(panel.html(),/The park is quiet/);
  f.c.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();assert.match(buildSquarePrompt(f.state(),f.c.chat),/The park is quiet/);
  f.c.chat.push({mes:'2003-07-25'});await f.memory.read();assert.equal(buildSquarePrompt(f.state(),f.c.chat),'');assert.match(panel.html(),/时间不明确/);assert.equal(f.calls(),1);
 }finally{f.close();}
});
test('refresh replaces edition, old selections cannot leak; rollback restores previous edition',async()=>{
 const f=fixture();try{
  ok(await f.x.refresh('square'));const first=post(f);ok(await f.x.toggleInjection(first.id));f.c.chat.push({mes:'Later in the same afternoon.'});await f.memory.read();
  f.reply({posts:[row('The lake is quiet.')]});ok(await f.x.refresh('square'));assert.equal(buildSquarePrompt(f.state(),f.c.chat),'');assert.equal((await f.x.toggleInjection(first.id)).ok,false);
  f.c.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();assert.match(buildSquarePrompt(f.state(),f.c.chat),/The park is quiet/);assert.equal(xItems(f.state(),'post').length,1);
 }finally{f.close();}
});
test('selection rollback, blocked authors, disabled app and stale output cannot inject or resurrect posts',async()=>{
 const f=fixture();try{
  ok(await f.x.refresh('square'));const p=post(f);f.c.chat.push({mes:'Another reply.'});await f.memory.read();ok(await f.x.toggleInjection(p.id));
  f.c.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();assert.equal(buildSquarePrompt(f.state(),f.c.chat),'');
  ok(await f.x.toggleInjection(p.id));ok(await f.x.block(p.author,true));assert.equal(buildSquarePrompt(f.state(),f.c.chat),'');f.settings.apps.x=false;assert.equal((await f.x.refresh('square')).ok,false);assert.equal(f.calls(),1);f.settings.apps.x=true;
  let start,finish;const ready=new Promise(r=>start=r);f.reply(()=>{start();return new Promise(r=>finish=r);});const pending=f.x.refresh('square');await ready;
  f.c.chat[0].mes='Changed scene.';f.bus.emit('MESSAGE_EDITED');await f.memory.read();finish(JSON.stringify({posts:[row('Late post')]}));assert.equal((await pending).ok,false);assert.equal(xItems(f.state(),'post').length,0);
 }finally{f.close();}
});
test('liking or reposting does not bypass manual selection through communication context',async()=>{
 const f=fixture();try{
  ok(await f.x.refresh('square'));const p=post(f);ok(await f.x.react(p.id,'liked'));ok(await f.x.react(p.id,'reposted'));
  assert.doesNotMatch(buildContinuityPrompt(f.state(),{name:'Alex',avatar:'a'},{instruction:'Remember',allConversations:true}),/The park is quiet/);assert.equal(buildSquarePrompt(f.state(),f.c.chat),'');
 }finally{f.close();}
});

test('square comments are local and do not make a second API call',async()=>{
 const f=fixture();try{ok(await f.x.refresh('square'));const p=post(f);ok(await f.x.comment(p.id,'Nice place.'));assert.equal(f.calls(),1);assert.equal(xItems(f.state(),'comment').length,1);assert.equal(xItems(f.state(),'comment')[0].author,'user');}finally{f.close();}
});
