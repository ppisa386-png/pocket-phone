import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPhoneMemory } from '../src/memory.js';
import { createPhoneService } from '../src/phone.js';
import { normalizeSettings } from '../src/config.js';

function fixture() {
    const bus = new EventEmitter();
    const context = {chatId:'background',chat:[{mes:'2026-10-27 12:00'}],chatMetadata:{},saveMetadata:async()=>{},
        eventSource:bus,event_types:Object.fromEntries(['CHAT_CHANGED','GENERATION_STARTED','GENERATION_STOPPED','GENERATION_ENDED','MESSAGE_EDITED','MESSAGE_DELETED'].map(n=>[n,n]))};
    const settings=normalizeSettings({retries:0});
    let release, start;
    const ready=new Promise(r=>start=r);
    context.generateQuietPrompt=async()=>{bus.emit('GENERATION_STARTED','quiet');start();await new Promise(r=>release=r);bus.emit('GENERATION_STOPPED');return '{"result":"saved"}';};
    const memory=createPhoneMemory({getContext:()=>context});
    const phone=createPhoneService({memory,getContext:()=>context,getSettings:()=>settings});
    const run=app=>phone.appTask(async(view,current,request)=>{
        const ticket=await memory.begin();
        const data=await request('test',x=>x,current);
        assert.ok(current());
        await memory.commit(ticket,[{collection:'profiles',key:app,value:data}]);
    },app);
    return {bus,context,settings,memory,phone,ready,run,release:()=>release(),destroy(){phone.destroy();memory.destroy();}};
}
for(const app of ['daily','assets','amazon','x','snapchat','messages','phone']) {
    test(app+': detached view and quiet STOPPED do not cancel pending work',async()=>{
        const f=fixture();try {
            const off=f.phone.subscribe(()=>{}),pending=f.run(app);await f.ready;off();
            assert.equal(f.phone.snapshot().busy,true);assert.equal(f.phone.snapshot().requestKind,app);
            f.release();assert.equal((await pending).ok,true);
            assert.deepEqual((await f.memory.read()).state.profiles[app],{result:'saved'});
            assert.equal(f.phone.snapshot().busy,false);
        } finally {f.destroy();}
    });
}
for(const mode of ['narrative','switch','edit','disable','destroy']) {
    test('background work still rejects '+mode,async()=>{
        const f=fixture();try {
            const pending=f.run('daily');await f.ready;
            if(mode==='narrative')f.bus.emit('GENERATION_STARTED','normal');
            if(mode==='switch'){f.context.chatId='other';f.context.chatMetadata={};f.bus.emit('CHAT_CHANGED');}
            if(mode==='edit'){f.context.chat[0].mes='changed';f.bus.emit('MESSAGE_EDITED');}
            if(mode==='disable')f.settings.apps.daily=false;
            if(mode==='destroy')f.phone.destroy();
            f.release();assert.equal((await pending).ok,false);
            assert.equal((await f.memory.read()).state.profiles.daily,undefined);
        } finally {f.destroy();}
    });
}
