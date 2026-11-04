import test from 'node:test';
import assert from 'node:assert/strict';
import { readActorMemory, actorMemoryPrompt } from '../src/external-memory.js';

const identity = {hostChatId:'chat',qqjChatId:'memory'};
const context = () => ({chatId:'chat',chatMetadata:{qianqianjie:{chatId:'memory'}},chat:[]});
const query = {actors:[{id:'account',name:'Alex',aliases:['亚历克斯']}],topic:'刚才一起打开了礼物'};
function bridge() {
    return {
        getPeopleSnapshot:()=>({status:'ready',identity,people:{status:'ready',items:[{displayName:'Alex',entityId:'a'},{displayName:'Bea',entityId:'b'}]}}),
        readContext:async()=>({status:'ready',identity,routerText:'ROUTER_SECRET',actors:[{entityId:'a',stateText:'本人私密状态：已看过礼物',memoryText:'约定明天出发，尚未履行',profileText:'PROFILE_SECRET'},{entityId:'b',memoryText:'OTHER_SECRET'}],coverage:{partial:true}}),
    };
}

test('actor memory uses exact unique identity, filters unrelated actors and keeps private labels',async()=>{
    const b=bridge();let calls=0;const read=b.readContext;
    b.readContext=async options=>{calls++;assert.deepEqual(options.entityIds,['a']);assert.equal(options.maxCharacters,6000);assert.match(options.query,/刚才一起打开/);return read();};
    const result=await readActorMemory(context(),{},query,()=>true,b);
    assert.equal(calls,1);assert.equal(result.actors[0].accountId,'account');assert.equal(result.partial,true);
    assert.match(actorMemoryPrompt(result),/本人私密状态/);assert.match(actorMemoryPrompt(result),/尚未履行/);
    assert.doesNotMatch(actorMemoryPrompt(result),/ROUTER_SECRET|PROFILE_SECRET|OTHER_SECRET/);
});

test('ambiguous names and conflicting aliases never pick a convenient identity',async()=>{
    for(const items of [[{displayName:'Alex',entityId:'a'},{displayName:'Alex',entityId:'b'}],[{displayName:'Alex',entityId:'a'},{displayName:'亚历克斯',entityId:'b'}]]){
        const b=bridge();b.getPeopleSnapshot=()=>({status:'ready',identity,people:{status:'ready',items}});b.readContext=()=>assert.fail('must not read unresolved actors');
        assert.equal((await readActorMemory(context(),{},query,()=>true,b)).status,'unmatched');
    }
});

test('disabled/missing/not-ready/cross-chat/error memory degrades without cached or private fallback',async()=>{
    const b=bridge();b.getPeopleSnapshot=()=>assert.fail('disabled must not read');
    assert.equal((await readActorMemory(context(),{api:{memorySource:'none'}},query,()=>true,b)).status,'disabled');
    assert.equal((await readActorMemory(context(),{},query,()=>true,{})).status,'missing');
    for(const value of [{status:'not-ready'}, {status:'ready',identity:{hostChatId:'other'},people:{status:'ready',items:[]}}]){
        const b=bridge();b.getPeopleSnapshot=()=>value;b.readContext=()=>assert.fail('must not read');
        assert.equal((await readActorMemory(context(),{},query,()=>true,b)).actors.length,0);
    }
    for(const response of [{status:'ready',identity:{hostChatId:'other'},actors:[{entityId:'a',memoryText:'STALE'}]},{status:'empty',identity}]){
        const b=bridge();b.readContext=async()=>response;assert.equal((await readActorMemory(context(),{},query,()=>true,b)).actors.length,0);
    }
    const failure=bridge();failure.readContext=()=>{throw Error('PRIVATE failure');};
    assert.doesNotMatch(JSON.stringify(await readActorMemory(context(),{},query,()=>true,failure)),/PRIVATE/);
});

test('async actor result is discarded after invalidation, chat change or oversized response',async()=>{
    for(const change of ['invalid','chat','large']){
        const c=context(),b=bridge();let current=true;const read=b.readContext;
        b.readContext=async()=>{const result=await read();if(change==='invalid')current=false;if(change==='chat')c.chatId='other';if(change==='large')result.actors[0].stateText='x'.repeat(9000);return result;};
        const result=await readActorMemory(c,{},query,()=>current,b);assert.equal(result.actors.length,0);
    }
});

test('publication links use the first surviving journal entry for old posts even after a later metric update',async()=>{
    const {appendChange,replayJournal}=await import('../src/journal.js');
    const post={id:'p',type:'post',author:'user',text:'好。'};
    const change=value=>[{collection:'x',key:'p',value}];
    let journal=appendChange(undefined,['floor0'],change(post));
    journal=appendChange(journal,['floor0','floor1','floor2'],change({...post,metrics:{likes:7}}));
    assert.equal(replayJournal(journal).x.p.sourceIndex,0);
    assert.equal(journal.events[0].changes[0].value.sourceIndex,undefined);
});

test('publication anchors contain no floor text',async()=>{
 const {publicationScenePrompt}=await import('../src/social-context.js');
 const c=context();c.chat=[{mes:'not for export'}];const prompt=publicationScenePrompt(c,[{id:'p',sourceIndex:0}]);
 assert.match(prompt,/"sourceIndex":0/);assert.doesNotMatch(prompt,/not for export/);
});
