// Weather locations come only from explicit user editing, never from story tags.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPhoneMemory } from '../src/memory.js';
import { createPhoneService } from './phone-fixture.js';
import { createWeather } from '../src/weather.js';
import { normalizeSettings } from '../src/config.js';

function fixture() {
    const bus=new EventEmitter();
    const context={chatId:'manual-weather',name1:'Sam',name2:'Alex',
        characterId:0,characters:[{name:'Alex'}],
        chat:[{mes:'2026-11-21 10:00\n【状态栏】位置：东京。',is_user:false}],
        chatMetadata:{},saveMetadata:async()=>{},eventSource:bus,
        event_types:Object.fromEntries(['MESSAGE_DELETED','MESSAGE_EDITED','CHAT_CHANGED','GENERATION_STARTED','GENERATION_ENDED'].map(x=>[x,x])),
        generateQuietPrompt:async()=>'{ }'};
    const settings=normalizeSettings({retries:0});
    const memory=createPhoneMemory({getContext:()=>context});
    const phone=createPhoneService({memory,getContext:()=>context,getSettings:()=>settings});
    const weather=createWeather({memory,phone,getContext:()=>context});
    return {context,bus,memory,phone,weather,
        state:async()=>(await memory.read()).state,
        close(){phone.destroy();memory.destroy();}};
}

test('narrative location markers and status bars do not populate the location record',async()=>{
    const f=fixture();try{
        f.context.chat.push({mes:'2026-11-21 11:00 Sam reached Paris.<!--durian-location:{"city":"巴黎"}-->',is_user:false});
        const state=await f.state();
        assert.equal(state.location?.current,undefined);
        assert.equal(f.weather.report(state).status,'no-location');
        const result=await f.weather.refresh();
        assert.equal(result.ok,false);
        assert.match(result.error,/长按天气地点/);
    }finally{f.close();}
});

test('historical auto-detected city is ignored and replaced only by user location edit',async()=>{
    const f=fixture();try{
        const ticket=await f.memory.begin();
        await f.memory.commit(ticket,[{collection:'location',key:'current',value:{city:'圣保罗',sourceIndex:0}}]);
        assert.equal(f.weather.report(await f.state()).status,'no-location');
        const noCity=await f.weather.refresh();
        assert.equal(noCity.ok,false);
        const edited=await f.weather.editLocation('云京城','');
        assert.equal(edited.ok,true,edited.error);
        assert.deepEqual((await f.state()).location.current,
            {city:'云京城',sourceIndex:0,manual:true});
        f.context.chat.push({mes:'2026-11-21 12:00 user 到达伦敦。<!--durian-location:{"city":"伦敦"}-->',is_user:false});
        assert.equal((await f.state()).location.current.city,'云京城');
    }finally{f.close();}
});

test('manual location survives a weather refresh failure and an untrusted story marker',async()=>{
    const f=fixture();try{
        const selected=await f.weather.editLocation('纽约','');
        assert.equal(selected.ok,true,selected.error);
        f.context.chat.push({mes:'2026-11-21 12:00 到达东京<!--durian-location:{"city":"东京"}-->',is_user:false});
        const failed=await f.weather.refresh();
        assert.equal(failed.ok,false);
        assert.equal((await f.state()).location.current.city,'纽约');
        assert.equal((await f.state()).location.current.manual,true);
    }finally{f.close();}
});
