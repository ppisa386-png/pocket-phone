import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings } from '../src/config.js';
import { createPresetAssembly, readCurrentPreset, presetRule, presetRowSelected } from '../src/preset-assembly.js';
import { createPresetAssemblyPanel } from '../src/preset-assembly-view.js';
import { createApiClient } from '../src/api.js';
import { captureHostRequest } from '../src/api-context.js';
import { HostEvents } from './host-fixture.js';

const key = name => JSON.stringify(['openai', name]);
const ordinary = (identifier, content, role = 'system') => ({ identifier, name: identifier, content, role, system_prompt: false, injection_position: 0 });
const project = ({ role, content }) => ({ role, content });
function fixture(options = {}) {
    let settings = normalizeSettings({ api: { mode: 'independent', baseUrl: 'https://phone.example/v1', model: 'phone-model' },
        presetAssemblies: { x: { [key('A')]: { mode: 'custom', choices: { style: false } } } } });
    const bus = new HostEvents();
    const types = Object.fromEntries(['GENERATION_STARTED','GENERATE_AFTER_DATA','CHAT_COMPLETION_SETTINGS_READY','OAI_PRESET_CHANGED_BEFORE','OAI_PRESET_CHANGED_AFTER','CHAT_CHANGED'].map(n => [n,n]));
    const context = { mainApi: 'openai', eventSource: bus, event_types: types, chatId: 'one', getRequestHeaders: () => ({}),
        chatCompletionSettings: { preset_settings_openai: 'A', squash_system_messages: false,
            prompts: [ordinary('style','同样的文字 {{user}}'), ordinary('keep','同样的文字 {{user}}','user'), ordinary('off','disabled'),
                { identifier:'main', name:'主提示词', system_prompt:true, role:'system', content:'main' },
                { identifier:'chatHistory', name:'聊天历史', marker:true }],
            prompt_order: [{ character_id:100001, order:[{identifier:'main',enabled:true},{identifier:'style',enabled:true},{identifier:'keep',enabled:true},{identifier:'off',enabled:false},{identifier:'chatHistory',enabled:true}] }] },
    };
    context.getPresetManager = () => ({ getSelectedPresetName: () => context.chatCompletionSettings.preset_settings_openai });
    const manager = { serviceSettings: context.chatCompletionSettings, activeCharacter:{id:100001}, messages:{collection:[]} };
    const hostModule = { promptManager: manager };
    const assembly = createPresetAssembly({ getContext:()=>context, getSettings:()=>settings, getHost:()=>hostModule });
    const requests = [], hostRequests = [], originals = [];
    let quietCalls = 0;
    context.generateQuietPrompt = async quiet => {
        quietCalls++;
        await bus.emit(types.GENERATION_STARTED,'quiet',{quiet_prompt:quiet.quietPrompt},false);
        await options.beforePrepare?.();
        const leaves = context.chatCompletionSettings.prompt_order[0].order.filter(e=>e.enabled).flatMap(entry => {
            const p = context.chatCompletionSettings.prompts.find(p=>p.identifier===entry.identifier);
            if (!p || p.marker || !p.content) return [];
            return [{identifier:p.identifier,role:p.role,content:p.content.replaceAll('{{user}}','Alice')}];
        });
        leaves.splice(1,0,{identifier:'qqj_memory',role:'system',content:'memory and world info'});
        leaves.push({identifier:'history-1',role:'assistant',content:'latest story'}, {identifier:'quietPrompt',role:'system',content:quiet.quietPrompt});
        manager.messages = { collection:leaves.map(leaf => ({identifier:leaf.identifier === 'history-1' ? 'chatHistory' : leaf.identifier === 'quietPrompt' ? 'controlPrompts' : leaf.identifier, collection:[leaf]})) };
        originals.push(structuredClone(manager.messages));
        const generated = { prompt:leaves.map(project) };
        if (options.beforeSource) options.beforeSource(generated,manager);
        await bus.emit(types.GENERATE_AFTER_DATA,generated,false);
        const data = {messages:generated.prompt.filter(Boolean),temperature:.7,max_tokens:3456,model:'host-model',proxy_password:'host-secret'};
        await bus.emit(types.CHAT_COMPLETION_SETTINGS_READY,data);
        options.afterReady?.(data);
        hostRequests.push(JSON.parse(JSON.stringify(data)));
        return 'unexpected host result';
    };
    const client = createApiClient({getContext:()=>context,getSettings:()=>settings,getKey:()=> 'phone-secret',prepareRequest:captureHostRequest,presetAssembly:assembly,
        fetchImpl:async (_url, init) => {requests.push(JSON.parse(init.body)); return options.response ? options.response(init) : {ok:true,status:200,json:async()=>({choices:[{message:{content:'{"ok":true}'},finish_reason:'stop'}]})};}});
    return { context, bus, types, manager, assembly, client, requests, hostRequests, originals,
        get settings(){return settings;}, set settings(next){settings=normalizeSettings(next);}, get quietCalls(){return quietCalls;},
        run:(app='x', extra={})=>client.generate('App task',null,()=>true,()=>{}, {app,requireJsonObject:true,finalOutputContract:'JSON only',...extra}),
    };
}

