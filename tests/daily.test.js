import {paperDraft, DAILY_SECTIONS, dailySectionCounts, historicalSources} from '../src/daily-core.js';
import { DAILY_EDITORIAL_PROMPT, DAILY_NARRATIVE_PROMPT, PREVIOUS_DAILY_PROMPTS, PREVIOUS_DAILY_EDITORIAL_DEFAULT, PREVIOUS_DAILY_STORY_DEFAULT } from '../src/daily-prompts.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createDaily, dailyHistoryRules } from '../src/daily.js';
import { createDailyBridge, DAILY_KEY } from '../src/daily-story.js';
import { createDailyPanel } from '../src/daily-view.js';
import { dailyArticles, dailyExpiry, dailyStatus, buildDailyPrompt, dailyChanges, dailyArchives, dailyEditorialHistory } from '../src/daily-core.js';
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
  const a=first(f);ok(await f.daily.toggle(a.id));assert.match(buildDailyPrompt(f.state(),f.c.chat),/城市音乐节开幕/);assert.match(buildDailyPrompt(f.state(),f.c.chat),/完全由当前剧情决定/);assert.match(buildDailyPrompt(f.state(),f.c.chat),/整轮完全不提/);assert.doesNotMatch(buildDailyPrompt(f.state(),f.c.chat),/不强制下一回合回应/);ok(await f.daily.toggle(a.id));assert.equal(buildDailyPrompt(f.state(),f.c.chat),'');assert.equal(f.calls(),1);
  assert.doesNotMatch(f.prompt(),/最近二十条/);assert.match(f.prompt(),/普通 user 不强行上报/);assert.match(f.prompt(),/小歌手/);assert.match(f.prompt(),/不预知未来/);
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
test('private declarations and invalid summaries cannot be reported; all-invalid results preserve previous edition and do not retry',async()=>{
 const f=setup();try{ok(await f.daily.update());const before=f.state().daily.edition;
  for(const basis of [{...background,access:'private'},{access:'public',summary:''},{access:'dubious',summary:'Source',involvesCharacters:true},{...background,involvesCharacters:true}]){
   f.reply({articles:[{...article('不得出现'),publicBasis:basis}]});assert.equal((await f.daily.update()).ok,false);assert.deepEqual(f.state().daily.edition,before);
  }
  assert.equal(f.calls(),5);f.reply(()=>{throw Error('offline');});assert.equal((await f.daily.update()).ok,false);assert.equal(f.calls(),6);assert.deepEqual(f.state().daily.edition,before);
 }finally{f.close();}
});
test('headlines, feature and short mention preserve editorial hierarchy; private rows are filtered',async()=>{
 const f=setup();try{f.reply({articles:[article('小歌手的新单曲','brief'),article('地区活动','lead'),article('行业消息','feature'),article('城市简讯','brief'),{...article('私事'),publicBasis:{...background,access:'private'}}]});ok(await f.daily.update());assert.deepEqual(dailyArticles(f.state()).map(a=>a.placement),['lead','feature','brief','brief']);
  const panel=createDailyPanel({adapter:{daily:f.daily,storyChat:()=>f.c.chat},getView:f.state,redraw(){},notice(){}});assert.match(panel.html(),/pp-daily-lead/);assert.match(panel.html(),/pp-daily-brief/);assert.doesNotMatch(panel.html(),/私事/);await panel.action('read',first(f).id);assert.match(panel.html(),/主办方公布/);assert.equal(f.calls(),1);
 }finally{f.close();}
});
test('declared character news keep their source floor without attaching original prose',async()=>{
 const f=setup();try{
  for(let i=1;i<=25;i++)f.c.chat.push({mes:'公开活动 '+i+' 已举行。',is_user:false});
  f.c.chat[25].is_system=true;f.c.chat[25].extra={qianqianjieAutoHide:{schemaVersion:1,chatId:'qq'}};
  f.reply({articles:[{...article('旧消息'),subject:'character',publicBasis:{access:'public',summary:'Old event',sourceIndex:0}}]});ok(await f.daily.update());assert.equal(first(f).publicBasis.sourceIndex,0);
  f.reply({articles:[{...article('最新消息'),subject:'character',publicBasis:{access:'public',summary:'Public event',sourceIndex:25}}]});ok(await f.daily.update());assert.equal(first(f).publicBasis.sourceIndex,25);
  const payload=JSON.parse(f.prompt().split('剧情资料：')[1].split('\n')[0]);assert.equal(payload.recentProse,undefined);assert.doesNotMatch(f.prompt(),/公开活动 25 已举行/);
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
  assert.match(panel.html(),/<h2[^>]*>Los Angeles Times<\/h2>/);assert.doesNotMatch(panel.html(),/<h2[^>]*>榴莲日报/);
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
 assert.match(panel.html(),/<h2[^>]*>城中日报<\/h2>/);
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

// 1.0 archive and editorial continuity regressions.
test('archive keeps three expired dates, same-day refresh replaces rather than archives, and view costs no API',async()=>{
 const f=setup();try{
  ok(await f.daily.update());
  f.reply({articles:[article('同日最终版')]});ok(await f.daily.update());assert.equal(dailyArchives(f.state(),f.c.chat).length,0);
  for(let d=25;d<=28;d++){
   f.c.chat.push({mes:'2003-07-'+d});await f.memory.read();
   const before=dailyArchives(f.state(),f.c.chat);assert.ok(before.length<=3);
   f.reply({articles:[article('第'+d+'日新闻')]});ok(await f.daily.update());
  }
  let old=dailyArchives(f.state(),f.c.chat);assert.deepEqual(old.map(e=>e.day),[27,26,25].map(d=>dateDay('2003-07-'+d)));
  assert.equal(Object.values(f.state().daily).filter(a=>a.type==='article').length,4,'current state removes superseded article entries');
  assert.equal(Object.values(f.state().daily).filter(a=>a.type==='archive').length,3);
  const count=f.calls(),panel=createDailyPanel({adapter:{daily:f.daily,storyChat:()=>f.c.chat},getView:f.state,redraw(){},notice(){}});
  await panel.action('archive');assert.match(panel.html(),/过往报纸夹/);assert.equal((panel.html().match(/data-daily-action="archive-edition"/g)||[]).length,3);
  await panel.action('archive-edition',old[0].editionId);
  assert.doesNotMatch(panel.html(),/data-daily-action="edit"/);
  const archivedActions=panel.press({dataset:{press:'daily-article',dailyId:old[0].articles[0].id}});
  assert.deepEqual(archivedActions.map(a=>a.icon),['edit','inject']);assert.equal(archivedActions.find(a=>a.icon==='inject').disabled,true);
  await panel.action('read',old[0].articles[0].id);assert.match(panel.html(),/主办方公布/);assert.match(panel.html(),/已过期 · 仅供回看/);
  await panel.action('inject',old[0].articles[0].id);assert.equal(f.calls(),count);assert.equal((await f.daily.toggle(old[0].articles[0].id)).ok,false);assert.equal(buildDailyPrompt(f.state(),f.c.chat),'');
  assert.equal(panel.back(),true);assert.match(panel.html(),/过往报纸夹/);assert.equal(panel.back(),true);assert.match(panel.html(),/第28日新闻/);assert.equal(panel.back(),false);
  const copy=setup();try{copy.c.chat=structuredClone(f.c.chat);copy.c.chatMetadata=structuredClone(f.c.chatMetadata);await copy.daily.open();assert.deepEqual(dailyArchives(copy.state(),copy.c.chat),old);assert.equal(copy.calls(),0);}finally{copy.close();}
  f.c.chat.pop();await f.memory.read();assert.match(first(f).headline,/第27日/);assert.deepEqual(dailyArchives(f.state(),f.c.chat).map(e=>e.day),[26,25,24].map(d=>dateDay('2003-07-'+d)));
 }finally{f.close();}
});

test('archive trash removes exactly one stored edition, preserves the other issues and sends no model request',async()=>{
 const f=setup();try{
  ok(await f.daily.update());
  for(let d=25;d<=27;d++){
   f.c.chat.push({mes:'2003-07-'+d});await f.memory.read();
   f.reply({articles:[article('第'+d+'日报道')]});ok(await f.daily.update());
  }
  const before=dailyArchives(f.state(),f.c.chat);
  assert.equal(before.length,3);
  const count=f.calls(),target=before[1],panel=createDailyPanel({adapter:{daily:f.daily,storyChat:()=>f.c.chat},getView:f.state,redraw(){},notice(){}});
  await panel.action('archive');
  assert.match(panel.html(),/data-press="daily-archive"/);
  const actions=panel.press({dataset:{press:'daily-archive',dailyId:target.editionId}});
  assert.deepEqual(actions.map(a=>a.icon),['delete']);
  assert.equal(actions[0].danger,true);
  assert.equal(actions[0].disabled,false);
  await panel.action('archive-edition',target.editionId);
  await panel.action('delete-archive',target.editionId);
  assert.match(panel.html(),/过往报纸夹/);
  assert.deepEqual(dailyArchives(f.state(),f.c.chat).map(e=>e.editionId),[before[0].editionId,before[2].editionId]);
  assert.equal(f.state().daily['archive:'+target.editionId],undefined);
  assert.equal(f.state().daily.archiveSchema.sectionLog.some(e=>e.editionId===target.editionId),false);
  assert.equal(dailyEditorialHistory(f.state(),f.c.chat).some(e=>e.editionId===target.editionId),false);
  assert.equal(f.state().daily.edition.day,dateDay('2003-07-27'));
  assert.match(first(f).headline,/第27日/);
  assert.equal(f.calls(),count);
  const copy=setup();try{
   copy.c.chat=structuredClone(f.c.chat);copy.c.chatMetadata=structuredClone(f.c.chatMetadata);
   await copy.daily.open();
   assert.deepEqual(dailyArchives(copy.state(),copy.c.chat).map(e=>e.editionId),[before[0].editionId,before[2].editionId]);
   assert.equal(copy.calls(),0);
  }finally{copy.close();}
  const again=await f.daily.deleteArchive(target.editionId);assert.equal(again.ok,false);
 }finally{f.close();}
});

test('an expired current edition in the past-issues folder can be deleted without touching earlier archives',async()=>{
 const f=setup();try{
  ok(await f.daily.update());
  f.c.chat.push({mes:'2003-07-25'});await f.memory.read();
  f.reply({articles:[article('第二日期刊')]});ok(await f.daily.update());
  const currentId=f.state().daily.edition.editionId;
  f.c.chat.push({mes:'2003-07-26'});await f.memory.read();
  const before=dailyArchives(f.state(),f.c.chat);
  assert.equal(before[0].editionId,currentId);
  const oldId=before[1].editionId;
  const count=f.calls(),panel=createDailyPanel({adapter:{daily:f.daily,storyChat:()=>f.c.chat},getView:f.state,redraw(){},notice(){}});
  await panel.action('archive');
  assert.deepEqual(panel.press({dataset:{press:'daily-archive',dailyId:currentId}}).map(a=>a.icon),['delete']);
  await panel.action('delete-archive',currentId);
  assert.equal(f.state().daily.edition,undefined);
  assert.equal(dailyArticles(f.state()).length,0);
  assert.deepEqual(dailyArchives(f.state(),f.c.chat).map(e=>e.editionId),[oldId]);
  assert.equal(f.state().daily.archiveSchema.sectionLog.some(e=>e.editionId===currentId),false);
  assert.equal(f.calls(),count);
  ok(await f.daily.update());
  assert.deepEqual(dailyArchives(f.state(),f.c.chat).map(e=>e.editionId),[oldId]);
 }finally{f.close();}
});

test('editorial context labels adopted, selected pending and unselected; followups need a fresh selection',async()=>{
 const f=setup();try{
  ok(await f.daily.update());const rows=dailyArticles(f.state());ok(await f.daily.toggle(rows[0].id));ok(await f.daily.toggle(rows[1].id));
  const evidence='Alex 读了报纸，对报道中的传闻保持怀疑。';f.c.chat.push({mes:evidence+'<!--durian-daily-used:'+JSON.stringify({id:rows[0].id,used:true,evidence})+'-->'});await f.memory.read();
  f.c.chat.push({mes:'2003-07-25'});await f.memory.read();
  const history=dailyEditorialHistory(f.state(),f.c.chat);assert.deepEqual(history[0].articles.map(a=>a.adoption),['adopted','selected_pending','unselected','unselected']);
  f.reply({articles:[article('音乐节新进展')]});ok(await f.daily.update());
  const payload=JSON.parse(f.prompt().split('剧情资料：')[1].split('\n')[0]);assert.equal(payload.previousEditions[0].articles[0].adoption,'adopted');assert.match(f.prompt(),/无新进展不换标题重报，也不编造调查结果或人物行动/);assert.match(f.prompt(),/新旧选题比例由新闻价值决定/);assert.match(f.prompt(),/报道语言遵循当前预设/);
  assert.equal(first(f).selected,false);assert.equal(buildDailyPrompt(f.state(),f.c.chat),'');
  ok(await f.daily.toggle(first(f).id));const prompt=buildDailyPrompt(f.state(),f.c.chat);assert.match(prompt,/音乐节新进展/);assert.doesNotMatch(prompt,/其他栏目/);assert.match(prompt,/未经证实的指控/);
  f.c.chat.pop();await f.memory.read();assert.equal(dailyEditorialHistory(f.state(),f.c.chat)[0].articles[0].adoption,'adopted');
  f.c.chat.pop();await f.memory.read();assert.equal(dailyEditorialHistory(f.state(),f.c.chat)[0].articles[0].adoption,'selected_pending');
 }finally{f.close();}
});

test('failed replacement leaves complete folder untouched; unknown dates never label archives expired',async()=>{
 const f=setup();try{
  ok(await f.daily.update());f.c.chat.push({mes:'2003-07-25'});await f.memory.read();f.reply({articles:[article('第二日报纸')]});ok(await f.daily.update());const before=structuredClone(f.state().daily);
  f.reply(()=>JSON.stringify({publication:'Daily',articles:[]}));assert.equal((await f.daily.update()).ok,false);assert.deepEqual(f.state().daily,before);
  assert.deepEqual(dailyArchives({daily:before},[{mes:'日期未知'}]),[]);assert.deepEqual(dailyArchives({daily:before},[{mes:'2003-07-23'}]),[]);
  const history=dailyEditorialHistory({daily:{edition:{editionId:'legacy',day:null},a:{id:'a',type:'article',editionId:'legacy',headline:'未知采用状态',body:'正文',selected:true}}},[{mes:'日期未知'}]);assert.equal(history[0].articles[0].adoption,'unknown');
 }finally{f.close();}
});

test('old built-in daily prompts migrate, customized and blank prompts remain intact',()=>{
 const migrated=normalizeSettings({prompts:PREVIOUS_DAILY_PROMPTS});assert.equal(migrated.prompts.daily,DAILY_EDITORIAL_PROMPT);assert.equal(migrated.prompts.dailyStory,DAILY_NARRATIVE_PROMPT);
 const outgoing=normalizeSettings({prompts:{dailyStory:PREVIOUS_DAILY_STORY_DEFAULT}});assert.equal(outgoing.prompts.dailyStory,DAILY_NARRATIVE_PROMPT);
 const custom=normalizeSettings({prompts:{daily:'我的自定义选题',dailyStory:''}});assert.equal(custom.prompts.daily,'我的自定义选题');assert.equal(custom.prompts.dailyStory,'');
});

test('manual editing preserves article identity and selection, updates injection, and makes no model request',async()=>{
 const f=setup();try{
  ok(await f.daily.update());const article=first(f);ok(await f.daily.toggle(article.id));
  const panel=createDailyPanel({adapter:{daily:f.daily,storyChat:()=>f.c.chat},getView:f.state,redraw(){},notice(){}});
  assert.doesNotMatch(panel.html(),/data-daily-action="edit"/);
  const articleActions=panel.press({dataset:{press:'daily-article',dailyId:article.id}});
  assert.deepEqual(articleActions.map(a=>a.icon),['edit','inject']);
  const metaActions=panel.press({dataset:{press:'daily-meta',dailyField:'publication'}});
  assert.deepEqual(metaActions.map(a=>a.icon),['edit']);
  const fields={headline:'修改后的标题',summary:'修改后的导语',body:'修改后的正文 <script>。'};
  ok(await f.daily.edit(article.id,fields));await f.memory.read();
  assert.deepEqual(first(f),{...article,...fields,selected:true,selectedIndex:f.c.chat.length-1});
  assert.match(buildDailyPrompt(f.state(),f.c.chat),/修改后的标题/);
  assert.equal((await f.daily.edit(article.id,{...fields,body:' '})).ok,false);
  assert.equal(first(f).body,fields.body);assert.equal(f.calls(),1);
 }finally{f.close();}
});

test('whole-paper edit saves the masthead, print date, region and all articles together for current and archived editions',async()=>{
 const f=setup();try{
  ok(await f.daily.update());const id=f.state().daily.edition.editionId;
  const before=paperDraft(f.state(),id),draft=structuredClone(before);draft.publication='新报';draft.location='本地';draft.date='2028-12-31';
  draft.articles.forEach((a,i)=>{a.section='栏目';a.headline='新标题'+i;});ok(await f.daily.editEdition(id,before,draft));
  assert.deepEqual(paperDraft(f.state(),id),draft);assert.equal((await f.daily.editEdition(id,before,before)).ok,false);
  f.c.chat.push({mes:'2030-01-09'});await f.memory.read();ok(await f.daily.update());
  const archived=paperDraft(f.state(),id);assert.deepEqual(archived,draft);
  const updated={...archived,publication:'历史报头'};ok(await f.daily.editEdition(id,archived,updated));assert.deepEqual(paperDraft(f.state(),id),updated);
  assert.equal(f.calls(),2);
 }finally{f.close();}
});

// ---- Editorial columns and real-history material contract ----

test('the fourteen columns normalize, count over a seven-edition ring and keep custom wording',()=>{
 const rows=[{...article('娱乐头条'),section:'文化'},{...article('案件报道'),section:'治安与司法'},{...article('赛事'),section:'体育赛事'},{...article('明星动态'),section:'星闻快递'}];
 const data=complete({location:'本地',articles:rows});
 const changes=dailyChanges(data,{prose:[{index:0,role:'assistant',text:'剧情。'}],day:dateDay('2008-10-14'),sourceIndex:0,existing:[],chat:[{mes:'2008-10-14'}]});
 const sections=changes.filter(c=>c.value?.type==='article').map(c=>c.value.section);
 assert.deepEqual(sections,['文化与娱乐','治安与司法','体育','文化与娱乐']);
 assert.ok(sections.every(name=>DAILY_SECTIONS.includes(name)),'every article lands in one of the fourteen columns');
 assert.deepEqual(DAILY_SECTIONS.length,14);assert.equal(new Set(DAILY_SECTIONS).size,14);
 const state={daily:Object.fromEntries(changes.filter(c=>c.collection==='daily').map(c=>[c.key,c.value]))};
 assert.equal(dailySectionCounts(state)['文化与娱乐'],2);
 assert.equal(dailySectionCounts(state)['治安与司法'],1);
 assert.equal(dailySectionCounts(state)['体育'],1);
 assert.equal(dailySectionCounts(state)['政治与公共事务'],0);
 for(const name of DAILY_SECTIONS)assert.ok(name in dailySectionCounts(state),'all fourteen columns are counted');
 assert.deepEqual(historicalSources(state),{mode:'model-knowledge',external:null});
});

test('the rotation ring keeps the last seven editions and rolls back with its floor',async()=>{
 const f=setup();try{
  ok(await f.daily.update());
  for(let i=2;i<=8;i++){
   f.c.chat.push({mes:'2008-10-'+(10+i)+'\n本地剧情。'});await f.memory.read();
   f.reply({articles:[{...article('第'+i+'期头条'),section:'治安与司法'},{...article('第'+i+'期次条'),section:'体育'}]});
   ok(await f.daily.update());
  }
  const log=f.state().daily.archiveSchema.sectionLog;
  assert.equal(log.length,7,'older editions roll out of the window');
  const counts=dailySectionCounts(f.state());
  assert.equal(counts['治安与司法'],7);assert.equal(counts['体育'],7);assert.equal(counts['文化与娱乐'],14);
  assert.equal(counts['政治与公共事务'],0);
  f.c.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();
  const rolled=f.state().daily.archiveSchema.sectionLog;
  assert.equal(rolled.length,7,'the full window stays, its content rolls back');
  assert.equal(rolled.at(-1).counts['治安与司法'],1,'the rolled-back edition leaves the window');
  assert.equal(dailySectionCounts(f.state())['治安与司法'],6);
 }finally{f.close();}
});

test('the editorial prompt carries the historical-material contract, columns and rotation window',async()=>{
 const f=setup();try{
  f.c.chat[0].mes='2008-10-14\n本地剧情。';
  ok(await f.daily.update());
  f.c.chat.push({mes:'2008-10-15\n本地剧情继续。'});await f.memory.read();
  ok(await f.daily.update());
  const payload=JSON.parse(f.prompt().split('剧情资料：')[1].split(String.fromCharCode(10))[0]);
  assert.equal(payload.date,'2008-10-15');
  assert.deepEqual(payload.columns,DAILY_SECTIONS);
  assert.deepEqual(payload.history,{mode:'model-knowledge',external:null},'reserved seam for a future external history feed');
  assert.equal(payload.recentSections['文化与娱乐'],4,'the window reflects the editions before this one');
  assert.equal(payload.recentSections['治安与司法'],0);
  assert.equal(payload.recentSections['政治与公共事务'],0);
  assert.match(f.prompt(),/现实历史素材/);
  assert.match(f.prompt(),/剧情年份、月份相同的现实历史事件/);
  assert.match(f.prompt(),/参考同一年其他月份的真实事件/);
  assert.match(f.prompt(),/参考相近年份的同月事件/);
  assert.match(f.prompt(),/不要求与剧情日期同一天/);
  assert.match(f.prompt(),/允许根据历史事件的类型、背景和发展模式进行创作/);
  assert.match(f.prompt(),/按文章实际内容归入最合适的正式栏目/);
  assert.doesNotMatch(f.prompt(),/历史素材参考新闻1～3篇/);
  assert.doesNotMatch(f.prompt(),/奥运会、世界大战、美国总统选举、知名国际冲突、全球金融危机/);
  assert.match(f.prompt(),/所在城市及周边、所在国家或地区、邻近国家和地区/);
  assert.match(f.prompt(),/剧情日期之后发生的事件绝不能提前报道/);
  assert.match(f.prompt(),/不得虚构一个/);
  assert.match(f.prompt(),/section 必须从这14个栏目中选最贴切的一个/);
  assert.doesNotMatch(f.prompt(),/优先补充出现最少的栏目/);
  assert.match(f.prompt(),/其他年份同月或相近年份的事件仅作历史参考或创作原型，不得冒充当前剧情年份的真实新闻/);
  assert.match(f.prompt(),/重大政治事件、总统选举、战争、国际冲突、金融危机、重大体育赛事、自然灾害等均属于正常新闻选题/);
  assert.match(f.prompt(),/不设重大事件的数量上限、占比上限或连续刊登限制/);
  assert.match(f.prompt(),/允许连续多期报道/);
  assert.match(f.prompt(),/事件候选按以下优先级综合判断，这是新闻价值参考顺序，不是按栏目或题材逐项填充的配额/);
  assert.match(f.prompt(),/第一，当期具有新闻价值的重大事件/);
  assert.match(f.prompt(),/第四，普通地方新闻与生活资讯/);
  assert.match(f.prompt(),/历史素材的广度仅用于避免反复使用同一批熟知事件凑数，不得用于压低真实重大事件的报道地位/);
  assert.match(f.prompt(),/不得为了满足比例强行混入普通机构公告/);
  assert.match(f.prompt(),/地域优先不等于地域封锁/);
  assert.match(f.prompt(),/选题以当期新闻价值为准/);
  assert.match(f.prompt(),/机构日常业务调整（启动工作、完善机制、优化流程、调整审核标准、推进规范管理、开展专项整治等）只在具备相应新闻价值时刊登/);
  assert.match(f.prompt(),/不用抽象的部门工作内容填补没有实际选题的栏目/);
  assert.match(f.prompt(),/头条必须是本期最有报道价值的事件/);
  assert.match(f.prompt(),/新闻价值优先，栏目多样性辅助/);
  assert.match(f.prompt(),/不为补齐冷门栏目制造低价值报道/);
  assert.match(f.prompt(),/不是整份报纸必须围绕的中心/);
 }finally{f.close();}
});


test('fictional worlds switch the editorial contract and carry the world setting',async()=>{
 const f=setup();try{
  f.c.characters[0].data={description:'云京国是故事世界的主要国家。',character_book:{entries:[{enabled:true,content:'云京城是云京国的首都，地处热带，全年炎热。'}]}};
  f.c.chat[0].mes='2008-10-15\n本地剧情。';
  f.c.chat.push({mes:'The party arrives in 云京城.<!--durian-location:{"city":"云京城"}-->',is_user:false});
  await f.memory.read();
  ok(await f.daily.update());
  const payload=JSON.parse(f.prompt().split('剧情资料：')[1].split(String.fromCharCode(10))[0]);
  assert.equal(payload.locationKind,'fictional');
  assert.equal(payload.currentLocation,'云京城');
  assert.match(payload.worldSetting,/云京城是云京国的首都/);
  assert.match(f.prompt(),/当前架空世界为唯一现实/);
  assert.match(f.prompt(),/不得将现实世界的具体国家、城市、政府或媒体当作架空世界的实际地理与政治实体/);
  assert.match(f.prompt(),/不得冒充架空世界真实发生过的事件/);
  assert.doesNotMatch(f.prompt(),/所在城市及周边、所在国家或地区、邻近国家和地区/);
  assert.match(f.prompt(),/架空世界同样按当期新闻价值编排/);
  assert.match(f.prompt(),/选举、外交危机、战争、重大案件、体育联赛、文化娱乐事件、企业危机、自然灾害等均可正常出现/);
  assert.match(f.prompt(),/不受栏目轮换或题材比例限制/);
 }finally{f.close();}
});
test('real locations keep the real-history editorial contract',async()=>{
 const f=setup();try{
  f.c.chat[0].mes='2008-10-15\n本地剧情。';
  f.c.chat.push({mes:'Sam arrives in Shanghai.<!--durian-location:{"city":"上海"}-->',is_user:false});
  await f.memory.read();
  ok(await f.daily.update());
  const payload=JSON.parse(f.prompt().split('剧情资料：')[1].split(String.fromCharCode(10))[0]);
  assert.equal(payload.locationKind,'real');
  assert.match(f.prompt(),/剧情年份、月份相同的现实历史事件/);
  assert.doesNotMatch(f.prompt(),/当前架空世界为唯一现实/);
 }finally{f.close();}
});
test('2024 Los Angeles date and location select the real-history editorial branch',async()=>{
 const f=setup();try{
  f.c.chat[0].mes='2024-10-07\n综合性报纸。';
  f.c.chat.push({mes:'Sam 抵达 Los Ángeles, CA。<!--durian-location:{"city":"Los Ángeles, CA"}-->',is_user:false});
  await f.memory.read();
  ok(await f.daily.update());
  const prompt=f.prompt(),payload=JSON.parse(prompt.split('剧情资料：')[1].split('\n')[0]);
  assert.equal(payload.currentLocation,'Los Ángeles, CA');
  assert.equal(payload.locationKind,'real');
  assert.equal(payload.date,'2024-10-07');
  assert.ok(prompt.includes(dailyHistoryRules('real')),'historical branch is in the actual quietPrompt');
  assert.match(prompt,/现实地点从模型已有的历史知识中回忆/);
  assert.match(prompt,/确定事件以后再分配唯一头条/);
  assert.match(prompt,/不先按栏目寻找素材/);
  assert.equal(f.calls(),1,'no extra request added');
 }finally{f.close();}
});

test('event-first editorial rule follows saved custom preferences and older defaults migrate',async()=>{
 const migrated=normalizeSettings({prompts:{daily:PREVIOUS_DAILY_EDITORIAL_DEFAULT}});
 assert.equal(migrated.prompts.daily,DAILY_EDITORIAL_PROMPT);
 const custom='只按近期学校、机构和行业线索编写简报';
 const f=setup();try{
  f.settings.prompts.daily=custom;
  ok(await f.daily.update());
  const prompt=f.prompt();
  assert.ok(prompt.indexOf(custom)>=0 && prompt.indexOf(custom)<prompt.indexOf('当前任务：为榴莲日报 App'));
  assert.match(prompt,/最近7期统计只在选定事件后辅助版面多样性/);
  assert.match(prompt,/机构政策、学校管理、道路维修、企业流程及行业审核只在具有/);
  assert.match(prompt,/选出4～6个最值得刊登的不同事件/);
  assert.equal(normalizeSettings({prompts:{daily:custom}}).prompts.daily,custom);
  assert.equal(f.calls(),1);
 }finally{f.close();}
});
