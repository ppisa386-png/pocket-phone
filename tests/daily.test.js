import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createDaily } from '../src/daily.js';
import { createDailyBridge, DAILY_KEY } from '../src/daily-story.js';
import { createDailyPanel } from '../src/daily-view.js';
import { dailyArticles, dailyExpiry, dailyStatus, buildDailyPrompt, dailyChanges } from '../src/daily-core.js';
import { createPhoneMemory } from '../src/memory.js';
import { createPhoneService } from '../src/phone.js';
import { normalizeSettings } from '../src/config.js';
import { dateDay } from '../src/story-clock.js';
const background={access:'background',summary:'Public world news without story characters',involvesCharacters:false};
const article=(headline='城市音乐节开幕',placement='lead')=>({headline,placement,outlet:'城中日报',section:'文化',summary:'音乐节向公众开放。',subject:'world',topic:'culture',newsValue:'公共文化活动',contextAnchor:{keyword:'音乐节',sourceIndex:0,evidence:'音乐节'},body:'市民可以到公园参加音乐节。\n主办方公布了节目单。',publicBasis:background});

const complete = data => {
 const rows=data.articles||[],lead=rows[0];
 const fillers=lead?Array.from({length:Math.max(0,4-rows.length)},(_,i)=>({
  ...article(lead.headline+' · 其他栏目 '+i,'brief'),subject:lead.subject,publicBasis:lead.publicBasis,contextAnchor:lead.contextAnchor
 })):[];
 return {publication:'城中日报',...data,articles:[...rows,...fillers]};
};
function setup(){
 const bus=new EventEmitter();let response=complete({location:'本地',articles:[article()]}),calls=0,lastPrompt='';
 const c={chatId:'daily',chatMetadata:{},chat:[{mes:'2003-07-24\n音乐节公开开幕。',is_user:false}],characters:[{name:'Alex',avatar:'a'}],characterId:0,name1:'Sam',onlineStatus:'connected',saveMetadata:async()=>{},eventSource:bus,
  event_types:Object.fromEntries(['CHAT_CHANGED','MESSAGE_EDITED','MESSAGE_DELETED','MESSAGE_SWIPED','GENERATION_STARTED','GENERATION_AFTER_COMMANDS','GENERATION_ENDED','CHAT_COMPLETION_SETTINGS_READY'].map(n=>[n,n])),
  extensionPrompts:{},setExtensionPrompt(k,v){this.extensionPrompts[k]={value:v};},generateQuietPrompt:async o=>{calls++;lastPrompt=o.quietPrompt;return typeof response==='function'?response():JSON.stringify(response);}};
 const settings=normalizeSettings({retries:4}),memory=createPhoneMemory({getContext:()=>c}),phone=createPhoneService({memory,getContext:()=>c,getSettings:()=>settings});
 const daily=createDaily({memory,phone,getContext:()=>c,getSettings:()=>settings}),bridge=createDailyBridge({getContext:()=>c,getSettings:()=>settings});
 return {c,bus,settings,memory,phone,daily,bridge,calls:()=>calls,prompt:()=>lastPrompt,state:()=>phone.snapshot(),reply:r=>response=typeof r==='function'?r:complete(r),close(){bridge.destroy();phone.destroy();memory.destroy();}};
}
const ok=r=>assert.equal(r.ok,true,r.error);
const first=f=>dailyArticles(f.state())[0];