test('reads real active preset order, enabled flags, stable IDs and locks dynamic structures', () => {
    const f=fixture(), s=f.assembly.read();
    assert.equal(s.name,'A');assert.deepEqual(s.rows.map(r=>r.id),['main','style','keep','off','chatHistory']);
    assert.equal(s.rows[1].controllable,true);assert.equal(s.rows[3].enabled,false);assert.equal(s.rows[4].controllable,false);
    assert.equal(presetRowSelected(s.rows[1],presetRule(f.settings,'x',s)),false);
    assert.equal(presetRule(f.settings,'wechat',s).mode,'follow');
    const original=structuredClone(f.context.chatCompletionSettings);f.assembly.read();assert.deepEqual(f.context.chatCompletionSettings,original);f.assembly.destroy();
});

test('actual independent payload removes only the selected source, preserves identical text elsewhere and host data', async () => {
    const f=fixture(), original=structuredClone(f.context.chatCompletionSettings);
    await f.run();const sent=f.requests[0];
    assert.equal(f.hostRequests.length,0);assert.equal(sent.model,'phone-model');assert.equal(sent.proxy_password,'phone-secret');
    assert.deepEqual(sent.messages.map(m=>m.content),['main','memory and world info','同样的文字 Alice','latest story','App task','JSON only']);
    assert.equal(sent.messages[2].role,'user');assert.equal(sent.temperature,.7);assert.equal(sent.max_tokens,3456);assert.ok(sent.json_schema);
    assert.deepEqual(f.context.chatCompletionSettings,original);assert.deepEqual(f.manager.messages,f.originals[0]);
    assert.equal(f.bus.listenerCount('GENERATE_AFTER_DATA'),0);assert.equal(f.bus.listenerCount('CHAT_COMPLETION_SETTINGS_READY'),0);
    const d=f.assembly.diagnostic('x');assert.deepEqual(d.excluded.map(x=>x.id),['style']);assert.deepEqual(d.absent.map(x=>x.id),['off']);
    assert.doesNotMatch(JSON.stringify(d),/Alice|latest story|secret|memory and world info/);f.assembly.destroy();
});

