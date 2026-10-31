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
import { createAssets } from '../src/assets.js';
import { createX, xItems } from '../src/x.js';
import { cashBalance, assetRows } from '../src/assets-core.js';

const apiConfig = () => ({ mode: 'independent', baseUrl: 'https://provider.example/v1', model: 'test-model', timeout: 15, maxTokens: 2048, historyLimit: 2 });

test('all X refresh routes append feed schema, preserve old posts on syntax failure and make one request',async()=>{
 const f=phoneFixture(),x=createX({memory:f.memory,phone:f.phone,getContext:()=>f.context,getSettings:()=>f.settings});let calls=0;
 try{
  f.reply(()=>'{"posts":[{"name":"Alex","handle":"alex","text":"Old post"}]}');assert.equal((await x.refresh()).ok,true);
  const a=xItems(f.phone.snapshot(),'account')[0];await x.follow(a.id,true);
  const before=structuredClone(f.phone.snapshot().x);
  f.reply(options=>{calls++;const last=JSON.parse(options.body).messages.at(-1);assert.equal(last.role,'system');assert.match(last.content,/本次为X刷新/);assert.match(last.content,/字符串内部/);return '{"posts":[{"text":"PRIVATE\nsecret"}]}';});
  for(const mode of [false,true,'square']){const result=await x.refresh(mode);assert.equal(result.ok,false);assert.equal(result.code,'MODEL_JSON_SYNTAX');assert.match(result.error,/未转义换行/);assert.doesNotMatch(result.error,/PRIVATE|secret/);assert.deepEqual(f.phone.snapshot().x,before);}
  assert.equal(calls,3);
  f.reply(()=>'{"posts":[],"replies":[]}');assert.equal((await x.refresh()).ok,true);
 }finally{f.close();}
});

test('independent X discovery appends account schema after host preparation and saves a trailing-comma result once',async()=>{
 const f=phoneFixture(),x=createX({memory:f.memory,phone:f.phone,getContext:()=>f.context,getSettings:()=>f.settings});let calls=0;
 try{
  f.reply(options=>{
   calls++;const body=JSON.parse(options.body),last=body.messages.at(-1);
   assert.equal(last.role,'system');assert.match(last.content,/根字段 accounts 为数组/);
   assert.match(last.content,/不使用尾逗号/);assert.ok(body.messages.length>1);
   return '{"accounts":[{"name":"Alex","handle":"alex","bio":"hello","has_account":true,},],}';
  });
  const result=await x.discover('Alex');assert.equal(result.ok,true,result.error);assert.equal(calls,1);assert.equal(xItems(f.phone.snapshot(),'account').length,1);
 }finally{f.close();}
});

test('independent final output contract follows all preset hooks without mutating captured context',async()=>{
 const prepared={messages:[{role:'system',content:'Character and world'},{role:'user',content:'Task'},{role:'system',content:'Preset ending: continue roleplay prose'}],temperature:0.83,max_tokens:4321};
 const original=structuredClone(prepared),f=clientFixture({prepareRequest:async()=>prepared});
 await f.client.generate('task',null,()=>true,()=>{},{finalOutputContract:'Return one JSON ledger object.'});
 assert.deepEqual(f.requests[0].body.messages,[...original.messages,{role:'system',content:'Return one JSON ledger object.'}]);
 assert.deepEqual(prepared,original);assert.equal(f.requests[0].body.temperature,0.83);assert.equal(f.requests[0].body.max_tokens,4321);
 await f.client.generate('ordinary phone task',null,()=>true);assert.deepEqual(f.requests[1].body.messages,original.messages);
});

