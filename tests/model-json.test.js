import test from 'node:test';
import assert from 'node:assert/strict';
import {parseModelObject} from '../src/model-json.js';
import {parseXObject} from '../src/x.js';
import {parseAssetResponse} from '../src/assets.js';

test('X tolerates trailing delimiters only, preserving strings and all scalar values',()=>{
 const raw='{"accounts":[{"name":"Alex","handle":"alex","bio":"Literal ,} and ,] and \\"quote\\"","has_account":true,"followers":12,},],}';
 const value=parseXObject(raw);
 assert.equal(value.accounts[0].bio,'Literal ,} and ,] and "quote"');assert.equal(value.accounts[0].followers,12);
 assert.deepEqual(parseXObject('<think>{"wrong":1}</think><content>'+raw+'</content>'),value);
 assert.throws(()=>parseModelObject(raw),e=>e.code==='MODEL_JSON_SYNTAX','financial parser stays strict');
 for(const invalid of ['{"accounts":[,]}','{"accounts":[1,,]}','{"accounts":,}','{accounts:[]}',"{'accounts':[]}",'{}{}','{"accounts":[','{"bio":"Unescaped "quote"",}'])assert.throws(()=>parseXObject(invalid));
});

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


test('X converts only a complete recognized task list to its named root object',()=>{
 const posts=[{accountId:'known',text:'公园里的下午'}];
 const accounts=[{name:'Alex',handle:'alex',has_account:true}];
 const comments=[{accountId:'known',text:'非常好！'}];
 assert.deepEqual(parseXObject('<think>Need data.</think>\\n'+JSON.stringify(posts),{arrayKey:'posts'}),{posts});
 assert.deepEqual(parseXObject(JSON.stringify(accounts),{arrayKey:'accounts'}),{accounts});
 assert.deepEqual(parseXObject(JSON.stringify(comments),{arrayKey:'comments'}),{comments});
 assert.deepEqual(parseXObject('[]',{arrayKey:'posts'}),{posts:[]});
 assert.throws(()=>parseModelObject(JSON.stringify(posts)),e=>e.code==='MODEL_JSON_TYPE');
 assert.throws(()=>parseXObject(JSON.stringify(posts)),e=>e.code==='MODEL_JSON_TYPE');
 assert.throws(()=>parseXObject(JSON.stringify(posts),{arrayKey:'accounts'}),e=>e.code==='MODEL_JSON_TYPE');
 assert.throws(()=>parseXObject('[{"text":"no author"}]',{arrayKey:'posts'}),e=>e.code==='MODEL_JSON_TYPE');
 assert.throws(()=>parseXObject('[{"accountId":"known","text":"ok"}][{"accountId":"known","text":"second"}]',{arrayKey:'posts'}),e=>e.code==='MODEL_JSON_AMBIGUOUS');
 assert.throws(()=>parseXObject('<think>[{"accountId":"known","text":"hidden"}]</think>',{arrayKey:'posts'}),e=>e.code==='MODEL_JSON_MISSING');
});

test('asset-specific safe delimiter tolerance keeps amount data exact and never repairs missing fields',()=>{
 const data={residence:{region:'US',currency:'USD'},initial:{balance:'1580.25',holdings:[],jobs:[]}};
 assert.deepEqual(parseAssetResponse(JSON.stringify(data)),data);
 assert.deepEqual(parseAssetResponse('说明：\\n' + JSON.stringify(data)),data);
 assert.deepEqual(parseAssetResponse('{"initial":{"balance":1580.25,"holdings":[],"jobs":[],},}'),
     {initial:{balance:1580.25,holdings:[],jobs:[]}});
 for(const raw of ["{'initial':{'balance':125}}",'{"initial":{"balance":125',
     '{"initial":{"balance":1000}} {"initial":{"balance":2000}}',
     '{"initial":{"balance": not-a-number }}']){
  assert.throws(()=>parseAssetResponse(raw),error=>error.code?.startsWith('MODEL_JSON_'));
 }
 assert.throws(()=>parseModelObject('{"initial":{"balance":1000,}}'),error=>error.code==='MODEL_JSON_SYNTAX',
     'other finance consumers keep strict parsing unless they opted in');
});