test('open/read/select are local, one click one request; empty selections create no normal prose burden',async()=>{
 const f=setup();try{await f.daily.open();assert.equal(f.calls(),0);await f.bridge.prepare();assert.equal(f.c.extensionPrompts[DAILY_KEY].value,'');
  ok(await f.daily.update());assert.equal(f.calls(),1);assert.equal(buildDailyPrompt(f.state(),f.c.chat),'');
  const a=first(f);ok(await f.daily.toggle(a.id));assert.match(buildDailyPrompt(f.state(),f.c.chat),/城市音乐节开幕/);ok(await f.daily.toggle(a.id));assert.equal(buildDailyPrompt(f.state(),f.c.chat),'');assert.equal(f.calls(),1);
  assert.match(f.prompt(),/最近二十条/);assert.match(f.prompt(),/普通 user 不强行上报/);assert.match(f.prompt(),/小歌手/);assert.match(f.prompt(),/不预知未来/);
 }finally{f.close();}
});
test('story midnight expires the whole edition without needing an hour or wall clock',async()=>{
 const f=setup();try{ok(await f.daily.update());ok(await f.daily.toggle(first(f).id));f.c.chat.push({mes:'2003-07-24 23:59'});await f.memory.read();assert.match(buildDailyPrompt(f.state(),f.c.chat),/城市音乐节开幕/);
  f.c.chat.push({mes:'2003-07-25 00:00'});await f.memory.read();assert.equal(dailyExpiry(f.state().daily.edition,f.c.chat),'expired');assert.equal(buildDailyPrompt(f.state(),f.c.chat),'');assert.equal((await f.daily.toggle(first(f).id)).ok,false);assert.equal(f.calls(),1);
  f.c.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();assert.match(buildDailyPrompt(f.state(),f.c.chat),/城市音乐节开幕/);
 }finally{f.close();}
});
test('missing date stays unknown, future article dates cannot be invented by model',async()=>{
 const f=setup();try{f.c.chat[0].mes='A scene about 音乐节 without a date.';f.reply({date:'2030-01-01',articles:[article()]});ok(await f.daily.update());assert.equal(f.state().daily.edition.day,null);assert.equal((await f.daily.toggle(first(f).id)).ok,false);
  assert.equal(dailyExpiry({day:dateDay('2003-07-24')},[{mes:'2003-07-23'}]),'unknown');assert.equal(dailyExpiry({day:null},[{mes:'2003-07-24'}]),'unknown');
 }finally{f.close();}
});
test('private or old sources cannot be reported; all-invalid results preserve previous edition and do not retry',async()=>{
 const f=setup();try{ok(await f.daily.update());const before=f.state().daily.edition;
  for(const basis of [{...background,access:'private'},{access:'public',summary:'Source',sourceIndex:0,evidence:'Never said this.'},{access:'limited',summary:'Curtains open',sourceIndex:0,evidence:'音乐节公开开幕。'}]){
   f.reply({articles:[{...article('不得出现'),publicBasis:basis}]});assert.equal((await f.daily.update()).ok,false);assert.deepEqual(f.state().daily.edition,before);
  }
  assert.equal(f.calls(),4);f.reply(()=>{throw Error('offline');});assert.equal((await f.daily.update()).ok,false);assert.equal(f.calls(),5);assert.deepEqual(f.state().daily.edition,before);
 }finally{f.close();}
});
test('headlines, feature and short mention preserve editorial hierarchy; private rows are filtered',async()=>{
 const f=setup();try{f.reply({articles:[article('小歌手的新单曲','brief'),article('地区活动','lead'),article('行业消息','feature'),article('城市简讯','brief'),{...article('私事'),publicBasis:{...background,access:'private'}}]});ok(await f.daily.update());assert.deepEqual(dailyArticles(f.state()).map(a=>a.placement),['lead','feature','brief','brief']);
  const panel=createDailyPanel({adapter:{daily:f.daily,storyChat:()=>f.c.chat},getView:f.state,redraw(){},notice(){}});assert.match(panel.html(),/pp-daily-lead/);assert.match(panel.html(),/pp-daily-brief/);assert.doesNotMatch(panel.html(),/私事/);await panel.action('read',first(f).id);assert.match(panel.html(),/主办方公布/);assert.equal(f.calls(),1);
 }finally{f.close();}
});
test('daily source quotations are restricted to the latest twenty replies, including memory-hidden originals',async()=>{
 const f=setup();try{
  for(let i=1;i<=25;i++)f.c.chat.push({mes:'公开活动 '+i+' 已举行。',is_user:false});
  f.c.chat[25].is_system=true;f.c.chat[25].extra={qianqianjieAutoHide:{schemaVersion:1,chatId:'qq'}};
  f.reply({articles:[{...article('旧消息'),subject:'character',publicBasis:{access:'public',summary:'Old event',sourceIndex:0,evidence:'音乐节公开开幕。'}}]});assert.equal((await f.daily.update()).ok,false);
  f.reply({articles:[{...article('最新消息'),subject:'character',publicBasis:{access:'public',summary:'Public event',sourceIndex:25,evidence:'公开活动 25 已举行。'}}]});ok(await f.daily.update());assert.equal(first(f).publicBasis.sourceIndex,25);
  const payload=JSON.parse(f.prompt().split('剧情资料：')[1].split('\n')[0]);assert.equal(payload.recentProse.filter(p=>p.role==='assistant').length,20);assert.equal(payload.recentProse[0].index,6);
 }finally{f.close();}
});
test('adoption only follows selection and requires real narrative evidence, delete and regenerate restore it',async()=>{
 const f=setup();try{ok(await f.daily.update());const a=first(f);ok(await f.daily.toggle(a.id));const evidence='Alex 阅读了音乐节报道。',tag='<!--durian-daily-used:'+JSON.stringify({id:a.id,used:true,evidence})+'-->';
  for(const m of [{is_user:true,mes:evidence+tag},{mes:'<think>'+evidence+tag+'</think>'},{mes:'```'+evidence+tag+'```'},{mes:tag}]){f.c.chat.push(m);assert.match(buildDailyPrompt(f.state(),f.c.chat),/城市音乐节开幕/);f.c.chat.pop();}
  f.c.chat.push({mes:evidence+tag});await f.memory.read();assert.equal(buildDailyPrompt(f.state(),f.c.chat),'');assert.equal(dailyStatus(first(f),f.state(),f.c.chat),'used');assert.equal((await f.daily.toggle(a.id)).ok,false);
  await f.bridge.prepare('regenerate');assert.match(f.c.extensionPrompts[DAILY_KEY].value,/城市音乐节开幕/);
  f.c.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();assert.match(buildDailyPrompt(f.state(),f.c.chat),/城市音乐节开幕/);
 }finally{f.close();}
});
test('new edition retires previous selections and rollback restores prior edition',async()=>{
 const f=setup();try{ok(await f.daily.update());const old=first(f);ok(await f.daily.toggle(old.id));f.c.chat.push({mes:'Later the same day.'});await f.memory.read();f.reply({articles:[article('更新的报道')]});ok(await f.daily.update());assert.equal(buildDailyPrompt(f.state(),f.c.chat),'');assert.equal((await f.daily.toggle(old.id)).ok,false);
  f.c.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();assert.equal(first(f).id,old.id);assert.match(buildDailyPrompt(f.state(),f.c.chat),/城市音乐节开幕/);
 }finally{f.close();}
});
test('reprinting a story preserves identity and adoption, multiple lead labels are normalized',async()=>{
 const f=setup();try{
  ok(await f.daily.update());const old=first(f);ok(await f.daily.toggle(old.id));
  const evidence='Alex 阅读了音乐节报道。';
  f.c.chat.push({mes:evidence+'<!--durian-daily-used:'+JSON.stringify({id:old.id,used:true,evidence})+'-->'});await f.memory.read();
  ok(await f.daily.update());assert.equal(first(f).id,old.id);assert.equal(dailyStatus(first(f),f.state(),f.c.chat),'used');
  assert.equal(buildDailyPrompt(f.state(),f.c.chat),'');
  f.reply({articles:[article('头条一'),article('头条二')]});ok(await f.daily.update());
  assert.equal(dailyArticles(f.state()).filter(a=>a.placement==='lead').length,1);
  const edition=f.state().daily.edition;f.reply({articles:[]});assert.equal((await f.daily.update()).ok,false);assert.deepEqual(f.state().daily.edition,edition);
 }finally{f.close();}
});

