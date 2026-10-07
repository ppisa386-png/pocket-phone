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
const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
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
    check(errors.length === 0, 'no browser JavaScript errors: ' + errors.join('; '));
    check(external.length === 0, 'no external network or model requests');
} catch (error) {
    console.error('Browser errors:', errors);
    throw error;
} finally {
    await browser.close();
    await new Promise(done => server.close(done));
}