test('independent legacy repair sends final schema and reads wrapped JSON once; non-JSON keeps ledger untouched',async()=>{
 const f=phoneFixture();const assets=createAssets({memory:f.memory,phone:f.phone,getContext:()=>f.context,getSettings:()=>f.settings});
 try{
  f.context.chat=[{mes:'日期：2026-05-17\n平常的一天。'}];f.reply(()=>JSON.stringify({initial:{balance:1000,holdings:[],jobs:[]}}));assert.equal((await assets.update()).ok,true);
  const evidence='朋友付清礼服的款项，把礼服作为礼物交给Sam带走。';f.context.chat.push({mes:'日期：2026-05-18\n'+evidence});await f.memory.read();
  f.reply(()=>JSON.stringify({events:[],living:{total:0,bookedIds:[]},business:[]}));assert.equal((await assets.update()).ok,true);
  const ticket=await f.memory.begin(),wallet={...f.phone.snapshot().assets.wallet};delete wallet.ownershipAuditVersion;
  await f.memory.commit(ticket,[{collection:'assets',key:'wallet',value:wallet}]);const before=structuredClone(f.phone.snapshot().assets);
  let calls=0;
  f.reply(options=>{calls++;const body=JSON.parse(options.body);assert.match(body.messages.at(-1).content,/recoveredAssets/);assert.match(body.messages.at(-1).content,/不是角色扮演正文续写/);return '收到，我会核对这些物品。';});
  const failure=await assets.update();assert.equal(failure.ok,false);assert.equal(failure.code,'MODEL_JSON_MISSING');assert.deepEqual(f.phone.snapshot().assets,before);assert.equal(calls,1);
  f.reply(()=>{calls++;return '<!--'+JSON.stringify({recoveredAssets:[{sourceIndex:1,evidence,name:'礼服',owner:'user',category:'luxury',amount:null,marketValue:2000}]})+'-->';});
  const result=await assets.update();assert.equal(result.ok,true,result.error);assert.equal(result.value.repaired,true);assert.equal(calls,2);
  assert.equal(cashBalance(f.phone.snapshot()),100000);assert.equal(assetRows(f.phone.snapshot(),'holding').length,1);
  assert.equal((await assets.update()).ok,false);assert.equal(calls,2);
 }finally{f.close();}
});

test('compatible final-text variants are read without mistaking reasoning or streaming deltas for replies',()=>{
    assert.equal(extractApiText({choices:[{text:' Legacy final text ',finish_reason:'stop'}]}),'Legacy final text');
    assert.equal(extractApiText({choices:[{message:{content:[null,{type:'text',text:'First '},{type:'text',text:4},{type:'image_url',image_url:{url:'private'}},{type:'text',text:'second'}]}}]}),'First second');
    assert.equal(extractApiText({choices:[{message:{content:'Final',reasoning_content:'PRIVATE reasoning'}}]}),'Final');
    for(const [choice,code] of [
        [{message:{reasoning_content:'PRIVATE reasoning'},text:'not a substitute'},'API_REASONING_ONLY'],
        [{message:{tool_calls:[{function:{arguments:'PRIVATE tool args'}}]},text:'not a substitute'},'API_OUTPUT_TOOLS'],
        [{delta:{content:'PRIVATE fragment'}},'API_UNEXPECTED_DELTA'],
        [{message:{content:'Partial'},finish_reason:'length'},'API_OUTPUT_TRUNCATED'],
        [{message:{content:'PRIVATE refused'},finish_reason:'content_filter'},'API_OUTPUT_FILTERED'],
        [{message:{refusal:'PRIVATE refusal',content:''}},'API_OUTPUT_FILTERED'],
        [{message:{content:{text:'PRIVATE unknown'}}},'API_CONTENT_SHAPE'],
        [{message:{content:'   '},finish_reason:'stop'},'API_EMPTY_OUTPUT'],
    ])assert.throws(()=>extractApiText({choices:[choice]}),e=>{
        assert.equal(e.code,code);assert.equal(e.retryable,false);assert.doesNotMatch(e.message+e.diagnostic,/PRIVATE|substitute/);return true;
    });
});

test('missing/invalid candidates and unknown provider labels produce safe structural diagnostics',()=>{
    for(const data of [null,'PRIVATE raw',{}, {choices:[]}, {choices:'PRIVATE raw'}, {choices:[null]}]) {
        assert.throws(()=>extractApiText(data),e=>e.code==='API_RESPONSE_SHAPE'&&!e.diagnostic.includes('PRIVATE'));
    }
    assert.throws(()=>extractApiText({choices:[{finish_reason:'PRIVATE finish reason',message:{content:null,reasoning_details:['PRIVATE']}}],usage:{completion_tokens:'PRIVATE tokens'}}),e=>{
        assert.match(e.diagnostic,/结束原因：其他/);assert.match(e.diagnostic,/含推理内容：是/);
        assert.match(e.diagnostic,/输出token用量：未提供/);assert.doesNotMatch(e.diagnostic,/PRIVATE/);return true;
    });
});

