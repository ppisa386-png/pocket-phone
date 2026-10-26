import test from 'node:test';
import assert from 'node:assert/strict';
import {findProactiveEvidence,proactiveSources} from '../src/proactive-evidence.js';
import {validateIncoming} from '../src/incoming.js';
import {normalizeSettings} from '../src/config.js';
test('current card and persona macros are expanded; evidence cannot invent a source or ignore phone access',()=>{
 const c={name1:'Sam',characters:[{name:'Alex',data:{scenario:'{{char}} calls {{user}} every evening.'}}],powerUserSettings:{persona_description:'Sam and Alex are partners.'}};
 const sources=proactiveSources(c,normalizeSettings({api:{memorySource:'none'}}),{characterId:0,name:'Alex',id:'alex'},{messages:{draft:{contactId:'alex',text:'Not yet sent',replyStatus:'queued'}}});
 assert.ok(findProactiveEvidence('Alex calls Sam every evening.',[{mes:'Now.'}],sources,'card:scenario'));
 assert.equal(findProactiveEvidence('Not yet sent',[],sources),null);assert.equal(findProactiveEvidence('invented scene',[],sources),null);
 assert.throws(()=>validateIncoming({status:'ringing',can_obtain_number:false,route:'known_number',evidence:sources[0].text,reason:'hello'},[{mes:'Now.'}],sources));
});

test('prepared memory may substantiate existing phone contact only for the current chat',()=>{
 const previous=globalThis.qqj_v3_public_bridge_v1;
 try{
  globalThis.qqj_v3_public_bridge_v1={getPromptSnapshot:()=>({status:'ready',identity:{hostChatId:'current'},recall:{text:'Alex and Sam routinely call each other.'}})};
  const c={chatId:'current',name1:'Sam',characters:[{name:'Alex'}]},participant={characterId:0,name:'Alex',id:'alex'};
  assert.ok(proactiveSources(c,normalizeSettings({}),participant,{}).some(s=>s.id==='memory'));
  c.chatId='other';assert.equal(proactiveSources(c,normalizeSettings({}),participant,{}).some(s=>s.id==='memory'),false);
 }finally{if(previous===undefined)delete globalThis.qqj_v3_public_bridge_v1;else globalThis.qqj_v3_public_bridge_v1=previous;}
});

test('old built-in incoming prompt upgrades while user edits remain intact',()=>{
 const old='只在剧情中有合理动机且角色有可用途径取得 user 号码时发起来电。必须核对正文依据，不能因为 user 知名就凭空知道号码，不能把 user 单方面知道角色号码当成双方交换。共友需要明确存在且确实能提供号码；公开渠道需要正文确认号码可被访问。不强行制造来电，不重复已在正文中完成的电话。';
 assert.match(normalizeSettings({prompts:{incoming:old}}).prompts.incoming,/分享.*适时联络/);
 assert.equal(normalizeSettings({prompts:{incoming:'我的自定义规则'}}).prompts.incoming,'我的自定义规则');
});
