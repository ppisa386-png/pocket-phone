import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { contactSources, validateContacts, establishedSources, establishedReferences, establishedContactPrompt, validateEstablishedContacts } from '../src/contacts.js';
import { normalizeSettings } from '../src/config.js';
import { createPhoneMemory } from '../src/memory.js';
import { createPhoneService } from '../src/phone.js';

const quote='Alex gives Sam his number: +1 212 555 0123.';
const persona='Sam has a sister named Bea. Their close friend is Casey. Jordan is a coworker.';
const entry=(name,evidence,source='chat',relationship)=>({name,evidence,source,relationship,user_has_number:true,can_use_phone:true,number:null});

test('established contact rejection explains fields, source and evidence without exposing personal text',()=>{
    const sources=[{source:'persona',text:'Sam has a sister named Bea.'}];
    const valid={name:'Bea',established:true,relationship:'sister',source:'persona',evidence:sources[0].text};
    const contacts=[{}, {...valid,source:'invented'}, {...valid,evidence:'rewritten private biography'}, {...valid,name:'Unknown'}, valid];
    const rejected=[];
    const found=validateEstablishedContacts({contacts},[{}],{name1:'Sam',characters:[]},sources,[],(i,why)=>rejected.push([i,why]));
    assert.equal(found.length,1);assert.equal(rejected.length,4);
    assert.deepEqual(rejected.map(r=>r[0]),[1,2,3,4]);
    assert.match(rejected[0][1],/字段/);assert.match(rejected[1][1],/source/);assert.match(rejected[2][1],/原文/);assert.match(rejected[3][1],/aliases/);
    assert.doesNotMatch(JSON.stringify(rejected),/Bea|Sam|private biography|Unknown/);
});
function fixture() {
    const bus=new EventEmitter();const context={chatId:'A',name1:'Sam',name2:'Alex',characterId:0,characters:[{name:'Alex',avatar:'alex.png'}],powerUserSettings:{persona_description:persona},chat:[{mes:quote,name:'Alex',is_user:false},{mes:'Later that day.',name:'Alex',is_user:false}],chatMetadata:{},saveMetadata:async()=>{},onlineStatus:'connected',eventSource:bus,event_types:Object.fromEntries(['MESSAGE_RECEIVED','MESSAGE_DELETED','CHAT_CHANGED','GENERATION_STARTED','GENERATION_ENDED'].map(k=>[k,k]))};
    let requests=0,response=()=>({contacts:[entry('Alex',quote),entry('Bea','Sam has a sister named Bea.','persona','family'),entry('Casey','Their close friend is Casey.','persona','friend')]});const prompts=[];
    context.generateQuietPrompt=async options=>{requests++;prompts.push(options.quietPrompt);return JSON.stringify(await response(options));};
    const settings=normalizeSettings({retries:0,proactiveEnabled:false});const memory=createPhoneMemory({getContext:()=>context});const phone=createPhoneService({memory,getContext:()=>context,getSettings:()=>settings});
    return {context,bus,settings,memory,phone,prompts,requests:()=>requests,reply:fn=>response=fn,close(){phone.destroy();memory.destroy();}};
}

test('opening phone, SMS, and changing narrative never scans; each button action does',async()=>{
    const f=fixture();try{
        await f.phone.open();await f.phone.openMessages();assert.equal(f.requests(),0);
        f.context.chat.push({mes:'A new scene.',name:'Alex'});f.bus.emit('MESSAGE_RECEIVED');await f.memory.read();
        await f.phone.open();await f.phone.openMessages();assert.equal(f.requests(),0);assert.equal(Object.keys(f.phone.snapshot().contacts).length,0);
        const added=await f.phone.scan();assert.equal(f.requests(),1);assert.deepEqual(added.value,{added:3,updated:0});
        assert.match(f.phone.snapshot().contactStatus,/已新增 3/);
        await f.phone.openMessages();assert.equal(f.requests(),1);assert.equal(Object.keys(f.phone.snapshot().contacts).length,3);
        const again=await f.phone.scan();assert.equal(f.requests(),2);assert.deepEqual(again.value,{added:0,updated:0});assert.equal(Object.keys(f.phone.snapshot().contacts).length,3);assert.match(f.phone.snapshot().contactStatus,/未找到新的/);
    }finally{f.close();}
});

