import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readPreparedMemory, preparedMemoryPrompt, readXMemory, xMemoryPrompt } from '../src/external-memory.js';
import { normalizeSettings } from '../src/config.js';
import { createPhoneMemory } from '../src/memory.js';
import { createPhoneService } from '../src/phone.js';
import { JOURNAL_KEY, messageSignatures, revisionsFor, appendChange, reconcileJournal, replayJournal } from '../src/journal.js';

const settings=()=>normalizeSettings({retries:0,proactiveEnabled:false});
const context=()=>({chatId:'test-chat',chatMetadata:{qianqianjie:{chatId:'qqj-chat'}}});
const prepared=()=>({status:'ready',identity:{hostChatId:'test-chat',qqjChatId:'qqj-chat'},recall:{text:'Sam and Alex agreed to meet at the station.'},prequel:{text:'Earlier they met in London.'}});

const savedSnapshot=floors=>({status:'ready',identity:prepared().identity,memory:{status:'ready',floors}});
test('X selects saved whole floor summaries even when last recall is empty; no profile/state dump or model recall',()=>{
    const c={...context(),chat:Array.from({length:100},()=>({mes:'Story'}))};
    const floors=Array.from({length:100},(_,i)=>({messageIndex:i,assistantSeq:i,summary:'Unrelated record '+i}));
    floors[2].summary='索菲娅已亲眼见过礼物并获知出行计划；其他人并不知情。';
    const snapshot=savedSnapshot(floors);
    Object.defineProperty(snapshot,'people',{get(){throw Error('must not read profiles');}});
    Object.defineProperty(snapshot,'cse',{get(){throw Error('must not read private state');}});
    let reads=0;
    const bridge={getSnapshot(){reads++;return snapshot;},readMemory(){throw Error('must not initiate recall');}};
    const result=readXMemory(c,settings(),{names:['索菲娅·费尔南德斯'],topic:''},bridge);
    assert.equal(reads,1);assert.equal(result.status,'ready');assert.equal(result.count,21);
    assert.match(result.text,/已亲眼见过礼物/);assert.match(result.text,/其他人并不知情/);
    assert.doesNotMatch(result.text,/Unrelated record 3"/);assert.match(result.text,/Unrelated record 99/);
    assert.match(xMemoryPrompt(result),/不代表完整记忆/);
});

test('X saved selection respects active chat, disabled source, invalidation and removed/future floors',()=>{
    const c={...context(),chat:[{},{}]};const valid=savedSnapshot([{messageIndex:0,summary:'Alex knows.'},{messageIndex:2,summary:'Deleted future.'}]);
    let current=valid,reads=0;const bridge={getSnapshot(){reads++;return current;}};
    assert.equal(readXMemory(c,{api:{memorySource:'none'}},{},bridge).status,'disabled');assert.equal(reads,0);
    assert.equal(readXMemory(c,settings(),{},bridge).count,1);
    assert.equal(readXMemory({...c,getCurrentChatId:()=> 'other'},settings(),{},bridge).status,'stale');
    current={...valid,identity:{...valid.identity,qqjChatId:'other'}};assert.equal(readXMemory(c,settings(),{},bridge).text,'');
    current={...valid,memory:{status:'not-ready',floors:valid.memory.floors}};assert.equal(readXMemory(c,settings(),{},bridge).text,'');
    current=savedSnapshot([]);assert.equal(readXMemory(c,settings(),{},bridge).text,'','never fall back to cached records');
    assert.equal(readXMemory(c,settings(),{},{}).status,'missing');
});

test('X saved memory budgets whole summaries without truncating a privacy qualifier',()=>{
    const c={...context(),chat:Array.from({length:60},()=>({}))};
    const floors=Array.from({length:60},(_,i)=>({messageIndex:i,summary:'Alex '+String(i)+' '+('a'.repeat(4000))+' ONLY PRIVATE'}));
    const result=readXMemory(c,settings(),{names:['Alex']},{getSnapshot:()=>savedSnapshot(floors)});
    assert.ok(result.text.length<=32000);assert.ok(result.count>0&&result.count<40);
    for(const row of JSON.parse(result.text))assert.ok(row.summary.endsWith('ONLY PRIVATE'));
});

test('X Chinese topic can retrieve a saved floor outside the recent window without a name match',()=>{
    const c={...context(),chat:Array.from({length:50},()=>({}))};
    const floors=Array.from({length:50},(_,i)=>({messageIndex:i,summary:'Unrelated '+i}));
    floors[0].summary='朋友已经参观画展并见到了画家。';
    const result=readXMemory(c,settings(),{topic:'今年画展的进展'},{getSnapshot:()=>savedSnapshot(floors)});
    assert.match(result.text,/朋友已经参观画展/);
});

test('QQJ integration reads only prepared prompt text and preserves private boundaries as supplied',()=>{
    let reads=0;
    const forbidden=()=>{throw Error('must not read private storage or run a model');};
    const bridge={getPromptSnapshot(){reads++;return prepared();},getSnapshot:forbidden,readMemory:forbidden};
    const result=readPreparedMemory(context(),settings(),bridge);
    assert.equal(reads,1);assert.equal(result.status,'ready');assert.match(result.text,/station/);assert.match(result.text,/London/);
    assert.match(preparedMemoryPrompt(result),/知情边界/);
});

test('disabled, missing, unloaded, stale and wrong-chat sources never reuse another memory',()=>{
    assert.equal(readPreparedMemory(context(),{api:{memorySource:'none'}},{getPromptSnapshot(){throw Error('should not read');}}).text,'');
    assert.equal(readPreparedMemory(context(),settings(),null).status,'missing');
    for(const value of [{status:'empty'},{status:'disabled'},{...prepared(),identity:{hostChatId:'another',qqjChatId:'qqj-chat'}},{...prepared(),identity:{hostChatId:'test-chat',qqjChatId:'another'}}]) {
        assert.equal(readPreparedMemory(context(),settings(),{getPromptSnapshot:()=>value}).text,'');
    }
    const bridge={getPromptSnapshot:()=>prepared()};assert.equal(readPreparedMemory(context(),settings(),bridge).status,'ready');
    bridge.getPromptSnapshot=()=>({status:'empty'});
    assert.equal(readPreparedMemory(context(),settings(),bridge).text,'','no cached fallback after source invalidation');
    assert.equal(readPreparedMemory(context(),settings(),{getPromptSnapshot(){throw Error('secret');}}).message.includes('secret'),false);
});

test('oversize memory is explicitly skipped instead of silently dropping privacy labels',()=>{
    const result=readPreparedMemory(context(),settings(),{getPromptSnapshot:()=>({...prepared(),recall:{text:'x'.repeat(80001)}})});
    assert.equal(result.status,'oversize');assert.equal(result.text,'');
});

function fixture() {
    const bus=new EventEmitter();
    const c={...context(),name1:'Sam',name2:'Alex',characterId:0,characters:[{name:'Alex',avatar:'alex.png'}],chat:[{mes:'Alex gives Sam his number: +1 212 555 0123.',name:'Alex',is_user:false},{mes:'Later that evening.',name:'Alex',is_user:false}],onlineStatus:'connected',saveMetadata:async()=>{},eventSource:bus,event_types:Object.fromEntries(['MESSAGE_DELETED','MESSAGE_EDITED','CHAT_CHANGED','GENERATION_STARTED','GENERATION_ENDED'].map(n=>[n,n]))};
    const memory=createPhoneMemory({getContext:()=>c}); const s=settings(); const prompts=[];
    c.generateQuietPrompt=async options=>{prompts.push(options.quietPrompt); return options.quietPrompt.includes('"contacts"')?JSON.stringify({contacts:[{name:'Alex',number:'+1 212 555 0123',user_has_number:true,evidence:c.chat[0].mes}]}):'{"status":"reply","text":"Meet you there."}';};
    const phone=createPhoneService({memory,getContext:()=>c,getSettings:()=>s});
    return {c,bus,memory,phone,prompts,s,close(){phone.destroy();memory.destroy();}};
}

test('host-mode phone tasks receive prepared memory and do not persist its text in the journal',async()=>{
    const f=fixture();globalThis.qqj_v3_public_bridge_v1={getPromptSnapshot:()=>prepared()};
    try {
        await f.phone.scan();await f.phone.sendMessage('card:alex.png','Where are we meeting?');
        assert.equal(f.prompts.length,2);for(const prompt of f.prompts)assert.match(prompt,/agreed to meet at the station/);
        assert.ok(!JSON.stringify(f.c.chatMetadata[JOURNAL_KEY]).includes('Earlier they met in London'));
        globalThis.qqj_v3_public_bridge_v1={getPromptSnapshot:()=>({status:'empty'})};
        await f.phone.sendMessage('card:alex.png','Are you there?');assert.ok(!f.prompts.at(-1).includes('Earlier they met in London'));
    } finally {delete globalThis.qqj_v3_public_bridge_v1;f.close();}
});

test('QQJ hiding old floors preserves phone history; deleting the source still rolls it back',async()=>{
    const f=fixture();try {
        await f.phone.scan();await f.phone.sendMessage('card:alex.png','Hi');
        f.c.chat[0].extra={qianqianjieAutoHide:{schemaVersion:1,chatId:'qqj-chat'}};f.c.chat[0].is_system=true;
        f.bus.emit('MESSAGE_EDITED');await f.memory.read();
        assert.equal(Object.keys(f.phone.snapshot().contacts).length,1);assert.equal(Object.keys(f.phone.snapshot().messages).length,2);
        f.c.chat[0].is_system=false;delete f.c.chat[0].extra.qianqianjieAutoHide;await f.memory.read();
        assert.equal(Object.keys(f.phone.snapshot().messages).length,2,'unhide is also non-destructive');
        f.c.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();
        assert.equal(Object.keys(f.phone.snapshot().messages).length,0);assert.equal(Object.keys(f.phone.snapshot().contacts).length,1);
        f.c.chat[0].mes='Alex refuses to give a number.';f.bus.emit('MESSAGE_EDITED');await f.memory.read();
        assert.equal(Object.keys(f.phone.snapshot().contacts).length,0);
    } finally {f.close();}
});

test('v0.9 hidden-floor journals migrate only when the full legacy narrative still matches',async()=>{
    const chat=[{mes:'A phone exchange.',is_user:false,is_system:true,extra:{qianqianjieAutoHide:{schemaVersion:1,chatId:'qqj-chat'}}},{mes:'Later.',is_user:false}];
    const legacy=await revisionsFor(messageSignatures(chat,true)); const canonical=await revisionsFor(messageSignatures(chat));
    const raw=appendChange(undefined,legacy,[{collection:'messages',key:'m',value:{text:'Saved old text'}}]);delete raw.events[0].source.visibilityNormalized;
    const migrated=reconcileJournal(raw,canonical,legacy);assert.equal(migrated.removed,0);assert.equal(migrated.migrated,true);assert.equal(replayJournal(migrated.journal).messages.m.text,'Saved old text');
    chat[0].mes='Edited actual narrative';const newCanonical=await revisionsFor(messageSignatures(chat));const newLegacy=await revisionsFor(messageSignatures(chat,true));
    assert.equal(reconcileJournal(raw,newCanonical,newLegacy).removed,1);
});

test('prepared memory follows the active host chat ID and only falls back when it is empty',()=>{
    const bridge={getPromptSnapshot:()=>prepared()};
    assert.equal(readPreparedMemory({...context(),chatId:'',getCurrentChatId:()=> 'test-chat'},settings(),bridge).status,'ready');
    assert.equal(readPreparedMemory({...context(),getCurrentChatId:()=> 'active-other-chat'},settings(),bridge).status,'stale');
    assert.equal(readPreparedMemory({...context(),getCurrentChatId:()=> ''},settings(),bridge).status,'ready');
});
