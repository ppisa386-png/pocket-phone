import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { appendChange, replayJournal, reconcileJournal, revisionsFor, messageSignatures, JOURNAL_KEY } from '../src/journal.js';
import { syncCommContext, commEntries, commExpired, commMeta, commKey, commReplyClassification, commRecordPatch, commClassificationPlan, commClassificationChanges, commRecordExists, commExcerpt, inferShown, COMM_PLATFORMS } from '../src/comm-context.js';
import { importStoryPhone } from '../src/story-phone.js';
import { buildContinuityPrompt } from '../src/continuity.js';
import { createPhoneMemory } from '../src/memory.js';
import { normalizeSettings } from '../src/config.js';

const stamp = (date,time='12:00') => ({date,time,precision:'exact'});
const set = (collection,key,value) => ({collection,key,value});
const speaker = { name:'Alex',avatar:'alex.png',nameIsUnique:true };

const channelState = () => ({
    profiles:{}, contacts:{'card:alex.png':{id:'card:alex.png',name:'Alex'}},
    messages:{}, calls:{}, whatsapp:{}, wechat:{}, snapchat:{}, x:{}, commContext:{},
});

test('every comm channel gets a sidecar row with a story-time anchor from its source floor',async()=>{
    const chat=[{mes:'2026-11-01 09:00',name:'Alex',is_user:false}];
    const rev=await revisionsFor(messageSignatures(chat));
    const journal=appendChange(undefined,rev,[
        set('messages','s1',{id:'s1',contactId:'card:alex.png',role:'assistant',text:'hi',createdAt:1}),
        set('calls','c1',{id:'c1',contactId:'card:alex.png',status:'ended',turns:[],createdAt:2}),
        set('whatsapp','w1',{id:'w1',type:'message',accountId:'card:alex.png',role:'assistant',kind:'text',text:'yo',createdAt:3}),
        set('snapchat','k1',{id:'k1',type:'call',accountId:'card:alex.png',mode:'video',status:'ended',turns:[{role:'assistant',text:'see'}],createdAt:4}),
        set('x','x1',{id:'x1',type:'message',accountId:'card:alex.png',role:'assistant',text:'dm',createdAt:5}),
        set('x','x2',{id:'x2',type:'comment',postId:'p1',author:'a1',text:'c',createdAt:6}),
    ]);
    const state=replayJournal(syncCommContext(journal,rev,chat).journal);
    assert.deepEqual(commEntries(state).map(e=>e.platform+':'+e.id).sort(),
        ['call:c1','sms:s1','snapchat:k1','whatsapp:w1','x:x1','x:x2'].sort());
    for(const [platform,id] of [['sms','s1'],['call','c1'],['whatsapp','w1'],['snapchat','k1'],['x','x1'],['x','x2']]){
        const meta=commMeta(state,platform,id);
        assert.deepEqual(meta.anchor,stamp('2026-11-01','09:00'),platform+' anchors to its source floor');
        assert.equal(meta.classification,'pending');assert.equal(meta.expired,false);
    }
});

test('A/B categories expire strictly at 24/72 story hours on every channel; pending never expires',async()=>{
    const meta=(category,date,time)=>({version:1,category,anchor:stamp(date,time),expired:false});
    for(const platform of COMM_PLATFORMS){
        assert.equal(commExpired(commMeta({commContext:{[commKey(platform,'x')]:meta('A','2026-11-01','12:00')}},platform,'x'),stamp('2026-11-02','12:01')),true,platform+' A expires after 24h');
        assert.equal(commExpired(commMeta({commContext:{[commKey(platform,'x')]:meta('A','2026-11-01','12:00')}},platform,'x'),stamp('2026-11-02','12:00')),false,platform+' A survives the exact cutoff');
        assert.equal(commExpired(commMeta({commContext:{[commKey(platform,'x')]:meta('B','2026-11-01','12:00')}},platform,'x'),stamp('2026-11-04','12:01')),true,platform+' B expires after 72h');
        assert.equal(commExpired(commMeta({commContext:{[commKey(platform,'x')]:meta('B','2026-11-01','12:00')}},platform,'x'),stamp('2026-11-04','12:00')),false,platform+' B survives the exact cutoff');
        assert.equal(commExpired(commMeta({commContext:{[commKey(platform,'x')]:{version:1,category:null}}},platform,'x'),stamp('2030-01-01')),false,platform+' pending is conservative');
    }
});