test('persona relatives and friends can be added without number exchange or invented digits',()=>{
    const f=fixture();try{
        const data={contacts:[entry('Bea','Sam has a sister named Bea.','persona','family'),entry('Casey','Their close friend is Casey.','persona','friend'),entry('Jordan','Jordan is a coworker.','persona','coworker'),entry('Invented','Invented is a sister.','persona','family'),{...entry('Bea','Sam has a sister named Bea.','persona','family'),number:'1234567'}]};
        const contacts=validateContacts(data,f.context.chat,f.context);assert.deepEqual(contacts.map(c=>c.name),['Bea','Casey']);assert.ok(contacts.every(c=>c.number===null && c.sourceIndex===1 && c.sourceKind==='persona'));
    }finally{f.close();}
});

test('manual source list excludes hidden/system messages and does not authorize mere requests',()=>{
    const c={name1:'Sam',name2:'Alex',powerUserSettings:{persona_description:''}};
    const chat=[{mes:quote,is_system:true},{mes:'Hidden exchange with Bea.',hidden:true},{mes:'Hidden exchange with Casey.',is_hidden:true},{mes:'Sam asks for a number, Alex refuses.'}];
    const sources=contactSources(chat,c);assert.equal(sources.chat.length,1);
    const contacts=validateContacts({contacts:[entry('Alex',quote),{...entry('Alex',chat[3].mes),user_has_number:false}]},chat,c,sources);assert.equal(contacts.length,0);
});

test('contact additions roll back by narrative source or persona-addition floor and never populate social accounts',async()=>{
    const f=fixture();try{
        await f.phone.scan();f.context.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();
        assert.deepEqual(Object.values(f.phone.snapshot().contacts).map(c=>c.name),['Alex']);
        assert.deepEqual((await f.memory.read()).state.snapchat,{});assert.deepEqual((await f.memory.read()).state.x,{});
        f.context.chat[0].mes='Alex refuses to share a number.';await f.memory.read();assert.equal(Object.keys(f.phone.snapshot().contacts).length,0);
    }finally{f.close();}
});

test('changing persona during scan discards the pending result',async()=>{
    const f=fixture();try{
        let finish,started;const ready=new Promise(r=>started=r);f.reply(()=>{started();return new Promise(r=>finish=r);});
        const pending=f.phone.scan();await ready;f.context.powerUserSettings.persona_description='A different persona.';
        finish({contacts:[entry('Bea','Sam has a sister named Bea.','persona','family')]});await pending;
        assert.equal(Object.keys(f.phone.snapshot().contacts).length,0);
    }finally{f.close();}
});

test('persona NPC call names its actual recipient in the shared host task',async()=>{
    const f=fixture();try{
        await f.phone.scan();f.reply(()=>({status:'answered',text:'Hi from Bea'}));
        await f.phone.dial('name:bea');assert.match(f.prompts.at(-1),/当前通话对象：.*Bea/);
    }finally{f.close();}
});

test('delivered but unwritten temporary landline uses location name and stays separate from target',()=>{
 const quote='他把纸递给你。This is a classified landline number connected directly to his current holding sector. 你的视线落在那串数字上，十五位国际拨号代码加上内部分机。';
 const context={name1:'Sam',name2:'Alex',characters:[{name:'Alex',avatar:'alex.png'}]};
 const row={name:'Alex',contact_kind:'location',endpoint_kind:'landline',endpoint_name:'羁押区座机',target_name:'Alex',source:'chat',user_has_number:true,can_use_phone:true,number:null,evidence:quote};
 const result=validateContacts({contacts:[row]},[{mes:quote}],context);assert.equal(result.length,1);assert.equal(result[0].name,'羁押区座机');assert.equal(result[0].id,'location:羁押区座机');assert.equal(result[0].characterId,null);assert.equal(result[0].supportsSMS,false);assert.equal(result[0].number,null);
 assert.equal(validateContacts({contacts:[{...row,endpoint_name:'Alex'}]},[{mes:quote}],context).length,0);
 assert.equal(validateContacts({contacts:[{...row,number:'123456789012345'}]},[{mes:quote}],context).length,0);
 const exact='The officer hands you the holding sector landline: +1 212 555 0100 ext 42.';
 assert.equal(validateContacts({contacts:[{...row,evidence:exact,number:'+1 212 555 0100 ext 42'}]},[{mes:exact}],context)[0].number,'+1 212 555 0100 ext 42');
});

