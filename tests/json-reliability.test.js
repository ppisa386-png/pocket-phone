import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { APPS, normalizeSettings } from '../src/config.js';
import { parseAppObject, parseModelObject, phoneJsonSchema } from '../src/model-json.js';
import { parseJSON, createPhoneService } from '../src/phone.js';
import { parseAmazonResponse } from '../src/amazon.js';
import { parseCalendarResponse } from '../src/calendar-core.js';
import { parseAssetResponse } from '../src/assets.js';
import { parseSnapObject } from '../src/snapchat.js';
import { parseXObject } from '../src/x.js';
import { createPhoneMemory } from '../src/memory.js';
import { createApiClient } from '../src/api.js';

test('all app parsers recover lossless transport formatting without changing content or amounts', () => {
    const text = '第一行\r\n第二行\t原文\u0000 <!--keep--> <think>keep</think> ,} ,]';
    const expected = {text,amount:'1234.50',negative:-1,empty:null};
    const raw = '{"text":'+JSON.stringify(text).replaceAll('\\r','\r').replaceAll('\\n','\n').replaceAll('\\t','\t').replaceAll('\\u0000','\u0000')+',"amount":"1234.50","negative":-1,"empty":null,}';
    for (const parse of [parseAppObject,parseJSON,parseAmazonResponse,parseCalendarResponse,parseAssetResponse,parseSnapObject,parseXObject]) {
        assert.deepEqual(parse('说明：```json\n'+raw+'\n```'),expected);
        assert.deepEqual(parse(JSON.stringify(JSON.stringify(expected))),expected);
        assert.deepEqual(parse('\ufeff'+JSON.stringify(expected)),expected);
        assert.deepEqual(parse('{"text":"Literal \\\\n and \\\"quote\\\""}'),{text:'Literal \\n and "quote"'});
        for (const invalid of ['{"amount":','{"text":"broken "quote""}','{"amount":,}','{}{}',"{'amount':100}",'<think>{"amount":100}</think>']) {
            assert.throws(()=>parse(invalid),e=>e.code.startsWith('MODEL_JSON_'));
        }
    }
    assert.throws(()=>parseModelObject(raw),e=>e.code==='MODEL_JSON_SYNTAX','strict storage/evidence parsing is not relaxed');
});

function setup(mode) {
    const context = {chatId:'json-reliability',name1:'Sam',name2:'Alex',chat:[{mes:'2026-11-14 12:00'}],
        chatMetadata:{},saveMetadata:async()=>{},onlineStatus:'connected',eventSource:new EventEmitter(),
        event_types:{},getRequestHeaders:()=>({'Content-Type':'application/json'})};
    const settings = normalizeSettings({retries:15,api:{mode,model:'test',baseUrl:'https://model.invalid/v1'},apps:Object.fromEntries(APPS.map(a=>[a.id,true]))});
    const requests=[], errors=[];
    let reply = () => '{"records":["saved"]}';
    context.generateQuietPrompt = async options => {requests.push(options);return reply(options);};
    const client = createApiClient({getContext:()=>context,getSettings:()=>settings,getKey:()=> 'fixture-key',
        prepareRequest:async (_c,prompt)=>({messages:[{role:'system',content:'KEEP_PRESET'},{role:'user',content:prompt}],
            stop:['}'],tools:[{type:'function'}],tool_choice:'required',json_schema:{name:'unrelated',value:{type:'array'}},response_format:{type:'json_schema'},max_tokens:128}),
        fetchImpl:async (_url,options)=>{const body=JSON.parse(options.body);requests.push(body);const answer=await reply(body);
            return typeof answer==='string'?{ok:true,status:200,json:async()=>({choices:[{message:{content:answer},finish_reason:'stop'}]})}:answer;}});
    const memory = createPhoneMemory({getContext:()=>context});
    const phone = createPhoneService({memory,getContext:()=>context,getSettings:()=>settings,modelClient:client,onError:e=>errors.push(e)});
    const run = (app,options={}) => phone.appTask(async(view,current,request)=>{
        const result = await request('只输出 JSON：{"records":["原任务数据"]}',data=>{
            if(!Array.isArray(data.records)) throw Error('records must be an array');
            return data;
        },current,null,options);
        await memory.commit(await memory.begin(view),[{collection:'profiles',key:app,value:result}]);
        return result;
    },app);
    return {context,settings,requests,errors,phone,run,reply:fn=>reply=fn,close(){phone.destroy();memory.destroy();client.cancel();}};
}

