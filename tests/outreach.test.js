import test from 'node:test';
import assert from 'node:assert/strict';
import {importStoryPhone,buildStoryPhonePrompt} from '../src/story-phone.js';
import {normalizeSettings,MODULE_KEY} from '../src/config.js';
import {appendChange,replayJournal,reconcileJournal,revisionsFor,messageSignatures} from '../src/journal.js';
import {xUnread} from '../src/x.js';
import {syncCommContext,commMeta} from '../src/comm-context.js';
import {buildContinuityPrompt} from '../src/continuity.js';
const context={name1:'Sam Lee',characters:[],extensionSettings:{}};
const tags=(pairs)=>({mes:pairs.map(([channel,sender])=>{
    const text=channel==='x_mention'?'公开问候 @Sam Lee':'今天有空见面吗？';
    const evidence=sender+'发来了联系。';
    return evidence+'<!--durian-outreach:'+JSON.stringify({channel,sender,recipient:'user',text,evidence,media:'image'})+'-->';
}).join('\n')});
const four=Array.from({length:4},()=>({mes:'剧情继续。'}));
async function capture(chat,journal,ctx=context){
    const rev=await revisionsFor(messageSignatures(chat));
    return importStoryPhone(journal,rev,chat,ctx).journal;
}
test('one fifth floor imports six independent contacts once, with a public mention and pending private requests',async()=>{
    const chat=[...four,tags([['whatsapp','甲'],['wechat','乙'],['x_dm','丙'],['x_mention','丁'],['sms','戊'],['call','己']])];
    const journal=await capture(chat),state=replayJournal(journal);
    for(const app of ['wechat','whatsapp','x'])assert.equal(Object.values(state[app]).find(a=>a.type==='message').role,'assistant');
    assert.equal(Object.values(state.whatsapp).find(a=>a.type==='account').friend,'incoming');
    assert.equal(Object.values(state.x).filter(a=>a.type==='post').length,1);
    assert.equal(xUnread(state),1,'public X mention does not increment desktop unread');assert.equal(Object.keys(state.messages).length,1);assert.equal(Object.values(state.calls)[0].status,'ringing');
    assert.deepEqual(await capture(chat,journal),journal);
    assert.deepEqual(replayJournal(reconcileJournal(journal,await revisionsFor(messageSignatures(four))).journal).x,{});
});
test('proactive notifications store complete private messages without marking them seen in prose',async()=>{
    const contact=(channel,sender,text,shown=false)=>({
        channel,sender,recipient:'user',text,media:'text',motive:'实际联系',shown,
    });
    const rows=[
        contact('sms','戊','HIDDEN_SMS_CONTENT'),
        contact('whatsapp','甲','HIDDEN_WHATSAPP_CONTENT'),
        contact('wechat','乙','HIDDEN_WECHAT_CONTENT'),
        contact('x_dm','丙','HIDDEN_X_DM_CONTENT'),
        contact('x_mention','丁','@Sam Lee 公共提及'),
        contact('call','己',''),
    ];
    const prose='Sam正走在街上，口袋里的手机短暂震动，紧接着传来铃声。';
    const chat=[...four,{mes:prose+rows.map(row=>'<!--durian-outreach:'+JSON.stringify(row)+'-->').join('')}];
    const rev=await revisionsFor(messageSignatures(chat));
    const journal=await capture(chat);
    const state=replayJournal(syncCommContext(journal,rev,chat).journal);
    for(const [platform,collection,content] of [
        ['sms','messages','HIDDEN_SMS_CONTENT'],
        ['whatsapp','whatsapp','HIDDEN_WHATSAPP_CONTENT'],
        ['wechat','wechat','HIDDEN_WECHAT_CONTENT'],
        ['x','x','HIDDEN_X_DM_CONTENT'],
    ]){
        const message=Object.values(state[collection]).find(row=>row.text===content);
        assert.ok(message,platform+' was saved with its full hidden text');
        assert.equal(commMeta(state,platform,message.id)?.shown,false,platform+' arrival is not narrative reading');
        assert.ok(!prose.includes(content),platform+' content stays out of prose');
    }
    const mention=Object.values(state.x).find(row=>row.type==='post'&&row.outreachMention);
    assert.ok(mention);
    assert.equal(commMeta(state,'x',mention.id)?.shown,false,'public mention is not a read notification');
    const call=Object.values(state.calls)[0];
    assert.equal(call.status,'ringing');
    assert.equal(call.turns.length,0,'ringing cannot inject caller dialogue');
    assert.equal(commMeta(state,'call',call.id)?.shown,true,'the ringing event itself was presented');

    const prompt=buildStoryPhonePrompt(state,context,normalizeSettings({}),chat);
    assert.match(prompt,/不能仅凭消息抵达就写出完整消息、摘要、主题/);
    assert.match(prompt,/"shown":false/);
    const continuity=buildContinuityPrompt(state,{name:'Sam Lee'},{
        instruction:'衔接实际通信',allParticipants:true,budget:50000,
    });
    assert.match(continuity,/user 未在剧情里打开手机查看之前/);
    assert.doesNotMatch(continuity,/HIDDEN_SMS_CONTENT|HIDDEN_WHATSAPP_CONTENT|HIDDEN_WECHAT_CONTENT/,'the arrival was already narrated as a notification; the same unread messages must not prompt a second alert');
    assert.deepEqual(await capture(chat,journal),journal,'re-reading does not regenerate the incoming notifications');
    const rolled=replayJournal(reconcileJournal(journal,rev.slice(0,-1)).journal);
    assert.equal(Object.keys(rolled.messages).length,0);
    assert.equal(Object.values(rolled.whatsapp).filter(x=>x.type==='message').length,0);
});