test('persona contacts require an explicit availability decision; negative decisions never add',()=>{
 const f=fixture();try{
 const bea=entry('Bea','Sam has a sister named Bea.','persona','family');
 assert.equal(validateContacts({contacts:[{...bea,can_use_phone:false}]},f.context.chat,f.context).length,0);
 assert.equal(validateContacts({contacts:[{...bea,can_use_phone:undefined}]},f.context.chat,f.context).length,0);
 assert.equal(validateContacts({contacts:[{...entry('Alex',quote),can_use_phone:false}]},f.context.chat,f.context).length,0);
 }finally{f.close();}
});

test('manual scan preserves existing contacts even if model returns an obsolete removal review',async()=>{
 const f=fixture();try{
 await f.phone.scan();const id='name:bea';assert.ok(f.phone.snapshot().contacts[id]);
 const status='Bea has been an uncommunicative zombie for many years and cannot operate a telephone.';
 f.context.chat.push({mes:status,name:'Alex'});await f.memory.read();
 f.reply(()=>({contacts:[],reviews:[{id,can_use_phone:false,evidence:'A made-up status with no source'}]}));await f.phone.scan();assert.ok(f.phone.snapshot().contacts[id]);
 f.reply(()=>({contacts:[],reviews:[{id,can_use_phone:false,evidence:status}]}));const reviewed=await f.phone.scan();assert.deepEqual(reviewed.value,{added:0,updated:0});assert.ok(f.phone.snapshot().contacts[id]);assert.ok(f.phone.snapshot().contacts['card:alex.png']);
 f.context.chat.pop();f.bus.emit('MESSAGE_DELETED');await f.memory.read();assert.ok(f.phone.snapshot().contacts[id]);
 }finally{f.close();}
});

test('landline can be dialed by location; it never sends an SMS or exposes a fake personal identity',async()=>{
 const f=fixture();try{
 const q='Sam receives the holding sector landline number on a note.';f.context.chat.push({mes:q,name:'Alex'});
 f.reply(()=>({contacts:[{...entry('Holding sector',q),contact_kind:'location',endpoint_kind:'landline',endpoint_name:'Holding sector',target_name:'Alex'}]}));await f.phone.scan();
 const id='location:holding sector';assert.ok(f.phone.snapshot().contacts[id]);const before=f.requests();await f.phone.sendMessage(id,'Hello');assert.equal(f.requests(),before);assert.match(f.phone.snapshot().error,/不支持短信/);
 f.reply(options=>{assert.match(options.quietPrompt,/不是目标人物的私人手机/);assert.match(options.quietPrompt,/实际值守人员/);return {status:'answered',text:'Holding sector, who are you calling?'};});await f.phone.dial(id);assert.equal(f.phone.snapshot().calls[f.phone.snapshot().activeCallId].name,'Holding sector');
 }finally{f.close();}
});

test('status materials support lore-based availability without becoming a number source',()=>{
 const context={name1:'Sam',characterId:0,characters:[{name:'Bea',data:{description:'Bea is a zombie who cannot use phones.'}}],powerUserSettings:{persona_description:'Sam has a sister named Bea.'}};
 const sources=contactSources([{mes:'Later.'}],context);assert.match(sources.status[0].text,/cannot use phones/);
 assert.equal(validateContacts({contacts:[{...entry('Bea',sources.status[0].text),can_use_phone:true}]},[{mes:'Later.'}],context,sources).length,0);
});