test('wrapper JSON is accepted, truncated JSON fails atomically with a newspaper error',async()=>{
 const f=setup();try{f.reply(()=>'<think>prepare</think>\n```json\n'+JSON.stringify(complete({articles:[article()]}))+'\n```');ok(await f.daily.update());const old=first(f);
  f.reply(()=>'SECRET_TEXT {"articles":[');const r=await f.daily.update();assert.equal(r.ok,false);assert.match(r.error,/日报/);assert.doesNotMatch(r.error,/SECRET_TEXT|账本/);assert.equal(first(f).id,old.id);assert.equal(f.calls(),2);
 }finally{f.close();}
});
test('save failure, changed chat and late response never leave a partial new edition',async()=>{
 const f=setup();try{ok(await f.daily.update());const edition=f.state().daily.edition;f.reply({articles:[article('保存失败')]});f.c.saveMetadata=async()=>{throw Error('storage');};assert.equal((await f.daily.update()).ok,false);assert.deepEqual(f.state().daily.edition,edition);f.c.saveMetadata=async()=>{};
  let resolve,start;const ready=new Promise(r=>start=r);f.reply(()=>{start();return new Promise(r=>resolve=r);});const pending=f.daily.update();await ready;f.c.chatId='other';f.c.chatMetadata={};f.bus.emit('CHAT_CHANGED');await f.memory.read();resolve(JSON.stringify(complete({articles:[article('迟到')]})));assert.equal((await pending).ok,false);assert.equal(dailyArticles(f.state()).length,0);
 }finally{f.close();}
});
test('app switch is independent from X; disabling daily cancels output and normal/quiet injection',async()=>{
 const f=setup();try{ok(await f.daily.update());ok(await f.daily.toggle(first(f).id));f.settings.apps.daily=false;assert.equal((await f.daily.update()).ok,false);await f.bridge.prepare();assert.equal(f.c.extensionPrompts[DAILY_KEY].value,'');assert.equal(f.settings.apps.x,true);assert.equal(f.calls(),1);
  f.settings.apps.daily=true;await f.bridge.prepare('quiet');assert.equal(f.c.extensionPrompts[DAILY_KEY].value,'');await f.bridge.prepare('impersonate');assert.equal(f.c.extensionPrompts[DAILY_KEY].value,'');await f.bridge.prepare();assert.match(f.c.extensionPrompts[DAILY_KEY].value,/城市音乐节开幕/);
  let resolve,start;const ready=new Promise(r=>start=r);f.reply(()=>{start();return new Promise(r=>resolve=r);});const pending=f.daily.update();await ready;f.settings.apps.daily=false;resolve(JSON.stringify(complete({articles:[article('已关闭')]})));assert.equal((await pending).ok,false);assert.equal(first(f).headline,'城市音乐节开幕');
 }finally{f.close();}
});
test('selection persists through reload and rolls back with its source floor; article HTML is escaped',async()=>{
 const f=setup();try{f.reply({articles:[article('<img src=x onerror=bad()>')]});ok(await f.daily.update());const a=first(f);f.c.chat.push({mes:'Next turn.'});await f.memory.read();ok(await f.daily.toggle(a.id));
  const copy=setup();copy.c.chat=structuredClone(f.c.chat);copy.c.chatMetadata=structuredClone(f.c.chatMetadata);try{await copy.daily.open();assert.equal(first(copy).selected,true);assert.equal(copy.calls(),0);}finally{copy.close();}
  const panel=createDailyPanel({adapter:{storyChat:()=>f.c.chat},getView:f.state,redraw(){},notice(){}});assert.match(panel.html(),/&lt;img/);assert.doesNotMatch(panel.html(),/<img/);
  f.c.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();assert.equal(first(f).selected,false);
 }finally{f.close();}
});


