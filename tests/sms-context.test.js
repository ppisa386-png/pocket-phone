import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { smsExpired, smsForAI, smsClassificationPlan, smsClassificationChanges, smsEventForAI, syncSMSContext } from '../src/sms-context.js';
import { exactStoryTime } from '../src/story-clock.js';
import { appendChange, replayJournal, reconcileJournal, revisionsFor, messageSignatures, JOURNAL_KEY } from '../src/journal.js';
import { createPhoneMemory } from '../src/memory.js';
import { createPhoneService } from '../src/phone.js';
import { buildContinuityPrompt } from '../src/continuity.js';
import { renderMessagesScreen } from '../src/messages-view.js';
import { proactiveSources } from '../src/proactive-evidence.js';
import { normalizeSettings } from '../src/config.js';

const stamp = (date,time='12:00') => ({date,time,precision:'exact'});
const set = (collection,key,value) => ({collection,key,value});
const speaker = { name:'Alex',avatar:'alex.png',nameIsUnique:true };
const message = (id,contactId='card:alex.png') => ({id,contactId,name:contactId==='card:alex.png'?'Alex':'Bea',role:'assistant',text:'TEXT_'+id,createdAt:1,read:false});
const retention = (category,date='2026-10-01',time='12:00') => ({version:1,category,anchor:stamp(date,time),expired:false});

test('strict story-hour cutoffs: daily 12h/24h/24h01m, temporary 48h/72h/72h01m', () => {
    const a=retention('A'),b=retention('B');
    assert.equal(smsExpired(a,stamp('2026-10-02','00:00')),false);
    assert.equal(smsExpired(a,stamp('2026-10-02')),false);
    assert.equal(smsExpired(a,stamp('2026-10-02','12:01')),true);
    assert.equal(smsExpired(b,stamp('2026-10-03')),false);
    assert.equal(smsExpired(b,stamp('2026-10-04')),false);
    assert.equal(smsExpired(b,stamp('2026-10-04','12:01')),true);
    assert.equal(smsExpired(a,stamp('2026-09-30')),false);
    assert.equal(smsExpired(retention(null),stamp('2030-10-01')),false);
});

test('missing/fuzzy story time is not device time or invented elapsed duration', () => {
    assert.equal(smsExpired({category:'A',anchor:null},stamp('2030-01-01')),false);
    assert.equal(smsExpired(retention('A'),null),false);
    assert.equal(smsExpired(retention('A','invalid'),stamp('2030-01-01')),false);
    const dateOnly=retention('A','2026-10-01','');
    assert.equal(smsExpired(dateOnly,stamp('2026-10-02','23:59')),false);
    assert.equal(smsExpired(dateOnly,stamp('2026-10-03','00:00')),true);
    assert.deepEqual(exactStoryTime([{mes:'时间：2026-10-01 晚上'}]),stamp('2026-10-01',''));
    assert.equal(smsExpired({...retention('A'),expired:true},null),true);
});

test('both AI history builders filter identically while every original bubble remains visible', () => {
    const state={contacts:{'card:alex.png':{id:'card:alex.png',name:'Alex'}},messages:{a:message('a'),b:message('b'),other:message('other','card:bea.png')},smsContext:{a:retention('A'),b:retention('B'),other:retention('A')},calls:{},profiles:{}};
    const now=stamp('2026-10-03');
    assert.deepEqual(smsForAI(state,'card:alex.png',now).map(m=>m.id),['b']);
    const prompt=buildContinuityPrompt(state,speaker,{instruction:'continue',currentStoryTime:now});
    assert.doesNotMatch(prompt,/TEXT_a|TEXT_other/);assert.match(prompt,/TEXT_b/);
    const html=renderMessagesScreen(state,'card:alex.png',false,{});
    assert.match(html,/TEXT_a/);assert.match(html,/TEXT_b/);
    assert.doesNotMatch(html,/expired|classification|已过期|时效/);
    for(const replyStatus of ['pending','received','no_reply','failed','sent']) {
        state.messages.b.replyStatus=replyStatus;
        assert.equal(smsForAI(state,'card:alex.png',stamp('2026-10-05')).length,0);
    }
});

