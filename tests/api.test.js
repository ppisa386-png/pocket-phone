import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createApiClient, createKeyStore, normalizeApiUrl, extractApiText } from '../src/api.js';
import { captureHostRequest } from '../src/api-context.js';
import { HostEvents, installHostGeneration } from './host-fixture.js';
import { normalizeSettings } from '../src/config.js';
import { createPhoneMemory } from '../src/memory.js';
import { createPhoneService } from '../src/phone.js';
import { renderMessagesScreen } from '../src/messages-view.js';

const apiConfig = () => ({ mode: 'independent', baseUrl: 'https://provider.example/v1', model: 'test-model', timeout: 15, maxTokens: 2048, historyLimit: 2 });
const response = text => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: text } }] }) });
function clientFixture(overrides = {}) {
    const settings = normalizeSettings({ api: apiConfig() });
    const requests = [];
    const context = { getRequestHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-csrf' }) };
    const client = createApiClient({ getContext: () => context, getSettings: () => settings, getKey: () => 'test-phone-key', prepareRequest: async () => ({messages:[{ role: 'user', content: 'roleplay task' }],max_tokens:4321}), fetchImpl: async (url, options) => { requests.push({ url, ...options, body: JSON.parse(options.body) }); return response('OK'); }, ...overrides });
    return { client, settings, requests, context };
}

test('API addresses normalize safely and credentials are scoped by address', () => {
    assert.equal(normalizeApiUrl(' https://provider.example/v1/chat/completions/ '), 'https://provider.example/v1');
    assert.equal(normalizeApiUrl('https://provider.example'), 'https://provider.example/v1');
    for (const url of ['file:///tmp/api', 'https://key:secret@example.com', 'https://example.com?key=secret', 'not a url']) assert.throws(() => normalizeApiUrl(url));
    const data = new Map(); const store = createKeyStore({ getItem: k => data.get(k), setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) });
    store.set('https://provider.example/v1', 'test-key');
    assert.equal(store.get('https://provider.example/v1/models'), 'test-key');
    assert.equal(store.get('https://another.example/v1'), '');
    store.set('https://provider.example/v1', ''); assert.equal(store.get('https://provider.example/v1'), '');
    assert.throws(() => createKeyStore(null).set('https://provider.example', 'key'), /不能保存/);
    const settings = normalizeSettings({ api: { ...apiConfig(), key: 'secret', apiKey: 'secret' } });
    assert.ok(!JSON.stringify(settings).includes('secret'));
});

test('independent requests use host proxy with their own key and do not mutate host settings', async () => {
    const f = clientFixture(); f.context.savedHostKey = 'host-secret';
    await f.client.generate('task', null, () => true);
    const req = f.requests[0];
    assert.equal(req.url, '/api/backends/chat-completions/generate');
    assert.equal(req.body.reverse_proxy, apiConfig().baseUrl);
    assert.equal(req.body.proxy_password, 'test-phone-key');
    assert.equal(req.headers['X-CSRF-Token'], 'test-csrf');
    assert.equal(req.body.stream, false);
    assert.ok(!JSON.stringify(req.body).includes('host-secret'));
    assert.equal(f.context.savedHostKey, 'host-secret');
    assert.ok(!JSON.stringify(f.settings).includes('test-phone-key'));
});

test('disabled phone blocks generation, connection test and model-list requests before any API call',async()=>{
    let prepared=0;
    const f=clientFixture({prepareRequest:async()=>{prepared++;return {messages:[{role:'user',content:'test'}]};}});
    f.settings.enabled=false;
    await assert.rejects(f.client.generate('task',null,()=>true),/已停用/);
    await assert.rejects(f.client.test(apiConfig(),'key'),/已停用/);
    await assert.rejects(f.client.models(apiConfig(),'key'),/已停用/);
    assert.equal(prepared,0);assert.equal(f.requests.length,0);
    f.settings.enabled=true;
    assert.equal(await f.client.generate('task',null,()=>true),'OK');assert.equal(prepared,1);
});

test('model list and connection test never read or send roleplay context', async () => {
    const requests = [];
    const f = clientFixture({ prepareRequest: () => { throw new Error('must not read roleplay'); }, fetchImpl: async (url, options) => {
        requests.push(JSON.parse(options.body));
        return url.endsWith('/status') ? { ok:true, json:async()=>({ data:[{ id:'z' },{ id:'a' },{ id:'z' }] }) } : response('OK');
    } });
    assert.deepEqual(await f.client.models(apiConfig(), 'draft-key'), ['a','z']);
    assert.equal(await f.client.test(apiConfig(), 'draft-key'), 'OK');
    assert.equal(requests[0].messages, undefined);
    assert.equal(requests[1].messages.length, 1);
    assert.match(requests[1].messages[0].content, /Connection test/);
    assert.equal(requests[1].max_tokens, 1024);
});

