import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPhoneMemory } from '../src/memory.js';
import { createPhoneService } from '../src/phone.js';
import { normalizeSettings } from '../src/config.js';
import { contactPolicy, validateProactive } from '../src/contact-policy.js';
import { validateIncoming } from '../src/incoming.js';
import { messageParticipants } from '../src/messages.js';
import { buildContinuityPrompt } from '../src/continuity.js';

const evidence = 'Sam gave Alex their phone number.';
const reason = 'Alex receives the changed meeting address and needs to notify Sam.';
const proposal = { status: 'message', can_obtain_number: true, route: 'known_number', channel: '', evidence,
    reason: 'New meeting address', reason_kind: 'new_information', reason_evidence: reason,
    requires_live_conversation: false, text: 'The meeting is at the library now.' };
function setup() {
    const bus = new EventEmitter();
    const ctx = { chatId: 'a', characterId: 0, name1: 'Sam', name2: 'Alex', characters: [{name:'Alex',avatar:'alex.png'}],
        chat: [{mes:evidence,name:'Sam',is_user:true},{mes:reason,name:'Alex',is_user:false}], chatMetadata: {}, onlineStatus:'connected',
        saveMetadata:async()=>{},eventSource:bus,event_types:Object.fromEntries(['GENERATION_STARTED','GENERATION_ENDED','MESSAGE_DELETED','CHAT_CHANGED'].map(n=>[n,n])) };
    let requests = 0, reply = () => JSON.stringify(proposal);
    ctx.generateQuietPrompt = async options => { requests++; bus.emit('GENERATION_STARTED','quiet'); try { return await reply(options); } finally { bus.emit('GENERATION_ENDED'); } };
    const settings = normalizeSettings({retries:0});
    const memory = createPhoneMemory({getContext:()=>ctx});
    const phone = createPhoneService({memory,getContext:()=>ctx,getSettings:()=>settings});
    const advance = count => { for(let i=0;i<count;i++) ctx.chat.push({mes:'Continue '+ctx.chat.length,is_user:true},{mes:'Quiet story progression '+ctx.chat.length,is_user:false,name:'Alex'}); };
    return {ctx,settings,memory,phone,bus,advance,requests:()=>requests,reply:fn=>{reply=fn;},close:()=>{phone.destroy();memory.destroy();}};
}

test('legacy intervals never block a new AI contact decision', () => {
    const settings=normalizeSettings({contactInterval:100,unansweredInterval:200,contactEvents:false});
    const state={profiles:{contactGate:{turn:10,sourceIndex:20,unanswered:true},proactiveScan:{turn:10}}};
    assert.equal(contactPolicy(state,[],settings,'alex').allowed,true);
    settings.proactiveEnabled=false;assert.equal(contactPolicy(state,[],settings,'alex').allowed,false);
});

test('character motivation may reuse valid evidence but cannot invent number access', () => {
    const chat=[{mes:evidence},{mes:reason}];
    const policy=contactPolicy({profiles:{}},chat,normalizeSettings());
    const data={...proposal,reason_kind:'character_motivation'};
    assert.equal(validateProactive(data,chat,policy,{messages:true},validateIncoming).medium,'messages');
    assert.equal(validateProactive(data,chat,{...policy,usedReasons:[reason],sinceIndex:99,restricted:true},{messages:true},validateIncoming).medium,'messages');
    assert.throws(()=>validateProactive({...data,evidence:'invented phone number exchange'},chat,policy,{messages:true},validateIncoming));
    assert.throws(()=>validateProactive({...data,reason_evidence:'invented scene description'},chat,policy,{messages:true},validateIncoming));
});

test('proactive SMS arrives with no contact, replies in same thread, and enters only sender continuity', async () => {
    const f=setup(); await f.phone.checkIncoming(); let state=f.phone.snapshot();
    assert.equal(f.requests(),1); assert.equal(Object.keys(state.messages).length,1); assert.equal(Object.keys(state.contacts).length,0);
    assert.equal(messageParticipants(state)['card:alex.png'].receivedSMS,true);
    assert.equal(Object.values(state.messages)[0].read,false);
    assert.match(buildContinuityPrompt(state,{avatar:'alex.png',name:'Alex'},{instruction:'remember'}),/library/);
    assert.equal(buildContinuityPrompt(state,{avatar:'bea.png',name:'Bea'},{instruction:'remember'}),'');
    await f.phone.dial('card:alex.png'); assert.equal(f.requests(),1,'received SMS does not grant phone dialing');
    f.reply(()=>'{"status":"reply","text":"See you there."}');
    await f.phone.sendMessage('card:alex.png','Thanks.'); state=f.phone.snapshot();
    assert.deepEqual(Object.values(state.messages).map(m=>m.role),['assistant','user','assistant']);
    assert.equal(state.profiles.contactGate.unanswered,false);
    assert.equal(Object.keys(state.contacts).length,0); f.close();
});

