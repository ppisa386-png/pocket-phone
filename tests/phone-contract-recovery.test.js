import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhoneMemory } from '../src/memory.js';
import { createPhoneService } from '../src/phone.js';
import { normalizeSettings } from '../src/config.js';
import { commonTaskSchema } from '../src/task-contracts.js';

async function fixture(mode) {
    const seen=[], errors=[];
    let response=()=>({});
    const capture=(prompt, options={})=>{
        seen.push({prompt,schema:mode==='independent'?options.jsonSchema:commonTaskSchema('messages',prompt)||commonTaskSchema('phone',prompt)});
        return JSON.stringify(response());
    };
    const context={chatId:'contracts',name1:'Sam',name2:'Alex',characterId:0,characters:[{name:'Alex',avatar:'alex.png'}],
        chat:[{mes:'2026-01-01 10:00',is_user:false}],chatMetadata:{},saveMetadata:async()=>{},onlineStatus:'connected',
        generateQuietPrompt:async o=>capture(o.quietPrompt)};
    const settings=normalizeSettings({retries:15,api:{mode}});
    const memory=createPhoneMemory({getContext:()=>context});
    const phone=createPhoneService({memory,getContext:()=>context,getSettings:()=>settings,onError:e=>errors.push(e),
        modelClient:{generate:async(p,_c,_v,_progress,o)=>capture(p,o)}});
    await memory.commit(await memory.begin(),[{collection:'contacts',key:'card:alex.png',value:{id:'card:alex.png',name:'Alex',number:'1234567',sourceIndex:0}}]);
    return {phone,memory,seen,errors,reply:fn=>response=fn,close(){phone.destroy();memory.destroy();}};
}
for(const mode of ['host','independent']) {
    test(mode+' SMS repairs missing fields once, preserves failed send and keeps rewrite contract',async()=>{
        const f=await fixture(mode);try {
            f.reply(()=>f.seen.length===1?{}:{status:'reply',text:'Hello'});
            await f.phone.sendMessage('card:alex.png','Original');
            assert.equal(f.seen.length,2);
            assert.ok(f.seen.every(r=>r.schema?.name==='phone_sms_reply'));
            let messages=Object.values(f.phone.snapshot().messages);
            assert.deepEqual(messages.map(m=>m.role),['user','assistant']);
            f.reply(()=>({text:'Rewritten'}));await f.phone.rerollMessage(messages[1].id);
            assert.equal(f.seen.at(-1).schema.name,'phone_message_rewrite');
            assert.equal(Object.keys(f.phone.snapshot().messages).length,2);
            f.seen.length=0;f.reply(()=>({}));await f.phone.sendMessage('card:alex.png','Keep me');
            assert.equal(f.seen.length,2);assert.equal(f.errors.at(-1).code,'PHONE_DATA_MISSING');
            messages=Object.values(f.phone.snapshot().messages);assert.equal(messages.length,3);
            assert.equal(messages.at(-1).replyStatus,'failed');
            f.reply(()=>({status:'no_reply',text:''}));await f.phone.retryMessage(messages.at(-1).id);
            assert.equal(f.seen.length,3);assert.equal(Object.keys(f.phone.snapshot().messages).length,3);
            assert.equal(f.phone.snapshot().messages[messages.at(-1).id].replyStatus,'no_reply');
            f.seen.length=0;f.reply(()=>({status:'invalid',text:''}));await f.phone.sendMessage('card:alex.png','Invalid');
            assert.equal(f.seen.length,1);assert.equal(f.errors.at(-1).code,'PHONE_BUSINESS_INVALID');
        } finally {f.close();}
    });
    test(mode+' calls repair dial and continuation once without duplicating user turns',async()=>{
        const f=await fixture(mode);try {
            f.reply(()=>f.seen.length%2?{}:{status:'answered',text:'Hello'});
            assert.equal((await f.phone.dial('card:alex.png')).ok,true);
            assert.equal(f.seen.length,2);assert.ok(f.seen.every(r=>r.schema?.name==='phone_call_reply'));
            assert.equal((await f.phone.say('Can you hear me?')).ok,true);assert.equal(f.seen.length,4);
            let call=f.phone.snapshot().calls[f.phone.snapshot().activeCallId];
            assert.deepEqual(call.turns.map(t=>t.role),['assistant','user','assistant']);
            f.seen.length=0;f.reply(()=>({}));assert.equal((await f.phone.say('Keep this turn')).ok,false);
            assert.equal(f.seen.length,2);assert.equal(f.errors.at(-1).code,'PHONE_DATA_MISSING');
            call=f.phone.snapshot().calls[call.id];assert.equal(call.status,'connected');assert.equal(call.turns.length,4);
            f.reply(()=>({status:'answered',text:'Recovered'}));await f.phone.retry();
            call=f.phone.snapshot().calls[call.id];assert.equal(call.turns.length,5);assert.equal(call.turns.filter(t=>t.text==='Keep this turn').length,1);
            await f.phone.hangup();
            for(const status of ['no_answer','declined']) {
                f.seen.length=0;f.reply(()=>({status,text:''}));assert.equal((await f.phone.dial('card:alex.png')).ok,true);
                assert.equal(f.seen.length,1);assert.equal(Object.values(f.phone.snapshot().calls).at(-1).status,status);
            }
        } finally {f.close();}
    });
    test(mode+' incoming call receives the call schema and repairs missing fields',async()=>{
        const f=await fixture(mode);try {
            await f.memory.commit(await f.memory.begin(),[{collection:'calls',key:'incoming',value:{id:'incoming',contactId:'card:alex.png',name:'Alex',direction:'incoming',origin:'narrative',status:'ringing',turns:[]}}]);
            f.reply(()=>f.seen.length===1?{}:{status:'answered',text:'Incoming greeting'});
            assert.equal((await f.phone.answer()).ok,true);assert.equal(f.seen.length,2);
            assert.ok(f.seen.every(r=>r.schema?.name==='phone_call_reply'));
            assert.equal(f.phone.snapshot().calls.incoming.turns.length,1);
        } finally {f.close();}
    });
}

for(const mode of ['host','independent']) {
 test(mode+' failed dial remains retryable and invalid call status is not automatically retried',async()=>{
  const f=await fixture(mode);try {
   f.reply(()=>({}));const result=await f.phone.dial('card:alex.png');
   assert.equal(result.ok,false);assert.equal(result.code,'PHONE_DATA_MISSING');assert.equal(f.seen.length,2);
   const id=f.phone.snapshot().activeCallId;
   assert.equal(f.phone.snapshot().calls[id].status,'dialing');assert.equal(f.phone.snapshot().calls[id].turns.length,0);
   f.reply(()=>({status:'answered',text:'Recovered'}));assert.equal((await f.phone.retry()).ok,true);
   assert.equal(Object.keys(f.phone.snapshot().calls).length,1);assert.equal(f.phone.snapshot().calls[id].turns.length,1);
   await f.phone.hangup();f.seen.length=0;f.reply(()=>({status:'invalid',text:''}));
   const invalid=await f.phone.dial('card:alex.png');assert.equal(invalid.ok,false);assert.equal(invalid.code,'PHONE_BUSINESS_INVALID');assert.equal(f.seen.length,1);
  }finally{f.close();}
 });
}