test('frequency and enabled channels gate the decision, a partial alias excludes both X paths',()=>{
    const state=replayJournal(),chat=[...four,{is_user:true,mes:'user'},{role:'system',mes:'系统'}];
    state.x.profile={alias:'Sam'};
    for(const frequency of ['low','medium','high']){
        const settings=normalizeSettings({proactiveFrequency:frequency,apps:{whatsapp:false}});
        const prompt=buildStoryPhonePrompt(state,context,settings,chat);
        assert.match(prompt,/本轮是每五条/);assert.match(prompt,/可无人联系/);
        const channels=prompt.match(/渠道：([^。]+)/)[1];assert.ok(!/whatsapp|snapchat|x_dm|x_mention/.test(channels));
        assert.match(prompt,{low:/优先留白/,medium:/偏执/,high:/不设冷却/}[frequency]);
        assert.doesNotMatch(buildStoryPhonePrompt(state,context,settings,chat.slice(1)),/本轮是每五条/);
    }
});
test('disabled and blocked or unanswered requests do not reappear on replay',async()=>{
    const ctx={...context,extensionSettings:{[MODULE_KEY]:{apps:{wechat:false}}}};
    const chat=[...four,tags([['wechat','A'],['whatsapp','B'],['x_dm','C']])];
    let journal=await capture(chat,undefined,ctx);
    const rev=await revisionsFor(messageSignatures(chat));
    const a=Object.values(replayJournal(journal).x).find(x=>x.type==='account');
    journal=appendChange(journal,rev,[{collection:'x',key:a.id,value:{...a,blocked:true}}]);
    const later=[...chat,...four,tags([['whatsapp','B'],['x_dm','C']])];
    const state=replayJournal(await capture(later,journal));
    assert.deepEqual(state.wechat,{});for(const app of ['whatsapp','x'])assert.equal(Object.values(state[app]).filter(x=>x.type==='message').length,1);
});

import {createPhoneMemory} from '../src/memory.js';
import {createPhoneService} from '../src/phone.js';
import {createChatApp} from '../src/chat-apps.js';
import {createX} from '../src/x.js';
import {createXPanel} from '../src/x-view.js';

