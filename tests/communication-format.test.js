import test from 'node:test';
import assert from 'node:assert/strict';
import {formatPhoneDialogue,COMMUNICATION_LANGUAGE_RULE,SOCIAL_LANGUAGE_RULE} from '../src/communication-language.js';
import {createXPanel} from '../src/x-view.js';
import {renderMessagesScreen} from '../src/messages-view.js';

test('bilingual presentation accepts varying source and translation tags',()=>{
    const cases=[
        ['<ta_speech_src>Hello.</ta_speech_src>\n<ta_speech_zh>你好。</ta_speech_zh>','Hello.（你好。）'],
        ['<original>Hello.</original><translation>你好。</translation>','Hello.（你好。）'],
        ['<Japanese>こんにちは。</Japanese><Chinese>你好。</Chinese>','こんにちは。（你好。）'],
        ['<anything>Hello.</anything>\n<anythingElse>你好。</anythingElse>','Hello.（你好。）'],
        ['<ta_speech_zh>你好。</ta_speech_zh><ta_speech_src>Hello.</ta_speech_src>','Hello.（你好。）'],
        ['[original]Hello.[/original]\n[translation]你好。[/translation]','Hello.（你好。）'],
        ['【英文】Hello.\n【中文】你好。','Hello.（你好。）'],
        ['English: Hello.\nChinese: 你好。','Hello.（你好。）'],
        ['Hello.\n（你好。）','Hello.（你好。）'],
        ['Hello.\n你好。','Hello.（你好。）'],
        ['Hello.（你好。）','Hello.（你好。）'],
    ];
    for(const [raw,expected] of cases)assert.equal(formatPhoneDialogue(raw),expected,raw);
});
test('single language, unknown markers and unrelated markup are not fabricated or stripped',()=>{
    const cases=[
        '这是一条中文消息。','Hola.','Hello.（你好。）',
        '<b>Bold</b> text','<unknown>Just a note</unknown>',
        '<ta_speech_src>Hello.</ta_speech_src>'];
    const expected=[
        '这是一条中文消息。','Hola.','Hello.（你好。）',
        '<b>Bold</b> text','<unknown>Just a note</unknown>',
        'Hello.'];
    cases.forEach((raw,i)=>assert.equal(formatPhoneDialogue(raw),expected[i]));
    assert.match(COMMUNICATION_LANGUAGE_RULE,/预设要求双语/);
    assert.match(SOCIAL_LANGUAGE_RULE,/单语预设保持单语/);
});
test('X generated posts and comments show clean bilingual dialogue without rewriting user posts',()=>{
    const raw='<ta_speech_src>Hello.</ta_speech_src>\n<ta_speech_zh>你好。</ta_speech_zh>';
    const state={busy:false,x:{
        profile:{id:'profile',type:'profile',alias:'Robin',bio:''},
        a:{id:'a',type:'account',name:'Avery',handle:'avery',following:false},
        p:{id:'p',type:'post',author:'a',text:raw,metrics:{likes:0,reposts:0,replies:1}},
        own:{id:'own',type:'post',author:'user',text:raw,metrics:{likes:0,reposts:0,replies:0}},
        c:{id:'c',type:'comment',postId:'p',author:'a',text:raw}
    }};
    const panel=createXPanel({adapter:{userName:()=> 'Robin',storyChat:()=>[]},getView:()=>state,redraw(){},notice(){}});
    const html=panel.html();
    assert.match(html,/Hello\.（你好。）/);
    assert.match(html,/&lt;ta_speech_src&gt;Hello\./,'user post remains literal');
    assert.equal(state.x.p.text,raw,'stored model text is not modified');
    panel.action('comments','p');
    assert.match(panel.html(),/pp-x-comment-text pp-snap-copy">Hello\.（你好。）/);
});
test('SMS display formats model reply but preserves user words and source journal text',()=>{
    const raw='<ta_speech_src>Hello.</ta_speech_src>\n<ta_speech_zh>你好。</ta_speech_zh>';
    const view={contacts:{a:{id:'a',name:'Alex'}},messages:{
        m:{id:'m',contactId:'a',role:'assistant',text:raw,createdAt:1},
        u:{id:'u',contactId:'a',role:'user',text:raw,createdAt:2,replyStatus:'sent'}
    }};
    const html=renderMessagesScreen(view,'a',false,{});
    assert.match(html,/pp-sms-bubble">Hello\.（你好。）/);
    assert.match(html,/pp-sms-bubble">&lt;ta_speech_src&gt;Hello\./);
    assert.equal(view.messages.m.text,raw);
});
