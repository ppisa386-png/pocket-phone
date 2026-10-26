import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const require=createRequire(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/');
const {chromium}=require('playwright');
const fixture=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{height:2000px;background:#ddd}</style><div id="extensions_settings"></div><script>
window.requests=0;window.saved=0;const context={extensionSettings:{},mainApi:'openai',saveSettingsDebounced(){window.saved++;},event_types:{APP_READY:'ready'},eventSource:{on(t,f){if(t==='ready')queueMicrotask(f);}}};window.SillyTavern={getContext:()=>context};
</script><script type="module" src="/index.js"></script>`;
const server=createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);return;}const path=resolve(root,'.'+pathname);if(!path.startsWith(root+sep)){res.writeHead(403).end();return;}res.setHeader('Content-Type',extname(path)==='.css'?'text/css':'text/javascript');res.end(await readFile(path));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-gpu']});
const errors=[],external=[];
try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await ctx.addInitScript(()=>{const v=new EventTarget();Object.assign(v,{height:844,offsetTop:0,offsetLeft:0,pageTop:0,pageLeft:0,width:390,scale:1});Object.defineProperty(window,'visualViewport',{configurable:true,value:v});window.testViewport=(height,offsetTop=0)=>{v.height=height;v.offsetTop=offsetTop;v.dispatchEvent(new Event('resize'));v.dispatchEvent(new Event('scroll'));};});
 const p=await ctx.newPage();p.on('pageerror',e=>{errors.push(e.message);console.log(e.message);});await p.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():(external.push(r.request().url()),r.abort()));
 await p.goto(origin);await p.locator('.pp-launcher').tap();await p.locator('[data-app="settings"]').tap();await p.locator('[data-section="api"]').tap();await p.locator('[data-api-field="mode"]').selectOption('independent');
 async function visible(selector){await p.waitForFunction(selector=>{const s=document.querySelector('#personal-pocket-phone-root').shadowRoot,e=s.querySelector(selector),c=s.querySelector('.pp-content');if(!e||s.activeElement!==e)return false;const a=e.getBoundingClientRect(),b=c.getBoundingClientRect(),v=window.visualViewport;return a.top>=b.top&&a.bottom<=b.bottom&&a.top>=v.offsetTop&&a.bottom<=v.offsetTop+v.height;},selector);}
 const url=p.locator('[data-api-field="baseUrl"]');await url.focus();await url.fill('https://fixture.example/v1');
 await p.evaluate(()=>window.testViewport(330,48));await visible('[data-api-field="baseUrl"]');
 const scrollBefore=await p.evaluate(()=>document.scrollingElement.scrollTop);
 await url.pressSequentially('/typing');await visible('[data-api-field="baseUrl"]');assert.equal(await url.inputValue(),'https://fixture.example/v1/typing');
 assert.equal(await p.locator('.pp-api-savebar').evaluate(e=>getComputedStyle(e).position),'static');
 assert.ok(await url.evaluate(e=>getComputedStyle(e).backgroundColor!=='rgb(255, 255, 255)' && e.clientHeight>=40));
 assert.equal(await p.evaluate(()=>document.scrollingElement.scrollTop),scrollBefore);
 await mkdir(resolve(root,'../qa-results'),{recursive:true});await p.screenshot({path:resolve(root,'../qa-results/api-keyboard-url-390.png')});
 const key=p.locator('[data-api-field="key"]');await key.focus();await key.fill('fixture-only');await visible('[data-api-field="key"]');assert.equal(await key.getAttribute('type'),'password');
 const model=p.locator('[data-api-field="model"]');await model.focus();await model.fill('fictional-model');await visible('[data-api-field="model"]');
 await p.locator('[data-api-action="tab:profiles"]').tap();const profile=p.locator('[data-api-field="profileName"]');await profile.focus();await profile.pressSequentially('My profile');await visible('[data-api-field="profileName"]');
 await p.evaluate(()=>window.testViewport(844,0));await profile.blur();await p.waitForFunction(()=>document.querySelector('#personal-pocket-phone-root').shadowRoot.querySelector('.pp-phone').dataset.keyboard==='false');
 assert.equal(await p.locator('.pp-api-savebar').evaluate(e=>getComputedStyle(e).position),'sticky');
 const restored=await p.locator('.pp-phone').boundingBox();assert.ok(restored.height>700);
 await p.locator('[data-api-action="tab:connection"]').tap();assert.equal(await url.inputValue(),'https://fixture.example/v1/typing');assert.equal(await key.inputValue(),'fixture-only');
 // A browser that resizes the layout viewport instead of only the visual viewport.
 await p.setViewportSize({width:320,height:360});await p.evaluate(()=>window.testViewport(360,0));await url.focus();await url.pressSequentially('/small');await visible('[data-api-field="baseUrl"]');
 assert.ok(await p.locator('.pp-content').evaluate(e=>e.scrollWidth<=e.clientWidth+1));await p.screenshot({path:resolve(root,'../qa-results/api-keyboard-url-320.png')});
 // A dragged phone must not retain the keyboard's temporary height.
 await p.setViewportSize({width:390,height:844});await p.evaluate(()=>window.testViewport(844,0));await url.blur();
 await p.locator('.pp-topline').waitFor({state:'visible'});const handle=await p.locator('.pp-topline').boundingBox();await p.mouse.move(handle.x+20,handle.y+15);await p.mouse.down();await p.mouse.move(handle.x+20,handle.y+25);await p.mouse.up();
 await url.focus();await p.setViewportSize({width:390,height:360});await p.evaluate(()=>window.testViewport(360,0));await visible('[data-api-field="baseUrl"]');
 await p.setViewportSize({width:390,height:844});await p.evaluate(()=>window.testViewport(844,0));await url.blur();
 await p.waitForFunction(()=>document.querySelector('#personal-pocket-phone-root').shadowRoot.querySelector('.pp-phone').getBoundingClientRect().height>700);
 // Prompt editor remains focused during input; native textarea handles its own long content.
 await p.locator('[data-action="back"]').tap();await p.locator('[data-section="prompts"]').tap();const editor=p.locator('[data-prompt-editor]');await editor.focus();await editor.fill('新的规则\n第二行');
 assert.equal(await editor.inputValue(),'新的规则\n第二行');assert.equal(await editor.evaluate(e=>e.getRootNode().activeElement===e),true);
 await p.locator('[data-action="close"]').tap();await p.evaluate(()=>window.testViewport(844));await p.setViewportSize({width:390,height:844});await p.locator('.pp-launcher').tap();assert.equal(await p.locator('.pp-phone').isVisible(),true);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('PASS keyboard: visual viewport shrink/offset, layout resize, URL/key/model/profile typing visible, focus and drafts kept, no host scrolling, restored sticky savebar, prompt editing, close/reopen, no JS errors or external requests');
}finally{await browser.close();server.close();}