test('partial-name retrieval retains adjacent handoff and accepts cross-floor private satellite evidence',()=>{
 const owner='It is Leon S. Kennedy’s private satellite phone number.（这是里昂·S·肯尼迪的私人卫星电话号码。）';
 const handoff='你打开收纳盒，里面的黑色卡片上只打印了一串由特殊区号开头的数字。';
 const chat=[{mes:'Unrelated cooking.'},{mes:'Another unrelated day.'},{mes:owner},{mes:handoff},{mes:'Elsewhere.'}];
 const context={name1:'Sam',characters:[{name:'Leon S. Kennedy',avatar:'leon.png'}]};
 const sources=contactSources(chat,context,'里昂');assert.equal(sources.chat.length,3);assert.ok(!JSON.stringify(sources).includes('Unrelated cooking'));
 const found=validateContacts({contacts:[{name:'里昂·S·肯尼迪',aliases:['Leon S. Kennedy'],source:'chat',contact_kind:'person',can_use_phone:true,user_has_number:true,evidence:[owner.replace('’',"'"),handoff]}]},chat,context,sources);
 assert.equal(found.length,1);assert.equal(found[0].id,'card:leon.png');assert.equal(found[0].number,null);assert.equal(found[0].sourceIndex,3);
 assert.equal(validateContacts({contacts:[{...entry('Other',owner),aliases:[]}]},chat,context,sources).length,0);
 assert.equal(validateContacts({contacts:[{...entry('里昂',owner),evidence:[owner,'Invented handoff evidence']} ]},chat,context,sources).length,0);
});


test('one-click settings contacts include hostile relationships without phone qualification and preserve existing records',async()=>{
 const f=fixture();try{
 f.context.powerUserSettings.persona_description='Sam has a sister named Bea. Morgan is Sam’s lifelong enemy. Taylor is a passerby Sam met once.';
 const row=(name,evidence,relationship)=>({name,evidence,relationship,source:'persona',established:true,incidental:false,number:null});
 f.reply(()=>({contacts:[row('Bea','Sam has a sister named Bea.','sister'),{...row('Morgan','Morgan is Sam’s lifelong enemy.','enemy'),can_use_phone:false,user_has_number:false},{...row('Taylor','Taylor is a passerby Sam met once.','passerby'),incidental:true}]}));
 const result=await f.phone.addEstablishedContacts();assert.equal(result.ok,true);assert.deepEqual(result.value,{added:2});assert.deepEqual(Object.values(f.phone.snapshot().contacts).map(c=>c.name),['Bea','Morgan']);assert.equal(f.requests(),1);
 assert.match(f.prompts[0],/不要进行号码是否交换/);assert.match(f.prompts[0],/正文开始后才认识/);
 const before=structuredClone(f.phone.snapshot().contacts);await f.phone.addEstablishedContacts();assert.deepEqual(f.phone.snapshot().contacts,before);await f.phone.openMessages();assert.deepEqual(f.phone.snapshot().contacts,before);
 assert.deepEqual((await f.memory.read()).state.snapchat,{});assert.deepEqual((await f.memory.read()).state.x,{});
 f.context.chat.pop();await f.memory.read();assert.equal(Object.keys(f.phone.snapshot().contacts).length,0);
 }finally{f.close();}
});

test('one-click sources use active setup only, reject narrative-only or invented people and support embedded settings',()=>{
 const f=fixture();try{
 f.context.characters[0].data={description:'Alex and Sam have been rivals since school.',character_book:{entries:[{enabled:true,content:'Robin is Sam’s father.'},{enabled:false,content:'Hidden is Sam’s mother.'}]}};
 f.context.characters.push({name:'Unrelated',description:'Other is Sam’s uncle.'});
 const sources=establishedSources(f.context);assert.ok(!JSON.stringify(sources).includes('Other is'));assert.ok(!JSON.stringify(sources).includes('Hidden is'));assert.ok(!JSON.stringify(sources).includes(quote));
 const rows=[{name:'Alex',source:'card:0:description',evidence:'Alex and Sam have been rivals since school.',relationship:'rival'},{name:'Robin',source:'world:0:0',evidence:'Robin is Sam’s father.',relationship:'father'},{name:'New',source:'chat',evidence:'New met Sam today.',relationship:'friend'},{name:'Fake',source:'persona',evidence:'Fake is Sam’s mother.',relationship:'mother'}].map(r=>({...r,established:true,incidental:false,number:'12345678'}));
 const contacts=validateEstablishedContacts({contacts:rows},f.context.chat,f.context,sources);assert.deepEqual(contacts.map(c=>c.name),['Alex','Robin']);assert.equal(contacts[0].id,'card:alex.png');assert.ok(contacts.every(c=>c.number===null));
 }finally{f.close();}
});

