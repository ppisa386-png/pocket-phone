import test from 'node:test';
import assert from 'node:assert/strict';
import {importStoryPhone,buildStoryPhonePrompt} from '../src/story-phone.js';
import {normalizeSettings,MODULE_KEY} from '../src/config.js';
import {appendChange,replayJournal,reconcileJournal,revisionsFor,messageSignatures} from '../src/journal.js';
import {xUnread} from '../src/x.js';
const context={name1:'Sam Lee',characters:[],extensionSettings:{}};
const tags=(pairs)=>({mes:pairs.map(([channel,sender])=>{
    const text=channel==='x_mention'?'公开问候 @Sam Lee':'今天有空见面吗？';
    const evidence=sender+'发来了联系。';
    return evidence+'<!--durian-outreach:'+JSON.stringify({channel,sender,recipient:'user',text,evidence,media:'image'})+'-->';
}).join('\n')});
const four=Array.from({length:4},()=>({mes:'剧情继续。'}));
async function capture(chat,journal,ctx=context){
    const rev=await revisionsFor(messageSignatures(chat));
    return importStoryPhone(journal,rev,chat,ctx).journal;
}
test('one fifth floor imports six independent contacts once, with a public mention and pending private requests',async()=>{
    const chat=[...four,tags([['whatsapp','甲'],['wechat','乙'],['x_dm','丙'],['x_mention','丁'],['sms','戊'],['call','己']])];
    const journal=await capture(chat),state=replayJournal(journal);
    for(const app of ['wechat','whatsapp','x'])assert.equal(Object.values(state[app]).find(a=>a.type==='message').role,'assistant');
    assert.equal(Object.values(state.whatsapp).find(a=>a.type==='account').friend,'incoming');
    assert.equal(Object.values(state.x).filter(a=>a.type==='post').length,1);
    assert.equal(xUnread(state),2);assert.equal(Object.keys(state.messages).length,1);assert.equal(Object.values(state.calls)[0].status,'ringing');
    assert.deepEqual(await capture(chat,journal),journal);
    assert.deepEqual(replayJournal(reconcileJournal(journal,await revisionsFor(messageSignatures(four))).journal).x,{});
});
test('frequency and enabled channels gate the decision, a partial alias excludes both X paths',()=>{
    const state=replayJournal(),chat=[...four,{is_user:true,mes:'user'},{role:'system',mes:'系统'}];
    state.x.profile={alias:'Sam'};
    for(const frequency of ['low','medium','high']){
        const settings=normalizeSettings({proactiveFrequency:frequency,apps:{whatsapp:false}});
        const prompt=buildStoryPhonePrompt(state,context,settings,chat);
        assert.match(prompt,/本轮是每五条/);assert.match(prompt,/可无人联系/);
        const channels=prompt.match(/渠道：([^。]+)/)[1];assert.ok(!/whatsapp|snapchat|x_dm|x_mention/.test(channels));
        assert.match(prompt,{low:/优先留白/,medium:/偏执/,high:/不设冷却/}[frequency]);
        assert.doesNotMatch(buildStoryPhonePrompt(state,context,settings,chat.slice(1)),/本轮是每五条/);
    }
});
test('disabled and blocked or unanswered requests do not reappear on replay',async()=>{
    const ctx={...context,extensionSettings:{[MODULE_KEY]:{apps:{wechat:false}}}};
    const chat=[...four,tags([['wechat','A'],['whatsapp','B'],['x_dm','C']])];
    let journal=await capture(chat,undefined,ctx);
    const rev=await revisionsFor(messageSignatures(chat));
    const a=Object.values(replayJournal(journal).x).find(x=>x.type==='account');
    journal=appendChange(journal,rev,[{collection:'x',key:a.id,value:{...a,blocked:true}}]);
    const later=[...chat,...four,tags([['whatsapp','B'],['x_dm','C']])];
    const state=replayJournal(await capture(later,journal));
    assert.deepEqual(state.wechat,{});for(const app of ['whatsapp','x'])assert.equal(Object.values(state[app]).filter(x=>x.type==='message').length,1);
});

import {createPhoneMemory} from '../src/memory.js';
import {createPhoneService} from '../src/phone.js';
import {createChatApp} from '../src/chat-apps.js';
import {createX} from '../src/x.js';
import {createXPanel} from '../src/x-view.js';

