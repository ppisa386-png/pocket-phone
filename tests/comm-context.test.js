import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { appendChange, replayJournal, reconcileJournal, revisionsFor, messageSignatures, JOURNAL_KEY } from '../src/journal.js';
import { syncCommContext, commEntries, commExpired, commMeta, commKey, commReplyClassification, commRecordPatch, commClassificationPlan, commClassificationChanges, commRecordExists, commExcerpt, inferShown, COMM_PLATFORMS, commReadStatus } from '../src/comm-context.js';
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

test('continuity omits all X records and shown records from other channels',()=>{
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
    for(const app of ['whatsapp','wechat','snapchat'])assert.match(prompt,new RegExp('UNSHOWN_'+app));
    assert.doesNotMatch(prompt,/UNSHOWN_X_COMMENT|UNSHOWN_x/,'X comments and DMs remain phone-only');
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
    // X comments remain saved in the sidecar but never enter narrative history.
    const prompt=buildContinuityPrompt({...state,contacts:{'name:u1':{id:'name:u1',name:'U1'}},profiles:{}},{name:'U1',nameIsUnique:true},{instruction:'参考',currentStoryTime:stamp('2026-11-02')});
    assert.doesNotMatch(prompt,/reply to user thread/,'user-thread X comments are not sent to narrative');
    assert.doesNotMatch(prompt,/backfilled sample/,'samples on other threads stay out of the history');
});

