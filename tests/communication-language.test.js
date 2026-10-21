import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhoneMemory } from '../src/memory.js';
import { createPhoneService } from '../src/phone.js';
import { createApiClient } from '../src/api.js';
import { captureHostRequest } from '../src/api-context.js';
import { normalizeSettings } from '../src/config.js';
import { renderMessagesScreen } from '../src/messages-view.js';
import { renderPhoneScreen } from '../src/phone-view.js';
import { buildStoryPhonePrompt } from '../src/story-phone.js';
import { COMMUNICATION_LANGUAGE_RULE } from '../src/communication-language.js';
import { HostEvents, installHostGeneration } from './host-fixture.js';

const quote = 'Alex gives Sam his number: +1 212 555 0123.';
const contactId = 'card:alex.png';
function fixture(mode, narrativeContact = true) {
    const context = {chatId:'language',name1:'Sam',name2:'Alex',characterId:0,
        characters:[{name:'Alex',avatar:'alex.png',description:'母语德语，也会日语。'}],
        chat:[{mes:quote,name:'Alex',is_user:false}],chatMetadata:{},saveMetadata:async()=>{},
        onlineStatus:'connected',eventSource:new HostEvents(),getRequestHeaders:()=>({'Content-Type':'application/json'})};
    const host = installHostGeneration(context);
    let preset = '', response = {contacts:[{name:'Alex',number:'+1 212 555 0123',user_has_number:true,evidence:quote}]};
    context.eventSource.on('CHAT_COMPLETION_SETTINGS_READY',data=>{data.messages[0].content=preset;});
    const hostGenerate=context.generateQuietPrompt;
    context.generateQuietPrompt=async options=>{await hostGenerate(options);return JSON.stringify(response);};
    const settings=normalizeSettings({retries:0,api:{mode,baseUrl:'https://phone.invalid/v1',model:'test-model'}});
    const requests=[];
    const client=createApiClient({getContext:()=>context,getSettings:()=>settings,getKey:()=> 'test-only-key',prepareRequest:captureHostRequest,
        fetchImpl:async (_url,options)=>{requests.push(JSON.parse(options.body));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(response)}}]}),{status:200,headers:{'Content-Type':'application/json'}});}});
    const memory=createPhoneMemory({getContext:()=>context});
    const phone=createPhoneService({memory,getContext:()=>context,getSettings:()=>settings,modelClient:client,narrativeContact});
    return {context,settings,host,memory,phone,requests:mode==='independent'?requests:host.requests,
        setPreset:value=>{preset=value;},reply:value=>{response=value;},close(){phone.destroy();memory.destroy();}};
}