test('creative world news only needs a genuine context keyword, not a previously happened event',async()=>{
 const f=setup();try{
  f.c.chat[0].mes='2003-07-24\nSam 在洛杉矶经过哈灵顿工业和仁和医院。';
  const base={...article(),contextAnchor:{keyword:'仁和医院',sourceIndex:0,evidence:'仁和医院'}};
  f.reply({publication:'Los Angeles Times',articles:[{...base,headline:'医院引进新的检查设备'},
    {...base,headline:'医疗人才培训项目启动',placement:'feature'},
    {...base,headline:'社区健康项目开放预约',placement:'brief'},
    {...base,headline:'公共医疗设施建设计划发布',placement:'brief'}]});
  ok(await f.daily.update());assert.equal(dailyArticles(f.state()).length,4);
  assert.equal(f.state().daily.edition.publication,'Los Angeles Times');
  assert.equal(first(f).publicBasis.fictional,true);
  assert.equal(buildDailyPrompt(f.state(),f.c.chat),'');assert.deepEqual(f.state().assets,{});
  ok(await f.daily.toggle(first(f).id));assert.match(buildDailyPrompt(f.state(),f.c.chat),/"fictionalWorldNews":true/);
  assert.match(f.prompt(),/不能凭空说 user/);assert.match(f.prompt(),/不是只能报道/);
  const panel=createDailyPanel({adapter:{storyChat:()=>f.c.chat},getView:f.state,redraw(){},notice(){}});
  assert.match(panel.html(),/<h2>Los Angeles Times<\/h2>/);assert.doesNotMatch(panel.html(),/<h2>榴莲日报/);
 }finally{f.close();}
});

