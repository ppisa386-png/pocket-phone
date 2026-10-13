import test from 'node:test';
import assert from 'node:assert/strict';
import { HostEvents } from './host-fixture.js';
import { normalizeSettings } from '../src/config.js';
import { createAssetBridge, ASSETS_KEY } from '../src/assets-story.js';
import { createDeliveryBridge, DELIVERY_KEY } from '../src/delivery.js';
import { createOpinionBridge, OPINION_KEY } from '../src/x-opinion.js';
import { createStoryPhoneBridge, STORY_PHONE_KEY } from '../src/story-phone.js';
import { JOURNAL_KEY, appendChange, revisionsFor, messageSignatures } from '../src/journal.js';
import { dateDay } from '../src/story-clock.js';

async function fixture(factory) {
    const bus = new HostEvents(); bus.makeFirst = bus.prependListener.bind(bus);
    const types = ['GENERATION_STARTED','GENERATION_AFTER_COMMANDS','GENERATION_ENDED','CHAT_CHANGED','MESSAGE_EDITED','CHAT_COMPLETION_PROMPT_READY','CHAT_COMPLETION_SETTINGS_READY'];
    const c = {name1:'Sam',characterId:0,characters:[{name:'Alex',avatar:'alex.png'}],chatId:'one',chatMetadata:{},
        chat:[{mes:'2026-01-01 10:00',is_user:false},{mes:'2026-01-03 12:00',is_user:false}],
        eventSource:bus,event_types:Object.fromEntries(types.map(x=>[x,x])),extensionPrompts:{},
        setExtensionPrompt(key,value,_p,_d,_s,_r,filter){this.extensionPrompts[key]={value,filter};}};
    const rev = await revisionsFor(messageSignatures(c.chat));
    c.chatMetadata[JOURNAL_KEY] = appendChange(undefined,rev.slice(0,1),[
        {collection:'assets',key:'wallet',value:{id:'wallet',type:'wallet',openingMinor:12345,included:[]}},
        {collection:'orders',key:'parcel',value:{id:'parcel',type:'order',sourceIndex:0,createdDay:dateDay('2026-01-01'),createdHour:10,dueDay:dateDay('2026-01-03'),recipient:{id:'self',name:'Sam'},items:[{product:{name:'衣服'},quantity:1}]}}
    ]);
    const settings = normalizeSettings({}); const errors=[];
    let copied;
    bus.on('CHAT_COMPLETION_PROMPT_READY',data=>{copied=structuredClone(data.chat);});
    const bridge = factory({getContext:()=>c,getSettings:()=>settings,onError:e=>errors.push(e)});
    return {c,bus,settings,bridge,errors,copied:()=>copied};
}

for (const [name, factory, key] of [['balance',createAssetBridge,ASSETS_KEY],['delivery',createDeliveryBridge,DELIVERY_KEY],['opinion',createOpinionBridge,OPINION_KEY],['phone facts',createStoryPhoneBridge,STORY_PHONE_KEY]]) {
    test(name+' reaches outgoing messages even when preset omits the extension slot; no duplication or stale injection',async()=>{
        const f=await fixture(factory); try {
            await f.bridge.prepare('normal'); const prompt=f.c.extensionPrompts[key].value; assert.ok(prompt);
            const data={chat:[{role:'user',content:'继续'}]}; await f.bus.emit('CHAT_COMPLETION_PROMPT_READY',data);
            assert.equal(f.copied().filter(m=>m.content===prompt).length,1,'visible before another extension copies messages');
            await f.bus.emit('CHAT_COMPLETION_SETTINGS_READY',{type:'normal',messages:data.chat});
            assert.equal(data.chat.filter(m=>m.content===prompt).length,1);
            const kept=[{role:'system',content:'预设\n'+prompt},{role:'user',content:'继续'}];
            await f.bus.emit('CHAT_COMPLETION_SETTINGS_READY',{type:'normal',messages:kept}); assert.equal(kept.length,2);
            const quiet=[]; await f.bus.emit('CHAT_COMPLETION_SETTINGS_READY',{type:'quiet',messages:quiet}); assert.equal(quiet.length,0);
            await f.bus.emit('GENERATION_STARTED','normal',{},true); await f.bridge.prepare('normal',{},true);
            assert.equal(f.c.extensionPrompts[key].value,prompt,'prompt preview does not clear current generation');
            const dry={dryRun:true,chat:[]}; await f.bus.emit('CHAT_COMPLETION_PROMPT_READY',dry); assert.equal(dry.chat.length,0);
            f.c.chatMetadata={}; const switched=[]; await f.bus.emit('CHAT_COMPLETION_SETTINGS_READY',{type:'normal',messages:switched}); assert.equal(switched.length,0);
            await f.bus.emit('CHAT_CHANGED'); assert.equal(f.c.extensionPrompts[key].value,''); assert.deepEqual(f.errors,[]);
        } finally {f.bridge.destroy();}
    });
}
