import test from 'node:test';
import assert from 'node:assert/strict';
import {parseModelObject} from '../src/model-json.js';

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