test('classification never needs quotes: ids, ownership and single-use are all the program checks',()=>{
    const state=channelState();
    state.messages.w1={id:'w1',type:'message',accountId:'card:alex.png',role:'assistant',kind:'text',text:'whatsapp text',createdAt:1};
    state.whatsapp.w1=state.messages.w1;delete state.messages.w1;
    state.whatsapp.w2={id:'w2',type:'message',accountId:'card:alex.png',role:'assistant',kind:'text',text:'same text',createdAt:2};
    const plan=commClassificationPlan(state,'whatsapp','card:alex.png',stamp('2026-11-01'));
    assert.deepEqual(plan.ids,['w1','w2']);
    assert.doesNotMatch(plan.prompt,/same text|whatsapp text/,'no record text is re-sent for classification');
    const changes=commClassificationChanges({comm_classifications:[{id:'w1',category:'B'},{id:'w2',category:'nonsense'},{id:'ghost',category:'A'}]},plan,state);
    assert.deepEqual(changes.map(c=>c.key),['whatsapp:w1']);
    for(const change of changes)state.commContext[change.key]=change.value;
    assert.deepEqual(commClassificationPlan(state,'whatsapp','card:alex.png',stamp('2026-11-01')).ids,['w2']);
    // A direct reply classification merges into an existing row without losing it.
    const patch=commReplyClassification('whatsapp','w2','card:alex.png','A',state);
    state.commContext[patch[0].key]=patch[0].value;
    assert.equal(commMeta(state,'whatsapp','w2').category,'A');
});

test('story imports are shown, phone-app chatter defaults to unshown, and reads never touch the flag',async()=>{
    const state=channelState();
    state.messages.n={id:'n',origin:'narrative',contactId:'card:alex.png',role:'assistant',text:'from prose',createdAt:1,read:true};
    state.messages.a={id:'a',contactId:'card:alex.png',role:'assistant',text:'app reply',createdAt:2,read:true};
    state.calls.n={id:'n',origin:'narrative',contactId:'card:alex.png',status:'ended',turns:[],createdAt:3};
    state.whatsapp.out={id:'outreach:r:0',type:'message',accountId:'card:alex.png',role:'assistant',text:'outreach',createdAt:4,read:true};
    state.whatsapp.chat={id:'reply:x',type:'message',accountId:'card:alex.png',role:'assistant',text:'chat reply',createdAt:5,read:false};
    state.x.dm={id:'outreach:r:1',type:'message',accountId:'card:alex.png',role:'assistant',text:'dm',createdAt:6};
    const entries=Object.fromEntries(commEntries(state).map(e=>[e.platform+':'+e.id,e]));
    assert.equal(entries['sms:n'].record.id,'n');
    assert.equal(inferShown(entries['sms:n']),true,'narrative import was presented');
    assert.equal(inferShown(entries['sms:a']),false,'phone-app reply stays unshown');
    assert.equal(inferShown(entries['call:n']),true);
    assert.equal(inferShown(entries['whatsapp:outreach:r:0']),true,'outreach import was presented');
    assert.equal(inferShown(entries['whatsapp:reply:x']),false);
    assert.equal(inferShown(entries['x:outreach:r:1']),true);
});