test('migration recovers source-floor clock without rewriting text, original time or order', () => {
    const chat=[{mes:'2026-10-01 12:00'},{mes:'2026-10-05 12:00'}],revisions=['first','later'];
    let journal=appendChange(undefined,revisions.slice(0,1),[set('messages','a',{...message('a'),createdAt:9999999999999}),set('messages','b',message('b')),set('smsContext','a',{category:'A'})]);
    const before=replayJournal(journal).messages;
    const migrated=syncSMSContext(journal,revisions,chat);journal=migrated.journal;
    const state=replayJournal(journal);
    assert.deepEqual(state.messages,before);
    assert.deepEqual(state.smsContext.a.anchor,stamp('2026-10-01'));
    assert.equal(state.smsContext.a.expired,true);
    assert.equal(state.smsContext.b.classification,'pending');
    assert.equal(state.smsContext.b.expired,false);
    assert.equal(syncSMSContext(journal,revisions,chat).changed,false,'migration is idempotent');
    journal=appendChange(journal,revisions,[set('messages','a',{...state.messages.a,text:'Edited old text',read:true})]);
    assert.equal(replayJournal(syncSMSContext(journal,revisions,chat).journal).smsContext.a.expired,true);
    const rollback=syncSMSContext(reconcileJournal(journal,['first']).journal,['first'],chat.slice(0,1));
    assert.equal(replayJournal(rollback.journal).smsContext.a.expired,false,'rollback restores the earlier story state');
    assert.equal(smsExpired(replayJournal(rollback.journal).smsContext.a,stamp('2026-10-01')),false);
});

test('classification validates exact IDs/categories and isolates contacts; retries never reclassify successes', () => {
    const state={messages:{a:message('a'),b:message('b'),c:message('c'),done:message('done'),expired:message('expired'),other:message('other','card:bea.png')},smsContext:{done:retention('B'),expired:{...retention('A'),expired:true}}};
    const plan=smsClassificationPlan(state,'card:alex.png',stamp('2026-10-01'));
    assert.deepEqual(plan.ids,['a','b','c']);
    assert.doesNotMatch(plan.prompt,/TEXT_other|TEXT_expired/);
    const rows=[{id:'a',category:'B'},{id:'b',category:'A'},{id:'b',category:'B'},{id:'c',category:'longterm'},{id:'done',category:'A'},{id:'other',category:'B'},{id:'invented',category:'A'}];
    const changes=smsClassificationChanges({sms_classifications:rows},plan,state);
    assert.deepEqual(changes.map(c=>c.key),['a']);
    for(const change of changes) state.smsContext[change.key]=change.value;
    assert.deepEqual(smsClassificationPlan(state,'card:alex.png',null).ids,['b','c']);
    assert.deepEqual(smsClassificationChanges({},plan,state),[]);
    assert.equal(state.smsContext.done.category,'B');
    assert.equal(state.messages.a.text,'TEXT_a');
});

test('legacy batches drain oldest pending IDs without starving new messages or resending classified text for classification', () => {
    const state={messages:{},smsContext:{}};
    for(let i=0;i<100;i++)state.messages['m'+i]=message('m'+i);
    const first=smsClassificationPlan(state,'card:alex.png',null);
    assert.equal(first.ids.length,48);assert.ok(first.ids.includes('m0'));assert.ok(first.ids.includes('m99'));
    const changes=smsClassificationChanges({sms_classifications:first.ids.map(id=>({id,category:'B'}))},first,state);
    for(const change of changes)state.smsContext[change.key]=change.value;
    const next=smsClassificationPlan(state,'card:alex.png',null);
    assert.ok(next.ids.includes('m40'));assert.ok(next.ids.every(id=>!first.ids.includes(id)));
});

