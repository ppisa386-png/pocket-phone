import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPhoneMemory } from '../src/memory.js';
import { createPhoneService } from '../src/phone.js';
import { normalizeSettings } from '../src/config.js';
import { eventKey, isBlocked } from '../src/contact-events.js';

const numberEvidence = 'Sam gave Alex their phone number.';
const conflict = 'Sam tells Alex that their relationship is over and leaves.';
const start = { status:'ringing', can_obtain_number:true,route:'known_number',channel:'',evidence:numberEvidence,
    reason:'Ask about the breakup',reason_kind:'urgent_question',reason_evidence:conflict,requires_live_conversation:true,
    event_action:'start',event_requires_response:true,event_evidence:conflict,event_reason:'The relationship just ended.' };
const continuation = {...start,event_action:'continue'};
const pause = () => new Promise(r=>setTimeout(r,10));
async function settle(f, predicate) {for(let i=0;i<100;i++){if(!f.phone.snapshot().busy && predicate())return;await pause();}assert.fail('operation did not settle');}
function setup() {
    const bus=new EventEmitter();const ctx={chatId:'a',characterId:0,name1:'Sam',name2:'Alex',characters:[{name:'Alex',avatar:'alex.png'}],
        chat:[{mes:numberEvidence,is_user:true},{mes:conflict,is_user:false,name:'Alex'}],chatMetadata:{},saveMetadata:async()=>{},onlineStatus:'connected',eventSource:bus,
        event_types:Object.fromEntries(['GENERATION_STARTED','GENERATION_ENDED','MESSAGE_DELETED','CHAT_CHANGED'].map(n=>[n,n]))};
    let count=0,reply=()=>JSON.stringify(start);
    ctx.generateQuietPrompt=async options=>{count++;bus.emit('GENERATION_STARTED','quiet');try{return await reply(options);}finally{bus.emit('GENERATION_ENDED');}};
    const settings=normalizeSettings({retries:0});const memory=createPhoneMemory({getContext:()=>ctx});
    const phone=createPhoneService({memory,getContext:()=>ctx,getSettings:()=>settings});
    return {ctx,settings,memory,phone,bus,count:()=>count,reply:fn=>{reply=fn;},close:()=>{phone.destroy();memory.destroy();}};
}

test('new specific event may start inside routine cooldown without forcing every conflict to contact',async()=>{
    const f=setup();const ticket=await f.memory.begin();
    await f.memory.commit(ticket,[{collection:'profiles',key:'contactGate',value:{turn:1,sourceIndex:0,unanswered:true}}]);
    await f.phone.checkIncoming({narrative:true});
    assert.equal(f.count(),1);assert.ok(f.phone.snapshot().profiles[eventKey('card:alex.png')].active);assert.ok(f.phone.snapshot().activeCallId);f.close();
    const g=setup();g.reply(()=>'{"status":"none","event_action":"none"}');await g.phone.checkIncoming({narrative:true});
    assert.equal(Object.keys(g.phone.snapshot().calls).length,0);assert.equal(g.phone.snapshot().profiles[eventKey('card:alex.png')],undefined);g.close();
});

test('declining advances one event step, permits another call, and never self-loops',async()=>{
    const f=setup();await f.phone.checkIncoming({narrative:true});const first=f.phone.snapshot().activeCallId;
    f.reply(()=>JSON.stringify(continuation));await f.phone.decline();
    await settle(f,()=>Object.keys(f.phone.snapshot().calls).length===2);
    const second=f.phone.snapshot().activeCallId;assert.notEqual(first,second);assert.equal(f.count(),2);
    await pause();assert.equal(f.count(),2);assert.equal(f.phone.snapshot().calls[second].turns.length,0);
    await f.phone.checkIncoming({contactId:'card:alex.png',stepKey:'declined:'+first,trigger:'repeat'});assert.equal(f.count(),2);f.close();
});

test('same event can change to SMS; reading or leaving it unanswered never requests',async()=>{
    const f=setup();await f.phone.checkIncoming({narrative:true});
    f.reply(()=>JSON.stringify({...continuation,status:'message',text:'Can we talk?'}));await f.phone.decline();
    await settle(f,()=>Object.keys(f.phone.snapshot().messages).length===1);
    await f.phone.markMessagesRead('card:alex.png');await pause();assert.equal(f.count(),2);
    await f.phone.markMessagesRead('card:alex.png');await pause();assert.equal(f.count(),2);
    assert.equal(typeof f.phone.ignoreMessage,'undefined');
    f.ctx.chat.push({mes:'Several days later, they have moved on.',is_user:false,name:'Alex'});
    f.reply(()=>'{"status":"none","event_action":"end"}');await f.phone.checkIncoming({narrative:true});
    assert.equal(f.phone.snapshot().profiles[eventKey('card:alex.png')].active,false);f.close();
});

