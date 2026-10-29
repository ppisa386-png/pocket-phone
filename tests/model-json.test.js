import test from 'node:test';
import assert from 'node:assert/strict';
import {parseModelObject} from '../src/model-json.js';

test('one complete ledger in a hidden wrapper is preserved, not discarded',()=>{
 const value={recoveredAssets:[{sourceIndex:2,name:'礼服',amount:null,marketValue:1234.56,evidence:'对方付清款项，将礼服送给Sam。'}]};
 for(const raw of ['<!--'+JSON.stringify(value)+'-->','<!--durian-ledger: '+JSON.stringify(value)+' -->','<content><!--'+JSON.stringify(value)+'--></content>'])assert.deepEqual(parseModelObject(raw),value);
 assert.deepEqual(parseModelObject('<!--装饰说明--><!--'+JSON.stringify(value)+'-->'),value);
});

test('hidden ledgers cannot bypass ambiguity, reasoning isolation or business shape',()=>{
 const ledger='{"recoveredAssets":[]}';
 for(const raw of ['<!--'+ledger+'-->'+ledger,'<!--'+ledger+'--><!--'+ledger+'-->'])assert.throws(()=>parseModelObject(raw),e=>e.code==='MODEL_JSON_AMBIGUOUS');
 for(const raw of ['<think>'+ledger+'</think>','<!--durian-money:{"kind":"asset","name":"礼服"}-->','<!--说明和样例'+ledger+'-->','<!--{"unrelated":true}-->'])assert.throws(()=>parseModelObject(raw),e=>e.code==='MODEL_JSON_MISSING');
 assert.throws(()=>parseModelObject('<think>PRIVATE</think><!--PRIVATE-->没有账本'),e=>e.diagnostic.includes('隐藏注释数：1')&&e.diagnostic.includes('思考块数：1')&&!e.diagnostic.includes('PRIVATE'));
});

test('asset JSON wrapper handling preserves strings, nested objects and amounts exactly',()=>{
 const value={date:'2026-01-01',initial:{balance:'1234.56',holdings:[{name:'a } brace and "quote"',value:0}],jobs:[]}};
 for(const text of [JSON.stringify(value),'```json\n'+JSON.stringify(value)+'\n```','说明：<content>'+JSON.stringify(value)+'</content>','<thinking>{"discard":true}</thinking>\n'+JSON.stringify(value)])assert.deepEqual(parseModelObject(text),value);
});
test('asset parser rejects incomplete, competing and array results without leaking response contents',()=>{
 for(const text of ['[{}]','结果：[{}]','{"a":1} {"a":2}','{"initial":','{"a":1,}','<think>private content', 'not JSON']) {
  let failure;try{parseModelObject(text);}catch(e){failure=e;}
  assert.ok(failure);assert.match(failure.diagnostic,/返回字符数/);assert.ok(!failure.diagnostic.includes('private content'));
 }
});


test('presentation tags inside JSON strings are data, never removed or interpreted',()=>{
 const value={date:'2026-01-01',initial:{balance:100,holdings:[],jobs:[]},note:'literal <!--keep--> <think>keep</think> <script>keep</script> <analysis>unclosed'};
 for(const raw of [JSON.stringify(value),'说明：<content>'+JSON.stringify(value)+'</content>','<think>{"discard":true}</think>'+JSON.stringify(value)]) assert.deepEqual(parseModelObject(raw),value);
});

test('parser errors distinguish empty, syntax, truncation, competing and wrong-type responses',()=>{
 for(const [raw,code,reason] of [['','MODEL_JSON_EMPTY','没有返回文字'],['not JSON','MODEL_JSON_MISSING','未返回 JSON'],['{"balance":','MODEL_JSON_TRUNCATED','不完整'],['{"a":1,}','MODEL_JSON_SYNTAX','语法'],['{}{}','MODEL_JSON_AMBIGUOUS','多个'],['[]','MODEL_JSON_TYPE','单个 JSON'],['<think>secret','MODEL_JSON_REASONING','思考标签']]) {
  assert.throws(()=>parseModelObject(raw),e=>e.code===code&&e.message.includes(reason)&&e.diagnostic.includes(code)&&!e.diagnostic.includes('secret'));
 }
});