test('first contact decisions use the real app services and protect private media',async()=>{
    const chat=[...four,tags([['whatsapp','A'],['wechat','B'],['x_dm','C']])];
    const ctx={...context,chat,chatId:'outreach',chatMetadata:{},saveMetadata:async()=>{}};
    const getContext=()=>ctx,getSettings=()=>normalizeSettings({});
    const memory=createPhoneMemory({getContext}),phone=createPhoneService({memory,getContext,getSettings});
    const args={getContext,getSettings,memory,phone},wa=createChatApp({...args,app:'whatsapp'}),wc=createChatApp({...args,app:'wechat'}),x=createX(args);
    try{
        await memory.read();
        const id=name=>'outreach:'+encodeURIComponent(name);
        assert.equal((await wa.queueMessage(id('A'),'text','未接受')).ok,false);
        assert.equal((await wa.accept(id('A'),true)).ok,true);
        assert.equal((await wa.queueMessage(id('A'),'text','收到')).ok,true);
        assert.equal((await wc.accept(id('B'),false)).ok,true);
        assert.equal((await wc.queueMessage(id('B'),'text','未接受')).ok,false);
        const panel=createXPanel({adapter:{x,userName:()=>ctx.name1},getView:()=>phone.snapshot(),redraw(){},notice(){}});
        await panel.action('thread',id('C'));assert.match(panel.html(),/请求中的媒体已隐藏/);
        assert.equal((await x.decideRequest(id('C'),true)).ok,true);
        assert.doesNotMatch(panel.html(),/请求中的媒体已隐藏/);
        assert.equal((await x.block(id('C'),true)).ok,true);
        chat.push(...four,tags([['whatsapp','A'],['wechat','B'],['x_dm','C'],['x_mention','C']]));
        const state=(await memory.read()).state;
        assert.equal(Object.values(state.whatsapp).filter(x=>x.type==='message'&&x.role==='assistant').length,2);
        assert.equal(Object.values(state.wechat).filter(x=>x.type==='message').length,1);
        assert.equal(Object.values(state.x).filter(x=>x.type==='message').length,1);
        assert.equal(Object.values(state.x).filter(x=>x.type==='post').length,0);
    }finally{phone.destroy();memory.destroy();}
});

test('X privacy, exact alias and regenerate are enforced by the importer',async()=>{
    const chat=[...four,tags([['x_dm','A'],['x_mention','B']])];
    const rev=await revisionsFor(messageSignatures(chat));
    for(const [alias,expectedPosts] of [['Sam',0],['Lee',0],['Sam Lee',1]]){
        const seed=appendChange(undefined,rev.slice(0,1),[{collection:'x',key:'profile',value:{id:'profile',type:'profile',alias,requestsOpen:false}}]);
        let journal=await capture(chat,seed);
        const state=replayJournal(journal);
        assert.equal(Object.values(state.x).filter(r=>r.type==='message').length,0);
        assert.equal(Object.values(state.x).filter(r=>r.type==='post').length,expectedPosts);
        const reroll=[...four,{mes:'这一楼没有人联系。',swipe_id:1}];
        journal=reconcileJournal(journal,await revisionsFor(messageSignatures(reroll))).journal;
        assert.equal(Object.values(replayJournal(await capture(reroll,journal)).x).filter(r=>r.type==='post').length,0);
    }
});

test('one opportunity accepts many first-time contacts via the same enabled app, without needing phone numbers',async()=>{
    const pairs=Array.from({length:25},(_,i)=>['whatsapp','人物'+i]);
    const state=replayJournal(await capture([...four,tags(pairs)]));
    assert.equal(Object.values(state.whatsapp).filter(x=>x.type==='message').length,25);
    assert.equal(Object.values(state.whatsapp).filter(x=>x.friend==='incoming').length,25);
});

test('no decisions on background injections, empty reasoning or user messages',()=>{
    const settings=normalizeSettings({}),state=replayJournal();
    const noise=[{mes:'后台',isPhoneMessage:true},{mes:'<!-- note -->'},{mes:'<think>想法</think>'},{mes:'用户',role:'user'}];
    assert.match(buildStoryPhonePrompt(state,context,settings,[...four,...noise]),/本轮是每五条/);
    for(const freq of ['low','medium','high']){
        const ctx={...context,extensionSettings:{[MODULE_KEY]:{proactiveFrequency:freq}}};
        const chat=[...four,{mes:'五个回合过去，大家各自休息。'}];
        assert.deepEqual(replayJournal(importStoryPhone(undefined,['1','2','3','4','5'],chat,ctx).journal),state);
    }
});

