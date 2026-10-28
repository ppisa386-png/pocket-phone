import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + '/');
const { chromium } = require('playwright');
const fixture = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="extensions_settings"></div><script>
const saved=JSON.parse(localStorage.getItem('assets-test')||'null');window.calls=0;window.financeResponse={date:'2026-01-15',initial:{balance:5000,holdings:[{name:'凯迪拉克 XT5',category:'fixed',value:35000},{name:'复古名表',category:'luxury',value:12000},{name:'小理发店',category:'investment',value:25000}],jobs:[{name:'设计师',monthlySalary:4000}]}};
const handlers={};const ctx={chatId:'assets',name1:'Sam',characterId:0,characters:[{name:'Alex',avatar:'alex.png'}],mainApi:'openai',onlineStatus:'connected',extensionSettings:{},saveSettingsDebounced(){},
chat:saved?.chat||[{mes:'日期：2026-01-15\\nSam 是一名设计师。',is_user:false}],chatMetadata:saved?.metadata||{},
saveMetadata:async()=>localStorage.setItem('assets-test',JSON.stringify({chat:ctx.chat,metadata:ctx.chatMetadata})),
event_types:Object.fromEntries(['APP_READY','CHAT_CHANGED','GENERATION_STARTED','GENERATION_AFTER_COMMANDS','GENERATION_ENDED','MESSAGE_DELETED'].map(n=>[n,n])),
eventSource:{on(n,f){if(n==='APP_READY')queueMicrotask(f);else(handlers[n]||=[]).push(f);},removeListener(n,f){handlers[n]=(handlers[n]||[]).filter(x=>x!==f);},async emit(n,...a){for(const f of handlers[n]||[])await f(...a);}},
prompts:{},setExtensionPrompt(k,v){this.prompts[k]=v;},generateQuietPrompt:async()=>{window.calls++;return JSON.stringify(window.financeResponse);}};
window.SillyTavern={getContext:()=>ctx};window.advance=async(text)=>{ctx.chat.push({mes:text,is_user:false});await ctx.eventSource.emit('GENERATION_ENDED');};
</script><script type="module" src="/index.js"></script></body></html>`;
const server = createServer(async (req, res) => {
    try {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fixture); return; }
        if (pathname === '/script.js') { res.setHeader('Content-Type', 'text/javascript'); res.end('export function isGenerating(){return false;}'); return; }
        const path = resolve(root, '.' + pathname);
        if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
        res.setHeader('Content-Type', extname(path) === '.css' ? 'text/css' : 'text/javascript'); res.end(await readFile(path));
    } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE, args: ['--no-sandbox', '--disable-gpu'] });
const errors = [], external = [];
try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
    await p.route('**/*', route => { if (route.request().url().startsWith(origin)) return route.continue(); external.push(route.request().url()); return route.abort(); });
    await p.goto(origin); await p.locator('.pp-launcher').tap(); await p.locator('[data-app="assets"]').tap();
    async function checkBottom() {
        const box=await p.locator('.pp-assets').evaluate(el=>{
            const nav=el.querySelector('.pp-asset-tabs').getBoundingClientRect(),body=el.querySelector('.pp-asset-body').getBoundingClientRect(),content=el.parentElement.getBoundingClientRect();
            return {bottom:nav.bottom,expected:content.bottom,top:nav.top,bodyBottom:body.bottom,width:el.scrollWidth,client:el.clientWidth};
        });
        assert.ok(Math.abs(box.bottom-box.expected)<2,'tabs align with bottom of phone content');
        assert.ok(box.bodyBottom<=box.top+1,'scrolling content does not cover tabs');
        assert.ok(box.width<=box.client+1,'no horizontal overflow');
    }
    await checkBottom();
    assert.equal(await p.evaluate(() => window.calls), 0, 'open does not request');
    await p.evaluate(() => { window.financeResponse.date = '2026-01-14'; });
    await p.getByRole('button', { name: '一键更新', exact: true }).tap(); await p.getByText('$5,000.00', { exact: true }).waitFor();
    assert.equal(await p.evaluate(() => window.calls), 1); assert.equal(await p.locator('[data-asset-action="update"]').isDisabled(), true);
    for (const [tab, text] of [['fixed', '凯迪拉克 XT5'], ['luxury', '复古名表'], ['investment', '小理发店']]) {
        await p.locator('[data-asset-tab="' + tab + '"]').tap(); await p.getByText(text, { exact: true }).waitFor();await checkBottom();
    }
    assert.equal(await p.evaluate(() => window.calls), 1, 'tabs do not request');
    await p.locator('[data-asset-tab="cash"]').tap();
    await mkdir(resolve(root, '../qa-results'), { recursive: true }); await p.screenshot({ path: resolve(root, '../qa-results/assets-390.png') });
    await p.evaluate(async () => {
        const row = { kind: 'expense', name: '饮用水', amount: 5, evidence: 'Sam 买水花了5美元。' };
        await window.advance('日期：2026-01-16\n' + row.evidence + '<!--durian-money:' + JSON.stringify(row) + '-->');
    });
    await p.getByText('$4,995.00', { exact: true }).waitFor(); assert.equal(await p.evaluate(() => window.calls), 1);
    assert.equal(await p.locator('[data-asset-action="update"]').isDisabled(), false);
    await p.evaluate(async () => {
        window.financeResponse = { date: '2026-02-16', events: [], living: { total: 100, bookedIds: [] }, business: [] };
        await window.advance('日期：2026-02-16\n一个月过去了。');
    });
    await p.getByRole('button', { name: '一键更新', exact: true }).tap(); await p.getByText('$8,895.00', { exact: true }).waitFor();
    await p.locator('summary').filter({ hasText: '最近收支' }).tap(); await p.getByText('设计师 · 2026-02-15 工资', { exact: true }).waitFor();
    await p.setViewportSize({ width: 320, height: 640 });
    await checkBottom();
    await p.locator('.pp-asset-body').evaluate(el=>{
        const row=el.querySelector('.pp-asset-row');for(let i=0;i<30;i++)el.append(row.cloneNode(true));
        el.scrollTop=el.scrollHeight;
    });
    await checkBottom();
    assert.ok(await p.locator('.pp-asset-body').evaluate(el=>el.scrollTop>0),'long list scrolls within body');
    assert.ok(await p.locator('.pp-content').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    await p.screenshot({ path: resolve(root, '../qa-results/assets-320.png') });
    await p.reload(); await p.locator('.pp-launcher').tap(); await p.locator('[data-app="assets"]').tap();
    await p.getByText('$8,895.00', { exact: true }).waitFor(); assert.equal(await p.locator('[data-asset-action="update"]').isDisabled(), true); assert.equal(await p.evaluate(() => window.calls), 0);
    await p.evaluate(async () => { const c = window.SillyTavern.getContext(); c.chat.pop(); await c.eventSource.emit('MESSAGE_DELETED'); });
    await p.getByText('$4,995.00', { exact: true }).waitFor(); assert.equal(await p.locator('[data-asset-action="update"]').isDisabled(), false);
    await p.evaluate(async () => {
        const c=window.SillyTavern.getContext(), j=await import('/src/journal.js');
        const rev=await j.revisionsFor(j.messageSignatures(c.chat));
        c.chatMetadata[j.JOURNAL_KEY]=j.appendChange(c.chatMetadata[j.JOURNAL_KEY],rev,[
            {collection:'snapchat',key:'blocked-friend',value:{id:'blocked-friend',type:'account',name:'阿历克斯',handle:'alex',friend:'friends',blocked:true}},
            {collection:'snapchat',key:'pending-transfer',value:{id:'pending-transfer',type:'transfer',accountId:'blocked-friend',direction:'outgoing',status:'pending',currency:'USD',amountMinor:2000,memo:'测试转账'}}
        ]);
        await c.eventSource.emit('GENERATION_ENDED');
    });
    await p.locator('[data-action="home"]').tap(); await p.locator('[data-app="snapchat"]').tap();
    await p.getByRole('button',{name:'聊天记录',exact:true}).tap();
    assert.equal(await p.locator('[data-snap-action="settle"]').count(),0,'blocked account cannot settle');
    await p.getByRole('button',{name:'取消转账',exact:true}).tap(); await p.getByText('已拒收／取消',{exact:true}).waitFor();
    assert.equal(await p.evaluate(()=>window.calls),0,'cancellation is local');
    await p.locator('[data-action="home"]').tap(); await p.locator('[data-app="assets"]').tap();
    await p.getByText('$4,995.00',{exact:true}).waitFor();

    await p.evaluate(()=>{
        const c=window.SillyTavern.getContext();
        c.generateQuietPrompt=async()=>{window.calls++;return '<content>{"date":"2026-01-16","living":';};
    });
    await p.getByRole('button',{name:'一键更新',exact:true}).tap();
    await p.getByText(/账本返回格式不正确：JSON 不完整/).waitFor();
    assert.equal(await p.evaluate(()=>window.calls),1,'format failure is one request');
    assert.equal(await p.locator('[data-asset-action="update"]').isDisabled(),false);
    await p.getByText('$4,995.00',{exact:true}).waitFor();
    await p.locator('[data-action="home"]').tap();await p.locator('[data-app="settings"]').tap();await p.locator('[data-section="errors"]').tap();
    await p.locator('[data-running-version]').waitFor();
    const log=await p.locator('[data-error-log]').inputValue();
    assert.match(log,/当前运行版本：榴莲手机 1.0.1/);
    assert.match(log,/失败阶段：解析返回格式/);assert.match(log,/MODEL_JSON_TRUNCATED/);
    assert.ok(!log.includes('<content>'),'no raw response saved');
    assert.ok(await p.locator('.pp-content').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await p.screenshot({path:resolve(root,'../qa-results/assets-error-320.png')});
    await p.locator('[data-action="home"]').tap();await p.locator('[data-app="assets"]').tap();
    await p.evaluate(()=>{
        window.SillyTavern.getContext().generateQuietPrompt=async()=>{
            window.calls++;return '<content>'+JSON.stringify({date:'2026-01-16',events:[],living:{total:0,bookedIds:[]},business:[],note:'literal <analysis> text'})+'</content>';
        };
    });
    await p.getByRole('button',{name:'一键更新',exact:true}).tap();
    await p.getByText('账本已更新',{exact:true}).waitFor();
    assert.equal(await p.getByText('literal <analysis> text',{exact:true}).count(),0,'assessment explanation is not displayed');
    assert.equal(await p.getByText(/更新账本时结算|本轮已更新/).count(),0,'no internal timing explanation');
    assert.equal(await p.locator('[data-asset-action="update"]').isDisabled(),true);
    assert.equal(await p.evaluate(()=>window.calls),2,'success uses one new manual request');

    await p.evaluate(async () => {
        await window.advance('日期：2026-01-17\n继续生活。');
        window.SillyTavern.getContext().generateQuietPrompt = async () => {
            window.calls++; return JSON.stringify({date:'2026-01-16',events:[],living:{total:100,bookedIds:[]},business:[]});
        };
    });
    await p.getByRole('button',{name:'一键更新',exact:true}).tap();
    await p.getByText(/正文日期为 2026-01-17，模型返回 2026-01-16/).waitFor();
    await p.getByText('$4,995.00',{exact:true}).waitFor();
    assert.equal(await p.evaluate(()=>window.calls),3,'date conflict does not retry');
    assert.equal(await p.locator('[data-asset-action="update"]').isDisabled(),false);
    await p.locator('[data-action="home"]').tap();await p.locator('[data-app="settings"]').tap();await p.locator('[data-section="errors"]').tap();
    const dateLog=await p.locator('[data-error-log]').inputValue();
    assert.match(dateLog,/ASSET_DATE_MISMATCH/);
    assert.match(dateLog,/正文日期：2026-01-17；模型日期：2026-01-16/);

    await p.evaluate(()=>localStorage.removeItem('assets-test'));await p.reload();
    await p.evaluate(()=>{window.financeResponse={initial:{balance:1000,holdings:[{name:'项目持续收益权',category:'investment',value:null,details:'保留10%收益权',rights:{sharePercent:10}}],jobs:[]}};});
    await p.locator('.pp-launcher').tap();await p.locator('[data-app="assets"]').tap();await p.getByRole('button',{name:'一键更新',exact:true}).tap();await p.getByText('$1,000.00',{exact:true}).waitFor();
    await p.locator('[data-asset-tab="investment"]').tap();await p.getByText('待估值',{exact:true}).waitFor();await checkBottom();await p.screenshot({path:resolve(root,'../qa-results/assets-rights-pending-320.png')});
    await p.evaluate(async()=>{const evidence='Sam将部分权益转让，保留比例变为5%。';await window.advance('日期：2026-01-20\n'+evidence+'<!--durian-money:'+JSON.stringify({kind:'asset',name:'项目持续收益权',action:'amend',holdingId:'initial:holding:0',details:'保留5%收益权',rights:{sharePercent:5},evidence})+'-->');window.financeResponse={date:'2026-02-01',events:[],living:{total:0,bookedIds:[]},business:[{id:'initial:holding:0',netIncome:100,bookedIds:[]}]};await window.advance('日期：2026-02-01\n月末结算。');});
    await p.getByRole('button',{name:'一键更新',exact:true}).tap();await p.getByText(/收益期间超出有效持有期或跨越权益变更/).waitFor();assert.equal(await p.locator('[data-asset-action="update"]').isDisabled(),false);
    await p.evaluate(()=>{window.financeResponse.business=[{id:'initial:holding:0',from:'2026-01-15',to:'2026-01-20',netIncome:100,bookedIds:[]},{id:'initial:holding:0',from:'2026-01-20',to:'2026-02-01',netIncome:50,bookedIds:[]}];});
    await p.getByRole('button',{name:'一键更新',exact:true}).tap();await p.locator('[data-asset-tab="cash"]').tap();await p.getByText('$1,150.00',{exact:true}).waitFor();await p.reload();await p.locator('.pp-launcher').tap();await p.locator('[data-app="assets"]').tap();await p.getByText('$1,150.00',{exact:true}).waitFor();
    assert.equal(await p.locator('[data-asset-action="update"]').isDisabled(),true);await p.locator('[data-asset-tab="investment"]').tap();await p.getByText('待估值',{exact:true}).waitFor();assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    console.log('PASS rights mobile: unknown value saves, partial amendment, invalid period rejected, valid split income, persistence');

    await p.evaluate(()=>localStorage.removeItem('assets-test'));await p.reload();
    await p.evaluate(()=>{const c=window.SillyTavern.getContext();c.chat=[{mes:'日期：2026-05-12\nSam工作中。',is_user:false}];window.financeResponse={initial:{balance:12000,holdings:[],jobs:[{name:'文学作者',monthlySalary:4500}]}};});
    await p.locator('.pp-launcher').tap();await p.locator('[data-app="assets"]').tap();await p.locator('[data-asset-action="update"]').tap();await p.getByText('$12,000.00',{exact:true}).waitFor();
    await p.evaluate(async()=>{
        const rows=['餐费','交通费','酒店费','日用品'].map(name=>({kind:'expense',name,evidence:'Sam支付了'+name+'。'}));
        await window.advance('日期：2026-05-20\n'+rows.map(r=>r.evidence+'<!--durian-money:'+JSON.stringify(r)+'-->').join('\n'));
        await window.advance('【2026年5月20日 09:30 星期三 至 2026年6月24日 19:40 星期三|旅行结束】');
        window.financeResponse={date:'2026-06-24',events:[1,2,3,4].map(n=>({id:'P'+n,amount:100})),living:{total:2000,bookedIds:['bad']},business:[]};
    });
    await p.locator('[data-asset-action="update"]').tap();await p.getByText(/费用抵扣失败.*未找到对应/).waitFor();
    assert.equal(await p.locator('[data-asset-action="update"]').isDisabled(),false);await p.getByText('$12,000.00',{exact:true}).waitFor();
    await p.evaluate(()=>window.financeResponse.living.bookedIds=['P1','P2','P3','P4']);
    await p.locator('[data-asset-action="update"]').tap();await p.getByText('$14,950.00',{exact:true}).waitFor();
    await p.getByText('上次结算明细',{exact:true}).waitFor();await p.getByText(/2026-05-12 至 2026-06-24 · 43 天/).waitFor();
    await p.getByText('$1,600.00',{exact:true}).waitFor();await checkBottom();
    await p.screenshot({path:resolve(root,'../qa-results/assets-settlement-320.png')});
    await p.reload();await p.locator('.pp-launcher').tap();await p.locator('[data-app="assets"]').tap();
    await p.getByText(/43 天/).waitFor();assert.equal(await p.locator('[data-asset-action="update"]').isDisabled(),true);
    console.log('PASS settlement mobile: failed offsets preserve balance, four pending aliases settle 43 days, expense offsets and salary visible, reload preserved');
    assert.deepEqual(errors, []); assert.deepEqual(external, []); console.log('PASS assets mobile: open/tabs zero API, four categories, explicit expense, payday, persisted lock, rollback, blocked transfer cancellation, 320px layout, no external requests');
} finally { await browser.close(); server.close(); }
