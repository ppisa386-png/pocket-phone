import test from 'node:test';
import assert from 'node:assert/strict';
import { recentSocialStory, socialStoryPrompt } from '../src/social-context.js';
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

test('recent story preserves whole latest floors, roles, privacy clauses and current edits without persisting',()=>{
    const c=context();c.chat=Array.from({length:10},(_,i)=>({mes:'正文 '+i,name:'Alex'}));
    c.chat[9]={mes:'<think>REASONING_SECRET</think>两人刚拆了礼物。只有两人知道。<!-- durian-sms HIDDEN_RECORD -->'};
    c.chat.push({mes:'我希望明天出发。',is_user:true});const before=JSON.stringify(c);
    const result=recentSocialStory(c);assert.equal(result.rows.length,6);assert.equal(result.rows.at(-1).role,'user');
    assert.match(socialStoryPrompt(result),/两人刚拆了礼物。只有两人知道。/);
    assert.doesNotMatch(JSON.stringify(result),/REASONING_SECRET|HIDDEN_RECORD|正文 0/);assert.equal(JSON.stringify(c),before);
    c.chat[9].mes='已取消出发';assert.match(socialStoryPrompt(recentSocialStory(c)),/已取消出发/);
    c.chat.splice(9);assert.doesNotMatch(socialStoryPrompt(recentSocialStory(c)),/已取消出发|礼物/);
});

test('manual hidden/system floors stay out, current QQJ auto-hidden prose stays in',()=>{
    const c=context();const hidden=chatId=>({is_system:true,extra:{qianqianjieAutoHide:{schemaVersion:1,chatId}}});
    c.chat=[{mes:'MANUAL',is_system:true},{mes:'FLAG_HIDDEN',hidden:true},{mes:'WRONG_CHAT',...hidden('other')},{mes:'已发生的正文',...hidden('memory')},{mes:'SYSTEM',role:'system'},{mes:'PHONE',isPhoneMessage:true},{mes:'<thinking>UNFINISHED'}];
    assert.deepEqual(recentSocialStory(c).rows.map(row=>row.text),['已发生的正文']);
});

test('whole-floor budget reports omission instead of removing a private qualifier',()=>{
    const c=context();c.chat=[{mes:'x'.repeat(50000)+'只有本人知道'},{mes:'刚刚的短正文。只有本人知道。'}];
    const result=recentSocialStory(c);assert.equal(result.omitted,1);assert.equal(result.rows.length,1);assert.match(result.rows[0].text,/只有本人知道。$/);
    assert.ok(JSON.stringify(result.rows).length<=48000);assert.match(socialStoryPrompt(result),/因过长未附入/);
});

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
