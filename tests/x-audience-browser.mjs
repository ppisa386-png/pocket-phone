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
 await p.locator('[data-x-action="profile"][aria-label="个人主页"]').tap();assert.equal(await p.locator('[data-x-followers]').innerText(),'—');assert.equal(await p.evaluate(()=>window.calls),0);
 await p.locator('[data-x-action="reset-followers"]').tap();await p.getByText('已还原初始粉丝',{exact:true}).waitFor();assert.equal(await p.locator('[data-x-followers]').innerText(),'50');
 await p.locator('[data-x-field="alias"]').fill('Moon');await p.getByRole('button',{name:'保存',exact:true}).tap();
 await p.locator('[data-x-action="tab"][data-x-id="home"]').tap();await p.locator('[data-x-field="post"]').fill('My public project');await p.locator('[data-x-form="post"] button').tap();
 await p.getByText('My public project',{exact:true}).waitFor();const postId=await p.locator('[data-x-post]').getAttribute('data-x-post');assert.equal(await p.evaluate(()=>window.calls),1);
 await p.evaluate(id=>{window.publicData={id};window.result={posts:[{name:'Alex',handle:'alex',text:'A campus concert.（校园音乐会。）'},...Array.from({length:9},(_,i)=>({name:'Local '+i,handle:'local_'+i,text:'Local public update '+i,has_account:true,authorKind:'npc',npcEvidence:'Local '+i+' is a band member.'}))],accounts:[{name:'Alex',handle:'alex',has_account:true,bio:'Band biography'},{name:'Hermit',handle:'hermit',has_account:false}]};},postId);
 await p.locator('[data-x-action="refresh"]').tap();await p.getByText('A campus concert.（校园音乐会。）',{exact:true}).waitFor();assert.equal(await p.getByText('Band biography',{exact:true}).count(),0);assert.equal(await p.getByText('Hermit',{exact:true}).count(),0);
 assert.equal(await p.locator('[data-x-post]').count(),11);
 assert.equal(await p.locator('.pp-x-account').count(),0);assert.equal(await p.locator('[data-x-action="follow"]').count(),0);
 await mkdir(resolve(root,'../qa-results'),{recursive:true});
 for(const width of [390,320]){await p.setViewportSize({width,height:844});assert.ok(await p.locator('.pp-x-body').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await p.locator('.pp-x-post').filter({hasText:'校园音乐会'}).scrollIntoViewIfNeeded();await p.screenshot({path:resolve(root,'../qa-results/x-post-home-'+width+'.png')});}
 await p.locator('.pp-x-post').filter({hasText:'校园音乐会'}).locator('.pp-x-post-avatar').tap();await p.getByText('Band biography',{exact:true}).waitFor();assert.equal(await p.evaluate(()=>window.calls),3);
 assert.equal(await p.locator('[data-x-action="follow"]').count(),1);await p.locator('[data-x-action="follow"]').tap();assert.equal(await p.evaluate(()=>window.calls),3);
 await p.locator('[data-x-action="profile"][aria-label="个人主页"]').tap();assert.equal(await p.locator('[data-x-followers]').innerText(),'70');
 await p.locator('[data-x-action="reset-followers"]').tap();await p.getByText('已还原初始粉丝',{exact:true}).waitFor();assert.equal(await p.locator('[data-x-followers]').innerText(),'50');assert.equal(await p.evaluate(()=>window.calls),3);
 await p.locator('[data-x-action="tab"][data-x-id="home"]').tap();assert.ok(await p.locator('[data-x-action="refresh"]').isDisabled());
 await longPress(p.locator('.pp-x-post').filter({hasText:'My public project'}).first());await p.locator('.pp-press-action[data-kind="edit"]').tap();
 await p.locator('[data-x-form="edit-page"] textarea').first().fill('Edited project');await p.getByRole('button',{name:'保存修改'}).tap();console.log('EDIT HOME STATE',JSON.stringify({status:await p.locator('.pp-snap-status').allInnerTexts(),editor:await p.locator('[data-x-form="edit-page"]').count(),posts:(await p.locator('[data-x-post]').allInnerTexts()).slice(0,4),body:(await p.locator('.pp-x-body').innerText()).slice(0,500)}));await p.getByText('Edited project',{exact:true}).waitFor();
 for(const [tab,content,edited] of [['square','Park report','Updated park'],['search','Public project discussion','Updated trend']]){
  await p.locator('[data-x-action="tab"][data-x-id="'+tab+'"]').tap();
  await p.locator('[data-x-action="'+(tab==='square'?'refresh-square':'refresh-trends')+'"]').tap();
  await p.getByText(content,{exact:true}).waitFor();
  await longPress(p.locator(tab==='search'?'.pp-x-trend':'.pp-x-post').filter({hasText:content}).first());await p.locator('.pp-press-action[data-kind="edit"]').tap();
  await p.locator('[data-x-form="edit-page"] input, [data-x-form="edit-page"] textarea').first().fill(edited);
  await p.getByRole('button',{name:'保存修改'}).tap();await p.getByText(edited,{exact:true}).waitFor();
 }
 await p.reload();await p.locator('.pp-launcher').tap();await p.locator('[data-app="x"]').tap();
 assert.ok(await p.locator('[data-x-action="refresh"]').isDisabled());await p.getByText('Edited project',{exact:true}).waitFor();
 assert.equal(await p.evaluate(()=>window.calls),0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 // Saved IDs, including same-name accounts and a deleted author, drive touch navigation.
 await p.evaluate(async id=>{
  const {JOURNAL_KEY,appendChange,messageSignatures,revisionsFor}=await import('/src/journal.js');
  const ctx=window.SillyTavern.getContext(),revisions=await revisionsFor(messageSignatures(ctx.chat));
  const records=[
   {id:'touch-a',type:'account',name:'同名网友',handle:'first_touch',bio:'First biography',dmPolicy:'open'},
   {id:'touch-b',type:'account',name:'同名网友',handle:'second_touch',bio:'Second biography',dmPolicy:'open'},
   {id:'touch-post',type:'post',author:'touch-b',text:'Second author public post'},
   ...[['touch-a','NPC one'],['touch-b','NPC two'],['user','User reply'],['deleted','Deleted reply']].map(([author,text],i)=>({id:'touch-comment-'+i,type:'comment',author,text,postId:id,replyTo:null,read:true}))
  ];
  ctx.chatMetadata[JOURNAL_KEY]=appendChange(ctx.chatMetadata[JOURNAL_KEY],revisions,records.map(value=>({collection:'x',key:value.id,value})));
  await ctx.saveMetadata();
 },postId);
 await p.reload();await p.locator('.pp-launcher').tap();await p.locator('[data-app="x"]').tap();
 await p.locator('[data-x-post="'+postId+'"] [data-x-action="comments"]').tap();
 for(const width of [320,390]){
  await p.setViewportSize({width,height:844});
  const author=p.locator('[data-x-comment="touch-comment-1"] .pp-x-comment-author');
  assert.ok((await author.boundingBox()).height>=44);await author.tap();
  await p.getByText('Second biography',{exact:true}).waitFor();assert.equal(await p.getByText('First biography',{exact:true}).count(),0);
  await p.getByText('Second author public post',{exact:true}).waitFor();
  await p.locator('[data-x-action="back"]').tap();await p.locator('[data-x-comment="touch-comment-1"]').waitFor();
  await p.locator('[data-x-comment="touch-comment-0"] .pp-x-comment-author').tap();
  await p.getByText('First biography',{exact:true}).waitFor();await p.locator('[data-x-action="back"]').tap();
  await p.locator('[data-x-comment="touch-comment-2"] .pp-x-comment-author').tap();
  await p.locator('[data-x-form="profile"]').waitFor();await p.locator('[data-x-action="back"]').tap();
  assert.equal(await p.locator('[data-x-comment="touch-comment-3"] .pp-x-comment-author').count(),0);
 }
 assert.equal(await p.evaluate(()=>window.calls),0);assert.deepEqual(errors,[]);
 console.log('PASS mobile feed quantity, public trends, comment profile taps, return, missing accounts and reload');
}finally{await browser.close();server.close();}