test('App isolation and follow mode keep original content; reload preserves each preset separately', async () => {
    const f=fixture();f.settings=JSON.parse(JSON.stringify(f.settings));
    await f.run('x');await f.run('wechat');
    assert.equal(f.requests[0].messages.filter(m=>m.content==='同样的文字 Alice').length,1);
    assert.equal(f.requests[1].messages.filter(m=>m.content==='同样的文字 Alice').length,2);
    f.context.chatCompletionSettings.preset_settings_openai='B';
    assert.equal(presetRule(f.settings,'x',f.assembly.read()).mode,'follow');await f.run('x');
    f.context.chatCompletionSettings.preset_settings_openai='A';await f.run('x');
    assert.equal(f.requests[2].messages.filter(m=>m.content==='同样的文字 Alice').length,2);
    assert.equal(f.requests[3].messages.filter(m=>m.content==='同样的文字 Alice').length,1);f.assembly.destroy();
});

test('latest content, added and deleted IDs, and reordered entries are applied without index matching', async () => {
    const f=fixture(), s=f.context.chatCompletionSettings;
    s.prompts.find(p=>p.identifier==='keep').content='edited {{user}}';s.prompts.push(ordinary('new','new entry'));
    s.prompt_order[0].order.splice(1,0,{identifier:'new',enabled:true});s.prompt_order[0].order.reverse();
    s.prompts=s.prompts.filter(p=>p.identifier!=='style');s.prompt_order[0].order=s.prompt_order[0].order.filter(p=>p.identifier!=='style');
    await f.run();const contents=f.requests[0].messages.map(m=>m.content);
    assert.ok(contents.includes('edited Alice'));assert.ok(contents.includes('new entry'));assert.ok(contents.indexOf('edited Alice')<contents.indexOf('new entry'));
    assert.equal(f.assembly.diagnostic('x').excluded.length,0);f.assembly.destroy();
});

test('choices freeze for the whole task and are refreshed for the next task', async () => {
    const f=fixture();const plan=f.client.assemblyPlan('x');
    f.settings={...f.settings,presetAssemblies:{x:{[key('A')]:{mode:'custom',choices:{keep:false}}}}};
    await f.run('x',{assemblyPlan:plan});await f.run('x');
    assert.equal(f.requests[0].messages.some(m=>m.role==='system'&&m.content==='同样的文字 Alice'),false);
    assert.equal(f.requests[1].messages.some(m=>m.role==='user'&&m.content==='同样的文字 Alice'),false);f.assembly.destroy();
});

test('squashed messages, unavailable hooks, ambiguous IDs and changed injection type fail before any model call', async () => {
    for (const mutate of [
        f=>f.context.chatCompletionSettings.squash_system_messages=true,
        f=>delete f.context.event_types.OAI_PRESET_CHANGED_BEFORE,
        f=>f.context.chatCompletionSettings.prompts.push(ordinary('style','duplicate')),
        f=>f.context.chatCompletionSettings.prompts.find(p=>p.identifier==='style').injection_position=1,
        f=>f.context.extensionPrompts={style:{value:'collision'}},
    ]) {
        const f=fixture();mutate(f);await assert.rejects(f.run(),/组装|标识|独立|来源|匹配/);
        assert.equal(f.quietCalls,0);assert.equal(f.requests.length,0);assert.equal(f.hostRequests.length,0);f.assembly.destroy();
    }
});

test('unattributable source changes and later extension rewrites fail closed at serialization, with cleanup', async () => {
    for (const options of [
        {beforeSource:(_data,manager)=>manager.messages.collection.push({identifier:'wrong',role:'system',content:'unrelated'})},
        {afterReady:data=>data.messages[0].content+=' altered after capture'},
    ]) {
        const f=fixture(options);await assert.rejects(f.run(),/来源|一致/);assert.equal(f.requests.length,0);assert.equal(f.hostRequests.length,0);
        assert.equal(f.assembly.diagnostic('x'),null);assert.equal(f.bus.listenerCount('CHAT_COMPLETION_SETTINGS_READY'),0);f.assembly.destroy();
    }
});

test('switching A to B and back during preparation invalidates the request even if final fingerprint matches', async () => {
    let f;f=fixture({beforePrepare:async()=>{await f.bus.emit(f.types.OAI_PRESET_CHANGED_BEFORE);await f.bus.emit(f.types.OAI_PRESET_CHANGED_AFTER);}});
    await assert.rejects(f.run(),/取消|变化/);assert.equal(f.requests.length,0);assert.equal(f.hostRequests.length,0);f.assembly.destroy();
});

