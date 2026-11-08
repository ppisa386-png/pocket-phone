import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { appendChange, replayJournal, reconcileJournal, revisionsFor, messageSignatures, JOURNAL_KEY } from '../src/journal.js';
import { syncCommContext, commEntries, commExpired, commMeta, commKey, commReplyClassification, commRecordPatch, commClassificationPlan, commClassificationChanges, commRecordExists, commExcerpt, inferShown, COMM_PLATFORMS } from '../src/comm-context.js';
import { importStoryPhone, buildStoryPhonePrompt } from '../src/story-phone.js';
import { buildContinuityPrompt } from '../src/continuity.js';
import { xStoryPrompt, xStoryChanges } from '../src/x-story.js';
import { xTriggerCandidates } from '../src/outreach.js';
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

test('continuity omits shown records on every communication channel, including X replies',()=>{
    const state=channelState(),who={id:'card:alex.png',type:'account',name:'Alex',characterId:'card:alex.png',identityKnown:true};
    state.messages.unshown={id:'unshown',contactId:who.id,role:'assistant',text:'UNSHOWN_SMS',createdAt:1};
    state.messages.shown={id:'shown',contactId:who.id,role:'assistant',text:'SHOWN_SMS',createdAt:2};
    state.calls.shown={id:'shown',contactId:who.id,status:'ended',turns:[{role:'assistant',text:'SHOWN_CALL'}],createdAt:3};
    state.commContext['sms:unshown']={shown:false};
    state.commContext['sms:shown']={shown:true};
    state.commContext['call:shown']={shown:true};
    for(const app of ['whatsapp','wechat','snapchat','x']){
        state[app][who.id]={...who};
        for(const shown of [false,true]){
            const id=app+(shown?'-shown':'-unshown');
            state[app][id]={id,type:'message',accountId:who.id,role:'assistant',text:(shown?'SHOWN_':'UNSHOWN_')+app,createdAt:shown?5:4,read:true};
            state.commContext[app+':'+id]={shown};
        }
    }
    state.x.post={id:'post',type:'post',author:'user',feed:'home',text:'SHOWN_X_POST',createdAt:6};
    state.x.comment={id:'comment',type:'comment',postId:'post',author:who.id,text:'UNSHOWN_X_COMMENT',createdAt:7};
    state.commContext['x:post']={shown:true};
    state.commContext['x:comment']={shown:false};
    const prompt=buildContinuityPrompt(state,speaker,{instruction:'衔接',allParticipants:true,budget:50000});
    assert.match(prompt,/UNSHOWN_SMS/);
    for(const app of ['whatsapp','wechat','snapchat','x'])assert.match(prompt,new RegExp('UNSHOWN_'+app));
    assert.match(prompt,/UNSHOWN_X_COMMENT/);
    assert.doesNotMatch(prompt,/"text":"SHOWN_SMS"|"text":"SHOWN_(?:whatsapp|wechat|snapchat|x)"|SHOWN_CALL|SHOWN_X_POST/);
    const records=JSON.parse(prompt.split('\n').at(-2)).records;
    assert.ok(records.every(record=>record.shown===false),'only unshown records enter the payload');
    assert.equal(state.messages.shown.text,'SHOWN_SMS','phone history remains unchanged');
    const fullyShown=structuredClone(state);
    for(const meta of Object.values(fullyShown.commContext))meta.shown=true;
    assert.equal(buildContinuityPrompt(fullyShown,speaker,{instruction:'衔接',allParticipants:true}),'');

    state.commContext['sms:unshown'].expired=true;
    const expired=buildContinuityPrompt(state,speaker,{instruction:'衔接',allParticipants:true});
    assert.doesNotMatch(expired,/UNSHOWN_SMS/,'expiry still filters unshown records');
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

test('home-feed X posts and backfilled samples join the sidecar; square posts stay outside',async()=>{
    const chat=[{mes:'2026-11-01 09:00',name:'Alex',is_user:false}];
    const rev=await revisionsFor(messageSignatures(chat));
    const journal=appendChange(undefined,rev,[
        set('x','u1',{id:'u1',type:'account',name:'U1',createdAt:0}),
        set('x','home1',{id:'home1',type:'post',author:'user',feed:'home',text:'home post',createdAt:1,liked:false,reposted:false}),
        set('x','sq1',{id:'sq1',type:'post',author:'org1',feed:'square',text:'square post',createdAt:2,liked:false,reposted:false,publication:{editionId:'e'}}),
        set('x','npcPost',{id:'npcPost',type:'post',author:'u1',feed:'home',text:'npc thread',createdAt:2,liked:false,reposted:false}),
        set('x','sample',{id:'sample',type:'comment',postId:'npcPost',author:'u1',text:'backfilled sample',replyTo:null,ambient:true,read:true,createdAt:3}),
        set('x','friendReply',{id:'friendReply',type:'comment',postId:'home1',author:'u1',text:'reply to user thread',replyTo:null,createdAt:4}),
    ]);
    const state=replayJournal(syncCommContext(journal,rev,chat).journal);
    const ids=commEntries(state).map(e=>e.platform+':'+e.id).sort();
    assert.ok(ids.includes('x:home1'),'home-feed post enters the sidecar');
    assert.ok(!ids.includes('x:sq1'),'square post keeps its own mechanism');
    assert.ok(ids.includes('x:sample'),'backfilled sample enters the sidecar');
    assert.ok(ids.includes('x:friendReply'));
    assert.equal(commMeta(state,'x','home1').shown,false,'phone-side posts default to unshown');
    assert.equal(commMeta(state,'x','sample').classification,'pending');
    // Samples targeting user's thread are provided to the narrative as optional
    // references; samples on other accounts' posts never enter the history.
    const prompt=buildContinuityPrompt({...state,contacts:{'name:u1':{id:'name:u1',name:'U1'}},profiles:{}},{name:'U1',nameIsUnique:true},{instruction:'参考',currentStoryTime:stamp('2026-11-02')});
    assert.match(prompt,/reply to user thread/,'sample on user thread is provided');
    assert.doesNotMatch(prompt,/backfilled sample/,'samples on other threads stay out of the history');
});

test('the narrative catalog keeps every reference but degrades expired or shown post content',async()=>{
    const state=channelState();
    state.x.fresh={id:'fresh',type:'post',author:'u1',feed:'home',text:'未过期的帖子完整内容应该出现在目录里供正文参考',createdAt:1,liked:false,reposted:false};
    state.x.old={id:'old',type:'post',author:'u1',feed:'home',text:'已过期的帖子内容不应该再提供给正文AI',createdAt:2,liked:false,reposted:false};
    state.x.shown={id:'shown',type:'post',author:'u1',feed:'home',text:'已展示的帖子正文只需梗概其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉',createdAt:3,liked:false,reposted:false};
    state.commContext={
        'x:fresh':{version:1,category:'B',classification:'classified',anchor:stamp('2026-11-01','12:00'),anchorSource:'source-floor',expired:false,shown:false},
        'x:old':{version:1,category:'A',classification:'classified',anchor:stamp('2026-11-01','09:00'),anchorSource:'source-floor',expired:true,shown:false},
        'x:shown':{version:1,category:'A',classification:'classified',anchor:stamp('2026-11-01','12:00'),anchorSource:'source-floor',expired:false,shown:true},
    };
    const catalog=JSON.parse(xStoryPrompt(state,stamp('2026-11-02','12:00')).split('已保存帖子（reply只用于user帖，metrics可用于user及NPC帖）：')[1].trim());
    const rows=Object.fromEntries(catalog.map(p=>[p.id,p]));
    assert.equal(rows.fresh.text.includes('未过期的帖子完整内容'),true,'fresh content stays available');
    assert.equal(rows.old.text,undefined,'expired post degrades to a bare reference');
    assert.ok(rows.old.id,'the full catalog keeps the expired reference');
    assert.equal(rows.shown.text,undefined,'shown posts omit text completely');
    assert.equal(rows.shown.imageDescription,undefined,'shown posts omit imagery completely');
    assert.equal(rows.shown.shown,true,'shown metadata still identifies the post');
    const updated=xStoryChanges(state,[{action:'metrics',postId:'shown',metrics:{likes:{value:5}}}],[{mes:'正文写出点赞数'}],0,'metrics-check',{name1:'Sam'});
    assert.equal(updated.find(change=>change.key==='shown').value.metrics.likes,5,'shown posts can still update engagement by ID');
    const ignored=xStoryChanges(state,[{action:'metrics',postId:'fresh',metrics:{likes:{value:5}}}],[{mes:'正文写出点赞数'}],0,'metrics-check',{name1:'Sam'});
    assert.equal(ignored.length,0,'unshown posts still require matching post text');
});

test('expired posts stop serving as re-outreach catalysts',async()=>{
    const state=channelState();
    state.messages.m1={id:'m1',contactId:'card:alex.png',role:'assistant',text:'还在吗',createdAt:1};
    state.x.p1={id:'p1',type:'post',author:'user',feed:'home',text:'新的公开动态内容',postedAtStory:{day:19000,hour:9},createdAt:2,liked:false,reposted:false};
    const contacts={ 'card:alex.png':{id:'card:alex.png',name:'Alex'} };
    const base={...state,contacts,x:{...state.x,'p1':state.x.p1},profiles:{}};
    const fresh=buildCandidates(base,null);
    assert.ok(fresh.some(c=>c.posts.some(p=>p.id==='p1')),'fresh post qualifies as a catalyst');
    base.commContext={'x:p1':{version:1,category:'A',classification:'classified',anchor:stamp('2026-11-01','12:00'),anchorSource:'source-floor',expired:true,shown:false}};
    const expired=buildCandidates(base,stamp('2026-11-02','13:00'));
    assert.equal(expired.length,0,'expired post no longer triggers outreach');
});

function buildCandidates(state,now){
    return xTriggerCandidates(state,'Sam',now);
}

test('an X DM actually sent in narrative is imported as shown, not re-presented two floors later',async()=>{
    const context={name1:'Sam',name2:'Alex',chatId:'x-narrative',characterId:0,characters:[{name:'Alex',avatar:'alex.png'}],chat:[],chatMetadata:{}};
    const recipient='黑胶浪潮唱片行',content='Tuesday at 4:15 PM works. Photos at the listening corner, $150 cash after the post goes live. '+('Confirmed details. '.repeat(8));
    const marker={platform:'x',action:'sent',sender:'user',recipient,kind:'text',text:content,category:'B',shown:true};
    context.chat.push({mes:'2024-10-07 15:00 Sam 在 X 私信里发给黑胶浪潮唱片行：'+content+'<!--durian-message:'+JSON.stringify(marker)+'-->'});
    let rev=await revisionsFor(messageSignatures(context.chat)),journal=importStoryPhone(undefined,rev,context.chat,context).journal;
    let state=replayJournal(syncCommContext(journal,rev,context.chat).journal);
    const msgs=Object.values(state.x).filter(r=>r.type==='message');
    assert.equal(msgs.length,1);
    assert.equal(msgs[0].role,'user');assert.equal(msgs[0].status,'sent');assert.equal(msgs[0].text,content);
    assert.equal(msgs[0].origin,'narrative');
    assert.equal(state.x[msgs[0].accountId].dmAccepted,true,'narrative outgoing channel can receive follow-up');
    assert.equal(state.x[msgs[0].accountId].identityKnown,false,'anonymous user not disclosed to shop');
    assert.equal(commMeta(state,'x',msgs[0].id).shown,true);
    assert.equal(commMeta(state,'x',msgs[0].id).category,'B');
    context.chat.push({mes:'2024-10-07 15:15 角色回忆已有的周二预约，没有新的私信。'});
    context.chat.push({mes:'2024-10-07 15:30 继续走路。'});
    rev=await revisionsFor(messageSignatures(context.chat));
    journal=importStoryPhone(journal,rev,context.chat,context).journal;
    state=replayJournal(syncCommContext(journal,rev,context.chat).journal);
    assert.equal(Object.values(state.x).filter(r=>r.type==='message').length,1,'later floors do not re-import old prose');
    const prompt=buildContinuityPrompt(state,speaker,{instruction:'延续既有交流',allParticipants:true,userName:'Sam',currentStoryTime:stamp('2024-10-07','15:30'),budget:40000});
    assert.equal(prompt,'','shown X DM is absent from the next narrative context');
    const rolled=replayJournal(reconcileJournal(journal,rev.slice(0,0)).journal);
    assert.equal(Object.values(rolled.x).filter(r=>r.type==='message').length,0,'message rolls back with source floor');
});

test('X narrative replies are shown, while app-only X replies remain unshown',async()=>{
    const context={name1:'Sam',name2:'Alex',chatId:'x-reply',characterId:0,characters:[{name:'Alex',avatar:'alex.png'}],chat:[],chatMetadata:{}};
    context.chat.push({mes:'2024-10-07 15:00 商家通过 X 私信回复 Sam：周二见。<!--durian-message:'+JSON.stringify({
        platform:'x',action:'received',sender:'唱片行',recipient:'user',kind:'text',text:'周二见。',category:'B'})+'-->'});
    let rev=await revisionsFor(messageSignatures(context.chat));
    const journal=importStoryPhone(undefined,rev,context.chat,context).journal;
    const state=replayJournal(syncCommContext(journal,rev,context.chat).journal);
    const message=Object.values(state.x).find(x=>x.type==='message');
    assert.equal(message.role,'assistant');
    assert.equal(commMeta(state,'x',message.id).shown,true);
    assert.equal(commMeta(state,'x',message.id).category,'B');
    const unshown={id:'app-only',type:'message',accountId:message.accountId,role:'assistant',text:'Later followup',createdAt:50};
    state.x[unshown.id]=unshown;
    assert.equal(inferShown({platform:'x',id:unshown.id,record:unshown}),false);
    const continuity=buildContinuityPrompt(state,speaker,{instruction:'衔接',allParticipants:true});
    assert.doesNotMatch(continuity,/周二见。/,'shown reply is absent');
    assert.match(continuity,/Later followup/,'app-only reply stays available');
    const entryPrompt=buildStoryPhonePrompt(state,context,normalizeSettings({}),context.chat);
    assert.match(entryPrompt,/X 私信与其他通信使用同一已展示\/未展示记录机制/);
    assert.match(entryPrompt,/"platform":"x"/);
});

test('X narrative import rejects drafts, third-party chats and disabled X',async()=>{
    const context={name1:'Sam',name2:'Alex',chatId:'x-ignore',characterId:0,characters:[{name:'Alex',avatar:'alex.png'}],chat:[],chatMetadata:{}};
    const tags=[
        {platform:'x',action:'sent',sender:'user',recipient:'唱片行',kind:'text',text:'还没发出去',evidence:'Sam 打算发送私信。'},
        {platform:'x',action:'sent',sender:'Alex',recipient:'唱片行',kind:'text',text:'第三方消息'},
        {platform:'x',action:'received',sender:'唱片行',recipient:'user',kind:'image',text:'图片（X正文暂不导入图片）'}
    ];
    context.chat.push({mes:'2024-10-07 15:00 Sam 打算发送私信。'+tags.map(x=>'<!--durian-message:'+JSON.stringify(x)+'-->').join('')});
    let rev=await revisionsFor(messageSignatures(context.chat)),journal=importStoryPhone(undefined,rev,context.chat,context).journal;
    assert.equal(Object.values(replayJournal(journal).x).filter(x=>x.type==='message').length,0);
    context.extensionSettings={personal_pocket_phone:{apps:{x:false}}};
    context.chat.push({mes:'2024-10-07 16:00 Sam 发了一条 X 私信：hello<!--durian-message:'+JSON.stringify({platform:'x',action:'sent',sender:'user',recipient:'唱片行',kind:'text',text:'hello'})+'-->'});
    rev=await revisionsFor(messageSignatures(context.chat));
    journal=importStoryPhone(journal,rev,context.chat,context).journal;
    assert.equal(Object.values(replayJournal(journal).x).filter(x=>x.type==='message').length,0);
});

test('anonymous X retains narrative DM markers even with no other outgoing channels',()=>{
 const settings=normalizeSettings({apps:{phone:false,messages:false,whatsapp:false,wechat:false,snapchat:false,x:true,daily:false,assets:false,amazon:false,food:false}});
 const state=channelState();state.x.profile={id:'profile',type:'profile',alias:'Moon'};
 const prompt=buildStoryPhonePrompt(state,{name1:'Sam',characters:[],characterId:0},settings,[{mes:'2024-10-07 15:00'}]);
 assert.match(prompt,/X 私信与其他通信使用同一已展示\/未展示记录机制/);
 assert.match(prompt,/商业邀约已经用durian-business offer/);
 assert.match(prompt,/"platform":"x"/);
});
