import test from 'node:test';
import assert from 'node:assert/strict';
import {readStoryClock,storyTime,dateDay,displayStoryTime} from '../src/story-clock.js';
import {createPhoneMemory} from '../src/memory.js';
test('phone time follows final scene timestamp including SDC; ignores wall time, comments, thought and code',()=>{
 const first={mes:'<calendar>2018年4月3日 08:10 星期二|办公室|晴</calendar>正文<!-- SDC-end | date=2018年4月3日 | weekday=周二 | time=08:19 -->'};
 assert.deepEqual(readStoryClock([first]),{day:dateDay('2018-04-03'),hour:8+19/60});
 const malicious={mes:'<think>时间：2099-01-01 23:00</think>\n```\n日期：2099-01-01 23:00\n```\n<!-- 日期：2099-01-01 23:00 -->'};
 assert.equal(storyTime([first,malicious]).time,'08:19');
 assert.equal(storyTime([first,{mes:'<!-- SDC-start | date=2018年4月4日 | time=10:00 --><!-- SDC-end | date=2018年4月4日 | time=10:25 -->'}]).time,'10:25');
 assert.equal(storyTime([first]).date,'2018-04-03');
 assert.deepEqual(storyTime([]),{date:'',time:'',precision:'scene'});
 assert.equal(displayStoryTime({createdAt:Date.now()}),'—');
 assert.equal(storyTime([first,{mes:'第二天\n场景开始。'}]).time,'');
});
test('new communication records store story anchors and updates preserve them; deletion rolls them back',async()=>{
 const c={chatId:'clock',characterId:0,chat:[{mes:'时间：2018-04-03 08:10',is_user:false}],chatMetadata:{},saveMetadata:async()=>{}};
 const m=createPhoneMemory({getContext:()=>c});try{
  await m.commit(await m.begin(),[{collection:'messages',key:'one',value:{id:'one',contactId:'a',role:'user',text:'Hello',createdAt:Date.now()}}]);
  let state=(await m.read()).state;assert.equal(state.messages.one.storyTime.time,'08:10');
  c.chat.push({mes:'时间：2018-04-03 11:00',is_user:false});
  await m.commit(await m.begin(),[{collection:'messages',key:'one',value:{...state.messages.one,read:true}},{collection:'calls',key:'call',value:{id:'call',turns:[{role:'user',text:'Hello again'}]}}]);
  state=(await m.read()).state;assert.equal(state.messages.one.storyTime.time,'08:10');assert.equal(state.calls.call.turns[0].storyTime.time,'11:00');
  c.chat.pop();state=(await m.read()).state;assert.equal(state.calls.call,undefined);assert.equal(state.messages.one.storyTime.time,'08:10');
 }finally{m.destroy();}
});


test('bracketed scene date ranges use the final date and time, not arbitrary mentioned dates',()=>{
 const seed={mes:'日期：2026-05-12 10:00'};
 const range={mes:'【2026年5月20日 09:30 星期三 至 2026年6月24日 19:40 星期三|旅行结束】'};
 assert.deepEqual(readStoryClock([seed,range]),{day:dateDay('2026-06-24'),hour:19+40/60});
 assert.deepEqual(readStoryClock([range],null,{exact:true}),{day:dateDay('2026-06-24'),hour:19+40/60});
 assert.equal(storyTime([{mes:'[2026-05-20 09:30 to 2026-06-24 19:40]'}]).date,'2026-06-24');
 assert.equal(storyTime([{mes:'【2026年6月24日 19:40】'}]).time,'19:40');
 for(const text of ['她说旅行从2026年5月20日至2026年6月24日。','<think>'+range.mes+'</think>','<!--'+range.mes+'-->']) assert.equal(storyTime([seed,{mes:text}]).date,'2026-05-12');
 assert.equal(storyTime([{mes:'2026-05-20 09:30 约好2026-06-24见面。'}]).date,'2026-05-20');
 assert.equal(storyTime([{mes:'2026-05-20 至 2026-02-30'}]).date,'2026-05-20');
});

test('SDC wrapped in a narrative code block works without calendar and the final valid marker wins',()=>{
 const start='<!-- SDC-start | date=2026-03-02 | weekday=周一 | time=08:00 -->';
 const end='<!-- SDC-end | date=2026-03-02 | weekday=周一 | time=14:25 -->';
 const message={mes:'```html\n'+start+'\n<now_plot><content>正文</content></now_plot>\n'+end+'\n```\n<calendar>2026年3月2日 08:00</calendar>'};
 assert.equal(storyTime([message]).time,'14:25');assert.equal(storyTime([{mes:'```\n'+start+'\n正文\n```'}]).time,'08:00');
 assert.equal(readStoryClock([message],null,{exact:true}).hour,14+25/60);
});
test('SDC validates dates and times atomically, ignores user examples and thought blocks, and rolls back',()=>{
 const mark=(date,time)=>'<!-- SDC-end | date='+date+' | time='+time+' -->';
 const chat=[{mes:mark('2026-03-02','23:59')},{mes:'```\n'+mark('2026-03-03','00:05')+'\n```'}];
 assert.equal(storyTime(chat).date,'2026-03-03');assert.equal(storyTime(chat).time,'00:05');
 chat.pop();assert.equal(storyTime(chat).time,'23:59');
 chat.push({mes:mark('2099-01-01','10:00'),is_user:true});assert.equal(storyTime(chat).date,'2026-03-02');
 for(const invalid of [mark('2026-02-30','09:00'),mark('2099-01-01','25:00'),mark('2099-01-01','08:99'),mark('2099-01-01','08:00oops'),'<think>'+mark('2099-01-01','09:00')+'</think>','<analysis>'+mark('2099-01-01','09:00')+'</analysis>']){
  assert.equal(storyTime([...chat,{mes:invalid}]).time,'23:59');assert.equal(storyTime([...chat,{mes:invalid}]).date,'2026-03-02');
 }
});
