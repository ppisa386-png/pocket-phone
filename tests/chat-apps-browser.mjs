import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const {chromium}=createRequire(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/')('playwright');
const fixture=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="extensions_settings"></div><script>
const persisted=JSON.parse(localStorage.getItem('chat-fixture')||'null');const handlers={};window.modelCalls=0;window.response={};
const ctx={chatId:'chat-ui',name1:'小林',name2:'陈默',characterId:0,characters:[{name:'陈默',avatar:'chen.png'}],mainApi:'openai',onlineStatus:'connected',extensionSettings:{},saveSettingsDebounced(){},powerUserSettings:{persona_description:'陈默是小林的朋友。许清是小林的同事。'},chat:persisted?.chat||[{mes:'2026-10-30 09:30\\n陈默把电话号码给了小林。'}],chatMetadata:persisted?.metadata||{},saveMetadata:async()=>localStorage.setItem('chat-fixture',JSON.stringify({chat:ctx.chat,metadata:ctx.chatMetadata})),event_types:Object.fromEntries(['APP_READY','CHAT_CHANGED','GENERATION_STARTED','GENERATION_AFTER_COMMANDS','GENERATION_ENDED','MESSAGE_DELETED','MESSAGE_EDITED','GENERATE_AFTER_DATA','CHAT_COMPLETION_SETTINGS_READY'].map(n=>[n,n])),eventSource:{on(n,f){if(n==='APP_READY')queueMicrotask(f);else(handlers[n]||=[]).push(f);},removeListener(n,f){handlers[n]=(handlers[n]||[]).filter(x=>x!==f);},async emit(n,...a){for(const f of handlers[n]||[])await f(...a);}},prompts:{},setExtensionPrompt(k,v){this.prompts[k]=v;},generateQuietPrompt:async options=>{window.modelCalls++;window.lastPrompt=options.quietPrompt;if(window.delay)await new Promise(r=>window.finish=r);return JSON.stringify(window.response);}};
window.SillyTavern={getContext:()=>ctx};
</script><script type="module" src="/index.js"></script></body></html>`;
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;if(path==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);return;}if(path==='/script.js'){res.setHeader('Content-Type','text/javascript');res.end('export function isGenerating(){return false;}');return;}const full=resolve(root,'.'+path);if(!full.startsWith(root+sep)){res.writeHead(403).end();return;}res.setHeader('Content-Type',extname(full)==='.css'?'text/css':extname(full)==='.html'?'text/html; charset=utf-8':'text/javascript');res.end(await readFile(full));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
const errors=[],external=[];const screenshots=resolve(root,'../qa-results');await mkdir(screenshots,{recursive:true});
try{
 for(const width of [390,320]){
  const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true});const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',route=>{if(route.request().url().startsWith(origin))return route.continue();external.push(route.request().url());return route.abort();});
  await p.goto(origin);await p.locator('.pp-launcher').tap();
  for(const app of ['whatsapp','wechat']){
   await p.locator('[data-app="'+app+'"]').tap();assert.equal(await p.locator('.pp-'+app).count(),1);
   const before=await p.evaluate(()=>window.modelCalls);
   await p.locator('[data-chat-action="add"]').first().tap();await p.locator('[data-chat-field="name"]').fill('陈默');
   await p.evaluate(()=>window.response={contacts:[{name:'陈默',source:'chat',user_has_number:true,can_use_phone:true,number:null,evidence:'陈默把电话号码给了小林。'}]});
   await p.getByRole('button',{name:'搜索并添加',exact:true}).tap();await p.getByText('已添加 1 位好友。',{exact:true}).waitFor();assert.equal(await p.evaluate(()=>window.modelCalls),before+1);
   await p.locator('[data-action="back"]').tap();
   await p.evaluate(()=>window.response={contacts:[{name:'许清',source_name:'许清',relationship:'colleague',established:true,incidental:false,evidence_refs:['S1.P1'],number:null}]});
   await p.getByRole('button',{name:'一键添加好友',exact:true}).tap();await p.getByText('许清',{exact:true}).waitFor();assert.equal(await p.locator('.pp-chat-row').count(),2);
   await p.locator('.pp-chat-row').filter({hasText:'陈默'}).tap();await p.locator('[data-chat-field="message"]').fill('周末一起去喝咖啡吗？');
   await p.locator('[data-chat-field="message"]').press('Enter');await p.getByText('未发送',{exact:true}).waitFor();assert.equal(await p.evaluate(()=>window.modelCalls),before+2);
   await p.locator('[data-chat-field="message"]').fill('我找到一家靠河边的小店。');
   await p.evaluate(()=>window.response={status:'reply',messages:[{kind:'text',text:'好呀，周六下午怎么样？'},{kind:'text',text:'把地址发给我吧 ☕'}]});
   await p.getByRole('button',{name:'发送',exact:true}).tap();await p.getByText('把地址发给我吧 ☕',{exact:true}).waitFor();assert.equal(await p.evaluate(()=>window.modelCalls),before+3);assert.equal(await p.locator('.pp-chat-message').count(),4);
   assert.ok(await p.locator('.pp-chat-composer').evaluate(el=>{const p=el.closest('.pp-chat-app').getBoundingClientRect(),r=el.getBoundingClientRect();return r.bottom<=p.bottom+1&&r.top>=p.top;}));
   assert.ok(await p.locator('.pp-chat-app').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
   await p.locator('.pp-phone').screenshot({path:resolve(screenshots,app+'-chat-'+width+'.png')});
   await p.getByRole('button',{name:'修改消息',exact:true}).first().tap();await p.locator('[data-chat-field="editText"]').fill('周六下午两点见。');await p.locator('[data-chat-form="edit"] button[type="submit"]').tap();await p.getByText('周六下午两点见。',{exact:true}).waitFor();assert.equal(await p.evaluate(()=>window.modelCalls),before+3);
   await p.evaluate(()=>window.response={text:'周六两点，店门口见。'});await p.getByRole('button',{name:'重新生成消息',exact:true}).first().tap();await p.getByText('周六两点，店门口见。',{exact:true}).waitFor();
   await p.getByRole('button',{name:'转账',exact:true}).tap();await p.locator('[data-action="back"]').tap();assert.equal(await p.locator('[data-chat-form="message"]').count(),1);
   await p.getByRole('button',{name:'聊天信息',exact:true}).tap();await p.getByRole('button',{name:'加入黑名单',exact:true}).tap();await p.locator('[data-action="back"]').tap();await p.getByText('已拉黑，不能发送消息或通话。',{exact:true}).waitFor();await p.getByRole('button',{name:'解除拉黑',exact:true}).tap();
   await p.locator('[data-chat-field="message"]').fill('晚点聊');await p.evaluate(()=>{window.delay=true;window.response={status:'reply',messages:[{text:'好的，晚点见。'}]};});await p.getByRole('button',{name:'发送',exact:true}).tap();await p.waitForFunction(()=>!!window.finish);await p.locator('[data-action="close"]').tap();await p.evaluate(()=>{window.delay=false;window.finish();window.finish=null;});
   await p.waitForFunction(()=>JSON.stringify(window.SillyTavern.getContext().chatMetadata).includes('好的，晚点见。'));await p.locator('.pp-launcher').tap();await p.locator('[data-app="'+app+'"]').tap();if(await p.locator('.pp-chat-row').count())await p.locator('.pp-chat-row').filter({hasText:'陈默'}).tap();await p.getByText('好的，晚点见。',{exact:true}).waitFor();
   await p.locator('[data-action="back"]').tap();await p.locator('.pp-phone').screenshot({path:resolve(screenshots,app+'-list-'+width+'.png')});
   await p.locator('[data-chat-field="filter"]').fill('陈');assert.equal(await p.locator('.pp-chat-row').count(),1);await p.locator('[data-chat-field="filter"]').fill('');
   await p.locator('[data-action="home"]').tap();
  }
  await p.reload();await p.locator('.pp-launcher').tap();for(const app of ['whatsapp','wechat']){await p.locator('[data-app="'+app+'"]').tap();await p.locator('.pp-chat-row').filter({hasText:'陈默'}).tap();await p.getByText('周六两点，店门口见。',{exact:true}).waitFor();await p.locator('[data-action="home"]').tap();}
  await p.evaluate(async()=>{const ctx=window.SillyTavern.getContext();ctx.chat[0].mes='另一条时间线。';await ctx.eventSource.emit('MESSAGE_EDITED');});await p.locator('[data-app="whatsapp"]').tap();await p.getByText('与朋友开始聊天',{exact:true}).waitFor();
  await context.close();
 }
 const preview=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});preview.on('pageerror',e=>errors.push(e.message));await preview.goto(origin+'/preview.html');await preview.locator('.pp-phone').waitFor({state:'visible'});for(const app of ['whatsapp','wechat']){await preview.locator('[data-app="'+app+'"]').tap();assert.equal(await preview.locator('.pp-'+app).count(),1);await preview.locator('[data-action="home"]').tap();}await preview.close();
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('PASS WhatsApp/WeChat: 390/320px name + bulk add, queues, reply/edit/reroll, block, background save, isolation, reload, rollback, preview; no script errors or external requests.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