test('split outreach evidence recovers two WhatsApp messages in the existing friend thread after reloading an older journal',async()=>{
    const sender='林娜·陈',first='你走到屋檐下，口袋里的手机震动了两下。',last='你看见林娜刚发来的 WhatsApp 消息，问你到家没有。';
    const messages=['你到家了吗？','记得带上钥匙。'];
    const tag=(text,evidence)=>'<!--durian-outreach:'+JSON.stringify({channel:'whatsapp',sender,recipient:'user',accountId:'name:'+sender,text,evidence})+'-->';
    const chat=[...four,{mes:'<content>'+first+'你放下了手里的东西。'+last+tag(messages[0],first+'……'+last)+tag(messages[1],first+' ... '+last)+'</content>'}];
    const rev=await revisionsFor(messageSignatures(chat));
    const friend={id:'card:friend.png',type:'account',name:sender,friend:'friends'};
    const seed=appendChange(undefined,rev.slice(0,1),[{collection:'whatsapp',key:friend.id,value:friend}]);
    const saved=await capture(chat,seed),state=replayJournal(saved);
    assert.deepEqual(Object.values(state.whatsapp).filter(r=>r.accountId===friend.id).map(m=>m.text),messages);
    assert.equal(Object.values(state.whatsapp).filter(r=>r.type==='account').length,1);
    assert.deepEqual(await capture(chat,JSON.parse(JSON.stringify(saved))),saved);
    assert.deepEqual(replayJournal(reconcileJournal(saved,rev.slice(0,-1)).journal).whatsapp,{[friend.id]:friend});
});
test('recovering an earlier split quote leaves legacy exact-match IDs intact; invented or reordered quotes stay out',async()=>{
    const a='第一段明确写到手机正在振动。',b='第二段写到屏幕上出现了来信。';
    const tag=(sender,evidence)=>'<!--durian-outreach:'+JSON.stringify({channel:'whatsapp',sender,recipient:'user',text:sender+'来信',evidence})+'-->';
    const chat=[...four,{mes:a+'我拿起手机。'+b+tag('恢复',a+'……'+b)+tag('旧记录',b)+tag('乱序',b+'……'+a)+tag('捏造',a+'……这里有一句原文里没有的内容。')}];
    const rev=await revisionsFor(messageSignatures(chat)),oldId='outreach:'+rev.at(-1)+':0';
    const old={id:oldId,type:'message',accountId:'saved',role:'assistant',text:'旧记录来信'};
    const seed=appendChange(undefined,rev,[{collection:'whatsapp',key:oldId,value:old}],oldId);
    const state=replayJournal(await capture(chat,seed));
    assert.deepEqual(state.whatsapp[oldId],old);
    assert.deepEqual(Object.values(state.whatsapp).filter(r=>r.type==='message').map(r=>r.text).sort(),['恢复来信','旧记录来信'].sort());
});

// X-activity re-outreach: the program verifies facts only (an unanswered
// NPC message on SMS/WhatsApp/WeChat followed by user's public original post
// from the non-anonymous account); NPC reposts do not enter the narrative
// judgment and the trigger widens only low and medium frequencies.
import {xTriggerCandidates} from '../src/outreach.js';
import {dateDay} from '../src/story-clock.js';

const DAY1=dateDay('2026-11-01'),DAY2=dateDay('2026-11-02'),DAY3=dateDay('2026-11-03');
const stamp=(date,time='12:00')=>({date,time,precision:'scene'});
const userPost=(id,day,at=3000)=>({id,type:'post',author:'user',alias:'Sam Lee',text:'推文'+id,createdAt:at,postedAtStory:{day,hour:12},liked:false,reposted:false});
const npcPost=(id,day,at=1000)=>({id,type:'post',author:'acc1',text:'乙的帖子'+id,createdAt:at,postedAtStory:{day,hour:10},liked:false,reposted:false});
const sms=(id,role,at,storyTime,extra={})=>({id,contactId:'card:alex.png',name:'Alex',role,text:(role==='assistant'?'NPC_':'USER_')+id,createdAt:at,storyTime,read:false,...extra});
const appMessage=(id,role,at,storyTime,extra={})=>({id,type:'message',accountId:'acc1',role,kind:'text',text:(role==='assistant'?'NPC_':'USER_')+id,createdAt:at,storyTime,read:false,status:role==='assistant'?'received':'answered',...extra});
const chatAccount=extra=>({id:'acc1',type:'account',name:'乙',handle:'yi',friend:'friends',...extra});
const xState=()=>{const state=replayJournal();state.x.profile={id:'profile',type:'profile',alias:'Sam Lee'};return state;};