test('the narrative catalog keeps every reference but degrades expired or shown post content',async()=>{
    const state=channelState();
    state.x.fresh={id:'fresh',type:'post',author:'user',feed:'home',text:'未过期的帖子完整内容应该出现在目录里供正文参考',createdAt:1,liked:false,reposted:false};
    state.x.old={id:'old',type:'post',author:'user',feed:'home',text:'已过期的帖子内容不应该再提供给正文AI',createdAt:2,liked:false,reposted:false};
    state.x.shown={id:'shown',type:'post',author:'user',feed:'home',text:'已展示的帖子正文只需梗概其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉其余省略掉',createdAt:3,liked:false,reposted:false};
    state.commContext={
        'x:fresh':{version:1,category:'B',classification:'classified',anchor:stamp('2026-11-01','12:00'),anchorSource:'source-floor',expired:false,shown:false},
        'x:old':{version:1,category:'A',classification:'classified',anchor:stamp('2026-11-01','09:00'),anchorSource:'source-floor',expired:true,shown:false},
        'x:shown':{version:1,category:'A',classification:'classified',anchor:stamp('2026-11-01','12:00'),anchorSource:'source-floor',expired:false,shown:true},
    };
    const catalog=JSON.parse(xStoryPrompt(state,stamp('2026-11-02','12:00')).split('已保存的 user 本人帖子（仅附 user 参与的公开评论及其被回复链，不提供无关评论、NPC 帖子、广场、趋势及私信）：')[1].trim());
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
    assert.doesNotMatch(continuity,/Later followup/,'app-only private messages stay inside X');
    const entryPrompt=buildStoryPhonePrompt(state,context,normalizeSettings({}),context.chat);
    assert.match(entryPrompt,/WhatsApp 和 X 私信的 read 是手机阅读状态，shown 是小说正文展示状态，两者独立/);
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


test('X catalog uses source story dates and does not repeatedly send old pending post text',()=>{
 const state=channelState(),day=Date.UTC(2026,9,4)/86400000;
 state.x.p={id:'p',type:'post',author:'user',feed:'home',text:'十月四号发的公开推文',postedAtStory:{day,hour:10},createdAt:Date.now()};
 const row=now=>JSON.parse(xStoryPrompt(state,now).split('已保存的 user 本人帖子（仅附 user 参与的公开评论及其被回复链，不提供无关评论、NPC 帖子、广场、趋势及私信）：')[1].trim())[0];
 assert.equal(row(stamp('2026-10-05','12:00')).postedDate,'2026-10-04');
 assert.equal(row(stamp('2026-10-05','12:00')).storyDaysAgo,1);
 assert.equal(row(stamp('2026-10-07','10:00')).text,state.x.p.text,'72h boundary remains visible');
 assert.equal(row(stamp('2026-10-07','10:01')).text,undefined);
 assert.equal(row(stamp('2026-11-09','12:00')).storyDaysAgo,36);
 assert.equal(row(stamp('2026-11-09','12:00')).id,'p');
 assert.equal(row(stamp('2026-11-09','12:00')).text,undefined);
 state.x.p.postedAtStory={day,hour:null};
 assert.equal(row(stamp('2026-10-07','12:00')).text,state.x.p.text,'unknown hour does not guess cutoff');
 assert.equal(row(stamp('2026-10-08','12:00')).text,undefined);
 delete state.x.p.postedAtStory;
 assert.equal(row(stamp('2026-11-09','12:00')).postedDate,undefined,'missing date does not use createdAt');
});
test('existing X post is marked shown on first prose mention and reverts on floor rollback',async()=>{
 const ctx={name1:'Sam',name2:'Alex',chatId:'x-post-shown',characterId:0,characters:[{name:'Alex',avatar:'alex.png'}],chat:[],chatMetadata:{}};
 ctx.chat.push({mes:'2026-10-04 10:00 发帖当日',is_user:false});
 let rev=await revisionsFor(messageSignatures(ctx.chat));
 let journal=appendChange(undefined,rev,[set('x','old',{id:'old',type:'post',author:'user',feed:'home',text:'十月四日发的公开内容',postedAtStory:{day:Date.UTC(2026,9,4)/86400000,hour:10},createdAt:1})]);
 journal=syncCommContext(journal,rev,ctx.chat).journal;
 assert.equal(commMeta(replayJournal(journal),'x','old').shown,false);
 assert.equal(commRecordPatch('x','some-id',null,null,true)[0].value.shown,true);
 ctx.chat.push({mes:'2026-10-05 10:00 她提到了昨天 X 的旧帖。<!--durian-message-shown:{"platform":"x","id":"old"}-->',is_user:false});
 rev=await revisionsFor(messageSignatures(ctx.chat));
 journal=importStoryPhone(journal,rev,ctx.chat,ctx).journal;
 const state=replayJournal(syncCommContext(journal,rev,ctx.chat).journal);
 assert.equal(commMeta(state,'x','old').shown,true);
 const catalog=JSON.parse(xStoryPrompt(state,stamp('2026-10-05','10:00')).split('已保存的 user 本人帖子（仅附 user 参与的公开评论及其被回复链，不提供无关评论、NPC 帖子、广场、趋势及私信）：')[1].trim());
 assert.equal(catalog[0].text,undefined);assert.equal(catalog[0].postedDate,'2026-10-04');
 assert.equal(commMeta(replayJournal(reconcileJournal(journal,rev.slice(0,1)).journal),'x','old').shown,false);
});
test('X comment references use the original post date, not the comment timestamp',()=>{
 const state=channelState(),day=Date.UTC(2026,9,4)/86400000;
 state.x.a={id:'a',type:'account',name:'Alex',characterId:'card:alex.png',identityKnown:true};
 state.x.p={id:'p',type:'post',author:'user',feed:'home',text:'十月四日原帖',postedAtStory:{day,hour:10},createdAt:1};
 state.x.c={id:'c',type:'comment',postId:'p',author:'a',text:'这是一条刚发出的旧帖评论',createdAt:2};
 state.commContext['x:c']={shown:false};
 const prompt=buildContinuityPrompt(state,speaker,{instruction:'衔接',allParticipants:true,currentStoryTime:stamp('2026-11-09','12:00')});
 assert.doesNotMatch(prompt,/这是一条刚发出的旧帖评论/);
 assert.equal(prompt,'','X comments have no continuity injection even when dated');
});

test('notification-only incoming X and WhatsApp messages stay unshown until prose actually reads them',async()=>{
    const context={name1:'Sam',name2:'Alex',chatId:'notification-only',characterId:0,characters:[{name:'Alex',avatar:'alex.png'}],chat:[],chatMetadata:{}};
    const rows=[
        {platform:'x',action:'received',sender:'唱片行',recipient:'user',kind:'text',text:'HIDDEN_X_PRIVATE',category:'B',shown:false},
        {platform:'whatsapp',action:'received',sender:'Alex',recipient:'user',kind:'text',text:'HIDDEN_WA_PRIVATE',category:'A',shown:false},
    ];
    const notice='手机在口袋里短暂震动。';
    context.chat.push({mes:notice+rows.map(row=>'<!--durian-message:'+JSON.stringify(row)+'-->').join('')});
    let rev=await revisionsFor(messageSignatures(context.chat));
    let journal=importStoryPhone(undefined,rev,context.chat,context).journal;
    let state=replayJournal(syncCommContext(journal,rev,context.chat).journal);
    const saved=[];
    for(const [platform,secret] of [['x','HIDDEN_X_PRIVATE'],['whatsapp','HIDDEN_WA_PRIVATE']]){
        const message=Object.values(state[platform]).find(row=>row.type==='message'&&row.text===secret);
        assert.ok(message,'incoming '+platform+' stored');
        assert.equal(commMeta(state,platform,message.id)?.shown,false,'notification is not narrative reading');
        assert.ok(!notice.includes(secret));
        saved.push({platform,id:message.id});
    }
    const before=buildContinuityPrompt(state,speaker,{instruction:'衔接通信',allParticipants:true,budget:50000});
    assert.doesNotMatch(before,/HIDDEN_X_PRIVATE/,'X private messages stay local');
    assert.doesNotMatch(before,/HIDDEN_WA_PRIVATE/,'already-mentioned unread WhatsApp notice stays silent');
    const whenReading=buildContinuityPrompt(state,speaker,{instruction:'衔接通信',allParticipants:true,budget:50000,readingPhone:true});
    assert.match(whenReading,/HIDDEN_WA_PRIVATE/,'explicitly opening the phone can still reveal the original message');
    assert.match(whenReading,/noticeMentioned=true/);
    context.chat.push({mes:'Sam实际打开手机阅读了这两条信息。'+saved.map(row=>
        '<!--durian-message-shown:'+JSON.stringify(row)+'-->').join('')});
    rev=await revisionsFor(messageSignatures(context.chat));
    journal=importStoryPhone(journal,rev,context.chat,context).journal;
    state=replayJournal(syncCommContext(journal,rev,context.chat).journal);
    for(const row of saved)assert.equal(commMeta(state,row.platform,row.id)?.shown,true,'explicit reading marks '+row.platform+' as shown');
    assert.equal(buildContinuityPrompt(state,speaker,{instruction:'衔接通信',allParticipants:true,budget:50000}),'');
    const restored=replayJournal(reconcileJournal(journal,rev.slice(0,-1)).journal);
    for(const row of saved)assert.equal(commMeta(restored,row.platform,row.id)?.shown,false,'rolling back reading restores unshown');
});


test('WhatsApp, WeChat and X incoming DMs mirror phone-read state independently of shown state',async()=>{
    const chat=[{mes:'2026-11-12 09:00',name:'Alex',is_user:false}];
    const rev=await revisionsFor(messageSignatures(chat));
    let journal=appendChange(undefined,rev,[
        set('whatsapp','wa-in',{id:'wa-in',type:'message',accountId:'card:alex.png',role:'assistant',text:'WA_CONTENT',read:false,createdAt:1}),
        set('whatsapp','wa-out',{id:'wa-out',type:'message',accountId:'card:alex.png',role:'user',text:'my reply',read:true,createdAt:2}),
        set('wechat','wc-in',{id:'wc-in',type:'message',accountId:'card:alex.png',role:'assistant',text:'WC_CONTENT',read:false,createdAt:3}),
        set('wechat','wc-out',{id:'wc-out',type:'message',accountId:'card:alex.png',role:'user',text:'my WeChat reply',read:true,createdAt:4}),
        set('x','x-in',{id:'x-in',type:'message',accountId:'card:alex.png',role:'assistant',text:'X_CONTENT',read:false,createdAt:5}),
    ]);
    journal=syncCommContext(journal,rev,chat).journal;
    let state=replayJournal(journal);
    assert.equal(commMeta(state,'whatsapp','wa-in').shown,false);
    assert.equal(commMeta(state,'whatsapp','wa-in').read,false);
    assert.equal(commMeta(state,'wechat','wc-in').shown,false);
    assert.equal(commMeta(state,'wechat','wc-in').read,false);
    assert.equal(commMeta(state,'x','x-in').shown,false);
    assert.equal(commMeta(state,'x','x-in').read,false);
    assert.equal(commMeta(state,'whatsapp','wa-out').read,undefined,'user-authored messages are not classified as unread');
    assert.equal(commMeta(state,'wechat','wc-out').read,undefined,'user-authored WeChat messages are not classified as unread');
    // Opening both phone threads updates the source app records. Sidecar sync
    // mirrors read=true without changing whether prose has presented them.
    journal=appendChange(journal,rev,[
        set('whatsapp','wa-in',{...state.whatsapp['wa-in'],read:true}),
        set('wechat','wc-in',{...state.wechat['wc-in'],read:true}),
        set('x','x-in',{...state.x['x-in'],read:true}),
    ]);
    state=replayJournal(syncCommContext(journal,rev,chat).journal);
    assert.equal(commMeta(state,'whatsapp','wa-in').read,true);
    assert.equal(commMeta(state,'wechat','wc-in').read,true);
    assert.equal(commMeta(state,'x','x-in').read,true);
    assert.equal(commMeta(state,'whatsapp','wa-in').shown,false);
    assert.equal(commMeta(state,'wechat','wc-in').shown,false);
    assert.equal(commMeta(state,'x','x-in').shown,false);
    assert.equal(commReadStatus(state,'whatsapp','wa-in',state.whatsapp['wa-in']),true);
    assert.equal(commReadStatus(state,'wechat','wc-in',state.wechat['wc-in']),true);
    assert.equal(commReadStatus(state,'x','x-in',state.x['x-in']),true);
});

test('continuity explicitly distinguishes WhatsApp and WeChat read-but-unshown from unread messages',()=>{
    const state=channelState(),who={id:'card:alex.png',type:'account',name:'Alex',characterId:'card:alex.png',identityKnown:true};
    state.whatsapp[who.id]={...who};
    state.whatsapp.read={id:'read',type:'message',accountId:who.id,role:'assistant',text:'ALREADY_READ_CONTENT',read:true,createdAt:1};
    state.whatsapp.unread={id:'unread',type:'message',accountId:who.id,role:'assistant',text:'NOT_READ_CONTENT',read:false,createdAt:2};
    state.wechat[who.id]={...who};
    state.wechat.read={id:'wechat-read',type:'message',accountId:who.id,role:'assistant',text:'WECHAT_ALREADY_READ_CONTENT',read:true,createdAt:3};
    state.wechat.unread={id:'wechat-unread',type:'message',accountId:who.id,role:'assistant',text:'WECHAT_NOT_READ_CONTENT',read:false,createdAt:4};
    state.commContext['whatsapp:read']={shown:false,read:true,expired:false};
    state.commContext['whatsapp:unread']={shown:false,read:false,expired:false};
    state.commContext['wechat:wechat-read']={shown:false,read:true,expired:false};
    state.commContext['wechat:wechat-unread']={shown:false,read:false,expired:false};
    const prompt=buildContinuityPrompt(state,speaker,{instruction:'衔接',allParticipants:true,budget:50000});
    const records=JSON.parse(prompt.split('\n').at(-2)).records;
    const read=records.find(row=>row.recordId==='read'),unread=records.find(row=>row.recordId==='unread');
    const wechatRead=records.find(row=>row.recordId==='wechat-read'),wechatUnread=records.find(row=>row.recordId==='wechat-unread');
    assert.equal(read.shown,false);assert.equal(read.read,true);
    assert.equal(unread.shown,false);assert.equal(unread.read,false);
    assert.equal(wechatRead.shown,false);assert.equal(wechatRead.read,true);
    assert.equal(wechatUnread.shown,false);assert.equal(wechatUnread.read,false);
    assert.match(prompt,/WECHAT_ALREADY_READ_CONTENT/);assert.match(prompt,/WECHAT_NOT_READ_CONTENT/);
    assert.match(prompt,/shown 与 read 是两个独立状态/);
    assert.match(prompt,/不得再称其未读、刚收到/);
    assert.match(prompt,/不能把多条未展示记录一律写成一串未读消息/);
    assert.doesNotMatch(prompt,/read:true.*read:false/,'states are structured, not flattened into a single unread label');
});


test('a prose reminder consumes the unread-notice opportunity but does not read or display messages',async()=>{
    const chat=[
        {mes:'2026-11-13 09:00',name:'Alex',is_user:false},
        {mes:'Sam 的手机屏幕亮起，显示几条未读消息。',name:'Alex',is_user:false},
        {mes:'他们继续讨论明天的活动。',name:'Alex',is_user:false},
    ];
    const rev=await revisionsFor(messageSignatures(chat)),accountId='card:alex.png';
    const base=appendChange(undefined,rev.slice(0,1),[
        set('contacts',accountId,{id:accountId,name:'Alex'}),
        set('messages','sms-old',{id:'sms-old',contactId:accountId,role:'assistant',text:'SMS_SECRET',read:false,createdAt:1}),
        set('whatsapp',accountId,{id:accountId,type:'account',name:'Alex',identityKnown:true,characterId:accountId}),
        set('whatsapp','wa-old',{id:'wa-old',type:'message',accountId,role:'assistant',text:'WA_SECRET',read:false,createdAt:2}),
    ]);
    const context={name1:'Sam',name2:'Alex',characters:[{name:'Alex',avatar:'alex.png'}],characterId:0};
    let result=importStoryPhone(base,rev,chat,context);
    let journal=syncCommContext(result.journal,rev,chat).journal,state=replayJournal(journal);
    assert.equal(state.commContext['sms:sms-old'].noticeMentioned,true);
    assert.equal(state.commContext['whatsapp:wa-old'].noticeMentioned,true);
    assert.equal(state.messages['sms-old'].read,false);
    assert.equal(state.whatsapp['wa-old'].read,false);
    assert.equal(state.commContext['sms:sms-old'].shown,false);
    assert.equal(state.commContext['whatsapp:wa-old'].shown,false);
    const opts={instruction:'剧情衔接',allParticipants:true,budget:20000};
    const silent=buildContinuityPrompt(state,speaker,opts);
    assert.doesNotMatch(silent,/SMS_SECRET|WA_SECRET/,'old unread messages are no longer offered to generate another reminder');
    const reading=buildContinuityPrompt(state,speaker,{...opts,readingPhone:true});
    assert.match(reading,/SMS_SECRET/);
    assert.match(reading,/WA_SECRET/);
    assert.match(reading,/noticeMentioned":true/);
    assert.equal(importStoryPhone(journal,rev,chat,context).changed,false,'repeated import does not write duplicates');
    const newMessage={id:'sms-new',contactId:accountId,role:'assistant',text:'A_FRESH_MESSAGE',read:false,createdAt:3};
    journal=appendChange(journal,rev,[set('messages','sms-new',newMessage)]);
    state=replayJournal(syncCommContext(journal,rev,chat).journal);
    assert.match(buildContinuityPrompt(state,speaker,opts),/A_FRESH_MESSAGE/,'later genuine messages can still notify');
    assert.doesNotMatch(buildContinuityPrompt(state,speaker,opts),/SMS_SECRET|WA_SECRET/);
    const reverted=replayJournal(reconcileJournal(journal,rev.slice(0,1)).journal);
    assert.notEqual(reverted.commContext['sms:sms-old']?.noticeMentioned,true,'removing the notifying floor restores the notice opportunity');
});

test('exact notice markers apply to specified records only and never change another message or shown/read',async()=>{
    const id='card:alex.png',evidence='Sam 手机屏幕亮起，显示一条微信未读消息。';
    const marker='<!--durian-message-noticed:'+JSON.stringify({platform:'wechat',ids:['wc-old'],evidence})+'-->';
    const chat=[{mes:'2026-11-13 09:00',name:'Alex',is_user:false},{mes:evidence+marker,name:'Alex',is_user:false}];
    const rev=await revisionsFor(messageSignatures(chat));
    const base=appendChange(undefined,rev.slice(0,1),[
        set('wechat',id,{id,type:'account',name:'Alex',identityKnown:true,characterId:id}),
        set('wechat','wc-old',{id:'wc-old',type:'message',accountId:id,role:'assistant',text:'WC_SECRET',read:false}),
        set('whatsapp',id,{id,type:'account',name:'Alex',identityKnown:true,characterId:id}),
        set('whatsapp','wa-old',{id:'wa-old',type:'message',accountId:id,role:'assistant',text:'WA_SECRET',read:false}),
    ]);
    const context={name1:'Sam',name2:'Alex',characters:[{name:'Alex',avatar:'alex.png'}],characterId:0};
    const journal=importStoryPhone(base,rev,chat,context).journal,state=replayJournal(syncCommContext(journal,rev,chat).journal);
    assert.equal(state.commContext['wechat:wc-old'].noticeMentioned,true);
    assert.equal(state.commContext['whatsapp:wa-old'].noticeMentioned,false);
    assert.equal(state.commContext['wechat:wc-old'].shown,false);
    assert.equal(state.wechat['wc-old'].read,false);
    const prompt=buildContinuityPrompt(state,speaker,{instruction:'延续',allParticipants:true,budget:20000});
    assert.doesNotMatch(prompt,/WC_SECRET/);
    assert.match(prompt,/WA_SECRET/);
    const invalidChat=[chat[0],{mes:evidence+'<!--durian-message-noticed:'+JSON.stringify({platform:'wechat',ids:['not-real'],evidence})+'-->',name:'Alex',is_user:false}];
    const rev2=await revisionsFor(messageSignatures(invalidChat));
    const invalid=importStoryPhone(appendChange(undefined,rev2.slice(0,1),base.events[0].changes),rev2,invalidChat,context);
    const badState=replayJournal(invalid.journal);
    assert.notEqual(badState.commContext['wechat:wc-old']?.noticeMentioned,true,'a made-up marker must not consume real notification records');
});

test('notification fallback cannot mark a message that did not exist until a later floor',async()=>{
    const chat=[{mes:'First floor.',name:'Alex',is_user:false},
        {mes:'Sam 的手机上显示未读消息。',name:'Alex',is_user:false},
        {mes:'The later phone message is created here.',name:'Alex',is_user:false}];
    const rev=await revisionsFor(messageSignatures(chat)),id='card:alex.png';
    const base=appendChange(undefined,rev.slice(0,1),[
        set('contacts',id,{id,name:'Alex'}),
        set('messages','earlier',{id:'earlier',contactId:id,role:'assistant',text:'OLD',read:false})
    ]);
    const withFuture=appendChange(base,rev,[
        set('messages','later',{id:'later',contactId:id,role:'assistant',text:'FUTURE',read:false})
    ]);
    const context={name1:'Sam',name2:'Alex',characters:[{name:'Alex',avatar:'alex.png'}],characterId:0};
    const state=replayJournal(importStoryPhone(withFuture,rev,chat,context).journal);
    assert.equal(state.commContext['sms:earlier'].noticeMentioned,true);
    assert.notEqual(state.commContext['sms:later']?.noticeMentioned,true);
});
