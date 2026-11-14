import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnostics } from '../src/diagnostics.js';

function fixture(extra={}) {
    const data=new Map(), storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
    const options={storage,version:'test',...extra};
    return {data,log:createDiagnostics(options),reload:()=>createDiagnostics(options)};
}
const failure = (text,extra={}) => Object.assign(Error('JSON 解析失败'),{
    diagnostic:'解析摘要',modelResponses:[{attempt:1,code:'MODEL_JSON_SYNTAX',text,...extra}],
});

test('copied evidence distinguishes literal escapes, real controls, whitespace and unicode quotes',()=>{
    const f=fixture();
    const raw='\ufeff{\n“name”:\t"line\\nnext\\\\path",\r\n"space":"\u00a0\u200b\u2028"}';
    f.log.add(failure(raw),'assets');
    const output=f.log.text();
    const representation=output.split('\n').at(-1);
    assert.equal(JSON.parse(representation),raw);
    assert.match(representation,/\\ufeff/);assert.match(representation,/\\n/);
    assert.match(representation,/\\\\n/);assert.match(representation,/\\u200b/);
    assert.equal(f.reload().text(),output);
});

test('reply samples and parser excerpts are redacted before storage; request and reasoning fields are excluded',()=>{
    const secret='known-"secret', f=fixture({getSecrets:()=>[secret]});
    f.log.add(failure(JSON.stringify({api_key:'unknown-secret',text:secret,url:'https://user:pass@a.example/v1?token=private-query'})+
        '<think>private reasoning</think><analysis>unfinished reasoning',{
        metadata:{model:'test',reasoning_content:'not collected',messages:['request prompt'],headers:{Authorization:'not collected'}},
        parser:{nativeMessage:'Bad '+secret,position:2,candidateStart:0,candidateCharacters:500},
    }),'calendar');
    const stored=[...f.data.values()].join('');
    assert.doesNotMatch(stored,/known-|unknown-secret|private-query|user:pass|private reasoning|unfinished reasoning|not collected|request prompt/);
    assert.match(f.log.text(),/已隐藏/);assert.match(f.log.text(),/脱敏：是/);
    assert.equal(f.reload().text(),f.log.text());
});

test('large replies retain labeled head and tail, survive reload unchanged and obey the total log bound',()=>{
    const f=fixture(), raw='HEAD'+ 'x'.repeat(20000)+'TAIL';
    f.log.add(failure(raw),'amazon');
    const entry=f.log.list()[0], sample=entry.modelResponses[0];
    assert.equal(sample.originalCharacters,raw.length);assert.equal(sample.truncated,true);
    assert.ok(sample.text.startsWith('HEAD'));assert.ok(sample.text.endsWith('TAIL'));
    assert.match(sample.text,/中段省略/);assert.match(f.log.text(),/非完整回复/);
    assert.equal(f.reload().text(),f.log.text(),'truncated samples must not be truncated again on reload');
    for(let i=0;i<100;i++)f.log.add(failure(raw),'amazon');
    assert.ok(f.log.list().length<100);assert.ok(f.log.list().length>1);
    assert.ok([...f.data.values()][0].length<=512000);
    assert.equal(f.reload().text(),f.log.text());
    f.log.clear();assert.equal(f.reload().text(),'');
});

test('samples are not lost behind long diagnostic summaries or a browser storage failure',()=>{
    const f=fixture(), error=failure('{bad:"LAST"}');
    error.diagnostic='d'.repeat(4000)+'END';
    f.log.add(error,'assets');
    assert.match(f.reload().text(),/END/);assert.match(f.reload().text(),/LAST/);
    const longest=failure('{bad:[]}');longest.message='m'.repeat(1500);longest.diagnostic='d'.repeat(4500);
    f.log.add(longest,'assets');assert.equal(f.reload().text(),f.log.text());
    const memory=createDiagnostics({storage:{getItem:()=>null,setItem:()=>{throw Error('quota');}}});
    memory.add(error,'assets');assert.equal(memory.persistent(),false);assert.match(memory.text(),/LAST/);
});
