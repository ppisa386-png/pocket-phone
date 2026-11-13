import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const { chromium } = createRequire(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + '/')('playwright');
const fixture = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#e4e2db"><div id="extensions_settings"></div><script>
window.calls=0;window.fail=false;window.delay=0;const handlers={};
window.response={region:'日本 · 东京',timezone:'Asia/Tokyo',years:[2026,2027],holidays:[{name:'文化之日',date:'2026-11-03',note:'珍惜自由与和平，促进文化发展。'},{name:'勤劳感谢日',date:'2026-11-23',note:'感念劳动与生活中的每一份付出。'},{name:'圣诞节',date:'2026-12-25',note:'冬季的节日，城市里陆续亮起灯饰。'},{name:'元旦',date:'2027-01-01',note:'新一年的开始。'}]};
const saved=JSON.parse(localStorage.getItem('calendar-test')||'null');const c=window.c={chatId:'calendar',name1:'Sam',characterId:0,characters:[{name:'Alex',avatar:'a'}],mainApi:'openai',onlineStatus:'connected',
extensionSettings:{},saveSettingsDebounced(){},chat:saved?.chat||[{mes:'2026-11-13 09:41\\n在东京的家中休息。<!--durian-location:{"city":"东京"}-->',is_user:false}],chatMetadata:saved?.metadata||{},saveMetadata:async()=>localStorage.setItem('calendar-test',JSON.stringify({chat:c.chat,metadata:c.chatMetadata})),
event_types:Object.fromEntries(['APP_READY','CHAT_CHANGED','GENERATION_STARTED','GENERATION_AFTER_COMMANDS','GENERATION_ENDED','GENERATION_STOPPED','MESSAGE_DELETED','MESSAGE_EDITED','CHAT_COMPLETION_PROMPT_READY','CHAT_COMPLETION_SETTINGS_READY'].map(n=>[n,n])),
eventSource:{on(n,f){if(n==='APP_READY')queueMicrotask(f);else(handlers[n]||=[]).push(f);},removeListener(n,f){handlers[n]=(handlers[n]||[]).filter(x=>x!==f);},async emit(n,...args){for(const f of handlers[n]||[])await f(...args);}},extensionPrompts:{},setExtensionPrompt(k,v){this.extensionPrompts[k]={value:v};},
generateQuietPrompt:async()=>{window.calls++;if(window.delay)await new Promise(r=>setTimeout(r,window.delay));if(window.fail)throw Error('模拟网络中断');return JSON.stringify(window.response);}};window.SillyTavern={getContext:()=>c};
window.generate=async()=>{await c.eventSource.emit('GENERATION_STARTED','normal');await c.eventSource.emit('GENERATION_AFTER_COMMANDS','normal');const data={chat:[{role:'user',content:'继续'}]};await c.eventSource.emit('CHAT_COMPLETION_PROMPT_READY',data);await c.eventSource.emit('CHAT_COMPLETION_SETTINGS_READY',{messages:data.chat,type:'normal'});const prompt=c.extensionPrompts.durian_phone_calendar.value;c.chat.push({mes:'剧情自然延续。',is_user:false});await c.eventSource.emit('GENERATION_ENDED');return prompt;};
</script><script type="module" src="/index.js"></script></body></html>`;
const server = createServer(async (req,res) => { try {
    const pathname = new URL(req.url,'http://localhost').pathname;
    if (pathname === '/') { res.setHeader('Content-Type','text/html; charset=utf-8'); res.end(fixture); return; }
    if (pathname === '/script.js') { res.setHeader('Content-Type','text/javascript'); res.end('export function isGenerating(){return false;}'); return; }
    const path = resolve(root,'.'+pathname); if (!path.startsWith(root+sep)) {res.writeHead(403).end();return;}
    res.setHeader('Content-Type',({'.css':'text/css','.js':'text/javascript','.woff2':'font/woff2','.png':'image/png','.html':'text/html'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));
} catch {res.writeHead(404).end();} });
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-gpu']});
const errors=[],external=[],failedAssets=[];const evidence=resolve(root,'../qa-results');await mkdir(evidence,{recursive:true});
try {
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const p=await context.newPage();
    p.on('pageerror',e=>errors.push(e.message));p.on('response',r=>{if(r.status()>=400)failedAssets.push(r.url());});
    await p.route('**/*',r=>{if(r.request().url().startsWith(origin))return r.continue();external.push(r.request().url());return r.abort();});
    const open=async()=>{await p.locator('.pp-launcher').click();await p.locator('[data-app="calendar"]').click();};
    await p.goto(origin);await open();await p.locator('.pp-cal-welcome').waitFor();assert.equal(await p.evaluate(()=>window.calls),0);
    await p.screenshot({path:resolve(evidence,'calendar-initialize-390.png')});
    await p.evaluate(()=>window.fail=true);await p.locator('[data-calendar-action="refresh"]').click();await p.getByText(/日历初始化失败/).waitFor();assert.equal(await p.locator('.pp-cal-grid').count(),0);
    await p.evaluate(()=>{window.fail=false;window.delay=400;});await p.locator('[data-calendar-action="refresh"]').click();await p.getByText('正在整理地区节日资料…').waitFor();await p.locator('.pp-cal-grid').waitFor();assert.equal(await p.locator('.pp-cal-day').count(),35);
    assert.equal(await p.locator('.pp-cal-upcoming-row').filter({hasText:'圣诞节'}).locator('b').textContent(),'42');
    await p.getByRole('button',{name:'添加事件',exact:true}).click();await p.locator('[name="name"]').fill('晚餐约定');await p.locator('[name="note"]').fill('19:00 · 街角的小餐馆');await p.getByRole('button',{name:'保存事件',exact:true}).click();await p.locator('.pp-cal-details h4').getByText('晚餐约定').waitFor();
    await p.getByRole('button',{name:'添加事件',exact:true}).click();await p.locator('[name="name"]').fill('相识纪念日');await p.locator('[name="date"]').fill('2026-12-02');await p.locator('[name="kind"]').selectOption('anniversary');await p.locator('[name="repeat"]').selectOption('yearly');await p.getByRole('button',{name:'保存事件',exact:true}).click();await p.getByRole('button',{name:'回到今天',exact:true}).click();
    await p.locator('.pp-toast').waitFor({state:'hidden'});
    for(const width of [320,360,390,430]) {
        await p.setViewportSize({width,height:900});await p.locator('.pp-content').evaluate(el=>el.scrollTop=0);await p.evaluate(()=>document.fonts.ready);await p.mouse.move(0,0);
        const layout=await p.locator('.pp-calendar').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,cols:getComputedStyle(el.querySelector('.pp-cal-grid')).gridTemplateColumns.split(' ').length,number:el.querySelector('.is-selected .pp-cal-number').getBoundingClientRect().width}));
        assert.equal(layout.cols,7);assert.ok(layout.scroll<=layout.width+1);assert.ok(layout.number>=30);assert.ok(await p.locator('.pp-content').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
        await p.screenshot({path:resolve(evidence,'calendar-month-'+width+'.png')});
        await p.locator('.pp-cal-upcoming').scrollIntoViewIfNeeded();assert.ok(await p.locator('.pp-content').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await p.screenshot({path:resolve(evidence,'calendar-events-'+width+'.png')});
    }
    await p.getByRole('button',{name:'下个月',exact:true}).click();assert.match(await p.locator('.pp-cal-month').textContent(),/12月/);await p.getByRole('button',{name:'上个月',exact:true}).click();await p.getByRole('button',{name:'回到今天',exact:true}).click();
    await p.getByRole('button',{name:'日历设置',exact:true}).click();await p.getByText('Asia/Tokyo',{exact:true}).waitFor();await p.screenshot({path:resolve(evidence,'calendar-settings-430.png')});
    await p.getByRole('button',{name:'编辑 晚餐约定',exact:true}).click();await p.locator('[name="name"]').fill('非常长的个人事件名称，用来检查窄屏换行与日历日期完整展示的情况');await p.getByRole('button',{name:'保存事件',exact:true}).click();await p.getByRole('button',{name:'返回月历',exact:true}).click();await p.setViewportSize({width:320,height:900});assert.ok(await p.locator('.pp-content').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await p.evaluate(()=>window.fail=true);await p.getByRole('button',{name:'刷新日历',exact:true}).click();await p.getByText(/更新失败，已保留原有日历资料/).waitFor();assert.equal(await p.locator('.pp-cal-grid').count(),1);await p.screenshot({path:resolve(evidence,'calendar-failure-320.png')});
    await p.evaluate(()=>window.fail=false);await p.reload();await open();await p.locator('.pp-cal-grid').waitFor();assert.match(await p.locator('.pp-cal-details').textContent(),/非常长的个人事件/);
    // Real bridge in the production entry point, not a separate render mock.
    await p.evaluate(async()=>{c.chat.push({mes:'2026-11-20 10:00\\n新的一天。',is_user:false});await c.eventSource.emit('GENERATION_ENDED');});
    assert.match(await p.evaluate(()=>window.generate()),/勤劳感谢日/);assert.equal(await p.evaluate(()=>window.generate()),'');
    await p.getByRole('button',{name:'日历设置',exact:true}).click();await p.getByRole('button',{name:'编辑 相识纪念日',exact:true}).click();p.once('dialog',d=>d.accept());await p.getByRole('button',{name:'删除事件',exact:true}).click();await p.locator('.pp-cal-settings').waitFor();assert.equal(await p.getByRole('button',{name:'编辑 相识纪念日',exact:true}).count(),0);
    await p.emulateMedia({reducedMotion:'reduce'});await p.getByRole('button',{name:'返回月历',exact:true}).click();assert.ok(await p.locator('.pp-cal-number').first().evaluate(el=>getComputedStyle(el).transitionDuration==='0s'));
    // Offline bundle parses and opens the calendar without network/model access.
    await p.goto(origin+'/preview.html');await p.locator('[data-app="calendar"]').click();await p.locator('.pp-cal-welcome').waitFor();
    for(const app of ['daily','weather','x','wechat']){await p.getByRole('button',{name:'回到桌面',exact:true}).click();await p.locator('[data-app="'+app+'"]').click();}
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(failedAssets,[]);
    console.log('PASS calendar: 320/360/390/430px; init/loading/failure; CRUD/repeat; persistence; month navigation; countdown; actual narrative dedup; reduced motion; local assets; offline preview.');
} finally {await browser.close();server.close();}
