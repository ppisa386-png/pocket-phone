import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const {chromium}=createRequire(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/')('playwright');
const fixture=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="extensions_settings"></div><script>
const saved=JSON.parse(localStorage.getItem('x-test')||'null');window.calls=0;window.result={initialFollowers:50};
const handlers={};const ctx={chatId:'x-audience',name1:'Sam',characterId:0,characters:[{name:'Alex',avatar:'alex.png',description:Array.from({length:9},(_,i)=>'Local '+i+' is a band member.').join(' ')}],mainApi:'openai',onlineStatus:'connected',extensionSettings:{},saveSettingsDebounced(){},
chat:[{mes:'2026-10-18 00:05',is_user:false}],chatMetadata:saved||{},saveMetadata:async()=>localStorage.setItem('x-test',JSON.stringify(ctx.chatMetadata)),
event_types:{APP_READY:'APP_READY'},eventSource:{on(n,f){if(n==='APP_READY')queueMicrotask(f);else(handlers[n]||=[]).push(f);},removeListener(){}},
setExtensionPrompt(){},generateQuietPrompt:async o=>{window.calls++;window.lastPrompt=o.quietPrompt;
if(window.publicData){
 const r=window.publicData;
 if(o.quietPrompt.includes('当前任务：X 广场'))return JSON.stringify({posts:[{name:'Walker',handle:'walker',text:'Park report',publicBasis:{access:'background',summary:'Public park',involvesCharacters:false}},...Array.from({length:9},(_,i)=>({name:'Walker '+i,handle:'walker_'+i,text:'Local park update '+i,publicBasis:{access:'background',summary:'Public park',involvesCharacters:false}}))]});
 if(o.quietPrompt.includes('趋势评估资料'))return JSON.stringify({topics:[{title:'Public project discussion',summary:'Local news',scope:'Local',sourcePostIds:[r.id]},...Array.from({length:7},(_,i)=>({title:'World topic '+i,summary:'Public life',scope:'Local',sourcePostIds:[]}))],evaluations:[{postId:r.id,eligible:true,reason:'public interest'}]});
 if(o.quietPrompt.includes('逐条独立估计'))return JSON.stringify({stats:[{postId:r.id,likes:100,reposts:20,replies:0,gained:25,lost:5}]});
}
return typeof window.result==='string'?window.result:'<think>Plan</think><content>'+JSON.stringify(window.result)+'</content>';}};
window.SillyTavern={getContext:()=>ctx};</script><script type="module" src="/index.js"></script></body></html>`;
const server=createServer(async(req,res)=>{try{
 const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(process.env.CJK_QA_FONT?fixture.replace('</head>','<style>@font-face{font-family:"Microsoft YaHei";src:url(/qa-font);unicode-range:U+2E80-9FFF,U+F900-FAFF}</style></head>'):fixture);return;}
 if(pathname==='/qa-font'&&process.env.CJK_QA_FONT){res.setHeader('Content-Type','font/woff2');res.end(await readFile(process.env.CJK_QA_FONT));return;}
 const path=resolve(root,'.'+pathname);if(!path.startsWith(root+sep)){res.writeHead(403).end();return;}
 res.setHeader('Content-Type',extname(path)==='.js'?'text/javascript; charset=utf-8':extname(path)==='.css'?'text/css':'text/plain');res.end(await readFile(path));
}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-gpu']});
const errors=[],external=[];
try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),p=await ctx.newPage();
 p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',r=>{if(r.request().url().startsWith(origin))return r.continue();external.push(r.request().url());return r.abort();});
 await p.goto(origin);await p.locator('.pp-launcher').tap();await p.locator('[data-app="x"]').tap();
 const longPress=async(locator)=>{await locator.dispatchEvent('pointerdown',{pointerType:'touch',pointerId:11,isPrimary:true,bubbles:true,cancelable:true});await p.waitForTimeout(600);await locator.dispatchEvent('pointerup',{pointerType:'touch',pointerId:11,isPrimary:true,bubbles:true,cancelable:true});await p.locator('.pp-press-bubble').waitFor();};
 await p.locator('[data-x-action="profile"][aria-label="个人主页"]').tap();
 assert.equal(await p.locator('[data-x-followers]').innerText(),'—');
 await p.locator('[data-x-action="reset-followers"]').tap();
 await p.getByText('已还原初始粉丝',{exact:true}).waitFor();
 assert.equal(await p.locator('[data-x-followers]').innerText(),'50');
 await p.locator('[data-x-action="tab"][data-x-id="home"]').tap();
 await p.locator('[data-x-field="post"]').fill('My public project');
 await p.locator('[data-x-form="post"] button').tap();
 await p.getByText('My public project',{exact:true}).waitFor();
 const postId=await p.locator('[data-x-post]').first().getAttribute('data-x-post');
 await p.evaluate(id=>{window.publicData={id};window.result={posts:[{name:'Alex',handle:'alex',has_account:true,authorKind:'npc',text:'A campus concert.（校园音乐会。）'},...Array.from({length:9},(_,i)=>({name:'Local '+i,handle:'local_'+i,text:'Local public update '+i,has_account:true,authorKind:'npc',npcEvidence:'Local '+i+' is a band member.'}))]};},postId);
 const homeButton=p.locator('[data-x-action="refresh"]');
 assert.equal(await homeButton.getAttribute('aria-label'),'刷新首页动态与粉丝');
 assert.equal(await p.locator('[data-x-action="refresh-square"],[data-x-action="refresh-trends"]').count(),0);
 await homeButton.tap();
 await p.getByText('A campus concert.（校园音乐会。）',{exact:true}).waitFor();
 assert.equal(await p.locator('[data-x-post]').count(),11);
 assert.equal(await p.evaluate(()=>window.calls),3,'home refresh does not call square or trends');
 await p.locator('[data-x-action="profile"][aria-label="个人主页"]').tap();
 assert.equal(await p.locator('[data-x-followers]').innerText(),'70');
 await p.locator('[data-x-action="tab"][data-x-id="search"]').tap();
 assert.equal(await p.locator('[data-x-action="refresh"]').count(),0);
 assert.equal(await p.locator('[data-x-action="refresh-square"]').count(),0);
 await p.locator('[data-x-action="refresh-trends"]').tap();
 await p.getByText('Public project discussion',{exact:true}).waitFor();
 assert.equal(await p.evaluate(()=>window.calls),4);
 await p.locator('[data-x-action="tab"][data-x-id="square"]').tap();
 assert.equal(await p.locator('[data-x-action="refresh"]').count(),0);
 assert.equal(await p.locator('[data-x-action="refresh-trends"]').count(),0);
 await p.locator('[data-x-action="refresh-square"]').tap();
 await p.getByText('Park report',{exact:true}).waitFor();
 assert.equal(await p.locator('[data-x-post]').count(),10,'square has 10 distinct public posts');
 assert.equal(await p.evaluate(()=>window.calls),5);
 await p.locator('[data-x-action="tab"][data-x-id="search"]').tap();
 await p.getByText('Public project discussion',{exact:true}).waitFor();
 await p.locator('[data-x-action="tab"][data-x-id="home"]').tap();
 await p.getByText('A campus concert.（校园音乐会。）',{exact:true}).waitFor();
 assert.ok(await p.locator('[data-x-action="refresh"]').isDisabled());
 await p.locator('[data-x-action="profile"][aria-label="个人主页"]').tap();
 assert.equal(await p.locator('[data-x-followers]').innerText(),'70','square and trends do not alter followers');
 for(const width of [320,390]){
   await p.setViewportSize({width,height:844});
   assert.ok(await p.locator('.pp-x-body').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'X body overflows at '+width+'px');
 }
 await p.reload();await p.locator('.pp-launcher').tap();await p.locator('[data-app="x"]').tap();
 await p.locator('[data-x-action="profile"][aria-label="个人主页"]').tap();
 assert.equal(await p.locator('[data-x-followers]').innerText(),'70');
 assert.equal(await p.evaluate(()=>window.calls),0);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 console.log('PASS X refresh separation: home feed/followers, search trends, square, persistence and narrow mobile');
}finally{await browser.close();server.close();}
