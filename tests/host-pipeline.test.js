import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhoneContext, freezePhoneContext, hostCompletionPayload } from '../src/api-context.js';
import { independentPayload, createApiClient } from '../src/api.js';
import { normalizeSettings } from '../src/config.js';
import { HostEvents, publishStorySnapshot } from './host-fixture.js';

function fixture() {
    const names = ['GENERATION_STARTED','GENERATE_AFTER_DATA','CHAT_COMPLETION_SETTINGS_READY','GENERATION_ENDED','GENERATION_STOPPED',
        'CHAT_CHANGED','CHAT_LOADED','MESSAGE_EDITED','MESSAGE_DELETED','MESSAGE_SWIPED','SETTINGS_UPDATED','WORLDINFO_UPDATED'];
    const context = {mainApi:'openai',chatId:'a',characterId:0,chatMetadata:{},name1:'Sam',name2:'Alex',
        characters:[{name:'Alex',avatar:'alex.png',data:{description:'Alex description',personality:'Kind',scenario:'Home'}}],
        powerUserSettings:{persona_description:'{{user}} persona'},chatCompletionSettings:{temp_openai:.7,openai_max_tokens:4096},
        chat:[{mes:'Old visible floor',name:'Alex'},{mes:'Last settled floor',is_user:true}],
        eventSource:new HostEvents(),eventTypes:Object.fromEntries(names.map(n=>[n,n])),getRequestHeaders:()=>({}),
        generateQuietPrompt:()=>{throw Error('Quiet must never run');},generateRaw:()=>{throw Error('Raw must never run');}};
    const reader = createPhoneContext({getContext:()=>context,loadWorldModule:async()=>({})});
    return {context,reader,bus:context.eventSource};
}
test('passive snapshot retains late hooks, strips connection secrets and never mutates host requests',async()=>{
    const f=fixture();
    try {
        f.bus.on('CHAT_COMPLETION_SETTINGS_READY',async data=>{await Promise.resolve();data.messages.push({role:'system',content:'Late macro and world info'});data.top_p=.91;});
        const native=await publishStorySnapshot(f.context),original=structuredClone(native);
        const prepared=await f.reader.prepare(f.context,'Phone task');
        assert.equal(prepared.contextMode,'story_snapshot');
        assert.deepEqual(prepared.messages.slice(0,-1),native.messages);
        assert.equal(prepared.top_p,.91);
        const payload=independentPayload(prepared,{model:'phone',maxTokens:128});
        assert.doesNotMatch(JSON.stringify(payload),/host-secret|durian-request/);
        assert.deepEqual(native,original);assert.equal(Object.hasOwn(native,'toJSON'),false);
        payload.messages[0].content='phone-only';assert.deepEqual(native,original);
    } finally {f.reader.destroy();}
    assert.equal(f.bus.listenerCount('GENERATION_STARTED'),0);
    assert.equal(f.bus.listenerCount('CHAT_COMPLETION_SETTINGS_READY'),1,'only the unrelated hook remains');
});
test('snapshot appends only new settled floors and task freezes before a later narrative starts',async()=>{
    const f=fixture();try {
        await publishStorySnapshot(f.context);
        f.context.chat.push({mes:'Completed story reply'});
        const source=freezePhoneContext(f.context);
        f.context.chat.push({mes:'UNFINISHED_STREAM'});
        const prepared=await f.reader.prepare(f.context,'Task',null,()=>true,{context:source});
        const text=JSON.stringify(prepared.messages);
        assert.equal(prepared.contextMode,'story_snapshot');assert.match(text,/Completed story reply/);assert.doesNotMatch(text,/UNFINISHED_STREAM/);
        assert.equal(prepared.messages.filter(m=>m.content.includes('Last settled floor')).length,1);
    } finally {f.reader.destroy();}
});
test('edits, chat switches and setting changes discard stale snapshots; unrelated Quiet cannot replace one',async()=>{
    for (const event of ['MESSAGE_EDITED','MESSAGE_DELETED','MESSAGE_SWIPED','CHAT_CHANGED','SETTINGS_UPDATED','WORLDINFO_UPDATED']) {
        const f=fixture();try {
            await publishStorySnapshot(f.context);
            await f.bus.emit('GENERATION_STARTED','quiet',{},false);
            await f.bus.emit('CHAT_COMPLETION_SETTINGS_READY',{type:'quiet',messages:[{role:'system',content:'OTHER_PLUGIN'}]});
            assert.equal((await f.reader.prepare(f.context,'Task')).contextMode,'story_snapshot');
            await f.bus.emit(event);
            const result=await f.reader.prepare(f.context,'Task');
            assert.equal(result.contextMode,'rebuilt_context');assert.doesNotMatch(JSON.stringify(result),/OTHER_PLUGIN/);
        } finally {f.reader.destroy();}
    }
    const f=fixture();try {
        await publishStorySnapshot(f.context);f.context.chat[0].mes='Edited without an event';
        assert.equal((await f.reader.prepare(f.context,'Task')).contextMode,'rebuilt_context');
        await publishStorySnapshot(f.context);f.context.chatMetadata={};
        assert.equal((await f.reader.prepare(f.context,'Task')).contextMode,'rebuilt_context');
    } finally {f.reader.destroy();}
});
test('cold-start builder retains preset, persona, card, bound books and memory without executing state macros',async()=>{
    const f=fixture();f.reader.destroy();
    Object.assign(f.context,{chatMetadata:{world_info:'chat-book'},extensionPrompts:{memory:{value:'Extension memory',position:0}},
        powerUserSettings:{persona_description:'{{user}} persona',persona_description_lorebook:'persona-book'}});
    f.context.chatCompletionSettings.prompts=[{identifier:'main',role:'system',content:'Preset {{char}} {{setvar::x::bad}}'}];
    f.context.characters[0].data.extensions={world:'character-book'};
    f.context.characters[0].data.character_book={entries:[{enabled:true,constant:true,content:'Embedded lore'}, {enabled:false,constant:true,content:'DISABLED'}]};
    f.context.chat.push({mes:'HIDDEN_STORY',is_system:true});
    const loaded=[];
    f.context.loadWorldInfo=async name=>{loaded.push(name);return {entries:{a:{constant:true,content:name},b:{key:['settled'],content:'Triggered '+name},c:{key:['absent keyword'],content:'UNTRIGGERED'}}};};
    const reader=createPhoneContext({getContext:()=>f.context,loadWorldModule:async()=>({selected_world_info:['global-book'],world_info:{charLore:[{name:'alex',extraBooks:['extra-book']}]}})});
    try {
        const result=await reader.prepare(f.context,'Task');const text=JSON.stringify(result.messages);
        for(const term of ['Preset Alex','Sam persona','Alex description','Kind','Home','Embedded lore','Extension memory','Last settled floor','{{setvar::x::bad}}']) assert.ok(text.includes(term),term);
        assert.deepEqual(loaded.sort(),['global-book','chat-book','persona-book','character-book','extra-book'].sort());
        assert.doesNotMatch(text,/DISABLED|UNTRIGGERED|HIDDEN_STORY/);
        assert.equal(result.contextMode,'rebuilt_context');
    }finally{reader.destroy();}
});
test('group contact chooses its own card and does not reuse another member snapshot',async()=>{
    const f=fixture();try {
        f.context.groupId='g';f.context.characters.push({name:'Bob',data:{description:'Bob context'}});
        await publishStorySnapshot(f.context);
        const result=await f.reader.prepare(f.context,'Task',{characterId:1});
        assert.equal(result.contextMode,'rebuilt_context');assert.match(JSON.stringify(result),/Bob context/);assert.doesNotMatch(JSON.stringify(result),/Alex description/);
    }finally{f.reader.destroy();}
});
test('follow-host payload uses frozen settings, request-local parameters, and never selects a preset',async()=>{
    const f=fixture();let observed;
    f.context.chatCompletionSettings={temp_openai:.7,custom_model:'same-model',chat_completion_source:'custom'};
    f.context.getChatCompletionModel=s=>s.custom_model;
    f.context.ChatCompletionService={presetToGeneratePayload:async(preset,_overrides,payload)=>{observed=structuredClone(preset);preset.temperature=99;return {...payload,temperature:.7,chat_completion_source:'custom'};}};
    try{
        const original=structuredClone(f.context.chatCompletionSettings);
        const payload=await hostCompletionPayload(f.context,[{role:'user',content:'Task'}],async()=>({settingsToUpdate:{temperature:['','temp_openai'],custom_model:['','custom_model'],chat_completion_source:['','chat_completion_source']}}));
        assert.equal(payload.model,'same-model');assert.equal(payload.stream,false);assert.equal(observed.temperature,.7);assert.deepEqual(f.context.chatCompletionSettings,original);
        f.context.mainApi='textgenerationwebui';await assert.rejects(hostCompletionPayload(f.context,[]),/不支持隔离/);
    }finally{f.reader.destroy();}
});

