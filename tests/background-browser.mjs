import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const {chromium}=createRequire(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/')('playwright');
const fixture=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#eee}</style><h1>酒馆正文仍然可见</h1><script type="module">
import {mountPhone} from '/src/ui.js';
import {normalizeSettings} from '/src/config.js';
import {createPhoneMemory} from '/src/memory.js';
import {createPhoneService} from '/src/phone.js';
import {createDaily} from '/src/daily.js';
import {createApiClient} from '/src/api.js';
import {captureHostRequest} from '/src/api-context.js';
window.calls=0;window.finished=false;window.backgroundFail=false;
window.edition={publication:'Los Angeles Times',location:'洛杉矶',articles:Array.from({length:4},(_,i)=>({headline:'后台新闻 '+i,subject:'world',section:'城市',placement:i?'brief':'lead',summary:'城市公共活动安排。',body:'这是在小手机收起后保存的新闻。'}))};
window.reply=window.edition;
const handlers={},c={chatId:'background',characterId:0,characters:[{name:'Alex',avatar:'alex'}],name1:'Sam',chat:[{mes:'2026-10-27 12:00 洛杉矶。'}],chatMetadata:{},mainApi:'openai',onlineStatus:'connected',saveMetadata:async()=>{window.saved=structuredClone(c.chatMetadata);},getRequestHeaders:()=>({'Content-Type':'application/json'}),event_types:Object.fromEntries(['GENERATION_STARTED','GENERATION_STOPPED','GENERATION_ENDED','CHAT_CHANGED','MESSAGE_DELETED','GENERATE_AFTER_DATA','CHAT_COMPLETION_SETTINGS_READY'].map(n=>[n,n])),eventSource:{on(n,f){(handlers[n]||=[]).push(f);},removeListener(n,f){handlers[n]=(handlers[n]||[]).filter(x=>x!==f);},async emit(n,...args){for(const f of [...(handlers[n]||[])]){try{await f(...args);}catch{}}}}};
window.context=c;
c.generateQuietPrompt=async options=>{
 await c.eventSource.emit('GENERATION_STARTED','quiet',{quiet_prompt:options.quietPrompt},false);
 try {
  const generated={prompt:[{role:'system',content:options.quietPrompt}]};await c.eventSource.emit('GENERATE_AFTER_DATA',generated,false);
  const data={messages:generated.prompt.filter(Boolean),stream:false};await c.eventSource.emit('CHAT_COMPLETION_SETTINGS_READY',data);JSON.stringify(data);
  window.calls++;await new Promise(r=>window.release=r);if(window.backgroundFail)throw Error('测试后台失败');return JSON.stringify(window.reply);
 } finally {await c.eventSource.emit('GENERATION_STOPPED');}
};
let settings=normalizeSettings({retries:0,api:{mode:new URL(location.href).searchParams.get('mode'),baseUrl:'https://fixture.invalid/v1',model:'fixture-model'}});
const memory=createPhoneMemory({getContext:()=>c,getGenerationState:()=>false});
const modelClient=createApiClient({getContext:()=>c,getSettings:()=>settings,getKey:()=>'',prepareRequest:captureHostRequest});
const phone=createPhoneService({memory,getContext:()=>c,getSettings:()=>settings,modelClient});
const adapter={phone,memory,load:()=>settings,save:s=>settings=s,storyChat:()=>c.chat,userName:()=>c.name1,onChange(s){if(!s.enabled){modelClient.cancel();phone.destroy();memory.destroy();}}};
adapter.daily=createDaily({memory,phone,getContext:()=>c,getSettings:()=>settings});
const styles=await(await fetch('/style.css')).text();window.ui=mountPhone({adapter,styles});
await memory.read();window.run=app=>{window.finished=false;window.result=null;phone.appTask(async(view,current,request)=>{const ticket=await memory.begin();const data=await request('Background '+app,x=>x,current);if(!current())throw Error('取消');await memory.commit(ticket,[{collection:'profiles',key:'test:'+app,value:data}]);},app).then(r=>{window.result=r;window.finished=true;});};
window.state=()=>phone.snapshot();window.ready=true;
</script>`;
const server=createServer(async(req,res)=>{try{
 const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);return;}
 const path=resolve(root,'.'+pathname);if(!path.startsWith(root+sep)){res.writeHead(403).end();return;}
 res.setHeader('Content-Type',extname(path)==='.css'?'text/css':'text/javascript');res.end(await readFile(path));
}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-gpu']});
const errors=[],external=[];
try {
 for(const mode of ['host','independent']) {
  const p=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});p.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
  let releaseNetwork=null,networkCalls=0;
  await p.route('**/*',async route=>{
   if(!route.request().url().startsWith(origin)){external.push(route.request().url());return route.abort();}
   if(route.request().url().endsWith('/api/backends/chat-completions/generate')){
    networkCalls++;await new Promise(r=>releaseNetwork=r);releaseNetwork=null;
    const data=await p.evaluate(()=>({reply:window.reply,fail:window.backgroundFail}));
    await route.fulfill({status:data.fail?503:200,contentType:'application/json',body:JSON.stringify(data.fail?{error:{message:'Service unavailable'}}:{choices:[{message:{content:JSON.stringify(data.reply)}}]})});return;
   }return route.continue();
  });
  const waitRequest=async()=>{if(mode==='host')await p.waitForFunction(()=>typeof window.release==='function');else for(let i=0;i<200&&!releaseNetwork;i++)await new Promise(r=>setTimeout(r,20));assert.ok(mode==='host'||releaseNetwork);};
  const release=async()=>{if(mode==='host')await p.evaluate(()=>{const r=window.release;window.release=null;r();});else releaseNetwork();};
  const count=async()=>mode==='host'?await p.evaluate(()=>window.calls):networkCalls;
  await p.goto(origin+'/?mode='+mode);await p.waitForFunction(()=>window.ready);
  await p.locator('.pp-launcher').tap();await p.locator('[data-app="daily"]').tap();
  await p.locator('[data-daily-action="update"]').tap();await waitRequest();
  await p.locator('[data-action="close"]').tap();assert.equal(await p.locator('.pp-phone').isVisible(),false);
  assert.equal(await p.locator('.pp-background-task').count(),0);assert.equal(await p.evaluate(()=>window.state().busy),true,'generation continues without a notice');
  // Reopening/reclosing the same running request must not repeat the notice.
  await p.locator('.pp-launcher').tap();await p.locator('[data-app="daily"]').tap();assert.equal(await p.locator('[data-daily-action="update"]').isDisabled(),true);assert.equal(await count(),1);
  await p.locator('[data-action="close"]').tap();assert.equal(await p.locator('.pp-background-task').count(),0);await release();
  await p.waitForFunction(()=>!window.state().busy);
  assert.equal(await p.locator('.pp-background-task').isVisible(),false,'completion stays quiet');
  assert.equal(await p.evaluate(()=>Object.values(window.state().daily).filter(a=>a.type==='article').length),4);
  await mkdir(resolve(root,'../qa-results'),{recursive:true});await p.screenshot({path:resolve(root,'../qa-results/background-'+mode+'.png')});
  await p.locator('.pp-launcher').tap();await p.locator('[data-app="daily"]').tap();assert.equal(await p.locator('.pp-daily-article').count(),4);assert.equal(await count(),1);
  for(const app of ['assets','amazon','x','snapchat','messages','phone']){
   const before=await count();await p.evaluate(app=>{window.reply={value:'saved '+app};window.run(app);},app);await waitRequest();
   await p.locator('[data-action="close"]').tap();assert.equal(await p.locator('.pp-background-task').count(),0);assert.equal(await p.evaluate(()=>window.state().busy),true);await release();
   await p.waitForFunction(()=>window.finished);assert.equal(await p.evaluate(()=>window.result.ok),true);
   assert.equal(await p.evaluate(app=>window.state().profiles['test:'+app]?.value,app),'saved '+app);
   assert.equal(await count(),before+1);await p.locator('.pp-launcher').tap();
  }
  // Failure remains inside the app without a floating notice.
  await p.locator('[data-app="daily"]').tap();await p.evaluate(()=>{window.reply=window.edition;window.backgroundFail=true;});
  await p.locator('[data-daily-action="update"]').tap();await waitRequest();await p.locator('[data-action="close"]').tap();assert.equal(await p.locator('.pp-background-task').count(),0);await release();
  await p.waitForFunction(()=>!window.state().busy);assert.equal(await p.locator('.pp-background-task').count(),0);await p.locator('.pp-launcher').tap();await p.locator('[data-app="daily"]').tap();
  assert.equal(await p.locator('.pp-daily-article').count(),4);assert.equal(await p.locator('[data-daily-action="update"]').isDisabled(),false);
  assert.ok((await p.locator('.pp-daily-status').textContent()).length>0);
  console.log('PASS '+mode+': real daily close/reopen/save/failure; six other apps shared service continues with UI hidden, no duplicate request');await p.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
} finally {await browser.close();server.close();}