test('changing setup while bulk contact request is pending discards the result',async()=>{
 const f=fixture();try{
 let finish,started;const ready=new Promise(r=>started=r);f.reply(()=>{started();return new Promise(r=>finish=r);});
 const pending=f.phone.addEstablishedContacts();await ready;f.context.powerUserSettings.persona_description='Sam lives alone.';
 finish({contacts:[{name:'Bea',source:'persona',evidence:'Sam has a sister named Bea.',relationship:'sister',established:true}]});await pending;assert.equal(Object.keys(f.phone.snapshot().contacts).length,0);
 }finally{f.close();}
});


test('bilingual settings names prefer established Chinese and update old IDs without duplicating contacts',async()=>{
 const f=fixture();try{
 f.context.powerUserSettings.persona_description='Morgan is Sam’s lifelong enemy. 摩根是 Sam 的死对头。';
 const row={name:'Morgan',relationship:'enemy',established:true,incidental:false,source:'persona',evidence:'Morgan is Sam’s lifelong enemy.',number:null};
 f.reply(()=>({contacts:[row]}));await f.phone.addEstablishedContacts();const old=Object.values(f.phone.snapshot().contacts)[0];
 f.reply(()=>({contacts:[{...row,name:'摩根',aliases:['Morgan']},{...row,aliases:['摩根']}]}));
 await f.phone.addEstablishedContacts();const contacts=Object.values(f.phone.snapshot().contacts);assert.equal(contacts.length,1);assert.equal(contacts[0].id,old.id);assert.equal(contacts[0].name,'摩根');assert.ok(contacts[0].aliases.includes('Morgan'));assert.match(f.prompts.at(-1),/所有 App 共用/);assert.match(f.prompts.at(-1),/优先采用人物设定/);
 }finally{f.close();}
});

test('bulk full family names survive short-name source preference and upgrade existing IDs in one request',async()=>{
 const f=fixture();try{
  f.context.name1='艾米·沃克';f.context.powerUserSettings.persona_description='艾米·沃克来自沃克家族。父亲名为彼得，母亲名为海伦。';
  const row=(name,aliases=[])=>({name,aliases,source:'persona',evidence:f.context.powerUserSettings.persona_description,established:true,relationship:'父母',incidental:false});
  f.reply(()=>({contacts:[row('彼得'),row('海伦')]}));await f.phone.addEstablishedContacts();
  const ids=Object.keys(f.phone.snapshot().contacts);let before=f.requests();
  f.reply(()=>({contacts:[row('彼得·沃克',['彼得']),row('海伦·沃克',['海伦'])]}));
  assert.equal((await f.phone.addEstablishedContacts()).ok,true);assert.equal(f.requests(),before+1);
  assert.deepEqual(Object.keys(f.phone.snapshot().contacts),ids);
  assert.deepEqual(Object.values(f.phone.snapshot().contacts).map(c=>c.name),['彼得·沃克','海伦·沃克']);
  f.reply(()=>({contacts:[row('彼得'),row('海伦')]}));await f.phone.addEstablishedContacts();
  assert.deepEqual(Object.values(f.phone.snapshot().contacts).map(c=>c.name),['彼得·沃克','海伦·沃克']);
  assert.match(f.prompts.at(-1),/婚后姓/);assert.match(f.prompts.at(-1),/确实无法可靠推理才保留名或外号/);
  f.settings.retries=15;f.reply(()=>{throw Error('offline');});before=f.requests();
  assert.equal((await f.phone.addEstablishedContacts()).ok,false);assert.equal(f.requests(),before+1);
 }finally{f.close();}
});

test('numbered setup references accept five translated contacts without model-copied quotations',()=>{
 const sources=[{source:'persona',text:'Bea is Sam’s sister.\nRobin is Sam’s father.\nMorgan is Sam’s rival.\nCasey is Sam’s friend.\nJordan is Sam’s coworker.'}];
 const names=['贝娅','罗宾','摩根','凯西','乔丹'],originals=['Bea','Robin','Morgan','Casey','Jordan'];
 const rows=names.map((name,i)=>({name,source_name:originals[i],relationship:'既有关系',established:true,evidence_refs:['S1.P'+(i+1)],evidence:'模型翻译或改写了原文',number:'12345678'}));
 const found=validateEstablishedContacts({contacts:rows},[{}],{name1:'Sam',characters:[]},sources);
 assert.deepEqual(found.map(c=>c.name),names);assert.equal(found.length,5);
 for(const [i,c] of found.entries()){
  assert.equal(c.evidence,sources[0].text.split('\n')[i]);assert.ok(c.aliases.includes(originals[i]));assert.equal(c.number,null);
 }
});

