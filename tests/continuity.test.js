import test from 'node:test';
import assert from 'node:assert/strict';
import { createContinuityBridge, buildContinuityPrompt, resolveSpeaker, communicationSceneScope, CONTINUITY_KEY } from '../src/continuity.js';
import { JOURNAL_KEY, revisionsFor, messageSignatures, appendChange } from '../src/journal.js';
import { createPhoneMemory } from '../src/memory.js';
import { normalizeSettings } from '../src/config.js';
class Events {
    listeners = new Map();
    on(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
    makeFirst(type,fn) { this.listeners.set(type,[fn,...(this.listeners.get(type)||[])]); }
    removeListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== fn)); }
    async emit(type, ...args) { for (const fn of this.listeners.get(type) || []) await fn(...args); }
}
const set = (collection, key, value) => ({ collection, key, value });
async function fixture({ group = false, legacy = false, withMemory = false, beforeBridge = null } = {}) {
    const bus = new Events();
    const names = ['GENERATION_STARTED', 'GENERATION_ENDED', 'GENERATION_STOPPED', 'CHAT_CHANGED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'GROUP_MEMBER_DRAFTED', 'GROUP_WRAPPER_FINISHED'];
    if (!legacy) names.push('GENERATION_AFTER_COMMANDS'); names.push('CHAT_COMPLETION_PROMPT_READY','CHAT_COMPLETION_SETTINGS_READY');
    const prompts = {};
    const context = {
        name1: 'Sam', name2: 'Alex', chatId: 'story', characterId: 0,
        characters: [{ name: 'Alex', avatar: 'alex.png' }, { name: 'Bea', avatar: 'bea.png' }],
        groupId: group ? 'group1' : null, groups: [{ id: 'group1', members: ['alex.png', 'bea.png'] }],
        chat: [{ mes: 'You and Alex exchanged numbers. 两人谈起 Alex 和 Bea 之前短信里说的事，以及电话里的承诺。', name: 'Alex', is_user: false }],
        chatMetadata: {}, eventSource: bus, event_types: Object.fromEntries(names.map(n => [n, n])),
        saveMetadata: async () => {},
        setExtensionPrompt(key, value, position, depth, scan, role, filter) { prompts[key] = { value, position, depth, scan, role, filter }; },
    };
    const revisions = await revisionsFor(messageSignatures(context.chat));
    context.chatMetadata[JOURNAL_KEY] = appendChange(undefined, revisions, [
        set('contacts', 'card:alex.png', { id: 'card:alex.png', name: 'Alex', characterId: 99 }),
        set('contacts', 'card:bea.png', { id: 'card:bea.png', name: 'Bea', characterId: 0 }),
        set('messages', 'a', { id: 'a', contactId: 'card:alex.png', role: 'user', text: 'A_PRIVATE_MEETING', createdAt: 1 }),
        set('messages', 'b', { id: 'b', contactId: 'card:bea.png', role: 'assistant', text: 'B_PRIVATE_PLAN', createdAt: 2 }),
        set('calls', 'call', { id: 'call', contactId: 'card:alex.png', status: 'ended', createdAt: 3, turns: [{ role: 'assistant', text: 'A_CALL_PROMISE' }] }),
        set('calls', 'empty', { id: 'empty', contactId: 'card:alex.png', status: 'no_answer', createdAt: 4, turns: [] }),
    ]);
    const settings = normalizeSettings({});
    const errors = [];
    const memory = withMemory ? createPhoneMemory({ getContext: () => context }) : null;
    beforeBridge?.(bus);
    const bridge = createContinuityBridge({ getContext: () => context, getSettings: () => settings, onError: error => errors.push(error) });
    return { context, bus, prompts, settings, errors, bridge, memory,
        async generate(type = 'normal') { await bus.emit('GENERATION_STARTED', type); if (!legacy) await bus.emit('GENERATION_AFTER_COMMANDS', type); },
        close() { bridge.destroy(); memory?.destroy(); },
    };
}

test('foreground narrative receives user conversations with explicit participant boundaries', async () => {
    const f = await fixture({ withMemory: true });
    const before = JSON.stringify({ chat: f.context.chat, metadata: f.context.chatMetadata });
    await f.generate();
    const prompt = f.prompts[CONTINUITY_KEY];
    assert.match(prompt.value, /A_PRIVATE_MEETING/); assert.match(prompt.value, /A_CALL_PROMISE/);
    assert.match(prompt.value, /B_PRIVATE_PLAN/); assert.match(prompt.value, /其他人物不能自动获知/); assert.doesNotMatch(prompt.value,/no_answer|dialing/);
    assert.equal(prompt.position, 1); assert.equal(prompt.depth, 1); assert.equal(prompt.role, 0); assert.equal(prompt.scan, false);
    assert.equal(prompt.filter(), true);
    assert.equal(JSON.stringify({ chat: f.context.chat, metadata: f.context.chatMetadata }), before);
    assert.equal((await f.memory.read()).scope, null, 'ordinary writes remain blocked while main generation runs');
    await f.bus.emit('GENERATION_ENDED'); assert.equal(f.prompts[CONTINUITY_KEY].value, '');
    f.close();
});

test('quiet and impersonation requests clear previous narrative context', async () => {
    const f = await fixture(); await f.generate();
    await f.generate('quiet'); assert.equal(f.prompts[CONTINUITY_KEY].value, '');
    await f.generate('impersonate'); assert.equal(f.prompts[CONTINUITY_KEY].value, '');
    f.close();
});

test('group member identity changes cannot reuse another member\'s private context', async () => {
    const f = await fixture({ group: true }); await f.generate();
    const old = f.prompts[CONTINUITY_KEY];
    f.context.characterId = 1; f.context.name2 = 'Bea';
    assert.equal(old.filter(), false);
    await f.bus.emit('GROUP_MEMBER_DRAFTED', 1); await f.generate();
    assert.match(f.prompts[CONTINUITY_KEY].value, /B_PRIVATE_PLAN/);
    assert.match(f.prompts[CONTINUITY_KEY].value, /A_PRIVATE_MEETING/);
    f.context.characterId = undefined; await f.generate();
    assert.equal(f.prompts[CONTINUITY_KEY].value, '');
    f.close();
});

test('editing or deleting an acquisition floor removes invalid context without saving prose', async () => {
    const f = await fixture(); await f.generate();
    f.context.chat[0].mes = 'No phone number was given.'; await f.bus.emit('MESSAGE_EDITED'); await f.generate();
    assert.equal(f.prompts[CONTINUITY_KEY].value, '');
    assert.equal(f.context.chatMetadata[JOURNAL_KEY].events.length, 1, 'bridge is read-only; journal reconciliation owns persistence');
    f.context.chat.length = 0; await f.bus.emit('MESSAGE_DELETED'); await f.generate();
    assert.equal(f.prompts[CONTINUITY_KEY].value, '');
    f.close();
});

test('regenerate and swipe exclude effects of the answer being replaced', async () => {
    const f = await fixture();
    f.context.chat.push({ name: 'Alex', is_user: false, mes: 'Second answer' });
    f.context.chatMetadata[JOURNAL_KEY] = appendChange(f.context.chatMetadata[JOURNAL_KEY], await revisionsFor(messageSignatures(f.context.chat)), [set('messages', 'late', { contactId: 'card:alex.png', role: 'assistant', text: 'REPLACED_FLOOR_SECRET', createdAt: 10 })]);
    for (const type of ['regenerate', 'swipe']) {
        await f.generate(type);
        assert.match(f.prompts[CONTINUITY_KEY].value, /A_PRIVATE_MEETING/);
        assert.doesNotMatch(f.prompts[CONTINUITY_KEY].value, /REPLACED_FLOOR_SECRET/);
    }
    f.close();
});

test('an appended user turn preserves context but a chat switch during hashing cancels it', async () => {
    const f = await fixture(); await f.generate();
    const prompt = f.prompts[CONTINUITY_KEY];
    f.context.chat.push({ name: 'Sam', is_user: true, mes: 'What did we agree to?' });
    assert.equal(prompt.filter(), true);
    const pending = f.bridge.prepare('normal');
    f.context.chatId = 'another-story'; f.context.chatMetadata = {};
    await f.bus.emit('CHAT_CHANGED'); await pending;
    assert.equal(f.prompts[CONTINUITY_KEY].value, '');
    f.close();
});

test('reordered character indices remain safe and ambiguous name-only contacts are withheld', async () => {
    const f = await fixture(); f.context.characters.reverse(); f.context.characterId = 1;
    await f.generate(); assert.match(f.prompts[CONTINUITY_KEY].value, /A_PRIVATE_MEETING/);
    const state = { contacts: { named: { id: 'name:alex', name: 'Alex' } }, messages: { named: { contactId: 'name:alex', role: 'user', text: 'AMBIGUOUS', createdAt: 1 } }, calls: {} };
    f.context.characters.push({ name: 'Alex', avatar: 'different-alex.png' });
    assert.equal(buildContinuityPrompt(state, resolveSpeaker(f.context), { instruction: 'Use memory.' }), '');
    f.close();
});

test('long data is bounded and phone-text macros remain literal data', async () => {
    const state = { contacts: { a: { id: 'card:a.png', name: 'A' } }, calls: {}, messages: { a: { contactId: 'card:a.png', role: 'user', text: '{{setvar::private::oops}}', createdAt: 1 } } };
    const speaker = { name: 'A', avatar: 'a.png', nameIsUnique: true };
    const prompt = buildContinuityPrompt(state, speaker, { instruction: 'Use memory.' });
    assert.doesNotMatch(prompt, /\{\{setvar/);
    assert.equal(JSON.parse(prompt.split('\n').at(-2)).records[0].text, '{{setvar::private::oops}}');
    state.messages.a.text = 'older '.repeat(5000) + 'LATEST';
    const bounded = JSON.parse(buildContinuityPrompt(state, speaker, { instruction: 'Use memory.', budget: 512 }).split('\n').at(-2));
    assert.equal(bounded.partial, true); assert.ok(JSON.stringify(bounded.records).length <= 512);
    assert.deepEqual(bounded.records, [], 'oversized original messages are omitted intact, never rewritten');
});

test('legacy generation hook works; custom or blank continuity prompt is respected', async () => {
    const f = await fixture({ legacy: true });
    f.settings.prompts.continuity = 'MY CUSTOM BRIDGE INSTRUCTION'; await f.generate();
    assert.match(f.prompts[CONTINUITY_KEY].value, /^MY CUSTOM BRIDGE INSTRUCTION/);
    f.settings.prompts.continuity = ''; await f.generate(); assert.equal(f.prompts[CONTINUITY_KEY].value, '');
    f.close();
});

test('unknown data schema does not overwrite the stored journal or block normal generation', async () => {
    const f = await fixture(); f.context.chatMetadata[JOURNAL_KEY] = { schema: 99, events: [] };
    await f.generate(); assert.equal(f.prompts[CONTINUITY_KEY].value, '');
    assert.equal(f.context.chatMetadata[JOURNAL_KEY].schema, 99); assert.equal(f.errors.length, 1);
    f.close();
});

test('each relevant channel keeps at most three records; ordinary and anonymous dialogue remain while other people and private assets stay out',()=>{
 const state={contacts:{alex:{id:'card:alex.png',name:'Alex'}},messages:{},calls:{},snapchat:{profile:{alias:'Moon'},a:{id:'a',type:'account',name:'Alex',characterId:'card:alex.png',identityKnown:false}},x:{profile:{alias:'Moon'},a:{id:'a',type:'account',name:'Alex',characterId:'card:alex.png',identityKnown:false}},orders:{secret:'ORDER_SECRET'},assets:{secret:'ASSET_SECRET'}};
 for(let i=0;i<15;i++){
  state.messages['m'+i]={contactId:'card:alex.png',role:'user',text:'SMS '+i,createdAt:i};
  state.calls['c'+i]={contactId:'card:alex.png',status:'missed',turns:[],createdAt:i};
  state.snapchat['s'+i]={type:'message',accountId:'a',role:'user',text:'Snap casual '+i,createdAt:i};
  state.x['x'+i]={type:'message',accountId:'a',role:'user',text:'X casual '+i,createdAt:i};
 }
 state.messages.other={contactId:'card:bea.png',role:'user',text:'BEA_PRIVATE',createdAt:50};
 const prompt=buildContinuityPrompt(state,{avatar:'alex.png',name:'Alex',nameIsUnique:true},{instruction:'Remember',userName:'Sam',budget:50000}),records=JSON.parse(prompt.split('\n').at(-2)).records;
 for(const channel of ['短信','电话','Snapchat'])assert.equal(records.filter(r=>r.channel===channel).length,3);
 assert.doesNotMatch(prompt,/X casual|X 私信|ORDER_SECRET|ASSET_SECRET|BEA_PRIVATE/,'narrative continuity excludes all X DM records');
});


test('final outgoing request and earlier memory snapshot include exact history once even when the preset omits the extension slot', async()=>{
 let snapshot;
 const f=await fixture({beforeBridge:bus=>bus.on('CHAT_COMPLETION_PROMPT_READY',data=>{snapshot=structuredClone(data.chat);})});try{
  await f.generate();
  const data={chat:[{role:'system',content:'Host preset'},{role:'user',content:'Continue'}],dryRun:false};
  await f.bus.emit('CHAT_COMPLETION_PROMPT_READY',data);
  assert.match(JSON.stringify(snapshot),/A_PRIVATE_MEETING/);
  assert.match(JSON.stringify(snapshot),/B_PRIVATE_PLAN/);
  const final={type:'normal',messages:structuredClone(snapshot)};
  await f.bus.emit('CHAT_COMPLETION_SETTINGS_READY',final);
  await f.bus.emit('CHAT_COMPLETION_SETTINGS_READY',final);
  const wire=JSON.parse(JSON.stringify(final));
  assert.equal(wire.messages.filter(m=>m.content.includes('<durian-phone-history>')).length,1);
  assert.equal(wire.messages.at(-1).content,'Continue');
  final.messages=final.messages.filter(m=>!m.content.includes('<durian-phone-history>'));
  await f.bus.emit('CHAT_COMPLETION_SETTINGS_READY',final);
  assert.match(JSON.stringify(final),/A_CALL_PROMISE/,'final fallback repairs a removed slot');
  await f.generate('quiet');const quiet={chat:[],dryRun:false};await f.bus.emit('CHAT_COMPLETION_PROMPT_READY',quiet);assert.equal(quiet.chat.length,0);
  await f.generate();const dry={chat:[],dryRun:true};await f.bus.emit('CHAT_COMPLETION_PROMPT_READY',dry);assert.equal(dry.chat.length,0);
  await f.bus.emit('CHAT_CHANGED');const switched={type:'normal',messages:[]};await f.bus.emit('CHAT_COMPLETION_SETTINGS_READY',switched);assert.equal(switched.messages.length,0);
 }finally{f.close();}
});
test('three per conversation counts both sides and ordinary NPC messages do not need a matching current card',()=>{
 const state={contacts:{'name:a':{id:'name:a',name:'阿甲'},'name:b':{id:'name:b',name:'阿乙'}},messages:{},calls:{}};
 for(const id of ['a','b'])for(let n=0;n<14;n++)state.messages[id+n]={contactId:'name:'+id,role:n%2?'user':'assistant',text:id+n,createdAt:n};
 const text=buildContinuityPrompt(state,{name:'另一角色',nameIsUnique:true},{instruction:'记忆',allParticipants:true,budget:50000});
 const records=JSON.parse(text.split('\n').at(-2)).records;
 assert.equal(records.length,6);assert.equal(records.filter(r=>r.counterpart==='阿甲').length,3);
 assert.equal(records.filter(r=>r.speaker==='user').length,4);assert.ok(!records.some(r=>r.text==='a0'));
 assert.match(text,/不得编造 user 曾发过的消息/);assert.match(text,/剩余时间、已过时间与总时长/);
});

test('erased SMS clears prepared slot and is absent from next actual narrative payload',async()=>{
 const f=await fixture({withMemory:true});try{
  await f.memory.read();await f.generate();assert.match(f.prompts[CONTINUITY_KEY].value,/B_PRIVATE_PLAN/);
  // End generation so the user can make a local edit.
  await f.bus.emit('GENERATION_ENDED');
  await f.memory.eraseMessage(await f.memory.begin(),'b');
  assert.equal(f.prompts[CONTINUITY_KEY].value,'');
  await f.generate();const data={chat:[{role:'user',content:'Continue'}]};
  await f.bus.emit('CHAT_COMPLETION_PROMPT_READY',data);
  assert.ok(!JSON.stringify(data).includes('B_PRIVATE_PLAN'));
  assert.match(JSON.stringify(data),/A_PRIVATE_MEETING/);
 }finally{f.close();}
});

test('actual narrative payload expires SMS by story time before persistence and keeps phone UI history',async()=>{
 const f=await fixture({withMemory:true});try{
  await f.memory.read();
  await f.memory.commit(await f.memory.begin(),[
   set('smsContext','a',{category:'A',anchor:{date:'2026-10-01',time:'12:00'},expired:false}),
   set('smsContext','b',{category:'B',anchor:{date:'2026-10-01',time:'12:00'},expired:false})
  ]);
  f.context.chat.push({mes:'2026-10-03 12:00\n他们谈起短信和电话里的事。',name:'Alex',is_user:false});
  await f.generate();
  const payload={chat:[{role:'user',content:'Continue'}]};
  await f.bus.emit('CHAT_COMPLETION_PROMPT_READY',payload);
  assert.doesNotMatch(JSON.stringify(payload),/A_PRIVATE_MEETING/);
  assert.match(JSON.stringify(payload),/B_PRIVATE_PLAN/);
  await f.bus.emit('GENERATION_ENDED');await f.memory.read();
  assert.equal((await f.memory.read()).state.commContext['sms:a'].expired,true);
  f.context.chat.push({mes:'2026-10-04 12:01\n他们继续讨论电话里的约定。',name:'Alex',is_user:false});
  await f.generate();
  const next={type:'normal',messages:[{role:'user',content:'Continue'}]};
  await f.bus.emit('CHAT_COMPLETION_SETTINGS_READY',next);
  assert.doesNotMatch(JSON.stringify(next),/A_PRIVATE_MEETING|B_PRIVATE_PLAN/);
  assert.match(JSON.stringify(next),/A_CALL_PROMISE/);
  await f.bus.emit('GENERATION_ENDED');
  const state=(await f.memory.read()).state;
  assert.equal(state.commContext['sms:b'].expired,true);
  assert.equal(state.messages.a.text,'A_PRIVATE_MEETING');assert.equal(state.messages.b.text,'B_PRIVATE_PLAN');
 }finally{f.close();}
});

test('unrelated scenes stay free of old messages, but an actual topic restores exact memory with the right story age',async()=>{
 const f=await fixture();try{
  const c=f.context;c.chat=[{mes:'2026-10-30 21:15\n短信送达。'}];
  const rev=await revisionsFor(messageSignatures(c.chat));
  const record={id:'s',contactId:'card:alex.png',role:'assistant',text:'昨晚那件事，我知道了。',createdAt:1};
  c.chatMetadata[JOURNAL_KEY]=appendChange(undefined,rev,[set('contacts',record.contactId,{id:record.contactId,name:'Alex'}),set('messages','s',record)]);
  const saved=JSON.stringify(c.chatMetadata);
  for(const mes of ['2026-10-31 09:00\n两人照常去上课。','他们讨论了作业。']){
   c.chat.push({mes});await f.generate();
   assert.equal(f.prompts[CONTINUITY_KEY].value,'','unshown messages cannot force an unrelated scene to display them');
  }
  c.chat.push({mes:'Sam 这才谈起短信里说过的话，Alex 已经听明白了。'});await f.generate();
  let prompt=f.prompts[CONTINUITY_KEY].value;
  assert.match(prompt,/不能让人物再次首次得知/);
  assert.match(prompt,/后来可以回忆、讨论/);
  let [sms]=JSON.parse(prompt.split('\n').at(-2)).records;
  assert.equal(sms.text,record.text);assert.equal(sms.storyDaysAgo,1);
  assert.equal(sms.storyTime.date,'2026-10-30');assert.equal(sms.storyTime.time,'21:15');
  c.chat.push({mes:'2026-11-01 08:00\n他们又继续上课。'});await f.generate();
  assert.equal(f.prompts[CONTINUITY_KEY].value,'','history disappears from the next unrelated prose turn');
  c.chat.push({mes:'他们再次谈起短信里的约定。'});await f.generate();
  prompt=f.prompts[CONTINUITY_KEY].value;
  [sms]=JSON.parse(prompt.split('\n').at(-2)).records;
  assert.equal(sms.text,record.text);assert.equal(sms.storyDaysAgo,2,'same original fact, never a new message');
  assert.equal(JSON.stringify(c.chatMetadata),saved,'selective context does not consume, delete or mark phone history');
 }finally{f.close();}
});

test('communication scene cues require genuine plot relevance and never treat picking up a phone as reading',()=>{
 const state={contacts:{a:{id:'card:a',name:'Alex'},b:{id:'card:b',name:'Bea'}},whatsapp:{a:{type:'account',name:'Alex'},b:{type:'account',name:'Bea'}}};
 const speaker={name:'Alex'};
 assert.equal(communicationSceneScope(state,speaker,[{mes:'她把手机放在口袋里。'}]),null);
 assert.equal(communicationSceneScope(state,speaker,[{is_user:true,mes:'拿起手机看了看时间，继续走路。'}]),null);
 assert.equal(communicationSceneScope(state,speaker,[{mes:'手机又亮起未读红点。'}]),null);
 const topical=communicationSceneScope(state,speaker,[{is_user:true,mes:'Bea 问起昨天 WhatsApp 里的那段聊天。'}]);
 assert.equal(topical.readingPhone,false);assert.deepEqual(topical.relevantPeople,['Bea']);assert.deepEqual(topical.relevantPlatforms,['whatsapp']);
 const viewing=communicationSceneScope(state,speaker,[{is_user:true,mes:'Sam 打开 WhatsApp 查看和 Bea 的聊天记录。'}]);
 assert.equal(viewing.readingPhone,true);assert.deepEqual(viewing.relevantPeople,['Bea']);
 const all=communicationSceneScope(state,speaker,[{is_user:true,mes:'查看微信里的未读消息。'}]);
 assert.equal(all.readingPhone,true);assert.equal(all.relevantPeople,null);assert.deepEqual(all.relevantPlatforms,['wechat']);
 assert.equal(communicationSceneScope(state,speaker,[{is_user:true,mes:'继续正常上课。'}]),null);
});

test('a story only injects the named conversation and platform, not an unrelated NPC inbox',async()=>{
 const f=await fixture();try{
  const c=f.context;
  c.chat=[{mes:'Sam 和 Alex 走在街上。'}];
  const revisions=await revisionsFor(messageSignatures(c.chat));
  c.chatMetadata[JOURNAL_KEY]=appendChange(undefined,revisions,[
   set('contacts','card:alex.png',{id:'card:alex.png',name:'Alex'}),
   set('contacts','card:bea.png',{id:'card:bea.png',name:'Bea'}),
   set('messages','a',{id:'a',contactId:'card:alex.png',role:'user',text:'A_SMS_PRIVATE',createdAt:1}),
   set('messages','b',{id:'b',contactId:'card:bea.png',role:'assistant',text:'B_SMS_PRIVATE',createdAt:2}),
   set('whatsapp','alex',{id:'alex',type:'account',name:'Alex',characterId:'card:alex.png',identityKnown:true}),
   set('whatsapp','wa',{id:'wa',type:'message',accountId:'alex',role:'assistant',text:'A_WHATSAPP_PRIVATE',read:true,createdAt:3}),
  ]);
  await f.generate();assert.equal(f.prompts[CONTINUITY_KEY].value,'');
  c.chat.push({mes:'Bea 问起之前的短信里说了什么。',is_user:true});
  await f.generate();let text=f.prompts[CONTINUITY_KEY].value;
  assert.match(text,/B_SMS_PRIVATE/);assert.doesNotMatch(text,/A_SMS_PRIVATE|A_WHATSAPP_PRIVATE/);
  c.chat.push({mes:'他们转而谈起当天的演出安排。',is_user:false});
  await f.generate();assert.equal(f.prompts[CONTINUITY_KEY].value,'');
  c.chat.push({mes:'Sam 打开 WhatsApp 查看和 Alex 的聊天记录。',is_user:true});
  await f.generate();text=f.prompts[CONTINUITY_KEY].value;
  assert.match(text,/A_WHATSAPP_PRIVATE/);assert.doesNotMatch(text,/B_SMS_PRIVATE|A_SMS_PRIVATE/);
 }finally{f.close();}
});

test('missing dates never use wall time; valid stored SMS dates and sidecar dates are preserved',()=>{
 const message={id:'s',contactId:'name:A',role:'assistant',text:'hello',createdAt:Date.now()};
 const state={messages:{s:message},commContext:{},contacts:{'name:A':{id:'name:A',name:'A'}},calls:{}};
 const get=now=>JSON.parse(buildContinuityPrompt(state,{name:'A',nameIsUnique:true},{instruction:'参考',currentStoryTime:now}).split('\n').at(-2)).records[0];
 assert.equal(get({date:'2026-11-01'}).storyTime,null);assert.equal(get({date:'2026-11-01'}).storyDaysAgo,undefined);
 state.commContext['sms:s']={anchor:{date:'2026-10-30',time:''}};
 assert.equal(get(null).storyTime.date,'2026-10-30');assert.equal(get(null).storyDaysAgo,undefined);
 message.storyTime={date:'2026-10-29',time:'20:10'};
 assert.equal(get({date:'2026-11-01'}).storyDaysAgo,3);
});

test('queued draft anchors to the floor it was actually sent, not the draft or later edits',async()=>{
 const f=await fixture();try{
  const c=f.context;c.chat=['2026-10-29 10:00','2026-10-30 21:00','2026-10-31 08:00\n他们谈起短信里说过的事。'].map(mes=>({mes}));
  const rev=await revisionsFor(messageSignatures(c.chat));
  const m={id:'s',contactId:'card:alex.png',role:'user',text:'你好。',storyTime:{date:'2026-10-29',time:'10:00'}};
  let j=appendChange(undefined,rev.slice(0,1),[set('contacts',m.contactId,{id:m.contactId,name:'Alex'}),set('messages','s',{...m,replyStatus:'queued'})]);
  j=appendChange(j,rev.slice(0,2),[set('messages','s',{...m,replyStatus:'sent'})]);
  c.chatMetadata[JOURNAL_KEY]=appendChange(j,rev,[set('messages','s',{...m,read:true,replyStatus:'sent'})]);
  await f.generate();const [sms]=JSON.parse(f.prompts[CONTINUITY_KEY].value.split('\n').at(-2)).records;
  assert.equal(sms.storyTime.date,'2026-10-30');assert.equal(sms.storyDaysAgo,1);
 }finally{f.close();}
});

test('old built-in continuity text migrates while custom and blank instructions are preserved',()=>{
 const old='以下是 user 手机中已经发生的通信，作为有效剧情事实供后续正文参考。各人物只知道本人参与或有正当途径获知的内容，不能自动知道 user 与其他人的私聊；匿名社交仍须保留身份边界。忠实保留原话、双方身份及顺序，不得篡改或编造 user 既往发言。承接最新通信后的剧情与时间，不重演旧消息、不强制提起。叙事语言仍遵循酒馆预设。';
 assert.match(normalizeSettings({prompts:{continuity:old}}).prompts.continuity,/只在当前情节/);
 for(const text of ['我的衔接规则',''])assert.equal(normalizeSettings({prompts:{continuity:text}}).prompts.continuity,text);
});

test('default continuity preface is deduplicated without removing custom text or record metadata',()=>{
 const settings=normalizeSettings({}),state={contacts:{a:{id:'a',name:'Alex'}},messages:{m:{id:'m',contactId:'a',role:'assistant',text:'UNIQUE_MESSAGE',createdAt:1}},calls:{}};
 const build=instruction=>buildContinuityPrompt(state,{name:'Alex'},{instruction,allParticipants:true});
 const prompt=build(settings.prompts.continuity);
 assert.match(prompt,/叙事语言遵循酒馆预设/);assert.match(prompt,/匿名账号只知道网名/);assert.match(prompt,/shown 与 read 是两个独立状态/);
 assert.equal(prompt.split('UNIQUE_MESSAGE').length-1,1);
 const custom='自定义衔接：特别保留未完成的约定。';assert.ok(build(custom).startsWith(custom+'\n'));
 assert.deepEqual(JSON.parse(prompt.split('\n').at(-2)),JSON.parse(build(custom).split('\n').at(-2)),'only redundant instruction text changes, not the records');
});
