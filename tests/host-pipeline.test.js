import test from 'node:test';
import assert from 'node:assert/strict';
import {captureHostRequest,phoneQuietOptions} from '../src/api-context.js';
import {independentPayload} from '../src/api.js';
import {HostEvents,installHostGeneration} from './host-fixture.js';

function fixture(options) {
    const context={eventSource:new HostEvents(),chat:[{mes:'An old floor still supplied by the host'},{mes:'Latest floor'}]};
    const host=installHostGeneration(context,options);return {context,host,bus:context.eventSource};
}
test('independent payload equals real host messages and preset parameters after all hooks',async()=>{
    const f=fixture();
    f.bus.on('CHAT_COMPLETION_SETTINGS_READY',data=>{data.messages.splice(1,0,{role:'system',content:'A plugin dynamic injection'});});
    await f.context.generateQuietPrompt(phoneQuietOptions(f.context,'Phone task',null));
    const native=f.host.requests[0];
    // Listener registered AFTER our hook must be reflected in the handoff too.
    let register;
    const ready=new Promise(r=>register=r);
    f.context.generateQuietPrompt=((original)=>async options=>{
        f.bus.on('CHAT_COMPLETION_SETTINGS_READY',data=>{data.top_p=.91;});register();return original(options);
    })(f.context.generateQuietPrompt);
    const pending=captureHostRequest(f.context,'Phone task',null);await ready;
    const captured=await pending;
    assert.deepEqual(captured.messages,native.messages);
    const payload=independentPayload(captured,{model:'phone-model',maxTokens:128,historyLimit:1});
    assert.deepEqual(payload.messages,native.messages);
    assert.equal(payload.max_tokens,4321);assert.equal(payload.temperature,.83);assert.equal(payload.top_p,.91);
    assert.equal(payload.model,'phone-model');assert.ok(!JSON.stringify(payload).includes('host-secret'));
    assert.ok(!JSON.stringify(payload).includes('durian-request-'));
    assert.equal(f.host.requests.length,1,'independent preparation never invokes host model');
    assert.equal(f.host.cleanups,2);
    assert.equal(f.bus.listenerCount('GENERATION_STARTED'),0);
    assert.equal(f.bus.listenerCount('GENERATE_AFTER_DATA'),0);
    assert.equal(f.bus.listenerCount('CHAT_COMPLETION_SETTINGS_READY'),2,'only other plugins remain');
});
test('missing final hook or removed task cannot fall through to host API',async()=>{
    for(const options of [{skipReady:true},{stripTask:true}]){
        const f=fixture(options);await assert.rejects(captureHostRequest(f.context,'Task',null),/无法将完整/);
        assert.equal(f.host.requests.length,0);assert.equal(f.host.cleanups,1);
    }
});
test('unrelated quiet requests keep their own endpoint and context',async()=>{
    let release,started;
    const ready=new Promise(r=>started=r);
    const f=fixture({beforePrepare:async o=>{if(o.quietPrompt.includes('durian-request-')){started();await new Promise(r=>release=r);}}});
    const pending=captureHostRequest(f.context,'Phone',null);await ready;
    await f.context.generateQuietPrompt(phoneQuietOptions(f.context,'Unrelated plugin task',null));
    release();const captured=await pending;
    assert.equal(f.host.requests.length,1);assert.equal(f.host.requests[0].proxy_password,'host-secret');
    assert.ok(captured.messages.some(m=>m.content==='Phone'));
    assert.ok(!captured.messages.some(m=>m.content==='Unrelated plugin task'));
});
test('cancellation during preparation blocks both transports and always removes hooks',async()=>{
    let current=true;
    const f=fixture({beforePrepare:()=>{current=false;}});
    await assert.rejects(captureHostRequest(f.context,'Task',null,()=>current),/取消/);
    assert.equal(f.host.requests.length,0);
    for(const n of ['GENERATION_STARTED','GENERATE_AFTER_DATA','CHAT_COMPLETION_SETTINGS_READY'])assert.equal(f.bus.listenerCount(n),0);
});
test('unsupported host fails before beginning generation without simplified fallback',async()=>{
    const f=fixture();f.context.mainApi='textgenerationwebui';
    await assert.rejects(captureHostRequest(f.context,'Task',null),/无法将完整/);assert.equal(f.host.preparations,0);
    f.context.mainApi='openai';delete f.context.event_types.CHAT_COMPLETION_SETTINGS_READY;
    await assert.rejects(captureHostRequest(f.context,'Task',null),/无法将完整/);assert.equal(f.host.preparations,0);
});