test('first contact decisions use the real app services and protect private media',async()=>{
    const chat=[...four,tags([['whatsapp','A'],['wechat','B'],['x_dm','C']])];
    const ctx={...context,chat,chatId:'outreach',chatMetadata:{},saveMetadata:async()=>{}};
    const getContext=()=>ctx,getSettings=()=>normalizeSettings({});
    const memory=createPhoneMemory({getContext}),phone=createPhoneService({memory,getContext,getSettings});
    const args={getContext,getSettings,memory,phone},wa=createChatApp({...args,app:'whatsapp'}),wc=createChatApp({...args,app:'wechat'}),x=createX(args);
    try{
        await memory.read();
        const id=name=>'outreach:'+encodeURIComponent(name);
        assert.equal((await wa.queueMessage(id('A'),'text','未接受')).ok,false);
        assert.equal((await wa.accept(id('A'),true)).ok,true);
        assert.equal((await wa.queueMessage(id('A'),'text','收到')).ok,true);
        assert.equal((await wc.accept(id('B'),false)).ok,true);
        assert.equal((await wc.queueMessage(id('B'),'text','未接受')).ok,false);
        const panel=createXPanel({adapter:{x,userName:()=>ctx.name1},getView:()=>phone.snapshot(),redraw(){},notice(){}});
        await panel.action('thread',id('C'));assert.match(panel.html(),/请求中的媒体已隐藏/);
        assert.equal((await x.decideRequest(id('C'),true)).ok,true);
        assert.doesNotMatch(panel.html(),/请求中的媒体已隐藏/);
        assert.equal((await x.block(id('C'),true)).ok,true);
        chat.push(...four,tags([['whatsapp','A'],['wechat','B'],['x_dm','C'],['x_mention','C']]));
        const state=(await memory.read()).state;
        assert.equal(Object.values(state.whatsapp).filter(x=>x.type==='message'&&x.role==='assistant').length,2);
        assert.equal(Object.values(state.wechat).filter(x=>x.type==='message').length,1);
        assert.equal(Object.values(state.x).filter(x=>x.type==='message').length,1);
        assert.equal(Object.values(state.x).filter(x=>x.type==='post').length,0);
    }finally{phone.destroy();memory.destroy();}
});

test('X privacy, exact alias and regenerate are enforced by the importer',async()=>{
    const chat=[...four,tags([['x_dm','A'],['x_mention','B']])];
    const rev=await revisionsFor(messageSignatures(chat));
    for(const [alias,expectedPosts] of [['Sam',0],['Lee',0],['Sam Lee',1]]){
        const seed=appendChange(undefined,rev.slice(0,1),[{collection:'x',key:'profile',value:{id:'profile',type:'profile',alias,requestsOpen:false}}]);
        let journal=await capture(chat,seed);
        const state=replayJournal(journal);
        assert.equal(Object.values(state.x).filter(r=>r.type==='message').length,0);
        assert.equal(Object.values(state.x).filter(r=>r.type==='post').length,expectedPosts);
        const reroll=[...four,{mes:'这一楼没有人联系。',swipe_id:1}];
        journal=reconcileJournal(journal,await revisionsFor(messageSignatures(reroll))).journal;
        assert.equal(Object.values(replayJournal(await capture(reroll,journal)).x).filter(r=>r.type==='post').length,0);
    }
});

test('one opportunity accepts many first-time contacts via the same enabled app, without needing phone numbers',async()=>{
    const pairs=Array.from({length:25},(_,i)=>['whatsapp','人物'+i]);
    const state=replayJournal(await capture([...four,tags(pairs)]));
    assert.equal(Object.values(state.whatsapp).filter(x=>x.type==='message').length,25);
    assert.equal(Object.values(state.whatsapp).filter(x=>x.friend==='incoming').length,25);
});

test('no decisions on background injections, empty reasoning or user messages',()=>{
    const settings=normalizeSettings({}),state=replayJournal();
    const noise=[{mes:'后台',isPhoneMessage:true},{mes:'<!-- note -->'},{mes:'<think>想法</think>'},{mes:'用户',role:'user'}];
    assert.match(buildStoryPhonePrompt(state,context,settings,[...four,...noise]),/本轮是每五条/);
    for(const freq of ['low','medium','high']){
        const ctx={...context,extensionSettings:{[MODULE_KEY]:{proactiveFrequency:freq}}};
        const chat=[...four,{mes:'五个回合过去，大家各自休息。'}];
        assert.deepEqual(replayJournal(importStoryPhone(undefined,['1','2','3','4','5'],chat,ctx).journal),state);
    }
});