test('provider bodies and network errors never expose credentials; malformed output is rejected', async () => {
    for (const fetchImpl of [async()=>({ ok:false,status:401,json:async()=>({error:{message:'leaked-secret'}}) }), async()=>{throw new Error('leaked-secret');}]) {
        const f = clientFixture({fetchImpl});
        await assert.rejects(f.client.test(apiConfig(),'secret'), e => !e.message.includes('secret'));
    }
    assert.throws(() => extractApiText({choices:[{finish_reason:'length',message:{content:'partial'}}]}), /截断/);
    assert.throws(() => extractApiText({choices:[{message:{reasoning_content:'hidden'}}]}), /没有返回文字/);
    assert.equal(extractApiText({choices:[{message:{content:[{type:'text',text:'OK'}]}}]}), 'OK');
});

test('cancel and timeout abort pending requests; late JSON responses are discarded', async () => {
    let signal;
    const f = clientFixture({fetchImpl: async (_url,options)=>{signal=options.signal; return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted'))));}});
    const timeout = f.client.test({...apiConfig(),timeout:0.01},'key');
    await assert.rejects(timeout,/超时/); assert.equal(signal.aborted,true);
    const cancelled = f.client.test(apiConfig(),'key'); f.client.cancel();
    await assert.rejects(cancelled,/取消/);
    let current = true, finish;
    const g = clientFixture({fetchImpl:async()=>({ok:true,json:()=>new Promise(r=>{finish=r;})})});
    const pending = g.client.test(apiConfig(),'key',()=>current);
    await new Promise(r=>setImmediate(r)); current=false; finish({choices:[{message:{content:'late'}}]});
    await assert.rejects(pending,/取消/);
});

test('API config or key changes invalidate generation while context is prepared', async () => {
    for (const changeKey of [false,true]) {
        let finish, key='first', calls=0;
        const f=clientFixture({getKey:()=>key, prepareRequest:()=>new Promise(r=>{finish=r;}),fetchImpl:async()=>{calls++;return response('late');}});
        const pending=f.client.generate('task',null,()=>true);
        if(changeKey) key='second'; else f.settings.api.model='different';
        finish([]); await assert.rejects(pending,/配置已变化/); assert.equal(calls,0);
    }
});

const quote='Alex gives you his number: +1 212 555 0123.';
function phoneFixture() {
    const bus=new HostEvents(); const event_types=Object.fromEntries(['CHAT_CHANGED','MESSAGE_DELETED','GENERATION_STARTED','GENERATION_ENDED'].map(k=>[k,k]));
    const context={chatId:'A',characterId:0,characters:[{name:'Alex',avatar:'alex.png'}],name1:'Sam',name2:'Alex',chat:[{mes:quote,name:'Alex'}],chatMetadata:{},saveMetadata:async()=>{},onlineStatus:'no_connection',eventSource:bus,event_types,getRequestHeaders:()=>({'Content-Type':'application/json'})};
    installHostGeneration(context);
    const settings=normalizeSettings({api:apiConfig(),retries:0}); let responder=()=>JSON.stringify({contacts:[{name:'Alex',number:'+1 212 555 0123',user_has_number:true,evidence:quote}]}); let signal;
    const client=createApiClient({getContext:()=>context,getSettings:()=>settings,getKey:()=> 'test-only-key',prepareRequest:captureHostRequest,fetchImpl:async(_url,options)=>{signal=options.signal;const result=await responder(options);return typeof result==='string'?response(result):result;}});
    const memory=createPhoneMemory({getContext:()=>context});
    const phone=createPhoneService({memory,getContext:()=>context,getSettings:()=>settings,modelClient:client});
    return {context,settings,phone,memory,bus,signal:()=>signal,reply:fn=>responder=fn,close(){client.cancel();phone.destroy();memory.destroy();}};
}

test('independent phone and SMS work with host disconnected and roll back together', async () => {
    const f=phoneFixture(); f.settings.proactiveEnabled=false; try {
        await f.phone.scan(); assert.ok(f.phone.snapshot().contacts['card:alex.png']);
        f.context.chat.push({mes:'Later that day.',name:'Alex'});
        f.reply(()=>'{"status":"answered","text":"Hello?"}'); await f.phone.dial('card:alex.png'); await f.phone.hangup();
        f.reply(()=>'{"status":"reply","text":"Text received."}'); await f.phone.sendMessage('card:alex.png','Hi');
        assert.equal(Object.keys(f.phone.snapshot().calls).length,1); assert.equal(Object.keys(f.phone.snapshot().messages).length,2);
        assert.ok(!JSON.stringify(f.context.chatMetadata).includes('test-only-key'));
        f.context.chat.pop(); f.bus.emit('MESSAGE_DELETED'); await f.memory.read();
        assert.equal(Object.keys(f.phone.snapshot().calls).length,0); assert.equal(Object.keys(f.phone.snapshot().messages).length,0);
        assert.ok(f.phone.snapshot().contacts['card:alex.png']);
    } finally {f.close();}
});

test('deleting a floor aborts in-flight independent SMS and prevents stale records', async () => {
    const f=phoneFixture(); try {
        await f.phone.scan(); f.context.chat.push({mes:'Later.',name:'Alex'});
        let started; const ready=new Promise(r=>started=r);
        f.reply(options=>new Promise((_,reject)=>{started();options.signal.addEventListener('abort',()=>reject(new Error('aborted')));}));
        const pending=f.phone.sendMessage('card:alex.png','Hi'); await ready;
        f.context.chat.pop(); f.bus.emit('MESSAGE_DELETED'); await f.memory.read(); await pending;
        assert.equal(f.signal().aborted,true); assert.equal(Object.keys(f.phone.snapshot().messages).length,0);
    } finally {f.close();}
});

test('authentication failure is not retried fifteen times', async () => {
    const f=phoneFixture(); try {
        await f.phone.scan(); f.settings.retries=15; let attempts=0;
        f.reply(()=>{attempts++; throw Object.assign(new Error('认证失败'),{retryable:false});});
        await f.phone.sendMessage('card:alex.png','Hi'); assert.equal(attempts,1);
    } finally {f.close();}
});

test('gateway failures stop after one SMS attempt; manual retry keeps the original message', async () => {
    const f=phoneFixture(); try {
        await f.phone.scan(); f.settings.retries=15; let attempts=0;
        f.reply(()=>{attempts++;return {ok:false,status:502,json:async()=>{throw new Error('private gateway HTML');}};});
        await f.phone.sendMessage('card:alex.png','Hi');
        const failed=f.phone.snapshot();
        assert.equal(attempts,1);assert.equal(failed.busy,false);assert.equal(failed.progress,'');
        assert.match(failed.error,/HTTP 502/);assert.doesNotMatch(failed.error,/JSON|private gateway/);
        const sent=Object.values(failed.messages).find(m=>m.role==='user');
        assert.equal(sent.replyStatus,'failed');
        f.reply(()=>' {"status":"reply","text":"Received."}');
        await f.phone.retryMessage(sent.id);
        assert.equal(Object.values(f.phone.snapshot().messages).filter(m=>m.role==='user').length,1);
        assert.equal(Object.values(f.phone.snapshot().messages).filter(m=>m.role==='assistant').length,1);
    } finally {f.close();}
});

test('transport diagnostics distinguish no headers, gateway response, and HTTP 200 error without leaking data', async () => {
    for (const kind of ['timeout','gateway','provider']) {
        const f=clientFixture({fetchImpl:async(_url,options)=>{
            if(kind==='timeout')return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('private-secret'))));
            return {ok:kind==='provider',status:kind==='provider'?200:502,json:async()=>({error:{message:'private-secret personal-story'}})};
        }});
        f.settings.api.timeout=.01;
        await assert.rejects(f.client.generate('private-story',null,()=>true),error=>{
            assert.equal(error.retryable,false);
            assert.match(error.diagnostic,/上下文消息数：1/);
            assert.match(error.diagnostic,/回复上限：4321/);
            assert.match(error.diagnostic,kind==='timeout'?/HTTP：尚未收到/:kind==='gateway'?/HTTP：502/:/HTTP：200/);
            assert.doesNotMatch(error.message+error.diagnostic,/private|personal-story|test-phone-key|provider\.example/);
            if(kind==='provider')assert.match(error.message,/错误结果/);
            return true;
        });
    }
});

