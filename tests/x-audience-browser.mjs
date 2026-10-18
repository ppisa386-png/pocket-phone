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
const handlers={};const ctx={chatId:'x-audience',name1:'Sam',characterId:0,characters:[{name:'Alex',avatar:'alex.png'}],mainApi:'openai',onlineStatus:'connected',extensionSettings:{},saveSettingsDebounced(){},
chat:[{mes:'2026-10-18 00:05',is_user:false}],chatMetadata:saved||{},saveMetadata:async()=>localStorage.setItem('x-test',JSON.stringify(ctx.chatMetadata)),
event_types:{APP_READY:'APP_READY'},eventSource:{on(n,f){if(n==='APP_READY')queueMicrotask(f);else(handlers[n]||=[]).push(f);},removeListener(){}},
setExtensionPrompt(){},generateQuietPrompt:async o=>{window.calls++;window.lastPrompt=o.quietPrompt;return typeof window.result==='string'?window.result:'<think>Plan</think><content>'+JSON.stringify(window.result)+'</content>';}};
window.SillyTavern={getContext:()=>ctx};</script><script type="module" src="/index.js"></script></body></html>`;
const server=createServer(async(req,res)=>{try{
 const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);return;}
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
 await p.locator('[data-x-action="profile"]').tap();assert.equal(await p.locator('[data-x-followers]').innerText(),'—');assert.equal(await p.evaluate(()=>window.calls),0);
 await p.locator('[data-x-action="reset-followers"]').tap();await p.getByText('已还原初始粉丝',{exact:true}).waitFor();assert.equal(await p.locator('[data-x-followers]').innerText(),'50');
 await p.locator('[data-x-field="alias"]').fill('Moon');await p.getByRole('button',{name:'保存',exact:true}).tap();
 await p.locator('[data-x-action="tab"][data-x-id="home"]').tap();await p.locator('[data-x-field="post"]').fill('My public project');await p.locator('[data-x-form="post"] button').tap();
 await p.getByText('My public project',{exact:true}).waitFor();const postId=await p.locator('[data-x-post]').getAttribute('data-x-post');assert.equal(await p.evaluate(()=>window.calls),1);
 await p.evaluate(id=>{window.result={posts:[],accounts:[{name:'School',handle:'school',has_account:true,bio:'Campus news'},{name:'Hermit',handle:'hermit',has_account:false}],audience:{growth:[{sourceId:'post:'+id,hot:true,totalGain:20,basis:'The public project spread'}]},engagementUpdates:[{postId:id,metrics:{likes:100,reposts:20,replies:0}}]};},postId);
 await p.locator('[data-x-action="refresh"]').tap();await p.getByText('Campus news',{exact:true}).waitFor();assert.equal(await p.getByText('Hermit',{exact:true}).count(),0);
 assert.equal(await p.locator('[data-x-action="follow"]').count(),1);await p.locator('[data-x-action="follow"]').tap();assert.equal(await p.evaluate(()=>window.calls),2);
 await p.locator('[data-x-action="profile"]').tap();assert.equal(await p.locator('[data-x-followers]').innerText(),'70');
 await p.locator('[data-x-action="reset-followers"]').tap();await p.getByText('已还原初始粉丝',{exact:true}).waitFor();assert.equal(await p.locator('[data-x-followers]').innerText(),'50');assert.equal(await p.evaluate(()=>window.calls),2);
 await p.locator('[data-x-action="tab"][data-x-id="home"]').tap();await p.locator('[data-x-action="refresh"]').tap();await p.getByRole('button',{name:'赞 100',exact:true}).waitFor();
 await p.locator('[data-x-action="profile"]').tap();assert.equal(await p.locator('[data-x-followers]').innerText(),'50');
 await p.setViewportSize({width:320,height:740});assert.ok(await p.locator('.pp-x-body').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
 await mkdir(resolve(root,'../qa-results'),{recursive:true});await p.screenshot({path:resolve(root,'../qa-results/x-followers-320.png')});
 await p.reload();await p.locator('.pp-launcher').tap();await p.locator('[data-app="x"]').tap();await p.locator('[data-x-action="profile"]').tap();assert.equal(await p.locator('[data-x-followers]').innerText(),'50');assert.equal(await p.evaluate(()=>window.calls),0);
 await p.locator('[data-x-action="tab"][data-x-id="home"]').tap();await p.evaluate(()=>{window.result='<content>{"posts":';});await p.locator('[data-x-action="refresh"]').tap();
 await p.getByText(/X 数据返回格式不正确.*不完整/).waitFor();assert.equal(await p.evaluate(()=>window.calls),1);await p.getByText('My public project',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('PASS X audience mobile: wrapped home response, related accounts, opt-in follow, initial/growth/reset, dedup, persistence, 320px, detailed failure, no external requests');
}finally{await browser.close();server.close();}