async function fixture(independent=false) {
    const bus=new EventEmitter(),prompts=[],injections={};
    const context={chatId:'sms-retention',name1:'Sam',name2:'Alex',characterId:0,characters:[{name:'Alex',avatar:'alex.png'}],chat:[{mes:'2026-10-01 12:00',is_user:false}],chatMetadata:{},saveMetadata:async()=>{},onlineStatus:'connected',eventSource:bus,event_types:Object.fromEntries(['GENERATION_STARTED','GENERATION_ENDED','GENERATION_AFTER_COMMANDS','MESSAGE_DELETED','CHAT_CHANGED'].map(n=>[n,n])),setExtensionPrompt(key,text){injections[key]=text;}};
    let responder=()=>({status:'reply',text:'NEW_REPLY',sms_reply_category:'B'});
    const run=async prompt=>{prompts.push(prompt);return JSON.stringify(await responder(prompt));};
    context.generateQuietPrompt=async ({quietPrompt})=>run(quietPrompt);
    const settings=normalizeSettings({retries:0,api:{mode:independent?'independent':'follow'}});
    const memory=createPhoneMemory({getContext:()=>context});
    const service=createPhoneService({memory,getContext:()=>context,getSettings:()=>settings,modelClient:{generate:run}});
    await memory.read();
    await memory.commit(await memory.begin(),[set('contacts','card:alex.png',{id:'card:alex.png',name:'Alex',number:'12345'}),set('messages','a',message('a')),set('messages','b',message('b')),set('messages','other',message('other','card:bea.png')),set('smsContext','a',{category:'A'}),set('smsContext','b',{category:'B'})]);
    return {context,memory,service,settings,prompts,bus,injections,respond(fn){responder=fn;},async advance(mes){context.chat.push({mes,is_user:false});await memory.read();},close(){service.destroy();memory.destroy();}};
}

for(const independent of [false,true])test(`real SMS request and saved classification (${independent?'independent':'host'} transport); no extra API or old revival`,async()=>{
    const f=await fixture(independent);
    try{
        await f.advance('2026-10-03 12:00');
        f.respond(prompt=>{
            assert.doesNotMatch(prompt,/TEXT_a|TEXT_other/);assert.match(prompt,/TEXT_b/);
            const plan=smsClassificationPlan(f.service.snapshot(),'card:alex.png',stamp('2026-10-03'));
            assert.equal(plan.ids.length,1);
            return {status:'reply',text:'NEW_REPLY',sms_reply_category:'B',sms_classifications:plan.ids.map(id=>({id,category:'B'}))};
        });
        const sent=await f.service.sendMessage('card:alex.png','NEW_USER');
        assert.equal(sent.ok,true);assert.equal(f.prompts.length,1);
        let state=(await f.memory.read()).state;
        const user=Object.values(state.messages).find(m=>m.text==='NEW_USER');
        assert.equal(state.smsContext[user.id].category,'B');assert.equal(state.smsContext['reply:'+user.id].category,'B');
        assert.equal(state.smsContext.a.expired,true);
        assert.equal(state.messages.a.text,'TEXT_a');
        await f.advance('2026-10-08 12:00');
        state=(await f.memory.read()).state;
        assert.equal(smsForAI(state,'card:alex.png',stamp('2026-10-08')).length,0);
        const serialized=JSON.stringify(f.context.chatMetadata);
        await f.memory.read();assert.equal(JSON.stringify(f.context.chatMetadata),serialized,'no recurring metadata writes');
        f.respond(prompt=>{assert.doesNotMatch(prompt,/TEXT_a|TEXT_b|TEXT_other|NEW_REPLY|NEW_USER/);return {status:'no_reply',text:''};});
        await f.service.sendMessage('card:alex.png','UNCLASSIFIED_NEW');
        state=(await f.memory.read()).state;
        const pending=Object.values(state.messages).find(m=>m.text==='UNCLASSIFIED_NEW');
        assert.equal(state.smsContext[pending.id].classification,'pending');
        assert.equal(f.prompts.length,2,'missing category does not cause retries');
        assert.equal(state.smsContext.a.expired,true);
        assert.ok(JSON.parse(serialized)[JOURNAL_KEY].events.length);
    }finally{f.close();}
});

