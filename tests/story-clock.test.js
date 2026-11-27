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

for(const [text,days] of [['十天后',10],['11天后',11],['十一天后',11],['十九天后',19],['二十天后',20],['二十一天后',21],['九十九天后',99],['两天后',2],['一天后',1],['一十天后',10],['2 days later',2]]) {
 test('scene-opening relative transition '+text+' advances date and clears old time',()=>{
  const seed={mes:'2026-01-01 10:00'};
  assert.deepEqual(readStoryClock([seed,{mes:text+'\n新的场景。'}]),{day:dateDay('2026-01-01')+days,hour:null});
  assert.deepEqual(readStoryClock([seed,{mes:text+' 16:35\n新的场景。'}]),{day:dateDay('2026-01-01')+days,hour:16+35/60});
 });
}
for(const [base,jump,date] of [['2026-01-25','十一天后','2026-02-05'],['2026-12-25','二十天后','2027-01-14'],['2024-02-18','十一天后','2024-02-29'],['2024-02-29','两天后','2024-03-02']]) {
 test('Chinese relative date arithmetic '+base+' '+jump,()=>{
  assert.deepEqual(readStoryClock([{mes:base+' 10:00'},{mes:jump}]),{day:dateDay(date),hour:null});
 });
}
test('relative transitions require a known base and valid numerals; dialogue, plans and hidden text do not advance time',()=>{
 assert.deepEqual(readStoryClock([{mes:'十一天后'}]),{day:null,hour:null});
 const base={mes:'2026-01-01 10:00'},expected={day:dateDay('2026-01-01'),hour:10};
 for(const value of ['一一','十十','二十三四','两十','一2','2十','零十一','零','0']) {
  assert.deepEqual(readStoryClock([base,{mes:value+'天后 16:35'}]),expected,value);
 }
 for(const text of ['“十一天后见。”','她打算十一天后离开。','正文。\n十一天后再谈。','<!-- 十一天后 -->','```\n十一天后\n```','<think>十一天后</think>']) {
  assert.deepEqual(readStoryClock([base,{mes:text}]),expected,text);
 }
});

test('QQJ start/end shares the SDC clock and latest valid marker wins across midnight',()=>{
 const first={mes:'<!-- SDC-end | date=2025年10月16日 | time=12:35 -->'};
 const next={mes:'<!-- QQJ-start | date=2025年10月17日 | time=12:35 -->正文<!-- QQJ-end | date=2025年10月17日 | weekday=周五 | time=12:55 -->'};
 assert.deepEqual(readStoryClock([first,next]),{day:dateDay('2025-10-17'),hour:12+55/60});
 assert.equal(storyTime([first,next,{mes:'<think><!-- QQJ-end | date=2099-01-01 | time=08:00 --></think>'}]).time,'12:55');
 assert.equal(storyTime([first,{...next,is_user:true}]).date,'2025-10-16');
 assert.equal(storyTime([first,{mes:'<!-- QQJ-end | date=2025-02-30 | time=12:55 -->'}]).date,'2025-10-16');
 assert.equal(storyTime([first]).time,'12:35');
});