test('reading, reload and repeated checks do not trigger extra decisions; new narrative can', async () => {
    const f=setup();await f.phone.checkIncoming();await f.phone.markMessagesRead('card:alex.png');
    await f.phone.checkIncoming();assert.equal(f.requests(),1);
    const reloaded=createPhoneService({memory:f.memory,getContext:()=>f.ctx,getSettings:()=>f.settings});
    await reloaded.checkIncoming();assert.equal(f.requests(),1);reloaded.destroy();
    f.advance(1);await f.phone.checkIncoming();assert.equal(f.requests(),2);
    assert.equal(Object.keys(f.phone.snapshot().messages).length,2,'AI may choose to contact again without waiting sixteen turns');f.close();
});

test('declining a call lets AI choose a followup without an active event or cooldown', async () => {
    const f=setup();f.reply(()=>JSON.stringify({...proposal,status:'ringing',requires_live_conversation:true}));
    await f.phone.checkIncoming();f.reply(()=>JSON.stringify(proposal));await f.phone.decline();
    for(let i=0;i<30 && f.requests()<2;i++) await new Promise(r=>setTimeout(r,5));
    for(let i=0;i<30 && f.phone.snapshot().busy;i++) await new Promise(r=>setTimeout(r,5));
    assert.equal(f.requests(),2);assert.equal(Object.keys(f.phone.snapshot().messages).length,1);
    await new Promise(r=>setTimeout(r,20));assert.equal(f.requests(),2,'no autonomous loop');f.close();
});

test('a no-contact decision is reconsidered on the next new narrative, never the same revision', async () => {
    const f=setup();f.reply(()=>'{"status":"none"}');await f.phone.checkIncoming();await f.phone.checkIncoming();assert.equal(f.requests(),1);
    f.advance(1);await f.phone.checkIncoming();assert.equal(f.requests(),2);f.close();
});

test('app channel switches and master disable are enforced, including changes during a request', async () => {
    const f=setup(); f.settings.apps.phone=false;
    await f.phone.checkIncoming(); assert.equal(Object.keys(f.phone.snapshot().messages).length,1,'SMS works with telephone off'); f.close();
    const g=setup(); g.settings.proactiveEnabled=false; await g.phone.checkIncoming(); assert.equal(g.requests(),0);
    g.settings.proactiveEnabled=true;
    let finish,started;const ready=new Promise(r=>{started=r;});
    g.reply(()=>{started();return new Promise(r=>{finish=r;});});
    const work=g.phone.checkIncoming();await ready;g.settings.apps.messages=false;
    finish(JSON.stringify(proposal));await work;assert.equal(Object.keys(g.phone.snapshot().messages).length,0);g.close();
});

test('rollback removes incoming SMS, return-address permission and its cooldown together', async () => {
    const f=setup(); await f.phone.checkIncoming();
    f.ctx.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();
    const state=f.phone.snapshot();assert.equal(Object.keys(state.messages).length,0);
    assert.equal(state.profiles.contactGate,undefined);assert.equal(messageParticipants(state)['card:alex.png'],undefined);f.close();
});

test('legacy communication does not impose a hidden upgrade cooldown', async () => {
    const f=setup();const ticket=await f.memory.begin();
    await f.memory.commit(ticket,[{collection:'messages',key:'legacy',value:{id:'legacy',contactId:'card:alex.png',role:'assistant',text:'old',createdAt:1,read:true}}]);
    await f.phone.checkIncoming();assert.equal(f.requests(),1);f.close();
});

test('settings discard legacy frequency fields and keep the master switch', () => {
    const settings=normalizeSettings({contactInterval:100,unansweredInterval:200,contactEvents:false,contactExceptions:true,proactiveEnabled:false});
    for(const name of ['contactInterval','unansweredInterval','contactEvents','contactExceptions']) assert.equal(Object.hasOwn(settings,name),false);
    assert.equal(settings.proactiveEnabled,false);
    const custom='My custom instructions';assert.equal(normalizeSettings({prompts:{contactEvent:custom}}).prompts.contactEvent,custom);
});
