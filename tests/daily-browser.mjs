import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const require=createRequire(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/');
const {chromium}=require('playwright');
const fixture=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="extensions_settings"></div><script>
const stored=JSON.parse(localStorage.getItem('daily-test')||'null');window.calls=0;
const basis={access:'background',summary:'Local public events, no private story characters',involvesCharacters:false};
window.response={location:'洛杉矶',articles:[
{headline:'城市音乐节公布周末演出阵容',outlet:'洛城晚报',section:'城市 / 文化',placement:'lead',summary:'从公园舞台到街区小剧场，今年的音乐节将迎来更多本地创作者。',body:'主办方公布了本周末的完整节目安排。\\n演出将在多个公共场地举行，部分场次免费向市民开放。',publicBasis:basis},
{headline:'独立唱片店迎来暑期客流',outlet:'城市商业周刊',section:'商业',placement:'feature',summary:'几家街区唱片店延长营业时间，并计划举办小型试听活动。',body:'店主们希望通过现场交流吸引附近的听众。',publicBasis:basis},
{headline:'社区诊所增设周末门诊',outlet:'洛城晚报',section:'健康',placement:'feature',summary:'预约窗口将在周五开放，新增时段面向附近街区居民。',body:'相关安排将先试行一个月，后续根据居民反馈调整。',publicBasis:basis},
{headline:'区域铁路增加晚间班次',outlet:'洛城晚报',section:'交通',placement:'feature',summary:'通勤线路将在周末延长运营时间，方便夜间活动散场后的乘客。',body:'交通部门表示，新增班次将先运行六周，再依据客流决定是否保留。',publicBasis:basis},
{headline:'研究团队公布新型储能测试结果',outlet:'科学周刊',section:'科技',placement:'feature',summary:'实验室称新材料在连续循环测试中保持了较稳定的性能。',body:'研究人员计划扩大样本规模，并在下一阶段评估实际应用条件。',publicBasis:basis},
{headline:'城市足球杯决赛周末举行',outlet:'洛城晚报',section:'体育',placement:'feature',summary:'两支本地球队将在主场争夺本届赛事冠军，门票已开始发售。',body:'赛事组织方预计决赛将吸引来自周边社区的观众。',publicBasis:basis},
{headline:'新人歌手推出首支单曲',outlet:'南岸音乐通讯',section:'音乐短讯',placement:'brief',summary:'本地创作者的首支作品开始在小范围听众中流传。',body:'作品上线后，几位乐迷分享了自己的试听感受。',publicBasis:basis},
{headline:'滨河步道修缮完成',outlet:'洛城晚报',section:'城市短讯',placement:'brief',summary:'沿河步道重新开放，新增指示牌。',body:'维护人员提醒市民爱护沿线设施。',publicBasis:basis},
{headline:'周末社区艺术市集开放报名',outlet:'洛城晚报',section:'文化短讯',placement:'brief',summary:'手工艺摊位和小型现场演出开始接受申请。',body:'主办方将在周五公布最终摊位名单。',publicBasis:basis}
]};
window.response.publication='Los Angeles Times';
window.response.articles=window.response.articles.map(({publicBasis,...a})=>a);
const handlers={};const c={chatId:'daily',name1:'Sam',characterId:0,characters:[{name:'Alex',avatar:'a'}],mainApi:'openai',onlineStatus:'connected',
extensionSettings:JSON.parse(localStorage.getItem('daily-settings')||'{}'),saveSettingsDebounced(){localStorage.setItem('daily-settings',JSON.stringify(c.extensionSettings));},
chat:stored?.chat||[{mes:'2003-07-24\\n普通学生在洛杉矶的家中休息。',is_user:false}],chatMetadata:stored?.metadata||{},saveMetadata:async()=>localStorage.setItem('daily-test',JSON.stringify({chat:c.chat,metadata:c.chatMetadata})),
event_types:Object.fromEntries(['APP_READY','CHAT_CHANGED','GENERATION_STARTED','GENERATION_AFTER_COMMANDS','GENERATION_ENDED','MESSAGE_DELETED','MESSAGE_EDITED','CHAT_COMPLETION_PROMPT_READY','CHAT_COMPLETION_SETTINGS_READY'].map(n=>[n,n])),
eventSource:{on(n,f){if(n==='APP_READY')queueMicrotask(f);else(handlers[n]||=[]).push(f);},removeListener(n,f){handlers[n]=(handlers[n]||[]).filter(x=>x!==f);},async emit(n,...args){for(const f of handlers[n]||[])await f(...args);}},
extensionPrompts:{},setExtensionPrompt(k,v){this.extensionPrompts[k]={value:v};},generateQuietPrompt:async()=>{window.calls++;if(window.fail)throw Error('测试失败，原报纸保留');return JSON.stringify(window.response);}};
window.SillyTavern={getContext:()=>c};window.prepare=async()=>{await c.eventSource.emit('GENERATION_STARTED','normal');await c.eventSource.emit('GENERATION_AFTER_COMMANDS','normal');const data={chat:[{role:'user',content:'继续'}]};await c.eventSource.emit('CHAT_COMPLETION_PROMPT_READY',data);await c.eventSource.emit('CHAT_COMPLETION_SETTINGS_READY',{messages:data.chat,type:'normal'});window.request=data.chat;const prompt=c.extensionPrompts.durian_phone_daily.value;await c.eventSource.emit('GENERATION_ENDED');return prompt;};
</script><script type="module" src="/index.js"></script></body></html>`;
const server=createServer(async(req,res)=>{try{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);return;}
 if(pathname==='/script.js'){res.setHeader('Content-Type','text/javascript');res.end('export function isGenerating(){return false;}');return;}
 const path=resolve(root,'.'+pathname);if(!path.startsWith(root+sep)){res.writeHead(403).end();return;}
 res.setHeader('Content-Type',extname(path)==='.css'?'text/css':'text/javascript');res.end(await readFile(path));
}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-gpu']});
const errors=[],external=[];
try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/*',route=>{if(route.request().url().startsWith(origin))return route.continue();external.push(route.request().url());return route.abort();});
 await p.goto(origin);await p.locator('.pp-launcher').tap();await p.locator('[data-app="daily"]').tap();assert.equal(await p.evaluate(()=>window.calls),0);
 const longPress=async(locator)=>{await locator.dispatchEvent('pointerdown',{pointerType:'touch',pointerId:11,isPrimary:true,bubbles:true,cancelable:true});await p.waitForTimeout(600);await locator.dispatchEvent('pointerup',{pointerType:'touch',pointerId:11,isPrimary:true,bubbles:true,cancelable:true});await p.locator('.pp-press-bubble').waitFor();};
 const pressAction=async(locator,kind)=>{await longPress(locator);return p.locator('.pp-press-action[data-kind="'+kind+'"]');};
 const closeBubble=async()=>{await p.locator('.pp-daily-masthead h2').tap();await p.locator('.pp-press-bubble').waitFor({state:'detached'});};
 await p.getByRole('button',{name:'看看新闻',exact:true}).tap();await p.getByText('城市音乐节公布周末演出阵容',{exact:true}).waitFor();assert.equal(await p.evaluate(()=>window.calls),1);
 assert.equal(await p.locator('.pp-daily-lead').count(),1);assert.equal(await p.locator('.pp-daily-feature').count(),5);assert.equal(await p.locator('.pp-daily-brief').count(),3);
 assert.equal(await p.locator('.pp-daily-masthead h2').textContent(),'Los Angeles Times');
 assert.equal(await p.locator('.pp-daily-article').count(),9);
 const brief=p.locator('.pp-daily-brief').first();
 const original=await brief.locator('h3').innerText();
 const row=await p.locator('.pp-daily-article').evaluateAll((items,title)=>items.findIndex(a=>a.querySelector('h3').textContent===title),original);
 await pressAction(brief,'edit');await p.locator('.pp-press-action[aria-label="修改这篇报道"]').tap();
 const editor=p.getByRole('dialog',{name:'编辑这篇报道'});
 await editor.getByLabel('标题').fill('放弃的修改');await editor.getByRole('button',{name:'取消'}).evaluate(el=>el.click());await editor.waitFor({state:'detached'});
 assert.equal(await brief.locator('h3').innerText(),original);
 await pressAction(brief,'edit');await p.locator('.pp-press-action[aria-label="修改这篇报道"]').tap();
 await editor.getByLabel('标题').fill('手动修改的标题');
 await editor.getByLabel('导语').fill('手动修改的导语');
 await editor.getByLabel('正文').fill('手动修改的正文');
 await editor.getByRole('button',{name:'保存',exact:true}).tap();await editor.waitFor({state:'detached'});
 await brief.getByText('手动修改的标题',{exact:true}).waitFor();
 await brief.getByText('手动修改的导语',{exact:true}).waitFor();
 await brief.getByRole('button',{name:'阅读全文'}).tap();
 await brief.getByText('手动修改的正文',{exact:true}).waitFor();
 assert.equal(await p.evaluate(()=>window.calls),1);
 const responsive=await p.locator('.pp-daily').evaluate(el=>{const grid=el.querySelector('.pp-daily-feature-grid'),briefs=el.querySelector('.pp-daily-brief-section');return{paperWidth:el.getBoundingClientRect().width,featureColumns:getComputedStyle(grid).columnCount,featureWidths:[...grid.children].map(a=>a.getBoundingClientRect().width),briefColumns:getComputedStyle(briefs).gridTemplateColumns.trim().split(' ').length,briefListWidth:briefs.querySelector('.pp-daily-brief-list').getBoundingClientRect().width};});assert.equal(responsive.featureColumns,'1');assert.ok(responsive.featureWidths.every(width=>width>responsive.paperWidth*.82));assert.equal(responsive.briefColumns,1);assert.ok(responsive.briefListWidth>responsive.paperWidth*.82);
 await p.locator('.pp-daily').evaluate(el=>{el.style.width='520px';});assert.equal(await p.locator('.pp-daily-feature-grid').evaluate(el=>getComputedStyle(el).columnCount),'2');await p.locator('.pp-daily').evaluate(el=>el.style.removeProperty('width'));
 await mkdir(resolve(root,'../qa-results'),{recursive:true});await p.screenshot({path:resolve(root,'../qa-results/daily-newspaper-390.png')});
 assert.equal(await p.evaluate(()=>window.prepare()),'');
 const lead=p.locator('.pp-daily-lead');await lead.getByRole('button',{name:'阅读全文',exact:true}).tap();await p.getByText('主办方公布了本周末的完整节目安排。',{exact:false}).waitFor();assert.equal(await p.evaluate(()=>window.calls),1);
 await (await pressAction(lead,'inject')).tap();await longPress(lead);assert.equal(await p.locator('.pp-press-action[data-kind="inject"]').getAttribute('data-active'),'true');await closeBubble();
 assert.match(await p.evaluate(()=>window.prepare()),/城市音乐节公布/);assert.doesNotMatch(await p.evaluate(()=>window.prepare()),/独立唱片店/);
 assert.equal(await p.evaluate(()=>window.request.filter(m=>m.content.includes('durian-daily-used')).length),1);
 await (await pressAction(lead,'inject')).tap();await longPress(lead);assert.equal(await p.locator('.pp-press-action[data-kind="inject"][data-active]').count(),0);await closeBubble();assert.equal(await p.evaluate(()=>window.prepare()),'');
 await (await pressAction(lead,'inject')).tap();await longPress(lead);assert.equal(await p.locator('.pp-press-action[data-kind="inject"]').getAttribute('data-active'),'true');await closeBubble();
 await mkdir(resolve(root,'../qa-results'),{recursive:true});await p.screenshot({path:resolve(root,'../qa-results/daily-390.png')});
 await p.reload();await p.locator('.pp-launcher').tap();await p.locator('[data-app="daily"]').tap();await longPress(p.locator('.pp-daily-lead'));assert.equal(await p.locator('.pp-press-action[data-kind="inject"]').getAttribute('data-active'),'true');await closeBubble();assert.equal(await p.evaluate(()=>window.calls),0);
 await p.getByRole('heading',{name:'手动修改的标题',exact:true}).waitFor();
 await p.evaluate(async()=>{const c=SillyTavern.getContext();const id=c.chatMetadata.durian_phone_history.events.flatMap(e=>e.changes).find(x=>x.value?.type==='article').key;const evidence='Alex 阅读了音乐节报道。';c.chat.push({mes:evidence+'<!--durian-daily-used:'+JSON.stringify({id,used:true,evidence})+'-->',is_user:false});await c.eventSource.emit('GENERATION_ENDED');});
 await longPress(lead);assert.equal(await p.locator('.pp-press-action[data-kind="inject"]').isDisabled(),true);await closeBubble();assert.equal(await p.evaluate(()=>window.prepare()),'');
 await p.evaluate(async()=>{const c=SillyTavern.getContext();c.chat.pop();await c.eventSource.emit('MESSAGE_DELETED');});await longPress(lead);assert.equal(await p.locator('.pp-press-action[data-kind="inject"]').getAttribute('data-active'),'true');await closeBubble();
 await p.evaluate(async()=>{const c=SillyTavern.getContext();c.chat.push({mes:'2003-07-25',is_user:false});await c.eventSource.emit('GENERATION_ENDED');});await p.locator('.pp-daily-expired').waitFor();assert.equal(await p.locator('.pp-daily-inject').count(),0);assert.equal(await p.evaluate(()=>window.prepare()),'');
 await p.setViewportSize({width:320,height:740});assert.ok(await p.locator('.pp-content').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await p.screenshot({path:resolve(root,'../qa-results/daily-expired-320.png')});
 assert.equal(await p.getByText('城市音乐节公布周末演出阵容',{exact:true}).count(),1);
 await p.evaluate(()=>window.fail=true);await p.getByRole('button',{name:'看看新闻',exact:true}).tap();await p.getByText('测试失败，原报纸保留',{exact:true}).waitFor();assert.equal(await p.evaluate(()=>window.calls),1);assert.equal(await p.locator('.pp-daily-article').count(),9);
 await p.evaluate(async()=>{const c=SillyTavern.getContext();c.chat.pop();await c.eventSource.emit('MESSAGE_DELETED');});await longPress(lead);assert.equal(await p.locator('.pp-press-action[data-kind="inject"]').getAttribute('data-active'),'true');await closeBubble();
 // App switch is independent; re-enabling preserves the edition and selection.
 await p.locator('[data-action="home"]').tap();await p.locator('[data-app="settings"]').tap();await p.locator('[data-section="apps"]').tap();await p.locator('[data-enabled="daily"]').uncheck();await p.locator('[data-action="home"]').tap();assert.equal(await p.locator('[data-app="daily"]').count(),0);assert.equal(await p.locator('[data-app="x"]').count(),1);assert.equal(await p.evaluate(()=>window.prepare()),'');
 await p.locator('[data-app="settings"]').tap();await p.locator('[data-section="apps"]').tap();await p.locator('[data-enabled="daily"]').check();await p.locator('[data-action="home"]').tap();await p.locator('[data-app="daily"]').tap();await longPress(lead);assert.equal(await p.locator('.pp-press-action[data-kind="inject"]').getAttribute('data-active'),'true');await closeBubble();
 assert.match(await p.evaluate(()=>window.prepare()),/城市音乐节公布/);assert.equal(await p.evaluate(()=>window.calls),1);
 // Folder browsing is local; expired copies persist across replacement/reload.
 await p.evaluate(async()=>{window.fail=false;const c=SillyTavern.getContext();c.chat.push({mes:'2003-07-25',is_user:false});await c.eventSource.emit('GENERATION_ENDED');});
 const callsBeforeFolder=await p.evaluate(()=>window.calls);
 await p.getByRole('button',{name:'过往报纸夹',exact:true}).tap();await p.locator('[data-daily-action="archive-edition"]').tap();
 assert.equal(await p.locator('.pp-daily-article').count(),9);assert.equal(await p.locator('.pp-daily-inject').count(),0);await longPress(p.locator('.pp-daily-lead'));assert.equal(await p.locator('.pp-press-action[data-kind="inject"]').isDisabled(),true);await closeBubble();
 await p.locator('.pp-daily-lead').getByRole('button',{name:'阅读全文',exact:true}).tap();await p.getByText('主办方公布了本周末的完整节目安排。',{exact:false}).waitFor();assert.equal(await p.evaluate(()=>window.calls),callsBeforeFolder);assert.equal(await p.evaluate(()=>window.prepare()),'');
 await p.locator('[data-action="back"]').tap();await p.getByRole('heading',{name:'过往报纸夹',exact:true}).waitFor();await p.locator('[data-action="back"]').tap();await p.getByRole('button',{name:'看看新闻',exact:true}).waitFor();
 await p.evaluate(()=>{window.response.articles=window.response.articles.map(a=>({...a,headline:'新一期 '+a.headline}));});await p.getByRole('button',{name:'看看新闻',exact:true}).tap();await p.getByText('新一期 城市音乐节公布周末演出阵容',{exact:true}).waitFor();
 await p.getByRole('button',{name:'过往报纸夹',exact:true}).tap();assert.equal(await p.locator('[data-daily-action="archive-edition"]').count(),1);assert.ok(await p.locator('.pp-content').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await p.screenshot({path:resolve(root,'../qa-results/daily-folder-320.png')});
 await p.reload();await p.locator('.pp-launcher').tap();await p.locator('[data-app="daily"]').tap();await p.getByRole('button',{name:'过往报纸夹',exact:true}).tap();await p.locator('[data-daily-action="archive-edition"]').tap();await p.getByText('城市音乐节公布周末演出阵容',{exact:true}).waitFor();assert.equal(await p.evaluate(()=>window.calls),0);assert.equal(await p.evaluate(()=>window.prepare()),'');
 await p.locator('[data-action="back"]').tap();
 await p.evaluate(()=>{window.confirm=()=>true;});
 await longPress(p.locator('[data-daily-action="archive-edition"]').first());
 assert.equal(await p.locator('.pp-press-action[data-kind="delete"][data-danger="true"]').getAttribute('aria-label'),'删除这期报纸');
 await p.locator('.pp-press-action[data-kind="delete"]').tap();
 await p.getByText('暂无过期报纸',{exact:true}).waitFor();
 assert.equal(await p.evaluate(()=>window.calls),0);
 await p.reload();await p.locator('.pp-launcher').tap();await p.locator('[data-app="daily"]').tap();
 await p.getByRole('button',{name:'过往报纸夹',exact:true}).tap();
 await p.getByText('暂无过期报纸',{exact:true}).waitFor();
 await p.locator('[data-action="back"]').tap();
 await p.evaluate(async()=>{const c=SillyTavern.getContext();c.chatId='another';c.chatMetadata={};c.chat=[{mes:'2003-07-25'}];await c.eventSource.emit('CHAT_CHANGED');});await p.locator('[data-app="daily"]').tap();await p.getByText('今天的世界，有什么新鲜事？',{exact:true}).waitFor();assert.equal(await p.locator('.pp-daily-article').count(),0);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('PASS daily mobile: 390/320px, editorial hierarchy, open/read/select zero API, actual request, adoption, reload, midnight expiry, rollback, one-attempt failure, app switch and chat isolation; no external requests or script errors');
}finally{await browser.close();server.close();}