test('concurrent phone requests retain their own source maps, App choices and diagnostic records', async () => {
    const f=fixture();f.settings={...f.settings,presetAssemblies:{...f.settings.presetAssemblies,wechat:{[key('A')]:{mode:'custom',choices:{keep:false}}}}};
    await Promise.all([f.run('x'),f.run('wechat')]);
    assert.equal(f.requests.length,2);assert.equal(f.hostRequests.length,0);
    assert.deepEqual(f.assembly.diagnostic('x').excluded.map(r=>r.id),['style']);assert.deepEqual(f.assembly.diagnostic('wechat').excluded.map(r=>r.id),['keep']);f.assembly.destroy();
});

test('old/malformed settings default to follow, preserve arbitrary safe identifiers and drop prompt bodies', () => {
    assert.deepEqual(normalizeSettings({}).presetAssemblies,{});
    const s=normalizeSettings({presetAssemblies:{unknown:{[key('A')]:{mode:'custom'}},x:{bad:{mode:'custom'},[key('A')]:{mode:'custom',choices:{style:false,other:'false'},content:'private prose',secret:'private key'}}}});
    assert.deepEqual(s.presetAssemblies,{x:{[key('A')]:{mode:'custom',choices:{style:false}}}});
    assert.deepEqual(normalizeSettings(JSON.parse(JSON.stringify(s))),s);
});

test('UI uses real entries, saves per App, supports switching presets, escaped names and explicit host limitations', () => {
    const f=fixture();f.context.chatCompletionSettings.prompts.find(p=>p.identifier==='style').name='<img src=x> very long name';
    const panel=createPresetAssemblyPanel({adapter:{presetAssembly:f.assembly},getSettings:()=>f.settings,persist:patch=>{f.settings={...f.settings,...patch};return true;},redraw(){},active:()=>false});
    try {
        assert.match(panel.html(),/&lt;img src=x&gt;/);assert.doesNotMatch(panel.html(),/<img src=x>/);
        panel.check('keep',false);panel.action('save');assert.equal(f.settings.presetAssemblies.x[key('A')].choices.keep,false);
        panel.change('app','wechat');panel.change('mode','custom');panel.action('all');panel.action('save');
        assert.equal(f.settings.presetAssemblies.wechat[key('A')].choices.keep,true);
        f.context.chatCompletionSettings.preset_settings_openai='B';assert.match(panel.html(),/<strong>B<\/strong>/);
        panel.change('mode','custom');panel.action('none');panel.action('save');
        f.context.chatCompletionSettings.preset_settings_openai='A';panel.html();assert.equal(f.settings.presetAssemblies.wechat[key('A')].choices.keep,true);
        panel.action('diagnostic');assert.match(panel.html(),/配置预览/);
        f.settings={...f.settings,api:{...f.settings.api,mode:'host'}};assert.match(panel.html(),/暂不支持自定义预设组装/);
        assert.equal(f.requests.length,0);
    } finally {panel.destroy();f.assembly.destroy();}
});

test('missing current preset with saved custom rules never silently falls back to full context', async () => {
    const f=fixture();f.context.chatCompletionSettings.preset_settings_openai='';await assert.rejects(f.run(),/名称/);
    assert.equal(f.quietCalls,0);f.assembly.destroy();
});

