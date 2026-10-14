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