// Mock outputs verify transport, persistence and rendering, not model comprehension.
for (const mode of ['host','independent']) test(mode+': active dialogue preset survives SMS, reroll and phone without extra calls',async()=>{
    const f=fixture(mode);
    try {
        assert.equal((await f.phone.scan()).ok,true);
        const cases=[
            ['正文叙述用英文，角色对白只用中文。','明天见。'],
            ['正文叙述用中文，角色对白只用英文，不附翻译。','See you tomorrow.'],
            ['正文叙述用中文，对白英文原文在前，下一行括号内中文译文。','See you tomorrow.\n（明天见。）'],
            ['正文中文。对白采用当前角色母语原文加中文译文，禁止统一成英语。','Bis morgen.\n（明天见。）'],
            ['正文英文。角色当前用日语交流，对白日文原文在前，后附中文。','また明日。\n（明天见。）'],
        ];
        for(const [preset,text] of cases){
            f.setPreset(preset);f.reply({status:'reply',text,sms_reply_category:'A'});
            const before=f.requests.length;
            assert.equal((await f.phone.sendMessage(contactId,'好的')).ok,true);
            assert.equal(f.requests.length,before+1,'no separate classification or translation request');
            const payload=f.requests.at(-1);
            assert.equal(payload.messages[0].content,preset,'current preset, including narration/dialogue distinction, is unchanged');
            assert.ok(payload.messages.at(-1).content.endsWith(COMMUNICATION_LANGUAGE_RULE));
            const state=f.phone.snapshot(), message=Object.values(state.messages).at(-1);
            assert.equal(message.text,text);
            assert.ok(renderMessagesScreen(state,contactId,false,{}).includes('>'+text+'</p>'));
        }
        const text='Gute Nacht.\n（晚安。）';
        f.reply({text});const last=Object.values(f.phone.snapshot().messages).at(-1);
        let before=f.requests.length;
        assert.equal((await f.phone.rerollMessage(last.id)).ok,true);
        assert.equal(f.requests.length,before+1);
        assert.equal(f.phone.snapshot().messages[last.id].text,text);
        assert.ok(f.requests.at(-1).messages.at(-1).content.endsWith(COMMUNICATION_LANGUAGE_RULE));
        f.reply({status:'answered',text});before=f.requests.length;
        assert.equal((await f.phone.dial(contactId)).ok,true);
        assert.equal((await f.phone.say('听得见吗')).ok,true);
        assert.equal(f.requests.length,before+2);
        const state=f.phone.snapshot(),call=state.calls[state.activeCallId];
        assert.equal(call.turns[0].text,text);assert.equal(call.turns.at(-1).text,text);
        assert.ok(renderPhoneScreen(state,'calls',call.id,'').includes('>'+text+'</p>'));
        assert.ok(f.requests.at(-1).messages.at(-1).content.endsWith(COMMUNICATION_LANGUAGE_RULE));
        const reloaded=createPhoneMemory({getContext:()=>f.context});
        try{const saved=(await reloaded.read()).state;assert.equal(saved.messages[last.id].text,text);assert.equal(saved.calls[call.id].turns.at(-1).text,text);}finally{reloaded.destroy();}
        if(mode==='independent')assert.equal(f.host.requests.length,0,'preparing full preset never sends a second model request');
    } finally {f.close();}
});

test('narrative communication annotation preserves bilingual text and existing read semantics',async()=>{
    const f=fixture('host');
    try{
        const prompt=buildStoryPhonePrompt({contacts:{},calls:{},messages:{},profiles:{}},f.context,f.settings,f.context.chat);
        assert.ok(prompt.endsWith(COMMUNICATION_LANGUAGE_RULE));
        const text='Bis morgen.\n（明天见。）',evidence='Sam received and read a text from Alex.';
        f.context.chat.push({is_user:false,mes:evidence+'<!--durian-contact:'+JSON.stringify({sender:'Alex',recipient:'user',name:'Alex',kind:'sms',text,evidence,read:true})+'-->'});
        await f.memory.read();const message=Object.values(f.phone.snapshot().messages)[0];
        assert.equal(message.text,text);assert.equal(message.read,true);assert.equal(f.requests.length,0);
    }finally{f.close();}
});

test('legacy proactive SMS also receives the dialogue rules and preserves both languages',async()=>{
    const f=fixture('independent',false);
    try{
        const evidence='Bea has Sam’s number and agrees to give it to Alex.';
        f.context.chat[0].mes=evidence;
        const text='Bis morgen.\n（明天见。）';
        f.setPreset('叙述中文，角色对白母语加中文译文。');
        f.reply({status:'message',can_obtain_number:true,route:'mutual_contact',channel:'Bea',evidence,
            reason:'Confirm the meeting.',reason_kind:'commitment',reason_evidence:evidence,requires_live_conversation:false,text});
        assert.equal((await f.phone.checkIncoming()).ok,true);
        assert.equal(f.requests.length,1);
        assert.ok(f.requests[0].messages.at(-1).content.endsWith(COMMUNICATION_LANGUAGE_RULE));
        assert.equal(Object.values(f.phone.snapshot().messages)[0].text,text);
    }finally{f.close();}
});
