import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createPhoneMemory} from '../src/memory.js';
import {createPhoneService} from '../src/phone.js';
import {createChatApp} from '../src/chat-apps.js';
import {createChatPanel} from '../src/chat-view.js';
import {normalizeSettings} from '../src/config.js';
import {wxMoments,wxFriends,canViewWxMoment,wechatMomentsStoryPrompt} from '../src/wechat-moments.js';
import {buildStoryPhonePrompt} from '../src/story-phone.js';
import {readFileSync,existsSync} from 'node:fs';
const ok=r=>assert.equal(r.ok,true,r.error);
function fixture(){
    const bus=new EventEmitter();
    let response={status:'no_reply',messages:[]},calls=0,prompt='';
    const ctx={chatId:'wechat-moments-qa',name1:'Sam',name2:'Alex',characterId:0,
        characters:[{name:'Alex',avatar:'alex.png'}],chat:[{mes:'2026-10-30 09:30\nThe day begins.'}],
        powerUserSettings:{persona_description:'Alex and Sam are friends; Bea is a colleague.'},
        chatMetadata:{},saveMetadata:async()=>{},onlineStatus:'connected',
        eventSource:bus,event_types:Object.fromEntries(['CHAT_CHANGED','MESSAGE_DELETED','MESSAGE_EDITED','GENERATION_STARTED','GENERATION_ENDED'].map(x=>[x,x]))};
    const generate=async text=>{calls++;prompt=text;const value=typeof response==='function'?response(text):response;return typeof value==='string'?value:JSON.stringify(value);};
    ctx.generateQuietPrompt=({quietPrompt})=>generate(quietPrompt);
    const settings=normalizeSettings({api:{mode:'host'}});
    const memory=createPhoneMemory({getContext:()=>ctx});
    const phone=createPhoneService({memory,getContext:()=>ctx,getSettings:()=>settings,modelClient:{generate,hasKey:()=>true}});
    const api=createChatApp({app:'wechat',memory,phone,getContext:()=>ctx,getSettings:()=>settings});
    return {ctx,memory,phone,api,settings,reply:value=>response=value,count:()=>calls,prompt:()=>prompt,
        state:()=>phone.snapshot(),close(){phone.destroy();memory.destroy();}};
}
async function friend(f,name='Alex'){
    f.reply({accepted:true,name});
    const added=await f.api.addByName(name);ok(added);
    return wxFriends(f.state()).find(a=>a.name===name).id;
}
test('WeChat four-tab clone renders reference discovery, contacts, me and real moments navigation',async()=>{
    const state={wechat:{profile:{alias:'Sam'},contact:{id:'contact',type:'account',name:'Alex',friend:'friends'}}};
    const panel=createChatPanel({app:'wechat',adapter:{userName:()=> 'Sam'},getView:()=>state,redraw(){},notice(){},assetBase:'https://local/assets/wechat/'});
    const home=panel.html();
    for(const title of ['微信','通讯录','发现','我']) assert.match(home,new RegExp('>'+title+'<'));
    assert.doesNotMatch(home,/data-chat-id="calls"/);
    await panel.action('tab','discover');
    const discover=panel.html();
    for(const title of ['朋友圈','扫一扫','摇一摇','附近的人','漂流瓶','购物','游戏','小程序']) assert.match(discover,new RegExp('>'+title+'<'));
    assert.match(discover,/data-chat-action="moment-feed"/);
    await panel.action('moment-feed');
    assert.match(panel.html(),/data-chat-action="moment-compose"/);
    await panel.action('moment-compose');
    assert.match(panel.html(),/data-chat-form="moment-publish"/);
    assert.match(panel.html(),/图片描述，不带也可以～/);
    assert.match(panel.html(),/这一刻的想法/);
    assert.match(panel.html(),/谁可以看/);
    await panel.action('moment-audience');
    assert.match(panel.html(),/部分可见/);
    await panel.action('moment-mode','include');
    assert.match(panel.html(),/data-chat-action="moment-friend"/);
    await panel.action('moment-friend','contact');
    assert.match(panel.html(),/data-chat-id="contact" aria-pressed="true"/);
    await panel.action('moment-audience-done');
    assert.match(panel.html(),/部分可见/);
    assert.equal(panel.back(),true);
    assert.match(panel.html(),/朋友圈/);
    assert.equal(panel.back(),true);
    await panel.action('tab','me');
    assert.match(panel.html(),/钱包/);
    assert.match(panel.html(),/相册/);
    await panel.action('tab','contacts');
    assert.match(panel.html(),/一键添加好友/);
    assert.match(panel.html(),/新的朋友/);
});
test('WeChat moments persist and enforce audience, friend invalidation, comments, likes and rollback-scoped storage',async()=>{
    const f=fixture();try{
        await f.api.open();
        const alex=await friend(f);
        ok(await f.api.publish('公开的日常','咖啡桌上的两杯饮料','all',[]));
        ok(await f.api.publish('私密日记','', 'private',[]));
        ok(await f.api.publish('仅他可见','散步的照片','include',[alex]));
        ok(await f.api.publish('拒绝他看','', 'exclude',[alex]));
        const posts=wxMoments(f.state());
        assert.equal(posts.length,4);
        const get=title=>posts.find(p=>p.text===title);
        assert.equal(canViewWxMoment(get('公开的日常'),alex),true);
        assert.equal(canViewWxMoment(get('私密日记'),alex),false);
        assert.equal(canViewWxMoment(get('仅他可见'),alex),true);
        assert.equal(canViewWxMoment(get('拒绝他看'),alex),false);
        for(const post of posts)assert.equal(canViewWxMoment(post,'user'),true);
        assert.deepEqual(get('仅他可见').audienceIds,[alex]);
        const before=f.count();
        assert.equal((await f.api.publish('坏名单','','include',['not-a-friend'])).ok,false);
        assert.equal((await f.api.publish('没有对象','','include',[])).ok,false);
        assert.equal(f.count(),before);
        ok(await f.api.likeMoment(get('公开的日常').id));
        ok(await f.api.commentMoment(get('公开的日常').id,'不错！'));
        assert.equal(f.state().wechat[get('公开的日常').id].likes.includes('user'),true);
        assert.equal(f.state().wechat[get('公开的日常').id].comments[0].text,'不错！');
        const newMemory=createPhoneMemory({getContext:()=>f.ctx});
        try{assert.equal(wxMoments((await newMemory.read()).state).length,4);}
        finally{newMemory.destroy();}
    }finally{f.close();}
});
test('WeChat circle friend refresh uses existing friends but never leaks user restricted posts into prompts',async()=>{
    const f=fixture();try{
        await f.api.open();
        const alex=await friend(f);
        ok(await f.api.publish('只有我知道的秘密','','private',[]));
        f.reply({moments:[{authorId:alex,text:'下午去了书店。',imageDescription:'书架上的旧书'}]});
        const old=f.count();
        ok(await f.api.refreshMoments());
        assert.equal(f.count(),old+1);
        assert.doesNotMatch(f.prompt(),/只有我知道的秘密/);
        const post=wxMoments(f.state()).find(x=>x.authorId===alex);
        assert.ok(post);
        assert.equal(post.text,'下午去了书店。');
        const panel=createChatPanel({app:'wechat',adapter:{},getView:()=>f.state(),redraw(){},notice(){}});
        await panel.action('moment-feed');
        assert.match(panel.html(),/书架上的旧书/);
    }finally{f.close();}
});
test('WeChat plus shares music as a genuine message and renders the exact local Fluent UI CD',async()=>{
    const f=fixture();try{
        await f.api.open();
        const alex=await friend(f);
        const panel=createChatPanel({app:'wechat',adapter:{userName:()=> 'Sam'},getView:()=>f.state(),redraw(){},notice(){},assetBase:'https://local/assets/wechat/'});
        await panel.action('thread',alex);
        assert.match(panel.html(),/data-chat-action="wx-plus"/);
        await panel.action('wx-plus');
        assert.match(panel.html(),/data-chat-action="share-music"/);
        await panel.action('share-music');
        assert.match(panel.html(),/data-chat-form="music"/);
        assert.match(panel.html(),/https:\/\/local\/assets\/wechat\/optical_disk_flat\.svg/);
        f.reply({status:'no_reply',messages:[]});
        ok(await f.api.shareMusic(alex,'海边的歌','林歌','分享给你听'));
        const music=Object.values(f.state().wechat).find(x=>x.type==='message'&&x.kind==='music');
        assert.ok(music);
        assert.deepEqual(JSON.parse(music.text),{title:'海边的歌',artist:'林歌',note:'分享给你听'});
        await panel.action('back');
        assert.match(panel.html(),/pp-wx-music-card/);
        assert.match(panel.html(),/海边的歌/);
        assert.match(panel.html(),/彩色 CD/);
        assert.equal((await f.api.shareMusic(alex,'','林歌')).ok,false);
        assert.equal(existsSync(new URL('../assets/wechat/optical_disk_flat.svg',import.meta.url)),true);
        const css=readFileSync(new URL('../style-wechat.css',import.meta.url),'utf8');
        assert.match(css,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
    }finally{f.close();}
});


test('WeChat friends can see authorized user Moments, post their own updates and react or reply to user comments',async()=>{
    const f=fixture();try{
        await f.api.open();const alex=await friend(f);
        const published=await f.api.publish('今天排练了新歌','舞台旁的麦克风','all',[]);ok(published);
        const id=published.value.id;
        const written=await f.api.commentMoment(id,'排练结束啦');ok(written);
        const replyTo=written.value.id;
        const prev=f.count();
        f.reply(prompt=>{
            assert.match(prompt,/今天排练了新歌/);
            assert.match(prompt,/排练结束啦/);
            assert.match(prompt,/仅本批好友有权限看到的朋友圈/);
            return {moments:[{authorId:alex,text:'今天也去排练了。',imageDescription:'吉他放在琴架上'}],
                interactions:[
                    {momentId:id,authorId:alex,kind:'like',text:''},
                    {momentId:id,authorId:alex,kind:'comment',text:'辛苦啦',replyTo},
                    {momentId:id,authorId:alex,kind:'comment',text:'期待新歌！',replyTo:null}
                ]};
        });
        ok(await f.api.refreshMoments());
        assert.equal(f.count(),prev+1,'one visible cohort requires one generation');
        const state=f.state(),mine=state.wechat[id];
        assert.deepEqual(mine.likes,[alex]);
        assert.equal(mine.comments.length,3);
        assert.equal(mine.comments[1].authorId,alex);
        assert.equal(mine.comments[1].replyTo,replyTo);
        assert.equal(mine.comments[2].text,'期待新歌！');
        assert.ok(wxMoments(state).some(m=>m.authorId===alex&&m.text==='今天也去排练了。'));
        const panel=createChatPanel({app:'wechat',adapter:{userName:()=>f.ctx.name1},getView:f.state,redraw(){},notice(){}});
        await panel.action('moment-feed');
        assert.match(panel.html(),/期待新歌/);
        assert.match(panel.html(),/回复 Sam/);
        assert.match(panel.html(),/data-chat-action="moment-comment-reply"/);
        await panel.action('moment-comment-reply',mine.comments[1].id);
        assert.match(panel.html(),/回复 Alex/);
        ok(await f.api.commentMoment(id,'谢谢你！',mine.comments[1].id));
        assert.equal(f.state().wechat[id].comments.at(-1).replyTo,mine.comments[1].id);
        const invalid=await f.api.commentMoment(id,'错贴回复','wx-comment:nonexistent');
        assert.equal(invalid.ok,false);
    }finally{f.close();}
});

test('WeChat refresh strictly partitions restricted Moment text by each friend visibility, never sends private Moments',async()=>{
    const f=fixture();try{
        await f.api.open();const alex=await friend(f,'Alex'),bea=await friend(f,'Bea');
        ok(await f.api.publish('PUBLIC_MARKER','','all',[]));
        ok(await f.api.publish('PRIVATE_MARKER','','private',[]));
        ok(await f.api.publish('ALEX_ONLY_MARKER','','include',[alex]));
        ok(await f.api.publish('BEA_ONLY_MARKER','','exclude',[alex]));
        const prompts=[];
        f.reply(prompt=>{
            prompts.push(prompt);
            assert.doesNotMatch(prompt,/PRIVATE_MARKER/);
            assert.match(prompt,/PUBLIC_MARKER/);
            const target=prompt.includes('ALEX_ONLY_MARKER')?alex:bea;
            assert.ok(prompt.includes('"id":"'+target+'"'));
            if(target===alex)assert.doesNotMatch(prompt,/BEA_ONLY_MARKER/);
            else assert.doesNotMatch(prompt,/ALEX_ONLY_MARKER/);
            return {moments:[],interactions:[]};
        });
        ok(await f.api.refreshMoments());
        assert.equal(prompts.length,2,'two distinct permission cohorts require separate prompts');
        assert.deepEqual(wxMoments(f.state()).filter(m=>m.authorId!=='user'),[]);
    }finally{f.close();}
});

test('WeChat rejected NPC access or reply targets cannot write any Moments data',async()=>{
    const f=fixture();try{
        await f.api.open();const alex=await friend(f);
        const pub=await f.api.publish('只有 Alex 能看到','','include',[alex]);ok(pub);
        const privatePost=await f.api.publish('我自己的私密动态','','private',[]);ok(privatePost);
        const before=structuredClone(f.state().wechat);
        f.reply({moments:[],interactions:[{momentId:privatePost.value.id,authorId:alex,kind:'comment',text:'偷看到了'}]});
        const rejected=await f.api.refreshMoments();
        assert.equal(rejected.ok,false);assert.deepEqual(f.state().wechat,before);
        f.reply({moments:[],interactions:[{momentId:pub.value.id,authorId:alex,kind:'comment',text:'回复',replyTo:'invalid-comment'}]});
        assert.equal((await f.api.refreshMoments()).ok,false);
        assert.deepEqual(f.state().wechat,before);
    }finally{f.close();}
});

test('narrative WeChat Moments respect the current speaker and story-day expiry without forcing a response',async()=>{
    const f=fixture();try{
        await f.api.open();const alex=await friend(f);
        ok(await f.api.publish('PUBLIC_STORY','沙发照片','all',[]));
        ok(await f.api.publish('ALEX_STORY','','include',[alex]));
        ok(await f.api.publish('EXCLUDED_STORY','','exclude',[alex]));
        ok(await f.api.publish('PRIVATE_STORY','','private',[]));
        const state=f.state();
        const prompt=wechatMomentsStoryPrompt(state,f.ctx,f.ctx.chat);
        assert.match(prompt,/PUBLIC_STORY|ALEX_STORY/);
        assert.match(prompt,/PUBLIC_STORY/);assert.match(prompt,/ALEX_STORY/);
        assert.doesNotMatch(prompt,/EXCLUDED_STORY|PRIVATE_STORY/);
        assert.match(prompt,/可以.*完全不理会/);
        const narrative=buildStoryPhonePrompt(state,f.ctx,f.settings,f.ctx.chat);
        assert.match(narrative,/ALEX_STORY/);
        f.ctx.chat.push({mes:'2026-11-05 11:00'});
        assert.doesNotMatch(wechatMomentsStoryPrompt(state,f.ctx,f.ctx.chat),/PUBLIC_STORY|ALEX_STORY/,'old Moments are not repeated indefinitely');
        f.ctx.chat.pop();
        f.ctx.characters.push({name:'Other',avatar:'other.png'});f.ctx.characterId=1;
        assert.equal(wechatMomentsStoryPrompt(state,f.ctx,f.ctx.chat),'','unrelated character cannot read restricted user Moments');
        f.ctx.characterId=0;f.settings.apps.wechat=false;
        assert.doesNotMatch(buildStoryPhonePrompt(state,f.ctx,f.settings,f.ctx.chat),/ALEX_STORY/);
    }finally{f.close();}
});


test('WeChat multi-cohort refresh is atomic: later invalid cohort cannot preserve earlier generated post',async()=>{
    const f=fixture();try{
        await f.api.open();const alex=await friend(f,'Alex');await friend(f,'Bea');
        ok(await f.api.publish('Alex 的特别消息','','include',[alex]));
        const before=JSON.stringify(f.state().wechat);let calls=0;
        f.reply(prompt=>{
            calls++;
            const id=prompt.includes('Alex 的特别消息')?alex:wxFriends(f.state()).find(a=>a.id!==alex).id;
            return calls===1?
                {moments:[{authorId:id,text:'最新动态'}],interactions:[]}:
                {moments:[],interactions:[{momentId:'nonexistent',authorId:id,kind:'comment',text:'错误目标'}]};
        });
        const bad=await f.api.refreshMoments();assert.equal(bad.ok,false);
        assert.equal(calls,2);
        assert.equal(JSON.stringify(f.state().wechat),before,'no first-cohort post can leak into storage after second-cohort failure');
    }finally{f.close();}
});

test('narrated NPC WeChat posts and comments import to real Moments once and roll back with their story floor',async()=>{
    const f=fixture();try{
        await f.api.open();const alex=await friend(f);
        const post=await f.api.publish('周末一起排练吧','','all',[]);ok(post);
        const first=await f.api.commentMoment(post.value.id,'没问题');ok(first);
        const floor='Alex 发表朋友圈：「新唱片即将发布」，随后在你的旧朋友圈评论：「明天见！」';
        const tags=[
            {action:'published',authorId:alex,text:'新唱片即将发布'},
            {action:'comment',momentId:post.value.id,authorId:alex,text:'明天见！',replyTo:first.value.id}
        ];
        f.ctx.chat.push({mes:floor+tags.map(row=>'<!--durian-wechat-moment:'+JSON.stringify(row)+'-->').join(''),is_user:false,name:'Alex'});
        await f.memory.read();
        const state=f.state();
        assert.equal(wxMoments(state).filter(m=>m.authorId===alex&&m.text==='新唱片即将发布').length,1);
        assert.equal(state.wechat[post.value.id].comments.length,2);
        assert.equal(state.wechat[post.value.id].comments[1].text,'明天见！');
        assert.equal(state.wechat[post.value.id].comments[1].replyTo,first.value.id);
        await f.memory.read();
        assert.equal(f.state().wechat[post.value.id].comments.length,2,'repeated imports are idempotent');
        f.ctx.chat.pop();await f.memory.read();
        assert.equal(wxMoments(f.state()).filter(m=>m.authorId===alex).length,0);
        assert.equal(f.state().wechat[post.value.id].comments.length,1);
    }finally{f.close();}
});

test('narrative markers never import unpublished text or NPC comments on an unauthorized user Moment',async()=>{
    const f=fixture();try{
        await f.api.open();const alex=await friend(f);
        const secret=await f.api.publish('只给我自己看的信','','private',[]);ok(secret);
        const tags=[
            {action:'published',authorId:alex,text:'准备发朋友圈但还没有发'},
            {action:'comment',authorId:alex,momentId:secret.value.id,text:'这是隐私评论'}
        ];
        f.ctx.chat.push({mes:'Alex 在思考准备发朋友圈，但没有真的发送。'+
            tags.map(row=>'<!--durian-wechat-moment:'+JSON.stringify(row)+'-->').join(''),is_user:false,name:'Alex'});
        await f.memory.read();
        assert.equal(wxMoments(f.state()).filter(m=>m.authorId===alex).length,0);
        assert.equal(f.state().wechat[secret.value.id].comments.length,0);
    }finally{f.close();}
});