test('empty final-text failures keep HTTP, request and safe response metadata through persisted error logs',async()=>{
    const {createDiagnostics}=await import('../src/diagnostics.js');let stored='';
    const log=createDiagnostics({storage:{getItem:()=>null,setItem:(_k,v)=>stored=v},version:'test'});
    const f=clientFixture({fetchImpl:async()=>({ok:true,status:200,json:async()=>({choices:[{message:{content:null,reasoning_content:'PRIVATE reasoning'},finish_reason:'stop'}],usage:{completion_tokens:77,completion_tokens_details:{reasoning_tokens:77}},private_field:'SECRET'})})});
    await assert.rejects(f.client.generate('PRIVATE prompt',null,()=>true),e=>{
        assert.equal(e.code,'API_REASONING_ONLY');assert.match(e.diagnostic,/HTTP：200/);
        assert.match(e.diagnostic,/请求环节：正在读取模型回复文字/);assert.match(e.diagnostic,/回复上限：4321/);
        assert.match(e.diagnostic,/结束原因：stop/);assert.match(e.diagnostic,/推理token用量：77/);
        log.add(e,'messages');assert.doesNotMatch(stored,/PRIVATE|SECRET/);assert.match(log.text(),/API_REASONING_ONLY/);return true;
    });
});

test('empty SMS is not repeatedly requested; unchanged manual retry succeeds without duplicating the message',async()=>{
    const errors=[],f=phoneFixture(e=>errors.push(e));try{
        await f.phone.scan();f.settings.retries=15;const bodies=[];
        f.reply(options=>{bodies.push(JSON.parse(options.body));return {ok:true,status:200,json:async()=>({choices:[{finish_reason:'stop',message:{content:''}}]})};});
        await f.phone.sendMessage('card:alex.png','Keep original');
        assert.equal(bodies.length,1);assert.equal(errors.at(-1).code,'API_EMPTY_OUTPUT');
        assert.match(errors.at(-1).diagnostic,/HTTP：200/);assert.match(errors.at(-1).diagnostic,/正在读取模型回复文字/);
        const sent=Object.values(f.phone.snapshot().messages)[0];assert.equal(sent.replyStatus,'failed');
        f.reply(options=>{bodies.push(JSON.parse(options.body));return {ok:true,status:200,json:async()=>({choices:[{text:'{"status":"reply","text":"Successful retry"}',finish_reason:'stop'}]})};});
        await f.phone.retryMessage(sent.id);
        assert.deepEqual(bodies[1],bodies[0]);
        const messages=Object.values(f.phone.snapshot().messages);assert.equal(messages.length,2);assert.equal(messages[1].text,'Successful retry');
    }finally{f.close();}
});

test('HTTP 200 proxy errors retain safe classifications from ST statusText and provider codes', async () => {
    const cases = [
        [{error:{message:'Service Unavailable'}},/服务繁忙或执行器不可用/,/报告状态：503/],
        [{error:{message:'Too Many Requests'}},/请求过于频繁/,/报告状态：429/],
        [{error:{message:'Bad Request'}},/请求被接口拒绝/,/报告状态：400/],
        [{error:{message:'Gateway Timeout'}},/上游等待超时/,/报告状态：504/],
        [{error:{message:'Too Many Requests'},quota_error:true},/额度不足/,/额度标记：是/],
        [{error:{code:'context_length_exceeded',message:'PRIVATE STORY secret-key'}},/长度超限/,/报告状态：未提供/],
        [{error:true,message:'Bad Gateway'},/转发连接失败/,/报告状态：502/],
        [{error:'Unauthorized'},/认证失败/,/报告状态：401/],
        [{error:{status:503,message:'PRIVATE STORY secret-key'}},/服务繁忙/,/报告状态：503/],
        [{error:true},/同一时刻的错误记录/,/含错误说明：否/],
    ];
    for(const [data,reason,detail] of cases){
        let calls=0;
        const f=clientFixture({fetchImpl:async()=>{calls++;return {ok:true,status:200,json:async()=>data};}});
        await assert.rejects(f.client.generate('task',null,()=>true),e=>{
            assert.equal(e.retryable,false);assert.match(e.message,reason);assert.match(e.diagnostic,detail);
            assert.match(e.diagnostic,/HTTP：200/);assert.doesNotMatch(e.message+e.diagnostic,/PRIVATE|secret-key/);return true;
        });assert.equal(calls,1);
    }
});