test('separate blocks stop each channel and both blocks end the event; unblock never replays',async()=>{
    const f=setup();await f.phone.checkIncoming({narrative:true});
    await f.phone.setBlocked('card:alex.png','phone',true);
    assert.equal(f.phone.snapshot().activeCallId,null);assert.equal(isBlocked(f.phone.snapshot(),'card:alex.png','phone'),true);
    f.ctx.chat.push({mes:'Sam continues walking.',is_user:false,name:'Alex'});
    f.reply(()=>JSON.stringify({...continuation,status:'message',text:'Please answer.'}));await f.phone.checkIncoming({narrative:true});
    assert.equal(Object.keys(f.phone.snapshot().messages).length,1,'SMS still available separately');
    await f.phone.setBlocked('card:alex.png','messages',true);assert.equal(f.phone.snapshot().profiles[eventKey('card:alex.png')].active,false);
    f.ctx.chat.push({mes:'Later.',is_user:false,name:'Alex'});const before=f.count();await f.phone.checkIncoming({narrative:true});assert.equal(f.count(),before);
    await f.phone.sendMessage('card:alex.png','Test');assert.equal(f.count(),before);
    await f.phone.setBlocked('card:alex.png','messages',false);await pause();assert.equal(f.count(),before);f.close();
});

test('blocking during generation discards late output and persists across reload',async()=>{
    const f=setup();await f.phone.checkIncoming({narrative:true});
    await f.phone.setBlocked('card:alex.png','phone',true);
    f.ctx.chat.push({mes:'Sam does not answer.',is_user:false,name:'Alex'});
    let finish,started;const ready=new Promise(r=>{started=r;});f.reply(()=>{started();return new Promise(r=>{finish=r;});});
    const work=f.phone.checkIncoming({narrative:true});await ready;await f.phone.setBlocked('card:alex.png','messages',true);
    finish(JSON.stringify({...continuation,status:'message',text:'late'}));await work;
    assert.equal(Object.keys(f.phone.snapshot().messages).length,0);
    const restored=createPhoneService({memory:f.memory,getContext:()=>f.ctx,getSettings:()=>f.settings});await f.memory.read();
    assert.equal(isBlocked(restored.snapshot(),'card:alex.png','phone'),true);assert.equal(isBlocked(restored.snapshot(),'card:alex.png','messages'),true);
    restored.destroy();f.close();
});

test('event recognition in a normal SMS reply adds no second model request',async()=>{
    const f=setup();const ticket=await f.memory.begin();await f.memory.commit(ticket,[{collection:'contacts',key:'card:alex.png',value:{id:'card:alex.png',name:'Alex',number:null,characterId:0}}]);
    f.reply(()=>JSON.stringify({status:'reply',text:'What happened?',event_action:'start',event_requires_response:true,event_evidence:'We should break up.',event_reason:'A breakup is unfolding.'}));
    await f.phone.sendMessage('card:alex.png','We should break up.');
    assert.equal(f.count(),1);assert.equal(f.phone.snapshot().profiles[eventKey('card:alex.png')].active,true);
    await pause();assert.equal(f.count(),1);f.close();
});

test('deleting source rolls back event, communication and blocking together',async()=>{
    const f=setup();await f.phone.checkIncoming({narrative:true});await f.phone.setBlocked('card:alex.png','phone',true);
    f.ctx.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();
    assert.equal(Object.keys(f.phone.snapshot().calls).length,0);assert.equal(f.phone.snapshot().profiles[eventKey('card:alex.png')],undefined);
    assert.equal(isBlocked(f.phone.snapshot(),'card:alex.png','phone'),false);f.close();
});

test('master switch blocks both events and routine contact',async()=>{
    const f=setup();f.settings.proactiveEnabled=false;const ticket=await f.memory.begin();
    await f.memory.commit(ticket,[{collection:'profiles',key:'contactGate',value:{turn:1,sourceIndex:0,unanswered:true}}]);
    await f.phone.checkIncoming({narrative:true});assert.equal(f.count(),0);f.close();
});
