import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createPhoneMemory} from '../src/memory.js';
import {createPhoneService} from '../src/phone.js';
import {createChatApp} from '../src/chat-apps.js';
import {createChatPanel} from '../src/chat-view.js';
import {normalizeSettings} from '../src/config.js';
import {wxMoments,wxFriends,canViewWxMoment} from '../src/wechat-moments.js';
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
    const generate=async text=>{calls++;prompt=text;return JSON.stringify(response);};
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