test('reference lookup rejects invented IDs, wrong original names, incidental people and missing relations',()=>{
 const sources=[{source:'persona',text:'Bea is Sam’s sister.'}],context={name1:'Sam',characters:[]};
 const row={name:'贝娅',source_name:'Bea',relationship:'sister',established:true,evidence_refs:['S1.P1'],source:'persona',evidence:sources[0].text};
 const rejected=[];
 const rows=[{...row,evidence_refs:['chat:0']},{...row,evidence_refs:[]},{...row,evidence_refs:'S1.P1'},
  {...row,evidence_refs:['S2.P1']},{...row,source_name:'Invented'},{...row,incidental:true},{...row,relationship:''},
  {...row,name:'虚构人物',source_name:'',aliases:[]},{...row,evidence_refs:Array(7).fill('S1.P1')},{...row,source_name:'---'}];
 assert.deepEqual(validateEstablishedContacts({contacts:rows},[{}],context,sources,[],(i,reason)=>rejected.push(reason)),[]);
 assert.equal(rejected.length,rows.length);assert.match(rejected[0],/编号/);assert.match(rejected[4],/source_name/);
});

test('setup references support names and relations across passages while retaining original evidence',()=>{
 const sources=[{source:'persona',text:'Family\nRobin\nSam’s father, phone +1 212 555 0199.'},{source:'card:0:description',text:'Robin grew up in this town.'}];
 const refs=establishedReferences(sources);
 assert.equal(refs[1].text,'Robin');assert.equal(refs[3].source,'card:0:description');
 const row={name:'罗宾',source_name:'Robin',relationship:'father',established:true,evidence_refs:['S1.P2','S1.P3','S2.P1'],number:'+1 212 555 0199'};
 const found=validateEstablishedContacts({contacts:[row]},[{}],{name1:'Sam',characters:[]},sources);
 assert.equal(found.length,1);assert.equal(found[0].number,row.number);
 assert.equal(found[0].evidence,'Robin\nSam’s father, phone +1 212 555 0199.\nRobin grew up in this town.');
 const long=[{source:'persona',text:'x'.repeat(1700)}];assert.equal(establishedReferences(long).map(p=>p.text).join(''),long[0].text);
 assert.ok(establishedReferences(long).every(p=>p.text.length<=800));
 const prompt=establishedContactPrompt('rules',{name1:'Sam'},sources,[]);
 assert.match(prompt,/evidence_refs/);assert.match(prompt,/source_name/);assert.match(prompt,/S2.P1/);
 assert.doesNotMatch(prompt,/evidence 仍逐字引用/);
});

test('reference-based bulk add persists translated identity once and rolls back with its source floor',async()=>{
 const f=fixture();try{
  f.context.powerUserSettings.persona_description='Bea is Sam’s sister.';
  f.reply(()=>({contacts:[{name:'贝娅',source_name:'Bea',relationship:'sister',established:true,evidence_refs:['S1.P1']}]}));
  const before=f.requests();assert.equal((await f.phone.addEstablishedContacts()).ok,true);assert.equal(f.requests(),before+1);
  assert.equal(Object.values(f.phone.snapshot().contacts)[0].evidence,'Bea is Sam’s sister.');
  await f.phone.addEstablishedContacts();assert.equal(Object.keys(f.phone.snapshot().contacts).length,1);
  f.context.chat.pop();await f.memory.read();assert.equal(Object.keys(f.phone.snapshot().contacts).length,0);
 }finally{f.close();}
});

test('reference IDs cannot authorize a late result after setup changes',async()=>{
 const f=fixture();try{
  f.context.powerUserSettings.persona_description='Bea is Sam’s sister.';
  let finish,started;const ready=new Promise(r=>started=r);f.reply(()=>{started();return new Promise(r=>finish=r);});
  const pending=f.phone.addEstablishedContacts();await ready;
  f.context.powerUserSettings.persona_description='Unknown is Sam’s coworker.';
  finish({contacts:[{name:'贝娅',source_name:'Bea',relationship:'sister',established:true,evidence_refs:['S1.P1']}]});
  await pending;assert.equal(Object.keys(f.phone.snapshot().contacts).length,0);
 }finally{f.close();}
});
