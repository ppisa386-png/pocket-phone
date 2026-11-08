import test from 'node:test';
import assert from 'node:assert/strict';
import {createChatPanel} from '../src/chat-view.js';

const fixtures = () => ({
    busy:false,
    whatsapp:{
        profile:{alias:'Sam',currency:'USD'},
        a:{id:'a',type:'account',name:'Alex',friend:'friends',identityKnown:true},
        received:{id:'received',type:'message',accountId:'a',role:'assistant',kind:'text',text:'See you tomorrow',read:false,createdAt:1},
        sent:{id:'sent',type:'message',accountId:'a',role:'user',kind:'text',text:'Okay',status:'answered',createdAt:2},
        call:{id:'call',type:'call',accountId:'a',mode:'voice',status:'ended',turns:[{role:'user',text:'Hello'}],createdAt:3},
        transfer:{id:'transfer',type:'transfer',accountId:'a',direction:'outgoing',status:'pending',amountMinor:15000,currency:'USD',memo:'Thanks',createdAt:4},
    },
    wechat:{
        profile:{alias:'Sam'},
        a:{id:'a',type:'account',name:'Alex',friend:'friends',identityKnown:true},
        received:{id:'received',type:'message',accountId:'a',role:'assistant',kind:'text',text:'你好',read:false,createdAt:1},
    },
});
const panel = (app,state) => createChatPanel({
    app,adapter:{userName:()=> 'Sam'},getView:()=>state,redraw(){},notice(){},
});

test('WhatsApp renders iOS-style chat, contact, call and settings screens with existing actions',async()=>{
    const ui=panel('whatsapp',fixtures());
    let html=ui.html();
    assert.match(html,/pp-whatsapp/);
    assert.match(html,/data-chat-screen="root"/);
    assert.match(html,/pp-wa-list/);
    assert.match(html,/一键添加好友/);
    assert.match(html,/data-chat-action="add"/);
    assert.match(html,/data-chat-action="thread"/);
    await ui.action('tab','contacts');
    assert.match(ui.html(),/联系人/);
    await ui.action('tab','calls');
    html=ui.html();
    assert.match(html,/pp-wa-call-row/);
    assert.match(html,/data-chat-action="contacts"/);
    await ui.action('tab','me');
    assert.match(ui.html(),/data-chat-form="profile"/);
});

test('WhatsApp thread retains messaging, media selection, calls, transfers and long-press actions',async()=>{
    const ui=panel('whatsapp',fixtures());
    await ui.action('thread','a');
    let html=ui.html();
    for(const item of ['pp-wa-kind-picker','pp-wa-send','pp-wa-payment','data-chat-form="message"',
        'data-chat-action="voice"','data-chat-action="video"','data-chat-action="info"','data-press="chat-message"'])
        assert.ok(html.includes(item),item);
    for(const kind of ['text','image','video','voice','transfer'])
        assert.ok(html.includes('<option value="'+kind+'"'),kind);
    ui.input({dataset:{chatField:'kind'},value:'image'});
    assert.match(ui.html(),/<option value="image" selected>/);
    await ui.action('cash');
    assert.match(ui.html(),/data-chat-form="cash"/);
    assert.equal(ui.back(),true);
    assert.match(ui.html(),/data-chat-form="message"/);
});

test('WeChat retains its original layout and composer',async()=>{
    const ui=panel('wechat',fixtures());
    await ui.action('tab','contacts');
    assert.match(ui.html(),/通讯录/);
    assert.doesNotMatch(ui.html(),/pp-wa-list/);
    await ui.action('thread','a');
    const html=ui.html();
    assert.doesNotMatch(html,/pp-wa-kind-picker|pp-wa-send/);
    assert.match(html,/pp-chat-compose-extra/);
    assert.match(html,/data-chat-form="message"/);
});