for (const mode of ['host','independent']) for (const {id} of APPS) test(mode+' '+id+': one format recovery, atomic save, bounded failure and full contract',async()=>{
    const f=setup(mode);
    try {
        let n=0;
        f.reply(()=>++n===1?'PRIVATE malformed reply':'```json\n{"records":["原文\n第二行",],}\n```');
        const result=await f.run(id);
        assert.equal(result.ok,true,result.error);assert.equal(n,2);
        assert.deepEqual(f.phone.snapshot().profiles[id],{records:['原文\n第二行']});
        for(const request of f.requests) {
            if(mode==='independent') {
                assert.deepEqual(request.json_schema,phoneJsonSchema());assert.equal(request.response_format,undefined);
                assert.equal(request.stop,undefined);assert.equal(request.tools,undefined);assert.equal(request.tool_choice,undefined);
                assert.equal(request.messages[0].content,'KEEP_PRESET');
                assert.match(request.messages.at(-1).content,/完整 JSON 对象/);
            } else {
                assert.match(request.quietPrompt,/完整 JSON 对象/);assert.ok(request.responseLength>=8192);
            }
        }
        const before=structuredClone(f.phone.snapshot().profiles[id]);
        n=0;f.reply(()=>{n++;return 'PRIVATE {"records":[';});
        const failed=await f.run(id);
        assert.equal(failed.code,'MODEL_JSON_TRUNCATED');assert.equal(n,2,'global retries=15 cannot repeat format failures');
        assert.deepEqual(f.phone.snapshot().profiles[id],before);
        assert.doesNotMatch(f.errors.at(-1).diagnostic,/PRIVATE/);
        const budgets=f.requests.slice(-2).map(r=>r.max_tokens??r.responseLength);
        assert.equal(budgets[1],Math.min(32768,budgets[0]*2));
        assert.equal(f.settings.api.maxTokens,2048);
    } finally {f.close();}
});

test('real ST schema envelope reaches the provider, unsupported schema fallback is remembered per endpoint/model',async()=>{
    const f=setup('independent');
    try {
        const providerRequests=[];
        f.reply(body=>{
            // Mirrors ST release src/endpoints/backends/chat-completions.js:
            // request.body.response_format is ignored; json_schema is converted.
            const provider={messages:body.messages};
            if(body.json_schema) provider.response_format={type:'json_schema',json_schema:{name:body.json_schema.name,strict:body.json_schema.strict??true,schema:body.json_schema.value}};
            providerRequests.push(provider);
            if(provider.response_format) return {ok:false,status:400,json:async()=>({error:{message:'json_schema is not supported'}})};
            return '{"records":[]}';
        });
        assert.equal((await f.run('calendar')).ok,true);assert.equal(f.requests.length,2);
        assert.equal(providerRequests[0].response_format.type,'json_schema');
        assert.equal(providerRequests[0].response_format.json_schema.strict,false);
        assert.equal(providerRequests[1].response_format,undefined);
        assert.deepEqual(providerRequests[0].messages,providerRequests[1].messages);
        assert.equal((await f.run('amazon')).ok,true);assert.equal(f.requests.length,3,'known unsupported schema is not submitted again');
        f.settings.api.model='another-model';
        assert.equal((await f.run('food')).ok,true);assert.equal(f.requests.length,5,'another model has its own capability');
    } finally {f.close();}
});

test('provider truncation retries with a larger budget, refuses partial data, then saves exactly once',async()=>{
    const f=setup('independent');
    try {
        let n=0;
        f.reply(()=>++n===1?{ok:true,status:200,json:async()=>({choices:[{message:{content:'{"records":["partial"'},finish_reason:'length'}]})}:'{"records":["complete"]}');
        assert.equal((await f.run('calendar',{maxTokens:4096})).ok,true);
        assert.deepEqual(f.requests.map(r=>r.max_tokens),[4096,8192]);
        assert.deepEqual(f.phone.snapshot().profiles.calendar,{records:['complete']});
    } finally {f.close();}
});

test('invalid business data, transport errors and cancelled replies cannot enter format recovery or overwrite data',async()=>{
    const f=setup('independent');
    try {
        assert.equal((await f.run('messages')).ok,true);
        const before=structuredClone(f.phone.snapshot().profiles);
        f.reply(()=>'{}');
        assert.equal((await f.run('messages',{retries:0})).ok,false);
        assert.equal(f.requests.length,2,'business errors do not trigger format recovery');
        f.reply(()=>({ok:false,status:401,json:async()=>({error:{message:'PRIVATE credentials'}})}));
        assert.equal((await f.run('messages')).ok,false);assert.equal(f.requests.length,3);
        f.reply(()=>{f.settings.api.model='changed';return '{"records":[';});
        assert.equal((await f.run('messages')).ok,false);assert.equal(f.requests.length,4);
        assert.deepEqual(f.phone.snapshot().profiles,before);
    } finally {f.close();}
});
