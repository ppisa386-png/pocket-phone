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
