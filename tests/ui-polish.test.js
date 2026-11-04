import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPhoneScreen } from '../src/phone-view.js';
import { renderMessagesScreen } from '../src/messages-view.js';
import { createChatPanel } from '../src/chat-view.js';

test('phone blacklist omits redundant heading and blocking uses accessible icons', () => {
    const view = { contacts:{a:{id:'a',name:'Alex'}}, profiles:{}, messages:{}, calls:{} };
    const blocked = renderPhoneScreen(view, 'blocked', null, '');
    assert.match(blocked, /黑名单为空/);
    assert.doesNotMatch(blocked, /电话黑名单/);
    const contacts = renderPhoneScreen(view, 'contacts', null, '');
    assert.match(contacts, /aria-label="拉黑电话"/);
    assert.match(contacts, /pp-block-button/);
    assert.doesNotMatch(contacts, />拉黑电话<\/button>/);
    const sms = renderMessagesScreen(view, 'a', false, {});
    assert.match(sms, /aria-label="拉黑短信"/);
    assert.doesNotMatch(sms, />拉黑短信<\/button>/);
    view.profiles['blocked:a'] = {id:'a',name:'Alex',phone:true,messages:true};
    assert.match(renderPhoneScreen(view,'contacts',null,''), /aria-label="取消拉黑电话"/);
    assert.match(renderMessagesScreen(view,'a',false,{}), /aria-label="取消拉黑短信"/);
});

test('WhatsApp transfer is selectable from message type and uses the existing transfer form', async () => {
    const state = {whatsapp:{
        a:{id:'a',type:'account',name:'Alex',friend:'friends',blocked:false},
        m:{id:'m',type:'message',accountId:'a',role:'user',kind:'text',text:'Hello',status:'pending',createdAt:1},
        p:{id:'p',type:'transfer',accountId:'a',direction:'outgoing',status:'pending',currency:'USD',amountMinor:12500,memo:'Lunch',createdAt:2}
    }};
    let redraws=0;
    const panel = createChatPanel({app:'whatsapp',adapter:{},getView:()=>state,redraw(){redraws++;},notice(){}});
    await panel.action('thread','a');
    let page=panel.html();
    assert.match(page, /<option value="transfer">转账<\/option>/);
    assert.doesNotMatch(page, /pp-chat-compose-extra|重试回复|data-chat-action="cash"/);
    assert.match(page, /pp-wa-payment/);
    assert.match(page, /待领取/);
    assert.match(page, /查看收款回应/);
    assert.match(page, /USD 125/);
    assert.match(page, /Lunch/);
    panel.input({dataset:{chatField:'kind'},value:'transfer'});
    assert.ok(redraws>0);
    assert.match(panel.html(), /data-chat-form="cash"/);
    assert.match(panel.html(), /转账金额/);
    assert.equal(panel.back(),true);
    assert.match(panel.html(), /<option value="text" selected>文字<\/option>/);
    state.whatsapp.p.status='accepted';
    assert.match(panel.html(), /已领取/);
    assert.doesNotMatch(panel.html(), /查看收款回应/);
    state.whatsapp.p.status='declined';
    assert.match(panel.html(), /已退还/);
    assert.doesNotMatch(panel.html(), /查看收款回应/);
});

test('WeChat retains its existing transfer entry and payment card', async () => {
    const state={wechat:{a:{id:'a',type:'account',name:'Alex',friend:'friends',blocked:false}}};
    const panel=createChatPanel({app:'wechat',adapter:{},getView:()=>state,redraw(){},notice(){}});
    await panel.action('thread','a');
    const page=panel.html();
    assert.match(page, /pp-chat-compose-extra/);
    assert.match(page, /data-chat-action="cash"/);
    assert.doesNotMatch(page, /<option value="transfer">转账<\/option>/);
});