test('low and medium frequencies list an unanswered SMS thread after a non-anonymous original post; high keeps its own rule',()=>{
    const build=()=>{const state=xState();state.x.p1=userPost('p1',DAY2);state.messages.m1=sms('m1','assistant',1000,stamp('2026-11-01'));return state;};
    for(const frequency of ['low','medium']){
        const prompt=buildStoryPhonePrompt(build(),context,normalizeSettings({proactiveFrequency:frequency}),four);
        assert.match(prompt,/特殊再次联系契机（仅供恋爱或暧昧关系使用）/);
        assert.match(prompt,/"channel":"sms","name":"Alex","unanswered"/);
        assert.match(prompt,/NPC_m1/);assert.match(prompt,/推文p1/);
        // ordinary friends, classmates, colleagues, family and one-sided
        // affection without ambiguity stay ineligible; the AI must judge the
        // relationship from persona and story, never invent one.
        assert.match(prompt,/仅当该人物与user当前处于恋爱关系或暧昧关系（情侣、相互暧昧、发展中的明确浪漫关系）时/);
        assert.match(prompt,/普通朋友、同学、同事、家人，或单方面好感而尚未形成暧昧关系的不适用/);
        assert.match(prompt,/不得凭联系人名单、聊天次数或称呼推断/);
        // silence stays a choice; no mechanical repetition of one post.
        assert.match(prompt,/也可继续沉默，不强制克制也不强制负面情绪/);
        assert.match(prompt,/同一条动态只作为一次契机/);
    }
    const settings=normalizeSettings({proactiveFrequency:'high'});
    assert.doesNotMatch(buildStoryPhonePrompt(build(),context,settings,four),/特殊再次联系契机/);
    assert.match(buildStoryPhonePrompt(build(),context,settings,four),/不设冷却/);
});

test('NPC reposts never become X narrative triggers for WhatsApp or WeChat',()=>{
    for(const app of ['whatsapp','wechat']){
        const state=xState();
        state.x.n1={...npcPost('n1',DAY1),reposted:true,repostedAt:4000,repostedDay:DAY2};
        state[app].acc1=chatAccount();
        state[app].w1=appMessage('w1','assistant',1000,stamp('2026-11-01'));
        const candidates=xTriggerCandidates(state,'Sam Lee');
        assert.deepEqual(candidates,[],'another author\'s repost is not a user-authored post');
        const prompt=buildStoryPhonePrompt(state,context,normalizeSettings({proactiveFrequency:'medium'}),four);
        assert.doesNotMatch(prompt,/特殊再次联系契机/);
        assert.doesNotMatch(prompt,/乙的帖子n1/);
    }
});

test('anonymous alias, user replies, pre-message or missing posts never qualify; undelivered drafts are not replies',()=>{
    const base=()=>{const state=xState();state.messages.m1=sms('m1','assistant',1000,stamp('2026-11-01'));return state;};
    const anon=base();anon.x.profile={id:'profile',type:'profile',alias:'马甲'};anon.x.p1=userPost('p1',DAY2);
    assert.deepEqual(xTriggerCandidates(anon,'Sam Lee'),[],'匿名账号发布不算契机');
    const replied=base();replied.x.p1=userPost('p1',DAY2);replied.messages.m2=sms('m2','user',2000,stamp('2026-11-01','13:00'),{replyStatus:'sent'});
    assert.deepEqual(xTriggerCandidates(replied,'Sam Lee'),[],'user已回复短信');
    assert.doesNotMatch(buildStoryPhonePrompt(replied,context,normalizeSettings({}),four),/特殊再次联系契机/);
    const chatApp=xState();chatApp.x.p1=userPost('p1',DAY2);chatApp.wechat.acc1=chatAccount();
    chatApp.wechat.w1=appMessage('w1','assistant',1000,stamp('2026-11-01'));
    chatApp.wechat.w2=appMessage('w2','user',2000,stamp('2026-11-01','13:00'));
    assert.deepEqual(xTriggerCandidates(chatApp,'Sam Lee'),[],'user已在聊天App回复');
    const queued={...chatApp,wechat:{...chatApp.wechat,w2:{...chatApp.wechat.w2,status:'pending'}}};
    assert.equal(xTriggerCandidates(queued,'Sam Lee').length,1,'未送达的草稿不算回复');
    const none=base();
    assert.deepEqual(xTriggerCandidates(none,'Sam Lee'),[],'没有新X动态');
    assert.match(buildStoryPhonePrompt(none,context,normalizeSettings({}),four),/优先留白/);
    const early=base();early.x.p1=userPost('p1',DAY1,500);
    assert.deepEqual(xTriggerCandidates(early,'Sam Lee'),[],'动态早于未回复消息');
});