test('SMS retains the first parse failure when a later retry gets a proxy error; manual retry does not duplicate',async()=>{
    const errors=[],f=phoneFixture(e=>errors.push(e));try{
        await f.phone.scan();f.settings.retries=2;let calls=0;
        f.reply(()=>++calls===1?'PRIVATE malformed response':{ok:true,status:200,json:async()=>({error:{message:'Service Unavailable'}})});
        await f.phone.sendMessage('card:alex.png','One original message');
        assert.equal(calls,2);assert.match(errors.at(-1).diagnostic,/此前尝试：第1次：解析返回格式/);
        assert.match(errors.at(-1).diagnostic,/错误分类：服务繁忙/);
        assert.doesNotMatch(errors.at(-1).diagnostic,/PRIVATE|One original/);
        const sent=Object.values(f.phone.snapshot().messages)[0];
        f.reply(()=>'{"status":"reply","text":"Works now"}');await f.phone.retryMessage(sent.id);
        assert.equal(Object.values(f.phone.snapshot().messages).filter(m=>m.role==='user').length,1);
        assert.equal(Object.values(f.phone.snapshot().messages).filter(m=>m.role==='assistant').length,1);
    }finally{f.close();}
});
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
function phoneFixture(onError = () => {}) {
    const bus=new HostEvents(); const event_types=Object.fromEntries(['CHAT_CHANGED','MESSAGE_DELETED','GENERATION_STARTED','GENERATION_ENDED'].map(k=>[k,k]));
    const context={chatId:'A',characterId:0,characters:[{name:'Alex',avatar:'alex.png'}],name1:'Sam',name2:'Alex',chat:[{mes:quote,name:'Alex'}],chatMetadata:{},saveMetadata:async()=>{},onlineStatus:'no_connection',eventSource:bus,event_types,getRequestHeaders:()=>({'Content-Type':'application/json'})};
    installHostGeneration(context);
    const settings=normalizeSettings({api:apiConfig(),retries:0}); let responder=()=>JSON.stringify({contacts:[{name:'Alex',number:'+1 212 555 0123',user_has_number:true,evidence:quote}]}); let signal;
    const client=createApiClient({getContext:()=>context,getSettings:()=>settings,getKey:()=> 'test-only-key',prepareRequest:captureHostRequest,fetchImpl:async(_url,options)=>{signal=options.signal;const result=await responder(options);return typeof result==='string'?response(result):result;}});
    const memory=createPhoneMemory({getContext:()=>context});
    const phone=createPhoneService({memory,getContext:()=>context,getSettings:()=>settings,modelClient:client,onError});
    return {context,settings,phone,memory,bus,signal:()=>signal,reply:fn=>responder=fn,close(){client.cancel();phone.destroy();memory.destroy();}};
}

test('actual independent social payload retains unsummarized latest prose when host history was trimmed',async()=>{
    const f=phoneFixture(),original=globalThis.qqj_v3_public_bridge_v1;let calls=0;
    try{
        f.context.chat.push({mes:'Alex JUST_FINISHED_THE_TRIP with Sam. This was private.'});
        globalThis.qqj_v3_public_bridge_v1={getPromptSnapshot:()=>({status:'empty'})};
        f.bus.on('GENERATE_AFTER_DATA',data=>{data.prompt=data.prompt.filter(m=>m.role==='system');});
        f.reply(options=>{calls++;const payload=JSON.parse(options.body);
            assert.ok(payload.messages.every(m=>m.role==='system'),'fixture stripped ordinary story messages');
            assert.match(JSON.stringify(payload.messages),/JUST_FINISHED_THE_TRIP/);
            assert.match(JSON.stringify(payload.messages),/This was private/);
            assert.match(payload.messages.at(-1).content,/本次为X刷新/);
            assert.equal(payload.temperature,0.83);return '{"posts":[]}';
        });
        const x=createX({memory:f.memory,phone:f.phone,getContext:()=>f.context,getSettings:()=>f.settings});
        const result=await x.refresh();assert.equal(result.ok,true,result.error);assert.equal(calls,1);
        assert.doesNotMatch(JSON.stringify(f.context.chatMetadata),/JUST_FINISHED_THE_TRIP/);
    }finally{globalThis.qqj_v3_public_bridge_v1=original;f.close();}
});

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