test('the same text on two platforms never shares a sidecar row',()=>{
    const state=channelState();
    state.whatsapp.dup={id:'dup',type:'message',accountId:'a1',role:'assistant',text:'twin message',createdAt:1};
    state.wechat.dup={id:'dup',type:'message',accountId:'a1',role:'assistant',text:'twin message',createdAt:2};
    assert.equal(commKey('whatsapp','dup'),'whatsapp:dup');
    assert.equal(commKey('wechat','dup'),'wechat:dup');
    assert.notEqual(commKey('whatsapp','dup'),commKey('wechat','dup'));
    assert.equal(commRecordExists(state,'whatsapp','dup'),true);
    assert.equal(commRecordExists(state,'wechat','dup'),true);
    assert.equal(commRecordExists(state,'snapchat','dup'),false,'cross-platform ids are rejected');
});

test('narrative shown markers flip existing records only, ignore invented ids, repeat silently and roll back with their floor',async()=>{
    const context={name1:'Sam',name2:'Alex',chatId:'shown',characterId:0,characters:[{name:'Alex',avatar:'alex.png'}],chat:[],chatMetadata:{},groupId:null,groups:[]};
    const push=mes=>{context.chat.push({mes,is_user:false});return revisionsFor(messageSignatures(context.chat));};
    let rev=await push('2026-11-01 09:00 they talked about it.');
    context.chatMetadata[JOURNAL_KEY]=appendChange(undefined,rev.slice(0,1),[
        set('contacts','card:alex.png',{id:'card:alex.png',name:'Alex'}),
        set('whatsapp','旧消息1',{id:'旧消息1',type:'message',accountId:'card:alex.png',role:'assistant',text:'旧消息内容',createdAt:1}),
    ]);
    rev=await push('They talked about it. <!--durian-contact:'+JSON.stringify({sender:'Alex',recipient:'user',name:'Alex',kind:'sms',text:'导入短信A',evidence:'They talked about it.'})+'-->');
    let imported=importStoryPhone(context.chatMetadata[JOURNAL_KEY],rev,context.chat,context);
    const inbound=Object.values(replayJournal(imported.journal).messages)[0];
    assert.equal(inbound.text,'导入短信A');
    rev=await push('正文提到手机里的两条旧消息<!--durian-message-shown:'+JSON.stringify({platform:'whatsapp',id:'旧消息1'})+'--><!--durian-message-shown:'+JSON.stringify({platform:'sms',id:inbound.id})+'--><!--durian-message-shown:'+JSON.stringify({platform:'sms',id:inbound.id})+'--><!--durian-message-shown:'+JSON.stringify({platform:'wechat',id:'不存在'})+'-->');
    imported=importStoryPhone(imported.journal,rev,context.chat,context);
    const state=replayJournal(imported.journal);
    assert.equal(commMeta(state,'whatsapp','旧消息1').shown,true,'existing record marked shown');
    assert.equal(commMeta(state,'sms',inbound.id).shown,true,'a narrative import is shown by default');
    assert.equal(commMeta(state,'wechat','不存在'),undefined,'invented ids never create rows');
    const shownEvents=imported.journal.events.filter(e=>e.id.startsWith('story-shown:'));
    assert.equal(shownEvents.length,3,'two accepted markers plus one tombstone; a repeat stays silent');
    const trimmed=reconcileJournal(imported.journal,rev.slice(0,2));
    const rolled=replayJournal(trimmed.journal);
    assert.equal(commMeta(rolled,'whatsapp','旧消息1'),undefined,'rollback removes the marker with its floor');
});