test('blocked or declined contacts and disabled apps keep the special trigger closed',()=>{
    const smsState=()=>{const state=xState();state.x.p1=userPost('p1',DAY2);state.messages.m1=sms('m1','assistant',1000,stamp('2026-11-01'));return state;};
    const blocked=smsState();blocked.profiles['blocked:card:alex.png']={messages:true};
    assert.deepEqual(xTriggerCandidates(blocked,'Sam Lee'),[],'被拉黑的短信联系人');
    for(const app of ['whatsapp','wechat']){
        for(const poisoned of [{blocked:true},{friend:'declined'},{inboundRequest:'declined'}]){
            const state=xState();state.x.p1=userPost('p1',DAY2);
            state[app].acc1=chatAccount(poisoned);
            state[app].w1=appMessage('w1','assistant',1000,stamp('2026-11-01'));
            assert.deepEqual(xTriggerCandidates(state,'Sam Lee'),[],app+' '+JSON.stringify(poisoned));
        }
    }
    // a disabled app keeps its candidate out of the prompt
    const state=xState();state.x.p1=userPost('p1',DAY2);
    state.whatsapp.acc1=chatAccount();
    state.whatsapp.w1=appMessage('w1','assistant',1000,stamp('2026-11-01'));
    assert.equal(xTriggerCandidates(state,'Sam Lee').length,1);
    assert.match(buildStoryPhonePrompt(state,context,normalizeSettings({}),four),/特殊再次联系契机/);
    assert.doesNotMatch(buildStoryPhonePrompt(state,context,normalizeSettings({apps:{whatsapp:false}}),four),/特殊再次联系契机/);
});

test('a newer unanswered NPC message retires the same post; building the prompt mutates nothing',()=>{
    const state=xState();
    state.x.p1=userPost('p1',DAY2);
    state.messages.m1=sms('m1','assistant',1000,stamp('2026-11-01'));
    state.messages.m2=sms('m2','assistant',4000,stamp('2026-11-03'));
    assert.deepEqual(xTriggerCandidates(state,'Sam Lee'),[],'NPC再次联系后旧动态不再是契机');
    assert.equal(state.messages.m1.read,false);
    const before=structuredClone(state);
    buildStoryPhonePrompt(state,context,normalizeSettings({}),four);
    assert.deepEqual(state,before,'发帖不把消息标记为已回复，也不改其他状态');
});

test('reload and floor rollback recompute the X trigger from the journal',async()=>{
    const chat=[...four,{mes:'第五楼，user在X上发布了新动态。'}];
    const rev=await revisionsFor(messageSignatures(chat));
    const message={id:'m1',contactId:'card:alex.png',name:'Alex',role:'assistant',text:'NPC_m1',createdAt:1,storyTime:stamp('2026-11-01'),read:false};
    let journal=appendChange(undefined,rev.slice(0,1),[
        {collection:'x',key:'profile',value:{id:'profile',type:'profile',alias:'Sam Lee'}},
        {collection:'messages',key:'m1',value:message}]);
    journal=appendChange(journal,rev,[{collection:'x',key:'p1',value:userPost('p1',DAY2,2)}]);
    for(let i=0;i<2;i++)assert.equal(xTriggerCandidates(replayJournal(journal),'Sam Lee').length,1,'存档重载后资格不变');
    const rolled=replayJournal(reconcileJournal(journal,rev.slice(0,-1)).journal);
    assert.equal(Object.keys(rolled.messages).length,1);
    assert.equal(xTriggerCandidates(rolled,'Sam Lee').length,0,'发帖楼被删除后资格消失');
    const wiped=replayJournal(reconcileJournal(journal,[]).journal);
    assert.equal(Object.keys(wiped.messages).length,0);
    assert.equal(xTriggerCandidates(wiped,'Sam Lee').length,0,'消息楼回退后资格消失');
    assert.ok(DAY1<DAY2&&DAY2<DAY3,'epoch day anchors stay comparable');
});