test('phone request, proactive sources, event evidence and narrative injection cannot leak expired SMS',async()=>{
    const f=await fixture();
    try{
        await f.advance('2026-10-05 12:00');
        const state=(await f.memory.read()).state;
        const sources=proactiveSources(f.context,f.settings,{id:'card:alex.png',name:'Alex',characterId:0},state);
        assert.equal(sources.some(s=>s.id.startsWith('message:')),false);
        const event={origin:'communication',channel:'sms',participant:{id:'card:alex.png'},active:true,evidence:'TEXT_a',reason:'TEXT_a',smsSourceIds:['a']};
        assert.equal(smsEventForAI(state,event,stamp('2026-10-05')),null);
        assert.equal(event.active,true,'not a completed matter');
        assert.equal(smsEventForAI(state,{...event,channel:'phone'},stamp('2026-10-05')).active,true);
        f.respond(prompt=>{assert.doesNotMatch(prompt,/TEXT_a|TEXT_b|TEXT_other/);return {status:'answered',text:'Call reply'};});
        const result=await f.service.dial('card:alex.png');assert.equal(result.ok,true);
        const prompt=buildContinuityPrompt(f.service.snapshot(),speaker,{instruction:'continue',currentStoryTime:stamp('2026-10-05')});
        assert.doesNotMatch(prompt,/TEXT_a|TEXT_b/);assert.match(prompt,/Call reply/);
    }finally{f.close();}
});

test('queued drafts acquire their retention clock when sent, not when typed',async()=>{
    const f=await fixture();
    try{
        await f.service.queueMessage('card:alex.png','DRAFT');
        const draft=Object.values(f.service.snapshot().messages).find(m=>m.text==='DRAFT');
        assert.equal(f.service.snapshot().smsContext[draft.id],undefined);
        await f.advance('2026-10-10 12:00');
        f.respond(()=>({status:'no_reply',text:'',sms_classifications:[{id:draft.id,category:'A'}]}));
        await f.service.flushMessages('card:alex.png');
        const meta=f.service.snapshot().smsContext[draft.id];
        assert.deepEqual(meta.anchor,stamp('2026-10-10'));assert.equal(meta.expired,false);
        await f.advance('2026-10-11 12:00');assert.equal(f.service.snapshot().smsContext[draft.id].expired,false);
        await f.advance('2026-10-11 12:01');assert.equal(f.service.snapshot().smsContext[draft.id].expired,true);
    }finally{f.close();}
});

test('historical unknown timestamp stays unknown after new dated prose; classification does not invent an anchor',async()=>{
    const chat=[{mes:'No story date here',send_date:'2026-01-01T00:00:00Z'},{mes:'2026-10-10 12:00'}];
    const rev=await revisionsFor(messageSignatures(chat));
    let journal=appendChange(undefined,rev.slice(0,1),[set('messages','old',{...message('old'),storyTime:{date:'',time:''},createdAt:1})]);
    journal=syncSMSContext(journal,rev,chat).journal;
    let state=replayJournal(journal);
    assert.equal(state.smsContext.old.anchor.date,'');
    const plan=smsClassificationPlan(state,'card:alex.png',stamp('2026-10-10'));
    journal=appendChange(journal,rev,smsClassificationChanges({sms_classifications:[{id:'old',category:'A'}]},plan,state));
    state=replayJournal(syncSMSContext(journal,rev,chat).journal);
    assert.equal(state.smsContext.old.category,'A');assert.equal(state.smsContext.old.expired,false);
    assert.equal(state.messages.old.createdAt,1);assert.equal(state.smsContext.old.anchor.date,'');
});