test('contact tasks use the invoking phone/SMS App connection and assembly without changing the shared contact queue', async () => {
    const { createPhoneService } = await import('../src/phone.js');
    const state={contacts:{},calls:{},messages:{},profiles:{}}, view={scope:'chat',state,revision:1};
    const memory={subscribe:fn=>{fn(view);return ()=>{};},read:async()=>view,epoch:()=>1,begin:async()=>({}),commit:async()=>{},commitBatch:async()=>{}};
    const settings=normalizeSettings({api:{mode:'host'},apiProfiles:[{id:'p',name:'App only',api:{mode:'independent',baseUrl:'https://phone.example/v1',model:'m'}}],appConnections:{phone:{profileId:'p'},messages:{profileId:'p'}}});
    const context={chat:[{mes:'Alice has a telephone.'}],name1:'Sam',name2:'Alice',powerUserSettings:{persona_description:'Sam knows Alice.'}};
    const seen=[],plans=[];
    const phone=createPhoneService({memory,getContext:()=>context,getSettings:()=>settings,modelClient:{
        assemblyPlan:app=>{plans.push(app);return {app};},
        generate:async(_prompt,_contact,_current,_progress,options)=>{seen.push(options);return '{"contacts":[]}';},
    }});
    try {
        assert.equal((await phone.scan('Alice','messages')).ok,true);
        assert.equal((await phone.addEstablishedContacts('phone')).ok,true);
        assert.deepEqual(plans,['messages','phone']);assert.deepEqual(seen.map(o=>o.app),plans);
        assert.deepEqual(seen.map(o=>o.assemblyPlan.app),plans);
    } finally {phone.destroy();}
});

test('detached and disabled entries are never forced on, and a later re-enabled entry keeps its explicit exclusion', async () => {
    const f=fixture(), s=f.context.chatCompletionSettings;
    s.prompt_order[0].order.find(e=>e.identifier==='style').enabled=false;
    s.prompts.push(ordinary('detached','must never send'));
    assert.equal(f.assembly.read().rows.at(-1).reason,'未加入当前排列，酒馆不发送此条目');
    await f.run();assert.equal(f.requests[0].messages.filter(m=>m.content==='同样的文字 Alice').length,1);
    s.prompt_order[0].order.find(e=>e.identifier==='style').enabled=true;
    await f.run();assert.equal(f.requests[1].messages.filter(m=>m.content==='同样的文字 Alice').length,1);f.assembly.destroy();
});

test('reserved control identifiers cannot remove the phone task, and history leaves are not preset sources', async () => {
    const f=fixture();const s=f.context.chatCompletionSettings;
    s.prompts.push(ordinary('quietPrompt','pretends to be normal'));s.prompt_order[0].order.push({identifier:'quietPrompt',enabled:true});
    assert.equal(f.assembly.read().rows.find(row=>row.id==='quietPrompt').controllable,false);
    f.settings={...f.settings,presetAssemblies:{x:{[key('A')]:{mode:'custom',choices:{quietPrompt:false}}}}};
    await assert.rejects(f.run(),/无法独立/);assert.equal(f.quietCalls,0);f.assembly.destroy();
    const g=fixture({beforeSource:(_data,manager)=>{manager.messages.collection.find(c=>c.identifier==='style').identifier='chatHistory';}});
    await assert.rejects(g.run(),/来源标识/);assert.equal(g.requests.length,0);g.assembly.destroy();
});

test('an extension introducing a conflicting identifier during preparation invalidates the plan', async () => {
    let f;f=fixture({beforePrepare:()=>{f.context.extensionPrompts={style:{value:'late extension'}};}});
    await assert.rejects(f.run(),/变化|取消/);assert.equal(f.requests.length,0);assert.equal(f.hostRequests.length,0);f.assembly.destroy();
});

test('variable-writing macros are explicitly locked because their effects can cross source boundaries', async () => {
    const f=fixture();f.context.chatCompletionSettings.prompts.find(p=>p.identifier==='style').content='{{setvar::style::long prose}}';
    const row=f.assembly.read().rows.find(row=>row.id==='style');assert.equal(row.controllable,false);assert.match(row.reason,/变量写入宏/);
    await assert.rejects(f.run(),/无法独立/);assert.equal(f.quietCalls,0);f.assembly.destroy();
});
