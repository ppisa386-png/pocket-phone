import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { latestMemory, readXMemory, xMemoryPrompt } from '../src/external-memory.js';
import { normalizeSettings } from '../src/config.js';
import { createPhoneMemory } from '../src/memory.js';
import { createPhoneService } from '../src/phone.js';
import { JOURNAL_KEY, messageSignatures, revisionsFor, appendChange, reconcileJournal, replayJournal } from '../src/journal.js';

const settings=()=>normalizeSettings({retries:0,proactiveEnabled:false});
const context=()=>({chat:[{mes:'Story'}],chatId:'test-chat',chatMetadata:{qianqianjie:{chatId:'qqj-chat'}}});
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
    assert.equal(reads,1);assert.equal(result.status,'ready');assert.equal(result.count,1);
    assert.match(result.text,/已亲眼见过礼物/);assert.match(result.text,/其他人并不知情/);
    assert.doesNotMatch(result.text,/Unrelated record 3"/);assert.doesNotMatch(result.text,/Unrelated record 99/);
    assert.match(xMemoryPrompt(result),/不代表完整记忆/);
});

test('X saved selection respects active chat, disabled source, invalidation and removed/future floors',()=>{
    const c={...context(),chat:[{},{}]};const valid=savedSnapshot([{messageIndex:0,summary:'Alex knows.'},{messageIndex:2,summary:'Deleted future.'}]);
    let current=valid,reads=0;const bridge={getSnapshot(){reads++;return current;}};
    assert.equal(readXMemory(c,{api:{memorySource:'none'}},{},bridge).status,'disabled');assert.equal(reads,0);
    assert.equal(readXMemory(c,settings(),{names:['Alex']},bridge).count,1);
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

test('A takes all available up to twenty whole summaries in chronological order, never calls prepared recall',()=>{
 for(const n of [0,5,15,25]){
  const c={...context(),chat:Array.from({length:n},(_,i)=>({mes:'floor '+i}))};
  const rows=c.chat.map((_,i)=>({messageIndex:i,summary:'summary '+i+' '+('x'.repeat(2000))})).reverse();
  const bridge={getPromptSnapshot:()=>assert.fail('old route'),getSnapshot:()=>savedSnapshot(rows)};
  const result=latestMemory(c,settings(),bridge);assert.equal(result.count,Math.min(n,20));
  assert.deepEqual(JSON.parse(result.text||'[]').map(f=>f.messageIndex),c.chat.map((_,i)=>i).slice(-20));
 }
});
test('unchanged summary is quarantined after editing its floor until the provider replaces it',()=>{
 const c={...context(),chat:[{mes:'before'}]},floor={messageIndex:0,summary:'old'},b={getSnapshot:()=>savedSnapshot([floor])};
 assert.equal(latestMemory(c,settings(),b).count,1);c.chat[0].mes='after';
 assert.equal(latestMemory(c,settings(),b).count,0);floor.summary='corrected';assert.equal(latestMemory(c,settings(),b).count,1);
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
    const f=fixture();globalThis.qqj_v3_public_bridge_v1={getSnapshot:()=>savedSnapshot([{messageIndex:0,summary:'Alex agreed to meet at the station'}])};
    try {
        await f.phone.scan();await f.phone.sendMessage('card:alex.png','Where are we meeting?');
        assert.equal(f.prompts.length,2);for(const prompt of f.prompts)assert.match(prompt,/agreed to meet at the station/);
        assert.ok(!JSON.stringify(f.c.chatMetadata[JOURNAL_KEY]).includes('Earlier they met in London'));
        globalThis.qqj_v3_public_bridge_v1={getSnapshot:()=>({status:'empty'})};
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
    const bridge={getSnapshot:()=>savedSnapshot([{messageIndex:0,summary:'Alex agreed to meet at the station'}])};
    assert.equal(latestMemory({...context(),chatId:'',getCurrentChatId:()=> 'test-chat'},settings(),bridge).status,'ready');
    assert.equal(latestMemory({...context(),getCurrentChatId:()=> 'active-other-chat'},settings(),bridge).status,'stale');
    assert.equal(latestMemory({...context(),getCurrentChatId:()=> ''},settings(),bridge).status,'ready');
});

for(const app of ['x','snapchat','whatsapp','wechat'])test(app+' generation skips prepared recall and unrelated recent summaries and never resends hidden AI floors',async()=>{
 const f=fixture(),old=globalThis.qqj_v3_public_bridge_v1;let preparedReads=0;
 try{
  f.c.chat=[];
  for(let i=0;i<7;i++){f.c.chat.push({mes:'AI_'+i+' '+(i===6?'x'.repeat(50000)+'END_FULL_TEXT':''),is_user:false,is_system:i%2===0,hidden:i===5});f.c.chat.push({mes:'USER_EXCLUDED_'+i,is_user:true});}
  globalThis.qqj_v3_public_bridge_v1={getPromptSnapshot(){preparedReads++;return prepared();},getSnapshot:()=>savedSnapshot([{messageIndex:0,summary:'Alex knows TOPIC_MATCH.'},{messageIndex:1,summary:'UNRELATED_RECENT_SUMMARY'}])};
  const result=await f.phone.appTask(async(view,current,request)=>request('TOPIC_MATCH',d=>d,current,null,{memoryQuery:{names:['Alex'],topic:'TOPIC_MATCH'},retries:0}),app);
  assert.equal(result.ok,true,result.error);assert.equal(preparedReads,0);const prompt=f.prompts.at(-1);
  assert.match(prompt,/TOPIC_MATCH/);assert.doesNotMatch(prompt,/AI_2|AI_6|END_FULL_TEXT/);
  assert.doesNotMatch(prompt,/USER_EXCLUDED|AI_0|AI_1|UNRELATED_RECENT_SUMMARY|agreed to meet at the station|Earlier they met in London/);
 }finally{globalThis.qqj_v3_public_bridge_v1=old;f.close();}
});
test('related summaries have a strict twenty-floor cap and no recent fallback',()=>{
 const c={...context(),chat:Array.from({length:50},()=>({}))};
 const floors=Array.from({length:50},(_,i)=>({messageIndex:i,summary:'Alex remembers event '+i}));
 const b={getSnapshot:()=>savedSnapshot(floors)};
 assert.equal(readXMemory(c,settings(),{names:['Alex']},b).count,20);
 assert.equal(readXMemory(c,settings(),{topic:'no_match_zzzz'},b).count,0);
});

test('task routing separates no-memory, chronological, and participant-specific reads',async()=>{
 const f=fixture(),original=globalThis.qqj_v3_public_bridge_v1;
 const names=['daily','contacts','assets','amazon','phone','messages','whatsapp','wechat','x'];
 let snapshots=0,actors=0,oldReads=0;
 globalThis.qqj_v3_public_bridge_v1={
   getPromptSnapshot(){oldReads++;throw Error('obsolete route');},
   getSnapshot(){snapshots++;return savedSnapshot([{messageIndex:0,summary:'Alex RECENT_RELEVANT'},{messageIndex:1,summary:'RECENT_UNRELATED'}]);},
   getPeopleSnapshot:()=>({status:'ready',identity:prepared().identity,people:{status:'ready',items:[{entityId:'alex',displayName:'Alex'}]}}),
   readContext:async()=>{actors++;return {status:'ready',identity:prepared().identity,actors:[{entityId:'alex',memoryText:'PERSON_ONLY'}]};}
 };
 try{
  for(const app of names){
   const social=['phone','messages','whatsapp','wechat','x'].includes(app),before=snapshots,actorBefore=actors;
   const result=await f.phone.appTask(async(_view,current,request)=>request('task',d=>d,current,social?{id:'name:alex',name:'Alex'}:null),app);
   assert.equal(result.ok,true,result.error);const prompt=f.prompts.at(-1);
   assert.equal(snapshots-before,app==='daily'?0:1,app);assert.equal(actors-actorBefore,social?1:0,app);
   assert.equal(prompt.includes('RECENT_RELEVANT'),app!=='daily');assert.equal(prompt.includes('RECENT_UNRELATED'),!social&&app!=='daily');
   assert.equal(prompt.includes('PERSON_ONLY'),social);assert.doesNotMatch(prompt,/Later that evening/);
  }
  const before=snapshots;for(const app of ['contacts','whatsapp','wechat']){
   const result=await f.phone.appTask(async(_view,current,request)=>request('opening',d=>d,current,null,{establishedImport:true}),app);
   assert.equal(result.ok,true,result.error);
  }
  assert.equal(before,snapshots);assert.equal(oldReads,0);
 }finally{globalThis.qqj_v3_public_bridge_v1=original;f.close();}
});