test('invalid classification leaves pending without retries; next request repairs it once and reload keeps the result',async()=>{
 const f=await fixture();try{
  f.respond(prompt=>{
   const pending=smsClassificationPlan(f.service.snapshot(),'card:alex.png',stamp('2026-10-01')).ids;
   return {status:'reply',text:'UNCLASSIFIED_REPLY',sms_reply_category:'forever',sms_classifications:pending.flatMap(id=>[{id,category:'A'},{id,category:'B'}])};
  });
  await f.service.sendMessage('card:alex.png','PENDING_USER');
  assert.equal(f.prompts.length,1);
  let state=f.service.snapshot();const pending=Object.values(state.messages).filter(m=>['PENDING_USER','UNCLASSIFIED_REPLY'].includes(m.text));
  assert.equal(pending.length,2);for(const m of pending)assert.equal(state.smsContext[m.id].classification,'pending');
  await f.advance('2026-10-06 12:00');
  f.respond(()=>({status:'no_reply',text:'',sms_classifications:smsClassificationPlan(f.service.snapshot(),'card:alex.png',stamp('2026-10-06')).ids.map(id=>({id,category:'A'}))}));
  await f.service.sendMessage('card:alex.png','NEW_TRIGGER');
  assert.equal(f.prompts.length,2);
  state=f.service.snapshot();for(const m of pending){assert.equal(state.smsContext[m.id].category,'A');assert.equal(state.smsContext[m.id].expired,true);assert.equal(state.messages[m.id].text,m.text);}
  const saved=JSON.parse(JSON.stringify(f.context.chatMetadata));const context={...f.context,chatMetadata:saved,eventSource:null};
  const reloaded=createPhoneMemory({getContext:()=>context});try{
   const after=(await reloaded.read()).state;
   for(const m of pending){assert.equal(after.smsContext[m.id].expired,true);assert.equal(after.messages[m.id].text,m.text);}
   assert.deepEqual(smsClassificationPlan(after,'card:alex.png',stamp('2026-10-06')).ids,[]);
  }finally{reloaded.destroy();}
 }finally{f.close();}
});

test('expired manual retry/reroll cannot send old raw text; local editing cannot renew its lease',async()=>{
 const f=await fixture();try{
  await f.advance('2026-10-05 12:00');const before=f.prompts.length;
  assert.equal((await f.service.rerollMessage('a')).ok,false);
  assert.equal(f.prompts.length,before);
  await f.service.editMessage('a','MANUALLY_EDITED_OLD');
  assert.equal(f.service.snapshot().smsContext.a.expired,true);
  const stale={id:'failed',contactId:'card:alex.png',role:'user',text:'OLD_FAILED',replyStatus:'failed',createdAt:1};
  await f.memory.commit(await f.memory.begin(),[set('messages','failed',stale),set('smsContext','failed',{category:'A',anchor:stamp('2026-10-01'),expired:true})]);
  await f.service.retryMessage('failed');assert.equal(f.prompts.length,before);
  assert.equal(f.service.snapshot().messages.failed.text,'OLD_FAILED');
  await f.service.deleteMessage('a');
  assert.equal(f.service.snapshot().messages.a,undefined);assert.equal(f.service.snapshot().smsContext.a,undefined);
 }finally{f.close();}
});

test('narrative incoming/outgoing annotations classify actual SMS without extra requests and roll back with their floor',async()=>{
 const f=await fixture();try{
  const evidence='Alex sent Sam a message.',reply='Sam sent Alex a message: ORIGINAL_OUTGOING';
  await f.advance('2026-10-02 12:00\n'+evidence+'<!--durian-contact:'+JSON.stringify({kind:'sms',name:'Alex',sender:'Alex',recipient:'user',evidence,text:'IMPORTED_INCOMING',sms_category:'B'})+'-->\n'+reply+'<!--durian-contact:'+JSON.stringify({kind:'sms',name:'Alex',sender:'user',recipient:'Alex',evidence:reply,text:'ORIGINAL_OUTGOING',sms_category:'A'})+'-->');
  let state=f.service.snapshot();const inbound=Object.values(state.messages).find(m=>m.text==='IMPORTED_INCOMING'),outbound=Object.values(state.messages).find(m=>m.text==='ORIGINAL_OUTGOING');
  assert.equal(state.smsContext[inbound.id].category,'B');assert.equal(state.smsContext[outbound.id].category,'A');assert.equal(f.prompts.length,0);
  await f.advance('2026-10-04 12:00');state=f.service.snapshot();
  assert.equal(state.smsContext[inbound.id].expired,false);assert.equal(state.smsContext[outbound.id].expired,true);
  assert.equal(state.messages[inbound.id].text,'IMPORTED_INCOMING');
  f.context.chat.pop();f.context.chat.pop();await f.memory.read();
  assert.equal(f.service.snapshot().messages[inbound.id],undefined);assert.equal(f.service.snapshot().smsContext[inbound.id],undefined);
 }finally{f.close();}
});