test('new editions require four to six valid unique stories and a newspaper title, with no partial replacement',async()=>{
 const f=setup();try{
  ok(await f.daily.update());const before=f.state().daily.edition;
  const valid=complete({articles:[article('新的世界新闻')]});
  for(const bad of [
   {...valid,articles:valid.articles.slice(0,3)},
   {...valid,articles:[...valid.articles,...valid.articles.slice(0,3)]},
   {...valid,publication:'榴莲日报'},
   {...valid,articles:valid.articles.map(a=>({...a,subject:'character'}))},
   {...valid,articles:valid.articles.map(a=>({...a,topic:'private_life'}))},
   {...valid,articles:valid.articles.map(a=>({...a,publicBasis:{...background,involvesCharacters:true}}))}
  ]) {
   f.reply(()=>JSON.stringify(bad));const count=f.calls();assert.equal((await f.daily.update()).ok,false);
   assert.equal(f.calls(),count+1);assert.deepEqual(f.state().daily.edition,before);
  }
 }finally{f.close();}
});

test('legacy editions remain readable, with their recorded outlet as the masthead',()=>{
 const old={daily:{edition:{editionId:'old',day:dateDay('2003-07-24'),articleIds:['a']},a:{...article(),id:'a',type:'article',editionId:'old'}}};
 const panel=createDailyPanel({adapter:{storyChat:()=>[{mes:'2003-07-24'}]},getView:()=>old,redraw(){},notice(){}});
 assert.match(panel.html(),/<h2>城中日报<\/h2>/);
 assert.match(panel.html(),/城市音乐节开幕/);assert.equal(dailyArticles(old).length,1);
});

test('world newspaper accepts four finished stories without technical selection metadata',async()=>{
 const f=setup();try{
  const rows=Array.from({length:4},(_,i)=>({headline:'世界新闻 '+i,body:'根据城市与行业背景展开的新事件。'.repeat(25)}));
  f.reply(()=>JSON.stringify({publication:'Los Angeles Times',articles:rows}));
  ok(await f.daily.update());assert.equal(dailyArticles(f.state()).length,4);
  assert.equal(dailyArticles(f.state()).filter(a=>a.placement==='lead').length,1);
  assert.equal(f.calls(),1);assert.equal(buildDailyPrompt(f.state(),f.c.chat),'');
  assert.match(f.prompt(),/至少4条/);
 }finally{f.close();}
});

test('world articles survive optional metadata mistakes and long text without silent filtering',async()=>{
 const f=setup();try{
  const data=complete({articles:[article('较长新闻')]});
  data.articles=data.articles.map(a=>({...a,topic:'地方资讯',newsValue:undefined,contextAnchor:{keyword:'并非逐字摘录'},summary:'介绍'.repeat(200),body:'报道'.repeat(1500),placement:'普通版面'}));
  f.reply(data);ok(await f.daily.update());assert.equal(dailyArticles(f.state()).length,4);assert.equal(first(f).body.length,3000);assert.equal(f.calls(),1);
 }finally{f.close();}
});

test('missing article contents report item and field without private excerpts',()=>{
 const data=complete({articles:[article('PRIVATE_HEADLINE')]});delete data.articles[1].body;
 assert.throws(()=>dailyChanges(data,{prose:[],day:1,sourceIndex:0}),e=>e.code==='DAILY_ARTICLE_FIELDS'&&/第2条：缺少正文/.test(e.diagnostic)&&!e.diagnostic.includes('PRIVATE_HEADLINE'));
});

test('reprinting on a later day does not reactivate a previously expired pending selection',async()=>{
 const f=setup();try{
  ok(await f.daily.update());ok(await f.daily.toggle(first(f).id));
  f.c.chat.push({mes:'2003-07-25'});await f.memory.read();ok(await f.daily.update());
  assert.equal(first(f).selected,false);assert.equal(buildDailyPrompt(f.state(),f.c.chat),'');
 }finally{f.close();}
});
