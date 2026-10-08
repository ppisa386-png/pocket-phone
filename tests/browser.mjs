// Optional browser QA: requires Playwright. Uses only a local HTTP fixture.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const project = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(import.meta.url);
const { chromium } = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
    ? createRequire(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + '/')('playwright') : require('playwright');
const screenshotDir = resolve(project, '..', 'qa-results');
await mkdir(screenshotDir, { recursive: true });
const fixture = legacy => '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#ddd;font-family:sans-serif;color:#c00}button{border:10px solid red;background:red;font-size:30px}#extensions_settings{max-width:300px}.menu_button{width:min-content!important;white-space:normal!important}</style></head><body><div id="extensions_settings"></div><p id="chat">正文不应被修改</p><script>window.saved=0;const extensionSettings=JSON.parse(localStorage.getItem("fixture-settings")||"{}");const context={extensionSettings,mainApi:"openai",saveSettingsDebounced(){window.saved++;localStorage.setItem("fixture-settings",JSON.stringify(extensionSettings));}}' + (legacy ? '' : ';context.event_types={APP_READY:"ready"};context.eventSource={on(type,fn){queueMicrotask(fn)}}') + ';window.SillyTavern={getContext(){return context}}</script><script type="module" src="/index.js"></script></body></html>';
const phoneFixture = () => fixture(false).replace('<script type="module" src="/index.js"></script>', `<script>
const ctx = window.SillyTavern.getContext();
ctx.chatId = 'phone-test'; ctx.name1 = 'Sam'; ctx.name2 = 'Alex'; ctx.characterId = 0; ctx.characters = [{name:'Alex',avatar:'alex.png'}]; ctx.onlineStatus = 'connected';
const persistedChat = JSON.parse(localStorage.getItem('phone-test-data') || 'null');
ctx.chat = persistedChat?.chat || [{name:'Alex',mes:'Alex gives you his number: +1 212 555 0123.'}];
ctx.chatMetadata = persistedChat?.metadata || {};
ctx.saveMetadata = async () => localStorage.setItem('phone-test-data', JSON.stringify({chat:ctx.chat,metadata:ctx.chatMetadata}));
const handlers = {}; ctx.event_types = Object.fromEntries(['APP_READY','CHAT_CHANGED','MESSAGE_EDITED','MESSAGE_DELETED','GENERATION_STARTED','GENERATION_AFTER_COMMANDS','GENERATION_ENDED'].map(n => [n,n]));
ctx.eventSource = {on(type, fn) {if(type==='APP_READY') queueMicrotask(fn); else (handlers[type] ||= []).push(fn);},async emit(type,...args) {for(const fn of handlers[type] || []) await fn(...args);}};
ctx.extensionPrompts = {};
ctx.setExtensionPrompt = (key,value,position,depth,scan,role,filter) => { ctx.extensionPrompts[key] = {value,position,depth,scan,role,filter}; };
window.modelCalls=0;
ctx.generateQuietPrompt = async options => {
 window.modelCalls++; await ctx.eventSource.emit('GENERATION_STARTED','quiet');
 const answer = options.quietPrompt.includes('当前任务：主动联系判断') ? (window.proactiveReply || (window.allowIncoming ? {status:'ringing',can_obtain_number:true,route:'known_number',channel:'',evidence:'Sam gave Alex their phone number.',reason:'Confirm the meeting.',reason_kind:'urgent_question',reason_evidence:window.contactEvidence||'Sam gave Alex their phone number.',requires_live_conversation:true} : {status:'none'})) : options.quietPrompt.includes('"contacts"') ? {contacts:[{name:'Alex',number:'+1 212 555 0123',user_has_number:true,evidence:'Alex gives you his number: +1 212 555 0123.'}]} : options.quietPrompt.includes('当前渠道：短信') ? {status:'reply',text:'Text received.'} : {status:'answered',text:options.quietPrompt.includes('Can you hear me?') ? 'I can hear you.' : 'Hello?'};
 if(options.quietPrompt.includes('当前渠道：短信')) { if(window.smsFail) throw new Error('Test reply failure'); if(window.smsHold) await new Promise(resolve => {window.finishSMS = resolve;}); }
 await ctx.eventSource.emit('GENERATION_ENDED',ctx.chat.length); return JSON.stringify(answer);
};
</script><script type="module" src="/index.js"></script>`);
const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/phone-fixture') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(phoneFixture()); return; }
        if (url.pathname === '/fixture') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fixture(url.searchParams.has('legacy'))); return; }
        const filename = url.pathname === '/preview' ? resolve(project, '..', 'deliverables/pocket-phone-preview.html') : resolve(project, '.' + url.pathname);
        if (url.pathname !== '/preview' && !filename.startsWith(project + '/')) { res.writeHead(403).end(); return; }
        res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' })[extname(filename)] || 'text/plain');
        res.end(await readFile(filename));
    } catch { res.writeHead(404).end(); }
});
await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}), args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
const errors = [];
const external = [];
function track(page) {
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (!request.url().startsWith(origin)) external.push(request.url()); });
}
const check = (condition, message) => { assert.ok(condition, message); console.log('PASS ' + message); };
try {
    if (process.env.QA_PART !== 'integration') {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage(); track(page);
    await page.goto(origin + '/preview');
    const phone = page.locator('.pp-phone');
    await phone.waitFor({ state: 'visible' });
    check(await page.locator('.pp-app').count() === 6, 'six desktop apps');
    await page.screenshot({ path: screenshotDir + '/desktop.png' });
    await page.getByRole('button', { name: '收起手机', exact: true }).click();
    const before = await page.locator('.pp-launcher').boundingBox();
    await page.mouse.move(before.x + 20, before.y + 20);
    await page.mouse.down();
    await page.mouse.move(200, 240, { steps: 12 });
    await page.mouse.up();
    check(await phone.isHidden(), 'drag does not open phone');
    const dragged = await page.locator('.pp-launcher').boundingBox();
    await page.reload();
    const restored = await page.locator('.pp-launcher').boundingBox();
    check(Math.abs(dragged.x - restored.x) < 1 && Math.abs(dragged.y - restored.y) < 1, 'drag position survives reload');
    await page.getByRole('button', { name: '收起手机', exact: true }).click();
    await page.locator('#preview-visibility').uncheck();
    check(await page.locator('.pp-launcher').isHidden(), 'launcher can be hidden');
    await page.locator('#preview-settings').click();
    check(await phone.isVisible(), 'settings entry works with hidden launcher');
    await page.locator('[data-section="apps"]').click();
    await page.getByRole('switch', { name: '启用X', exact: true }).uncheck();
    await page.getByRole('button', { name: '回到桌面', exact: true }).click();
    check(await page.locator('[data-app="x"]').count() === 0, 'disabled app disappears from desktop');
    await page.getByRole('button', { name: '打开设置', exact: true }).last().click();
    await page.locator('[data-section="apps"]').click();
    await page.getByRole('switch', { name: '启用X', exact: true }).check();
    await page.getByRole('button', { name: '回到桌面', exact: true }).click();
    check(await page.locator('[data-app="x"]').count() === 1, 'app returns after enabling');
    await page.locator('[data-app="settings"]').click();
    await page.locator('[data-section="retry"]').click();
    const retries = page.locator('[data-setting="retries"]');
    await retries.fill('15'); await retries.press('Tab');
    await retries.fill('16'); await retries.press('Tab');
    check(await retries.inputValue() === '15', 'retry count rejects 16');
    await retries.fill('0'); await retries.press('Tab');
    await page.reload(); await page.locator('#preview-settings').click();
    await page.locator('[data-section="retry"]').click();
    check(await retries.inputValue() === '0', 'zero retry setting survives reload');
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await page.locator('[data-section="prompts"]').click();
    await page.locator('[data-prompt-selector]').selectOption('x');
    const payload = '</textarea><script>window.promptInjection=true</script> & 中文';
    await page.locator('[data-prompt-editor]').fill(payload);
    await page.reload(); await page.locator('#preview-settings').click();
    await page.locator('[data-section="prompts"]').click();
    await page.locator('[data-prompt-selector]').selectOption('x');
    check(await page.locator('[data-prompt-editor]').inputValue() === payload, 'prompt edits survive reload exactly');
    check(await page.evaluate(() => !window.promptInjection), 'prompt text is not executed as HTML');
    await page.getByRole('button', { name: '恢复此项默认', exact: true }).click();
    check((await page.locator('[data-prompt-editor]').inputValue()).startsWith('生成 X'), 'single prompt reset');
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await page.locator('[data-section="appearance"]').click();
    await page.locator('[data-setting="theme"]').selectOption('light');
    await page.getByRole('button', { name: '海蓝壁纸' }).click();
    await page.locator('[data-setting="fontSize"]').fill('20');
    await page.locator('[data-setting="fontSize"]').dispatchEvent('change');
    await page.reload(); await page.locator('#preview-settings').click();
    await page.locator('[data-section="appearance"]').click();
    check(await page.locator('[data-setting="theme"]').inputValue() === 'light', 'theme survives reload');
    check(await page.locator('[data-setting="fontSize"]').inputValue() === '20', 'font size survives reload');
    await page.screenshot({ path: screenshotDir + '/settings-light.png' });
    await context.close();

    for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
        const mobile = await browser.newContext({ viewport: size, isMobile: true, hasTouch: true });
        const p = await mobile.newPage(); track(p); await p.goto(origin + '/preview');
        const box = await p.locator('.pp-phone').boundingBox();
        check(box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width + 1 && box.y + box.height <= size.height + 1, 'window within viewport ' + size.width + 'x' + size.height);
        check(await p.locator('.pp-content').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'no horizontal phone overflow ' + size.width);
        await p.getByRole('button', { name: '收起手机', exact: true }).tap();
        await p.locator('.pp-launcher').tap();
        check(await p.locator('.pp-phone').isVisible(), 'touch launcher opens ' + size.width);
        if (size.width === 390) await p.screenshot({ path: screenshotDir + '/mobile.png' });
        await mobile.close();
    }

    }
    for (const path of ['/fixture', '/fixture?legacy=1']) {
        const integrated = await browser.newContext({ viewport: { width: 1100, height: 850 } });
        const p = await integrated.newPage(); track(p); await p.goto(origin + path);
        await p.locator('#personal-pocket-phone-extension-settings').waitFor();
        check(await p.locator('[data-pp-open]').evaluate(el => getComputedStyle(el).whiteSpace === 'nowrap' && el.getBoundingClientRect().width > 100), 'text buttons stay horizontal under host theme ' + path);
        check(await p.locator('.pp-launcher .icon-tabler-device-mobile-star').count() === 1, 'user supplied mobile-star SVG ' + path);
        // Reproduce a mobile browser that sends pointerup but omits click.
        await p.locator('.pp-launcher svg').dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, clientX: 20, clientY: 20 });
        await p.locator('.pp-launcher svg').dispatchEvent('pointermove', { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: 28, clientY: 20 });
        await p.locator('.pp-launcher svg').dispatchEvent('pointerup', { pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, clientX: 28, clientY: 20 });
        check(await p.locator('.pp-phone').isVisible(), 'touch tap with slight movement opens without click ' + path);
        await p.locator('.pp-launcher').dispatchEvent('click', { detail: 1 });
        check(await p.locator('.pp-phone').isVisible(), 'follow-up click does not close phone ' + path);

        await p.locator('[data-pp-open]').click();
        await p.locator('[data-section="apps"]').click();
        await p.getByRole('switch', { name: '启用Amazon', exact: true }).uncheck();
        check(await p.evaluate(() => window.saved > 0 && !window.SillyTavern.getContext().extensionSettings.personal_pocket_phone.apps.amazon), 'SillyTavern settings API saves ' + path);
        check(await p.locator('#chat').textContent() === '正文不应被修改', 'chat untouched ' + path);
        check(await p.locator('.pp-icon-button').first().evaluate(el => getComputedStyle(el).borderTopWidth === '0px'), 'host styles do not leak into phone ' + path);
        await p.reload(); await p.locator('[data-pp-open]').click();
        await p.locator('[data-section="apps"]').click();
        check(!await p.getByRole('switch', { name: '启用Amazon', exact: true }).isChecked(), 'integrated persistence ' + path);
        await p.getByRole('button', { name: '收起手机', exact: true }).click();
        await p.locator('[data-pp-visibility]').uncheck();
        check(await p.locator('.pp-launcher').isHidden(), 'extension drawer hides launcher ' + path);
        await integrated.close();
    }
    // Real browser touch hit-testing, including host transforms and an overlay
    // above the old widget z-index. Synthetic dispatchEvent cannot catch this.
    for (const fallback of [false, true]) {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 760 }, isMobile: true, hasTouch: true });
        if (fallback) await ctx.addInitScript(() => { HTMLElement.prototype.showPopover = undefined; });
        const p = await ctx.newPage(); track(p);
        await p.goto(origin + '/fixture');
        const launcher = p.locator('.pp-launcher');
        await launcher.waitFor();
        await p.addStyleTag({ content: 'html { transform: translateZ(0); } body { height:100dvh; overflow:hidden; } #personal-pocket-phone-root { transform:translateZ(0); overflow:hidden; }' });
        if (!fallback) await p.evaluate(() => {
            const cover = document.createElement('div');
            cover.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:transparent';
            cover.id = 'test-overlay'; document.body.append(cover);
        });
        const box = await launcher.boundingBox();
        check(box.width === 36 && box.height === 36, 'compact 36px launcher, fallback=' + fallback);
        await launcher.tap({ timeout: 5000 });
        check(await p.locator('.pp-phone').isVisible(), 'actual touch opens above theme layers, fallback=' + fallback);
        await p.locator('[data-app="settings"]').tap();
        check(await p.locator('[data-section="appearance"]').isVisible(), 'phone content receives touch');
        await p.getByRole('button', { name: '收起手机', exact: true }).tap();
        check(await p.locator('.pp-phone').isHidden(), 'touch closes phone');
        await p.evaluate(() => document.getElementById('test-overlay')?.remove());
        await p.locator('[data-pp-visibility]').uncheck();
        check(await launcher.isHidden(), 'top layer does not block underlying host controls');
        await ctx.close();
    }
    {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        const p = await ctx.newPage(); track(p); await p.goto(origin + '/phone-fixture');
        await p.locator('.pp-launcher').tap();
        await p.locator('[data-app="phone"]').tap();
        await p.locator('[data-phone-tab="contacts"]').tap();
        await p.locator('[data-phone-dial]').waitFor();
        check(await p.locator('.pp-contact-row').count() === 1, 'phone UI shows contact recognized from narrative');
        await p.locator('[data-phone-dial]').tap();
        await p.getByText('Hello?', { exact: true }).waitFor();
        await p.locator('[data-phone-draft]').fill('Can you hear me?');
        await p.getByRole('button', { name: '发送', exact: true }).tap();
        await p.getByText('I can hear you.', { exact: true }).waitFor();
        check(await p.locator('.pp-call-turn').count() === 3, 'touch phone UI supports two-way text call');
        await p.locator('[data-phone-hangup]').tap();
        await p.getByText('拨出 · 已结束', { exact: true }).waitFor();
        await p.reload(); await p.locator('.pp-launcher').tap(); await p.locator('[data-app="phone"]').tap();
        await p.getByText('拨出 · 已结束', { exact: true }).waitFor();
        check(await p.evaluate(() => window.modelCalls) === 0, 'reopening unchanged chat restores history without API request');
        await p.locator('[data-phone-record]').tap();
        check(await p.locator('.pp-call-turn').count() === 3, 'call transcript survives reload');
        await p.locator('[data-phone-list]').tap();
        await p.locator('[data-phone-tab="contacts"]').tap();
        await p.evaluate(async () => { const c = window.SillyTavern.getContext(); c.chat[0].mes = 'Alex refuses to give his number.'; await c.eventSource.emit('MESSAGE_EDITED'); });
        await p.locator('[data-phone-dial]').waitFor({ state: 'detached' });
        check(await p.locator('.pp-contact-row').count() === 0, 'phone contacts disappear when acquisition is removed');
        await ctx.close();
    }
    {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        const p = await ctx.newPage(); track(p); await p.goto(origin + '/phone-fixture');
        await p.locator('.pp-launcher').tap(); await p.locator('[data-app="messages"]').tap();
        await p.locator('[data-sms-new]').tap(); await p.locator('[data-sms-contact]').waitFor();
        await p.locator('[data-sms-contact]').tap();
        const payload = '<script>window.smsInjection=true</script> Hello';
        await p.locator('[data-sms-draft]').fill(payload);
        await p.getByRole('button', { name: '发送短信', exact: true }).tap();
        await p.getByText('Text received.', { exact: true }).waitFor();
        check(await p.locator('.pp-sms-item').count() === 2, 'SMS UI sends and receives bubbles');
        check(await p.evaluate(() => !window.smsInjection), 'SMS content renders as text, not HTML');
        await p.waitForFunction(() => document.querySelector('#personal-pocket-phone-root').shadowRoot.querySelector('[data-sms-draft]').value === '');
        await p.evaluate(() => { window.smsHold = true; });
        await p.locator('[data-sms-draft]').fill('A later message');
        await p.getByRole('button', { name: '发送短信', exact: true }).tap();
        await p.waitForFunction(() => typeof window.finishSMS === 'function');
        await p.getByRole('button', { name: '回到桌面', exact: true }).tap();
        await p.evaluate(() => { window.smsHold = false; window.finishSMS(); });
        await p.locator('[data-app="messages"] .pp-app-badge').waitFor();
        check(await p.locator('.pp-app-badge').textContent() === '1', 'SMS reply outside thread shows one unread badge');
        await p.reload(); await p.locator('.pp-launcher').tap();
        await p.locator('[data-app="messages"] .pp-app-badge').waitFor();
        await p.locator('[data-app="messages"]').tap();
        await p.locator('[data-sms-contact]').tap();
        check(await p.locator('.pp-sms-item').count() === 4, 'SMS thread survives refresh');
        await p.getByRole('button', { name: '回到桌面', exact: true }).tap();
        await p.locator('[data-app="messages"] .pp-app-badge').waitFor({ state: 'detached' });
        check(await p.evaluate(() => window.modelCalls) === 0, 'reading restored SMS does not call API');
        await p.locator('[data-app="messages"]').tap();
        await p.evaluate(() => { window.smsFail = true; });
        await p.locator('[data-sms-draft]').fill('Do not duplicate this');
        await p.getByRole('button', { name: '发送短信', exact: true }).tap();
        await p.locator('[data-sms-retry]').waitFor();
        await p.evaluate(() => { window.smsFail = false; });
        await p.locator('[data-sms-retry]').tap();
        await p.locator('.pp-sms-item[data-role="assistant"]').nth(2).waitFor();
        check(await p.locator('.pp-sms-item[data-role="user"]').count() === 3, 'manual SMS retry does not duplicate outgoing bubble');
        const syncResult = await p.evaluate(async () => {
            const c = window.SillyTavern.getContext();
            const callsBefore = window.modelCalls; const floorsBefore = c.chat.length;
            await c.eventSource.emit('GENERATION_STARTED', 'normal');
            await c.eventSource.emit('GENERATION_AFTER_COMMANDS', 'normal');
            const prompt = c.extensionPrompts.durian_phone_continuity;
            const result = { text: prompt.value, allowed: prompt.filter?.(), callsUnchanged: callsBefore === window.modelCalls, floorsUnchanged: floorsBefore === c.chat.length };
            await c.eventSource.emit('GENERATION_ENDED');
            result.cleared = c.extensionPrompts.durian_phone_continuity.value === '';
            c.chat[0].mes = 'No phone numbers were exchanged.';
            await c.eventSource.emit('MESSAGE_EDITED');
            await c.eventSource.emit('GENERATION_STARTED', 'normal');
            await c.eventSource.emit('GENERATION_AFTER_COMMANDS', 'normal');
            result.rollbackCleared = c.extensionPrompts.durian_phone_continuity.value === '';
            await c.eventSource.emit('GENERATION_ENDED');
            return result;
        });
        check(syncResult.text.includes('Text received.') && syncResult.allowed, 'actual SMS history enters the next narrative prompt');
        check(syncResult.callsUnchanged && syncResult.floorsUnchanged, 'continuity adds no model request or visible chat floor');
        check(syncResult.cleared && syncResult.rollbackCleared, 'continuity context clears after generation and invalidated source');

        await ctx.close();
    }
    {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        const p = await ctx.newPage(); track(p); await p.goto(origin + '/phone-fixture');
        await p.locator('#personal-pocket-phone-extension-settings').waitFor();
        async function generateIncoming(text) {
            await p.evaluate(async text => {
                const c = window.SillyTavern.getContext(); window.allowIncoming = true; window.contactEvidence = text;
                await c.eventSource.emit('GENERATION_STARTED', 'normal');
                c.chat.push({name:'Alex',mes:text,is_user:false});
                await c.eventSource.emit('GENERATION_ENDED');
            }, text);
        }
        await generateIncoming('Sam gave Alex their phone number. Alex leaves to go home.');
        await p.locator('.pp-launcher-badge').waitFor({ state: 'visible' });
        check(await p.locator('.pp-phone').isHidden(), 'incoming call adds badge without forcing the phone open');
        await p.locator('.pp-launcher').tap();
        await p.locator('[data-phone-answer]').waitFor();
        check(await p.locator('.pp-call-turn').count() === 0, 'ringing screen has no speech before acceptance');
        check(await p.evaluate(() => window.modelCalls) === 1, 'one foreground reply triggers exactly one incoming check');
        await p.locator('[data-phone-decline]').tap();
        await p.getByText('已拒接', {exact:true}).waitFor();
        check(await p.evaluate(() => window.modelCalls) === 1, 'declining makes no API request');
        await p.getByRole('button', {name:'回到桌面',exact:true}).tap();
        check(await p.locator('[data-app="phone"] .pp-app-badge').count() === 0, 'declined incoming badge clears');
        await p.evaluate(() => { const c = window.SillyTavern.getContext(); for(let i=0;i<16;i++) c.chat.push({name:'Sam',mes:'Continue '+i,is_user:true}); });
        await generateIncoming('Alex has an urgent question about the meeting.');
        await p.locator('[data-app="phone"] .pp-app-badge').waitFor();
        await p.locator('[data-app="phone"]').tap();
        await p.locator('[data-phone-answer]').tap();
        await p.getByText('Hello?', {exact:true}).waitFor();
        await p.locator('[data-phone-draft]').fill('Can you hear me?');
        await p.getByRole('button', {name:'发送',exact:true}).tap();
        await p.getByText('I can hear you.', {exact:true}).waitFor();
        await p.locator('[data-phone-hangup]').tap();
        await p.getByText('来电 · 已结束', {exact:true}).waitFor();
        check(await p.getByText('来电 · 已拒接', {exact:true}).count() === 1, 'incoming history distinguishes completed and declined calls');
        await p.reload(); await p.locator('.pp-launcher').tap(); await p.locator('[data-app="phone"]').tap();
        await p.getByText('来电 · 已结束', {exact:true}).waitFor();
        check(await p.evaluate(() => window.modelCalls) <= 1, 'reload restores incoming history without re-ringing');
        check(await p.locator('.pp-content').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'incoming UI fits mobile width');
        await ctx.close();
    }
    {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        const p = await ctx.newPage(); track(p); await p.goto(origin + '/phone-fixture');
        await p.locator('.pp-launcher').tap(); await p.locator('[data-app="settings"]').tap();
        await p.locator('[data-section="contact"]').tap();
        check(await p.locator('[data-setting="contactInterval"]').inputValue() === '8', 'proactive settings default to eight turns');
        check(await p.locator('[data-setting="unansweredInterval"]').inputValue() === '16', 'unanswered contact defaults to sixteen turns');
        await p.locator('[data-setting="contactInterval"]').fill('10'); await p.locator('[data-setting="contactInterval"]').press('Tab');
        await p.reload(); await p.locator('.pp-launcher').tap(); await p.locator('[data-app="settings"]').tap(); await p.locator('[data-section="contact"]').tap();
        check(await p.locator('[data-setting="contactInterval"]').inputValue() === '10', 'contact interval setting survives reload');
        await p.getByRole('button', {name:'回到桌面',exact:true}).tap();
        await p.evaluate(async () => {
            const c = window.SillyTavern.getContext();
            await c.eventSource.emit('GENERATION_STARTED','normal');
            c.chat[0].mes = 'Sam gave Alex their phone number.';
            c.chat.push({mes:'Alex receives a changed meeting address to pass on.',name:'Alex',is_user:false});
            window.proactiveReply = {status:'message',can_obtain_number:true,route:'known_number',channel:'',evidence:c.chat[0].mes,reason:'Changed address',reason_kind:'new_information',reason_evidence:c.chat[1].mes,text:'Meet at the library instead.'};
            await c.eventSource.emit('GENERATION_ENDED');
        });
        await p.locator('[data-app="messages"] .pp-app-badge').waitFor();
        check(await p.evaluate(() => window.modelCalls) === 1, 'one shared request produces proactive SMS');
        await p.locator('[data-app="messages"]').tap(); await p.locator('[data-sms-contact]').tap();
        await p.getByText('Meet at the library instead.', {exact:true}).waitFor();
        check(await p.getByText('短信发件人', {exact:true}).count() === 1, 'received SMS opens a thread without inventing a phone contact');
        await p.locator('[data-sms-draft]').fill('Got it.'); await p.getByRole('button', {name:'发送短信',exact:true}).tap();
        await p.getByText('Text received.', {exact:true}).waitFor();
        check(await p.locator('.pp-sms-item').count() === 3, 'user can reply in the incoming SMS thread');
        await p.reload(); await p.locator('.pp-launcher').tap(); await p.locator('[data-app="messages"]').tap(); await p.locator('[data-sms-contact]').tap();
        check(await p.locator('.pp-sms-item').count() === 3, 'proactive SMS conversation survives reload');
        const before = await p.evaluate(() => window.modelCalls);
        await p.evaluate(async () => {
            const c = window.SillyTavern.getContext(); await c.eventSource.emit('GENERATION_STARTED','normal');
            c.chat.push({mes:'Continue',name:'Sam',is_user:true},{mes:'The story continues.',name:'Alex',is_user:false});
            await c.eventSource.emit('GENERATION_ENDED');
        });
        await p.waitForTimeout(100);
        check(await p.evaluate(() => window.modelCalls) === before, 'cooldown prevents another model request after refresh');
        await ctx.close();
    }
    check(errors.length === 0, 'no browser JavaScript errors: ' + errors.join('; '));
    check(external.length === 0, 'no external network or model requests');
} catch (error) {
    console.error('Browser errors:', errors);
    throw error;
} finally {
    await browser.close();
    await new Promise(done => server.close(done));
}