function clientFixture(mode='independent',overrides={}) {
    const f=fixture();const requests=[];
    const settings=normalizeSettings({api:{mode,baseUrl:'https://phone.example/v1',model:'same-model',timeout:15}});
    const client=createApiClient({getContext:()=>f.context,getSettings:()=>settings,getKey:()=> 'phone-key',prepareRequest:f.reader.prepare,
        buildHostPayload:async(_context,messages)=>({messages,model:'same-model',chat_completion_source:'custom',custom_url:'https://host.example/v1',temperature:.7}),
        fetchImpl:async(_url,options)=>new Promise((resolve,reject)=>{
            requests.push({signal:options.signal,body:JSON.parse(options.body),finish:text=>resolve({ok:true,status:200,json:async()=>({choices:[{message:{content:text}}]})})});
            options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
        }),...overrides});
    return {...f,client,requests,settings,close(){client.destroy();f.reader.destroy();}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
for(const mode of ['independent','host']) {
    test(`${mode}: story-first and phone-first share no stop signal; phone requests run concurrently`,async()=>{
        const f=clientFixture(mode);const storyController=new AbortController();
        try{
            await publishStorySnapshot(f.context);
            const one=new AbortController(),two=new AbortController();
            const a=f.client.generate('First',null,()=>true,()=>{},{signal:one.signal});
            const b=f.client.generate('Second',null,()=>true,()=>{},{signal:two.signal});
            await tick();assert.equal(f.requests.length,2,'neither request waits for the other');
            assert.notEqual(f.requests[0].signal,f.requests[1].signal);
            await f.bus.emit('GENERATION_STARTED','normal',{},false);await f.bus.emit('GENERATION_STOPPED');
            assert.ok(f.requests.every(r=>!r.signal.aborted));
            const rejected=assert.rejects(a,/取消/);one.abort();await rejected;
            assert.equal(storyController.signal.aborted,false);assert.equal(f.requests[1].signal.aborted,false);
            storyController.abort();await f.bus.emit('GENERATION_STOPPED');
            f.requests[1].finish('Phone survived');assert.equal(await b,'Phone survived');
            assert.equal(f.requests[1].body.model,'same-model');
            if(mode==='host') {assert.equal(f.requests[1].body.custom_url,'https://host.example/v1');assert.equal(f.requests[1].body.proxy_password,undefined);}
            else assert.equal(f.requests[1].body.proxy_password,'phone-key');
        }finally{f.close();}
    });
}
test('separate preparations overlap and cancellation before a late preparation prevents network submission',async()=>{
    const releases=[];
    const f=clientFixture('independent',{prepareRequest:async(_c,prompt)=>new Promise(resolve=>releases.push(()=>resolve({messages:[{role:'user',content:prompt}]})))});
    try{
        const one=new AbortController();const a=f.client.generate('One',null,()=>true,()=>{},{signal:one.signal});
        const b=f.client.generate('Two',null,()=>true);await tick();assert.equal(releases.length,2);
        const rejected=assert.rejects(a,/取消/);one.abort();await rejected;releases[0]();
        releases[1]();await tick();assert.equal(f.requests.length,1);assert.equal(f.requests[0].body.messages[0].content,'Two');
        f.requests[0].finish('OK');await b;
    }finally{f.close();}
});

test('newly hidden summary floors invalidate a processed snapshot without changing journal revisions',async()=>{
    const f=fixture();try{
        await publishStorySnapshot(f.context);
        f.context.chat[0].is_system=true;
        f.context.chat[0].extra={qianqianjieAutoHide:{schemaVersion:1,chatId:'a'}};
        const prepared=await f.reader.prepare(f.context,'Task');
        assert.equal(prepared.contextMode,'rebuilt_context');
        assert.doesNotMatch(JSON.stringify(prepared.messages),/Old visible floor/);
    }finally{f.reader.destroy();}
});

test('native host text is parsed but truncation and tool-only output are rejected',async()=>{
    const cases=[
        [{content:[{type:'thinking',thinking:'SECRET_REASONING'},{type:'text',text:'{"ok":true}'}],stop_reason:'end_turn'},null],
        [{content:[{type:'text',text:'{"ok":true}'}],stop_reason:'max_tokens'},'API_OUTPUT_TRUNCATED'],
        [{content:[{type:'tool_use',input:{ok:true}}],stop_reason:'tool_use'},'API_OUTPUT_TOOLS'],
        [{message:{tool_plan:'{"ok":true}'}},'API_OUTPUT_TOOLS'],
    ];
    for(const [data,error] of cases){
        const f=clientFixture('host',{fetchImpl:async()=>({ok:true,status:200,json:async()=>data})});
        f.context.extractMessageFromData=value=>value.content?.filter(p=>p.type==='text').map(p=>p.text).join('') || value.message?.tool_plan || '';
        try{
            const result=f.client.generate('Task',null,()=>true);
            if(error)await assert.rejects(result,e=>e.code===error);
            else assert.equal(await result,'{"ok":true}');
        }finally{f.close();}
    }
});

test('a newer narrative snapshot does not displace the processed context of an older phone source',async()=>{
    const f=fixture();try{
        const first=await publishStorySnapshot(f.context);
        first.messages[0].content='Processed old-source lore';
        const source=freezePhoneContext(f.context);
        f.context.chat.push({mes:'NEW_NARRATIVE_INPUT',is_user:true});
        const latest=await publishStorySnapshot(f.context);
        latest.messages[0].content='NEW_NARRATIVE_LORE';
        const result=await f.reader.prepare(f.context,'Old-source phone task',null,()=>true,{context:source});
        assert.equal(result.contextMode,'story_snapshot');
        assert.match(JSON.stringify(result.messages),/Processed old-source lore/);
        assert.doesNotMatch(JSON.stringify(result.messages),/NEW_NARRATIVE_INPUT|NEW_NARRATIVE_LORE/);
        assert.match(JSON.stringify((await f.reader.prepare(f.context,'New-source task')).messages),/NEW_NARRATIVE_INPUT/);
    }finally{f.reader.destroy();}
});
