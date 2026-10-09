import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createApiClient, createKeyStore, normalizeApiUrl, extractApiText } from '../src/api.js';
import { buildApiContext, enabledPresetText } from '../src/api-context.js';
import { normalizeSettings } from '../src/config.js';
import { createPhoneMemory } from '../src/memory.js';
import { createPhoneService } from '../src/phone.js';

const apiConfig = () => ({ mode: 'independent', baseUrl: 'https://provider.example/v1', model: 'test-model', timeout: 15, maxTokens: 2048, historyLimit: 2 });
const response = text => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: text } }] }) });
function clientFixture(overrides = {}) {
    const settings = normalizeSettings({ api: apiConfig() });
    const requests = [];
    const context = { getRequestHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-csrf' }) };
    const client = createApiClient({ getContext: () => context, getSettings: () => settings, getKey: () => 'test-phone-key', buildContext: async () => [{ role: 'user', content: 'roleplay task' }], fetchImpl: async (url, options) => { requests.push({ url, ...options, body: JSON.parse(options.body) }); return response('OK'); }, ...overrides });
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

test('model list and connection test never read or send roleplay context', async () => {
    const requests = [];
    const f = clientFixture({ buildContext: () => { throw new Error('must not read roleplay'); }, fetchImpl: async (url, options) => {
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
        const f=clientFixture({getKey:()=>key, buildContext:()=>new Promise(r=>{finish=r;}),fetchImpl:async()=>{calls++;return response('late');}});
        const pending=f.client.generate('task',null,()=>true);
        if(changeKey) key='second'; else f.settings.api.model='different';
        finish([]); await assert.rejects(pending,/配置已变化/); assert.equal(calls,0);
    }
});

test('context includes only enabled quiet preset text, bounded narrative and current actor', async () => {
    let dryRun;
    const context = {mainApi:'openai',characterId:0,name1:'Sam',name2:'Alex',maxContext:8192,
        characters:[{name:'Alex',avatar:'alex.png',data:{description:'Current actor'}},{name:'Bea',avatar:'bea.png',data:{description:'Other private card'}}],
        chat:[{mes:'excluded old floor'},{mes:'not narrative',is_system:true},{mes:'recent one'},{mes:'recent two',is_user:true}],
        chatCompletionSettings:{prompts:[{identifier:'language',content:'Use English, {{char}}.'},{identifier:'disabled',content:'DISABLED'},{identifier:'normal',content:'NORMAL ONLY',injection_trigger:['normal']}],prompt_order:[{character_id:100001,order:[{identifier:'language',enabled:true},{identifier:'disabled',enabled:false},{identifier:'normal',enabled:true}]}]},
        extensionSettings:{secret:'do not send'},getWorldInfoPrompt:async(_chat,_size,dry)=>{dryRun=dry;return {worldInfoBefore:'World lore'};}};
    const messages=await buildApiContext(context,'phone task',{id:'card:alex.png'},apiConfig());
    const text=JSON.stringify(messages);
    for(const part of ['Use English, Alex.','Current actor','World lore','recent one','recent two']) assert.ok(text.includes(part),part);
    for(const part of ['Other private card','excluded old floor','DISABLED','NORMAL ONLY','do not send','not narrative']) assert.ok(!text.includes(part),part);
    assert.equal(dryRun,true);
    assert.equal(enabledPresetText({...context,mainApi:'textgenerationwebui',powerUserSettings:{sysprompt:{enabled:false}}}), '');
    await assert.rejects(buildApiContext(context,'task',null,apiConfig(),()=>false),/取消/);
});

const quote='Alex gives you his number: +1 212 555 0123.';
function phoneFixture() {
    const bus=new EventEmitter(); const event_types=Object.fromEntries(['CHAT_CHANGED','MESSAGE_DELETED','GENERATION_STARTED','GENERATION_ENDED'].map(k=>[k,k]));
    const context={chatId:'A',characterId:0,characters:[{name:'Alex',avatar:'alex.png'}],name1:'Sam',name2:'Alex',chat:[{mes:quote,name:'Alex'}],chatMetadata:{},saveMetadata:async()=>{},onlineStatus:'no_connection',eventSource:bus,event_types,getRequestHeaders:()=>({'Content-Type':'application/json'})};
    const settings=normalizeSettings({api:apiConfig(),retries:0}); let responder=()=>JSON.stringify({contacts:[{name:'Alex',number:'+1 212 555 0123',user_has_number:true,evidence:quote}]}); let signal;
    const client=createApiClient({getContext:()=>context,getSettings:()=>settings,getKey:()=> 'test-only-key',buildContext:buildApiContext,fetchImpl:async(_url,options)=>{signal=options.signal;return response(await responder(options));}});
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
