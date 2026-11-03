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
    const phone=createPhoneService({narrativeContact:false,memory,getContext:()=>ctx,getSettings:()=>settings});
    return {ctx,settings,memory,phone,bus,count:()=>count,reply:fn=>{reply=fn;},close:()=>{phone.destroy();memory.destroy();}};
}

test('event recognition in a normal SMS reply adds no second model request',async()=>{
    const f=setup();const ticket=await f.memory.begin();await f.memory.commit(ticket,[{collection:'contacts',key:'card:alex.png',value:{id:'card:alex.png',name:'Alex',number:null,characterId:0}}]);
    f.reply(()=>JSON.stringify({status:'reply',text:'What happened?',event_action:'start',event_requires_response:true,event_evidence:'We should break up.',event_reason:'A breakup is unfolding.'}));
    await f.phone.sendMessage('card:alex.png','We should break up.');
    assert.equal(f.count(),1);assert.equal(f.phone.snapshot().profiles[eventKey('card:alex.png')].active,true);
    await pause();assert.equal(f.count(),1);f.close();
});
