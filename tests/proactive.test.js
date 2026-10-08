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

test('shared global and per-person hard cooldowns cannot be bypassed by channels or another contact', () => {
    const settings = normalizeSettings();
    const state = {profiles:{contactGate:{turn:10,sourceIndex:20,unanswered:false},'contactGate:alex':{turn:5,sourceIndex:10,unanswered:true}}};
    const chat = n=>Array.from({length:n},()=>({is_user:true}));
    assert.equal(contactPolicy(state,chat(17),settings,'bea').allowed,false);
    assert.equal(contactPolicy(state,chat(18),settings,'bea').allowed,true);
    assert.equal(contactPolicy(state,chat(18),settings,'alex').allowed,false);
    assert.equal(contactPolicy(state,chat(21),settings,'alex').allowed,true);
    state.profiles.proactiveScan={turn:21};
    assert.equal(contactPolicy(state,chat(22),settings,'alex').allowed,false);
    assert.equal(contactPolicy(state,[...chat(22),...Array.from({length:50},()=>({is_user:false}))],settings,'alex').allowed,false);
});

test('exceptions default off, have a two-turn hard floor, and require new qualified event evidence', () => {
    const settings = normalizeSettings();
    const state = {profiles:{contactGate:{turn:0,sourceIndex:0,unanswered:true}}};
    const chat=[{mes:evidence}, {mes:'continue',is_user:true},{mes:reason},{mes:'continue again',is_user:true}];
    assert.equal(contactPolicy(state,chat,settings).allowed,false);
    settings.contactExceptions=true;
    const policy=contactPolicy(state,chat,settings);
    assert.equal(policy.allowed,true); assert.equal(policy.restricted,true);
    assert.equal(contactPolicy(state,chat.slice(0,-1),settings).allowed,false);
    assert.equal(validateProactive(proposal,chat,policy,{messages:true},validateIncoming),null);
    const emergency={...proposal,reason_kind:'emergency'};
    assert.equal(validateProactive(emergency,chat,policy,{messages:true},validateIncoming).medium,'messages');
    assert.throws(()=>validateProactive({...emergency,reason_evidence:'made up personality claim'},chat,policy,{messages:true},validateIncoming));
    assert.throws(()=>validateProactive(emergency,chat,{...policy,sinceIndex:2},{messages:true},validateIncoming));
    assert.equal(validateProactive({...emergency,status:'ringing'},chat,{...policy,restricted:false},{phone:true},validateIncoming),null,'telephone requires live-conversation justification');
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

test('reading and reloading do not clear no-reply cooldown or cause calls during it', async () => {
    const f=setup(); await f.phone.checkIncoming(); await f.phone.markMessagesRead('card:alex.png');
    assert.equal(f.phone.snapshot().profiles.contactGate.unanswered,true);
    f.advance(15); await f.phone.checkIncoming(); assert.equal(f.requests(),1);
    const reloaded=createPhoneService({memory:f.memory,getContext:()=>f.ctx,getSettings:()=>f.settings});
    await reloaded.checkIncoming(); assert.equal(f.requests(),1);
    reloaded.destroy();
    f.advance(1); f.ctx.chat.at(-1).mes='There is a new urgent issue that needs a live call.';
    f.reply(()=>JSON.stringify({...proposal,status:'ringing',reason_evidence:f.ctx.chat.at(-1).mes,reason_kind:'urgent_question',requires_live_conversation:true}));
    await f.phone.checkIncoming(); assert.equal(f.requests(),2); assert.ok(f.phone.snapshot().activeCallId); f.close();
});

test('declining a call prevents immediate SMS and later requires a fresh reason', async () => {
    const f=setup(); f.reply(()=>JSON.stringify({...proposal,status:'ringing',requires_live_conversation:true}));
    await f.phone.checkIncoming(); await f.phone.decline(); f.reply(()=>JSON.stringify(proposal));
    f.advance(15); await f.phone.checkIncoming(); assert.equal(f.requests(),1);
    f.advance(1); await f.phone.checkIncoming();
    assert.equal(Object.keys(f.phone.snapshot().messages).length,0,'same old reason cannot restart contact');
    assert.equal(f.phone.snapshot().error,'','repeated known reason is silently treated as no contact');
    await f.phone.checkIncoming(); assert.equal(f.requests(),2,'rejected duplicate reason is cached'); f.close();
});

test('no-contact verdicts wait two user turns; group speaker messages do not accelerate checks', async () => {
    const f=setup(); f.reply(()=>'{"status":"none"}'); await f.phone.checkIncoming();
    for(let i=0;i<20;i++) f.ctx.chat.push({mes:'Group character reply '+i,is_user:false});
    await f.phone.checkIncoming(); assert.equal(f.requests(),1);
    f.advance(1); await f.phone.checkIncoming(); assert.equal(f.requests(),1);
    f.advance(1); await f.phone.checkIncoming(); assert.equal(f.requests(),2); f.close();
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

test('legacy communication receives a conservative cooldown on upgrade without an API call', async () => {
    const f=setup();const ticket=await f.memory.begin();
    await f.memory.commit(ticket,[{collection:'messages',key:'legacy',value:{id:'legacy',contactId:'card:alex.png',role:'assistant',text:'old',createdAt:1,read:true}}]);
    await f.phone.checkIncoming();assert.equal(f.requests(),0);assert.equal(f.phone.snapshot().profiles.contactGate.eventId,'upgrade');f.close();
});

test('settings migrate conservatively and clamp invalid contact intervals', () => {
    const defaults=normalizeSettings();assert.equal(defaults.contactInterval,8);assert.equal(defaults.unansweredInterval,16);assert.equal(defaults.contactExceptions,false);
    const settings=normalizeSettings({contactInterval:0,unansweredInterval:999,proactiveEnabled:false});
    assert.equal(settings.contactInterval,2);assert.equal(settings.unansweredInterval,200);assert.equal(settings.proactiveEnabled,false);
});