test('continuity injects unshown content, summarizes shown records and drops expired ones on every channel',()=>{
    const state=channelState();
    state.messages.u={id:'u',contactId:'card:alex.png',role:'assistant',text:'未展示的完整消息内容很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长附加内容附加内容附加内容附加内容附加内容附加内容附加内容附加内容',createdAt:1,read:true};
    state.messages.s={id:'s',contactId:'card:alex.png',role:'assistant',text:'已展示的完整消息内容也很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长结尾部分结尾部分结尾部分结尾部分结尾部分结尾部分结尾部分结尾部分',createdAt:2,read:true};
    state.calls.e={id:'e',contactId:'card:alex.png',status:'ended',turns:[{role:'assistant',text:'通话对白一'},{role:'assistant',text:'通话对白二'},{role:'assistant',text:'通话对白三'}],createdAt:3};
    state.commContext={
        'sms:u':{version:1,category:null,classification:'pending',anchor:{date:'',time:'',precision:'exact'},anchorSource:'source-floor',expired:false,shown:false},
        'sms:s':{version:1,category:'A',classification:'classified',anchor:{date:'',time:'',precision:'exact'},anchorSource:'source-floor',expired:false,shown:true},
        'call:e':{version:1,category:'B',classification:'classified',anchor:{date:'2026-11-01',time:'12:00'},anchorSource:'source-floor',expired:false,shown:true},
    };
    const prompt=buildContinuityPrompt(state,speaker,{instruction:'衔接',currentStoryTime:stamp('2026-11-02','12:01')});
    assert.match(prompt,/附加内容附加内容附加内容附加内容附加内容附加内容附加内容附加内容/,'unshown keeps its full content');
    assert.doesNotMatch(prompt,/结尾部分结尾部分结尾部分结尾部分结尾部分结尾部分结尾部分结尾部分/,'shown never re-injects the full text');
    assert.match(prompt,/已展示的完整消息内容也很长[^\n"]*…/,'shown is present as a summary');
    assert.doesNotMatch(prompt,/通话对白三/,'shown call turns are summarized');
    assert.match(prompt,/通话对白一/);
    // Expired rows leave every channel, while the phone history keeps them.
    assert.equal(state.messages.s.text.includes('已展示'),true,'phone history untouched');
    state.commContext['sms:u'].expired=true;
    state.commContext['call:e'].category='A';
    const expired=buildContinuityPrompt(state,speaker,{instruction:'衔接',currentStoryTime:stamp('2026-11-03','12:01')});
    assert.doesNotMatch(expired,/未展示的完整消息|通话对白一|通话对白三/);
    assert.match(expired,/已展示的完整消息内容也很长.*…|已展示/,'shown summaries may still appear as history');
});

test('element entries anchor to the floor their reaction appeared on and default to A',async()=>{
    const chat=[{mes:'2026-11-01 09:00',name:'Alex',is_user:false},{mes:'2026-11-03 20:00',name:'Alex',is_user:false}];
    const rev=await revisionsFor(messageSignatures(chat));
    let journal=appendChange(undefined,rev.slice(0,1),[set('snapchat','story1',{id:'story1',type:'story',author:'user',kind:'image',text:'我的故事',comments:[],friendLikes:[],createdAt:1})]);
    journal=appendChange(journal,rev,[set('snapchat','story1',{id:'story1',type:'story',author:'user',kind:'image',text:'我的故事',comments:[{accountId:'card:alex.png',name:'Alex',text:'好喜欢',createdAt:Date.now()}],friendLikes:['card:alex.png'],reactionsChecked:true,reactionsCheckedAt:Date.now(),createdAt:1})]);
    const state=replayJournal(syncCommContext(journal,rev,chat).journal);
    const like=commMeta(state,'snapchat','story1#like:card:alex.png');
    const comment=commMeta(state,'snapchat','story1#comment:card:alex.png');
    assert.deepEqual(like.anchor,stamp('2026-11-03','20:00'),'reaction anchors to its own floor');
    assert.deepEqual(comment.anchor,stamp('2026-11-03','20:00'));
    assert.equal(like.category,'A','pure likes are short interactions by default');
    assert.equal(comment.category,null,'story replies stay pending for classification');
    assert.equal(like.shown,false);
    const later=replayJournal(syncCommContext(reconcileJournal(journal,rev.slice(0,1)).journal,rev.slice(0,1),chat.slice(0,1)).journal);
    assert.equal(commMeta(later,'snapchat','story1#like:card:alex.png'),undefined,'rollback drops reactions with their floor');
});

test('outgoing narrative SMS registers from a faithful summary plus the marker text',async()=>{
    const chat=[{mes:'2026-11-01 09:00\nSam 给 Alex 发消息道歉，说自己不该那么说话。<!--durian-contact:'+JSON.stringify({sender:'user',recipient:'Alex',name:'Alex',kind:'sms',text:'妈，对不起，那天是我不对，我之后会好好和你谈。'})+'-->',name:'Alex',is_user:false}];
    const rev=await revisionsFor(messageSignatures(chat));
    const context={name1:'Sam',name2:'Alex',chatId:'summary',characterId:0,characters:[{name:'Alex',avatar:'alex.png'}],chat,chatMetadata:{},groupId:null,groups:[]};
    const imported=importStoryPhone(undefined,rev,chat,context);
    const state=replayJournal(syncCommContext(imported.journal,rev,chat).journal);
    const messages=Object.values(state.messages);
    assert.equal(messages.length,1);
    assert.equal(messages[0].text,'妈，对不起，那天是我不对，我之后会好好和你谈。');
    assert.equal(messages[0].origin,'narrative');
    assert.equal(commMeta(state,'sms',messages[0].id).shown,true,'the prose presented the send');
});

async function fixture(){
    const bus=new EventEmitter(),prompts=[],injections={};
    const context={chatId:'comm-fix',name1:'Sam',name2:'Alex',characterId:0,characters:[{name:'Alex',avatar:'alex.png'}],chat:[{mes:'2026-11-01 09:00',is_user:false}],chatMetadata:{},saveMetadata:async()=>{},onlineStatus:'connected',eventSource:bus,event_types:Object.fromEntries(['GENERATION_STARTED','GENERATION_ENDED','MESSAGE_DELETED','CHAT_CHANGED'].map(n=>[n,n])),setExtensionPrompt(key,text){injections[key]=text;}};
    const settings=normalizeSettings({retries:0});
    const memory=createPhoneMemory({getContext:()=>context});
    await memory.read();
    return {context,memory,settings,injections,close(){memory.destroy();}};
}

test('unified sidecar persists through the memory service; deleting a record erases its rows',async()=>{
    const f=await fixture();try{
        await f.memory.commit(await f.memory.begin(),[
            set('whatsapp','m1',{id:'m1',type:'message',accountId:'card:alex.png',role:'assistant',kind:'text',text:'wa',createdAt:1}),
            set('messages','s1',{id:'s1',contactId:'card:alex.png',role:'assistant',text:'sms',createdAt:2}),
            set('smsContext','s1',{category:'A',anchor:stamp('2026-11-01','09:00')}),
        ]);
        let state=(await f.memory.read()).state;
        assert.equal(commMeta(state,'whatsapp','m1').shown,false);
        assert.equal(commMeta(state,'sms','s1').category,'A','legacy smsContext migrates through the service');
        // Manual reads and edits never renew or touch the presentation state.
        await f.memory.commit(await f.memory.begin(),[set('messages','s1',{...state.messages.s1,read:true})]);
        state=(await f.memory.read()).state;
        assert.equal(commMeta(state,'sms','s1').shown,false);assert.equal(commMeta(state,'sms','s1').category,'A');
        await f.memory.eraseRecord(await f.memory.begin(),'whatsapp','m1');
        state=(await f.memory.read()).state;
        assert.equal(state.whatsapp.m1,undefined);
        assert.equal(commMeta(state,'whatsapp','m1'),undefined,'sidecar rows follow their record into erasure');
        assert.equal(commMeta(state,'sms','s1').category,'A','other channels are untouched');
    }finally{f.close();}
});

test('commExcerpt summarizes without rewriting',()=>{
    assert.equal(commExcerpt('短'),'短');
    assert.equal(commExcerpt('一'.repeat(100)), '一'.repeat(80)+'…');
    assert.equal(commExcerpt(null),'');
});
