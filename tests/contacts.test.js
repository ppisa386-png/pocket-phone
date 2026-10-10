import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { contactSources, validateContacts } from '../src/contacts.js';
import { normalizeSettings } from '../src/config.js';
import { createPhoneMemory } from '../src/memory.js';
import { createPhoneService } from '../src/phone.js';
import { buildApiContext } from '../src/api-context.js';

const quote='Alex gives Sam his number: +1 212 555 0123.';
const persona='Sam has a sister named Bea. Their close friend is Casey. Jordan is a coworker.';
const entry=(name,evidence,source='chat',relationship)=>({name,evidence,source,relationship,user_has_number:true,can_use_phone:true,number:null});
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

test('persona NPC call uses that person rather than pretending to be the selected character card',async()=>{
    const c={name1:'Sam',name2:'Alex',characterId:0,characters:[{name:'Alex',data:{description:'Alex private character description'}}],powerUserSettings:{persona_description:persona},chat:[]};
    const result=await buildApiContext(c,'Telephone task',{id:'name:bea',name:'Bea'},normalizeSettings().api);
    const content=JSON.stringify(result);assert.match(content,/Bea/);assert.ok(!content.includes('Alex private character description'));assert.match(content,/sister/);
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
