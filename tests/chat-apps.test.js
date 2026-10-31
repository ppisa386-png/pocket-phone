import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createPhoneMemory} from '../src/memory.js';
import {createPhoneService} from '../src/phone.js';
import {createChatApp,chatItems,chatUnread} from '../src/chat-apps.js';
import {createChatPanel} from '../src/chat-view.js';
import {normalizeSettings} from '../src/config.js';
import {buildContinuityPrompt} from '../src/continuity.js';
import {cashBalance,reservedCash} from '../src/assets-core.js';
const ok=r=>assert.equal(r.ok,true,r.error);
const speaker={name:'Alex',avatar:'alex.png',nameIsUnique:true};
const history=state=>buildContinuityPrompt(state,speaker,{instruction:'Remember',userName:'Sam',budget:30000});
function fixture(app,mode='host') {
    const bus=new EventEmitter();let response={},count=0,prompt='';
    const ctx={chatId:'chat-apps',name1:'Sam',name2:'Alex',characterId:0,characters:[{name:'Alex',avatar:'alex.png'}],chat:[{mes:'2026-10-30 09:30\nAlex gives Sam his number.'}],powerUserSettings:{persona_description:'Alex is Sam’s friend. Bea is Sam’s rival.'},chatMetadata:{},saveMetadata:async()=>{},onlineStatus:'connected',eventSource:bus,event_types:Object.fromEntries(['CHAT_CHANGED','MESSAGE_DELETED','MESSAGE_EDITED','GENERATION_STARTED','GENERATION_ENDED'].map(n=>[n,n]))};
    const generate=async text=>{count++;prompt=text;return typeof response==='function'?response():JSON.stringify(response);};
    ctx.generateQuietPrompt=({quietPrompt})=>generate(quietPrompt);
    const settings=normalizeSettings({api:{mode},retries:4});
    const memory=createPhoneMemory({getContext:()=>ctx});const phone=createPhoneService({memory,getContext:()=>ctx,getSettings:()=>settings,modelClient:{generate,hasKey:()=>true}});
    const make=id=>createChatApp({app:id,memory,phone,getContext:()=>ctx,getSettings:()=>settings});
    return {app,api:make(app),make,ctx,bus,settings,memory,phone,state:()=>phone.snapshot(),reply:r=>response=r,count:()=>count,prompt:()=>prompt,close(){phone.destroy();memory.destroy();}};
}
function contact(overrides={}){return {name:'Alex',source:'chat',user_has_number:true,can_use_phone:true,number:null,evidence:'Alex gives Sam his number.',...overrides};}
async function add(f){f.reply({contacts:[contact()]});ok(await f.api.addByName('Alex'));return chatItems(f.state(),f.app,'account')[0].id;}
for(const app of ['whatsapp','wechat']) {
    test(app+': name search follows contact evidence, adds directly, rejects unrelated or invented results and preserves blocks',async()=>{
        const f=fixture(app);try{await f.api.open();assert.equal(f.count(),0);assert.equal((await f.api.addByName(' ')).ok,false);assert.equal(f.count(),0);
            for(const item of [contact({name:'Bea'}),contact({user_has_number:false}),contact({evidence:'invented evidence'}),contact({can_use_phone:false}),contact({number:'+1 555 9999'})]){f.reply({contacts:[item]});assert.equal((await f.api.addByName('Alex')).ok,false);}
            const before=f.count(),id=await add(f);assert.equal(f.count(),before+1);assert.equal(f.state()[app][id].friend,'friends');assert.equal(Object.keys(f.state().contacts).length,0);assert.equal(Object.keys(f.state().snapchat).length,0);
            ok(await f.api.block(id,true));await add(f);assert.equal(chatItems(f.state(),app,'account').length,1);assert.equal(f.state()[app][id].blocked,true);assert.equal((await f.api.send(id,'text','No')).ok,false);
        }finally{f.close();}
    });
    test(app+': one click adds initial named positive and negative relationships with exact address-book reference validation',async()=>{
        const f=fixture(app);try{
            f.reply({contacts:[{name:'Alex',source_name:'Alex',relationship:'friend',established:true,incidental:false,evidence_refs:['S1.P1'],number:null},{name:'Bea',source_name:'Bea',relationship:'rival',established:true,incidental:false,evidence_refs:['S1.P1'],number:null}]});
            ok(await f.api.addEstablished());assert.equal(f.count(),1);assert.equal(chatItems(f.state(),app,'account').length,2);assert.match(f.prompt(),/不要进行号码是否交换/);assert.match(f.prompt(),/不另判好友邀请/);
            ok(await f.api.addEstablished());assert.equal(chatItems(f.state(),app,'account').length,2);
            f.reply({contacts:[{name:'Ghost',source_name:'Ghost',relationship:'friend',established:true,evidence_refs:['S9.P9']}]});assert.equal((await f.api.addEstablished()).ok,false);assert.equal(chatItems(f.state(),app,'account').length,2);
        }finally{f.close();}
    });
    for(const mode of ['host','independent'])test(app+': '+mode+' preserves queued batches, translated replies, edits, identity and time',async()=>{
        const f=fixture(app,mode);try{
            ok(await f.api.saveProfile({alias:'Moon',currency:'USD'}));const id=await add(f),before=f.count();
            f.ctx.chat.push({mes:'Alex privately WATCHED_THE_SHOW with Sam.'});await f.memory.read();
            ok(await f.api.queueMessage(id,'text','First thought'));ok(await f.api.queueMessage(id,'image','Second thought'));assert.equal(f.count(),before);assert.doesNotMatch(history(f.state()),/First thought/);
            f.reply({status:'reply',messages:[{kind:'text',text:'Hello!（你好！）'},{kind:'voice',text:'A reply.'}]});ok(await f.api.flushMessages(id));assert.equal(f.count(),before+1);assert.match(f.prompt(),/WATCHED_THE_SHOW/);assert.match(f.prompt(),/First thought/);assert.match(f.prompt(),/Second thought/);assert.match(f.prompt(),/不知道这个账号是谁/);assert.match(f.prompt(),/预设的对白语言/);
            const replies=chatItems(f.state(),app,'message').filter(m=>m.role==='assistant');assert.equal(chatUnread(f.state(),app),2);assert.ok(replies[0].storyTime);assert.match(history(f.state()),/Hello!（你好！）/);assert.match(history(f.state()),/"identityKnown":false/);
            ok(await f.api.editMessage(replies[0].id,'Edited'));f.reply({text:'Again'});ok(await f.api.rerollMessage(replies[0].id));assert.equal(f.state()[app][replies[1].id].text,'A reply.');assert.doesNotMatch(f.prompt(),/A reply\./);
            ok(await f.api.markRead(id));assert.equal(chatUnread(f.state(),app),0);ok(await f.api.reveal(id));ok(await f.api.saveProfile({alias:'New name',currency:'USD'}));assert.equal(f.state()[app][id].identityKnown,true);
        }finally{f.close();}
    });
    test(app+': retry has no duplicate user messages; reload persists; narrative deletion rolls back',async()=>{
        const f=fixture(app);try{const id=await add(f);f.ctx.chat.push({mes:'Later.'});await f.memory.read();ok(await f.api.queueMessage(id,'text','A'));ok(await f.api.queueMessage(id,'text','B'));
            f.reply(()=>{throw Error('offline');});const before=f.count();assert.equal((await f.api.flushMessages(id)).ok,false);assert.equal(f.count(),before+1);
            const failed=chatItems(f.state(),app,'message');assert.ok(failed.every(m=>m.status==='failed'));
            f.reply({status:'reply',messages:[{text:'Received'}]});ok(await f.api.retryMessage(failed[0].id));assert.equal(chatItems(f.state(),app,'message').length,3);
            const reload=createPhoneMemory({getContext:()=>f.ctx});try{assert.equal(chatItems((await reload.read()).state,app,'message').length,3);}finally{reload.destroy();}
            f.ctx.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();assert.equal(chatItems(f.state(),app,'message').length,0);assert.equal(chatItems(f.state(),app,'account').length,1);
        }finally{f.close();}
    });
    test(app+': stale requests cannot write after chat switch or app disable; source edits cancel bulk import',async()=>{
        for(const change of ['switch','disable','source']){const f=fixture(app);try{let finish,start;const started=new Promise(r=>start=r);f.reply(()=>{start();return new Promise(r=>finish=r);});const pending=f.api.addEstablished();await started;
            if(change==='switch'){f.ctx.chatId='other';f.ctx.chatMetadata={};f.bus.emit('CHAT_CHANGED');await f.memory.read();}
            if(change==='disable')f.settings.apps[app]=false;
            if(change==='source')f.ctx.powerUserSettings.persona_description='No known relationships.';
            finish(JSON.stringify({contacts:[{name:'Alex',source_name:'Alex',relationship:'friend',established:true,evidence_refs:['S1.P1']}]}));assert.equal((await pending).ok,false);assert.equal(chatItems((await f.memory.read()).state,app,'account').length,0);
        }finally{f.close();}}
    });
    test(app+': view exposes both friend entry points, nested navigation and safely escaped bubbles',async()=>{
        const state={[app]:{a:{id:'a',type:'account',name:'<Alex>',friend:'friends'},m:{id:'m',type:'message',accountId:'a',role:'assistant',kind:'text',text:'<script>unsafe</script>',createdAt:1}}};
        const panel=createChatPanel({app,adapter:{},getView:()=>state,redraw(){},notice(){}});assert.match(panel.html(),/一键添加好友/);assert.match(panel.html(),/添加好友/);assert.doesNotMatch(panel.html(),/选择添加|接受邀请/);
        await panel.action('thread','a');assert.match(panel.html(),/&lt;script&gt;/);await panel.action('cash');assert.equal(panel.back(),true);assert.match(panel.html(),/data-chat-form="message"/);await panel.action('edit','m');assert.equal(panel.back(),true);assert.equal(panel.back(),true);assert.equal(panel.back(),false);
        await panel.action('add');assert.match(panel.html(),/搜索并添加/);panel.reset();assert.doesNotMatch(panel.html(),/data-chat-form="add"/);
    });
}
test('same people in both apps keep independent recognition, messages, history budgets and transfer reservations',async()=>{
    const f=fixture('whatsapp');try{const id=await add(f),wc=f.make('wechat');f.reply({contacts:[contact()]});ok(await wc.addByName('Alex'));const wid=chatItems(f.state(),'wechat','account')[0].id;
        ok(await f.api.block(id,true));assert.equal(f.state().wechat[wid].blocked,false);ok(await f.api.block(id,false));
        const ticket=await f.memory.begin();await f.memory.commit(ticket,[{collection:'assets',key:'wallet',value:{id:'wallet',type:'wallet',openingMinor:10000,included:[],startDay:0}}]);
        const waTransfer=await f.api.transfer(id,'60','USD','WA');ok(waTransfer);assert.equal(reservedCash(f.state()),6000);assert.equal((await wc.transfer(wid,'50','USD','WC')).ok,false);
        f.reply({status:'accepted'});ok(await f.api.settle(waTransfer.value));assert.equal(cashBalance(f.state()),4000);assert.equal((await f.api.settle(waTransfer.value)).ok,false);
        f.reply({status:'reply',messages:[{text:'WA private'}]});ok(await f.api.send(id,'text','Hi WA'));f.reply({status:'reply',messages:[{text:'WC private'}]});ok(await wc.send(wid,'text','Hi WC'));assert.doesNotMatch(f.prompt(),/WA private/);
        const text=history(f.state());assert.match(text,/WhatsApp/);assert.match(text,/微信/);assert.match(text,/WA private/);assert.match(text,/WC private/);
        const other=buildContinuityPrompt(f.state(),{name:'Bea',avatar:'bea.png',nameIsUnique:true},{instruction:'Remember'});assert.equal(other,'');
    }finally{f.close();}
});
