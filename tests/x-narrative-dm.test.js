import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPhoneMemory } from '../src/memory.js';
import { narratedXSentDms } from '../src/x-narrative-dm.js';
import { buildStoryPhonePrompt } from '../src/story-phone.js';
import { normalizeSettings } from '../src/config.js';

const name = '原声乐器修造工坊';
const body = '您好！非常感谢贵工坊的邀请。我很喜欢你们家的手工植鞣革背带和天然草本护理理念，很高兴能接下这次体验推广合作！我将按照约定，在收到定制背带与润喉礼盒后，于日常排练或演出时拍摄带有产品细节的照片发布在X平台并艾特贵工坊账号（报酬180美元，赠品归本人所有）。以下是我的收件地址与联系方式，期待收到你们的作品！';
const prose = '你笑了笑，切回X平台的私信界面，点开“' + name +
    '”的对话框，认认真真地打字回复道：【' + body +
    '】检查了一遍地址门牌号没有拼写错误，你点击了发送键。几乎就在私信显示“已送达”的同一秒，215室那扇厚木门外传来了敲门声。';
const account = {id:'artisan-01',type:'account',name,handle:'@natural-strap',blocked:false,dmAccepted:false,dmPolicy:'requests',inboundRequest:'pending'};
const floor = mes => ({mes,is_user:false,send_date:'2026-11-11T15:18:00+08:00'});
const messages = state => Object.values(state.x).filter(row => row.type === 'message' && row.role === 'user');

function setup() {
    const context = {
        chatId:'x-story-dm',name1:'Emily',name2:'Alex',characterId:0,
        characters:[{name:'Alex',avatar:'alex.png'}],chat:[floor('夜晚，房间很安静。')],
        chatMetadata:{},saveMetadata:async()=>{},eventSource:new EventEmitter(),
        event_types:{},extensionSettings:{personal_pocket_phone:{proactiveEnabled:false}},
    };
    const memory=createPhoneMemory({getContext:()=>context});
    return {context,memory,async seed(){await memory.read();await memory.commit(await memory.begin(),[{collection:'x',key:account.id,value:structuredClone(account)}]);}};
}

test('missing X DM marker: recover the exact sent private reply into the known thread, once, and rollback',async()=>{
    const f=setup();
    try {
        await f.seed();
        f.context.chat.push(floor(prose));
        await f.memory.read();
        let state=(await f.memory.read()).state, sent=messages(state);
        assert.equal(sent.length,1);
        assert.equal(sent[0].accountId,account.id);
        assert.equal(sent[0].text,body);
        assert.equal(sent[0].role,'user');
        assert.equal(sent[0].status,'sent');
        assert.equal(sent[0].origin,'narrative');
        assert.equal(state.x[account.id].dmAccepted,true);
        assert.equal(state.commContext['x:'+sent[0].id]?.shown,true);
        f.context.chat.pop();
        state=(await f.memory.read()).state;
        assert.equal(messages(state).length,0);
        assert.equal(state.x[account.id].dmAccepted,false);
    } finally { f.memory.destroy(); }
});

test('native durian-message takes precedence; the no-marker recovery cannot double-register the same reply',async()=>{
    const f=setup();
    try {
        await f.seed();
        const marker={platform:'x',action:'sent',sender:'user',recipient:name,accountId:account.id,kind:'text',text:body,shown:true};
        f.context.chat.push(floor(prose+'<!--durian-message:'+JSON.stringify(marker)+'-->'));
        const state=(await f.memory.read()).state;
        assert.equal(messages(state).length,1);
        assert.match(messages(state)[0].id,/^narrative-message:/);
    } finally { f.memory.destroy(); }
});

test('X DM recovery requires an explicit successful send and a unique existing recipient',()=>{
    const state={x:{[account.id]:account}};
    assert.deepEqual(narratedXSentDms(floor(prose),state),[{accountId:account.id,name,text:body}]);
    const denied=prose.replace('你点击了发送键','你还没点击发送键').replace('私信显示“已送达”','输入框依然亮着');
    assert.deepEqual(narratedXSentDms(floor(denied),state),[]);
    const draft=prose.replace('你点击了发送键','你准备点击发送键').replace('私信显示“已送达”','屏幕停留在草稿上');
    assert.deepEqual(narratedXSentDms(floor(draft),state),[]);
    assert.deepEqual(narratedXSentDms(floor(prose.replace('切回X平台的私信界面','切回微信聊天界面')),state),[]);
    assert.deepEqual(narratedXSentDms(floor(prose),{x:{}}),[]);
    assert.deepEqual(narratedXSentDms(floor(prose),{x:{a:account,b:{...account,id:'artisan-02'}}}),[]);
    assert.deepEqual(narratedXSentDms(floor(prose),{x:{[account.id]:{...account,blocked:true}}}),[]);
});

test('X DM prompt explicitly requires a marker for a delivered narration reply',()=>{
    const settings=normalizeSettings({proactiveEnabled:false});
    const context={name1:'Emily',characters:[],chat:[floor('继续')]};
    const prompt=buildStoryPhonePrompt({x:{},business:{},contacts:{},calls:{},messages:{},profiles:{}},context,settings,context.chat);
    assert.match(prompt,/X 私信文尾同步是必需步骤/);
    assert.match(prompt,/durian-message/);
    assert.match(prompt,/已送达/);
});