test('SMS timeout does not multiply the wait by the configured retry count', async()=>{
    const f=phoneFixture();try {
        await f.phone.scan();f.settings.api.timeout=.01;f.settings.retries=15;let attempts=0;
        f.reply(options=>new Promise((_,reject)=>{attempts++;options.signal.addEventListener('abort',()=>reject(new Error('aborted')));}));
        await f.phone.sendMessage('card:alex.png','Hi');
        assert.equal(attempts,1);assert.equal(f.phone.snapshot().busy,false);
        assert.match(f.phone.snapshot().error,/不会自动重发/);
        assert.equal(Object.values(f.phone.snapshot().messages)[0].replyStatus,'failed');
    }finally{f.close();}
});

test('SMS shows preparation and network progress, then clears it after completion', async () => {
    const f=phoneFixture();try {
        await f.phone.scan();const seen=[];const stop=f.phone.subscribe(view=>seen.push(view.progress));
        let release,started;const ready=new Promise(r=>started=r);
        f.reply(()=>new Promise(r=>{release=r;started();}));
        const pending=f.phone.sendMessage('card:alex.png','Hi');await ready;
        const view=f.phone.snapshot();
        assert.match(view.progress,/提交酒馆转发接口/);
        assert.match(renderMessagesScreen(view,'card:alex.png',false,{}),/提交酒馆转发接口/);
        assert.ok(seen.some(s=>/尚未提交独立 API/.test(s)));
        release('{"status":"reply","text":"Hello"}');await pending;
        assert.ok(seen.some(s=>/正在读取返回内容/.test(s)));
        assert.equal(f.phone.snapshot().progress,'');stop();
    } finally {f.close();}
});
