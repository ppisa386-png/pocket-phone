// Real Chromium browser acceptance and screenshots for the opt-in enamel theme.
// Run after npm run build:preview. No real SillyTavern data or model calls.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const { chromium } = createRequire(import.meta.url)('playwright');
const output = resolve(root, '..', 'qa-results');
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = resolve(root, '.' + (pathname === '/' ? '/preview.html' : pathname));
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    res.setHeader('Content-Type', ({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[extname(file)] || 'text/plain');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']});
const errors = [];
try {
  const context = await browser.newContext({ viewport:{width:390,height:844},isMobile:true,hasTouch:true });
  const page = await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>assert.ok(request.url().startsWith(origin),'no external asset requests: '+request.url()));
  await page.goto(origin+'/preview.html');
  const phone = page.locator('.pp-phone');
  try { await phone.waitFor({state:'visible',timeout:12000}); }
  catch (error) {
    const state = await page.evaluate(()=>({title:document.title,phoneRoot:!!document.querySelector('#personal-pocket-phone-root'),bodyText:document.body.innerText.slice(0,250),scripts:document.scripts.length}));
    console.error('Browser bootstrap diagnostics', JSON.stringify({errors,state}));
    throw error;
  }
  assert.equal(await page.locator('.pp-layer').getAttribute('data-skin'),'classic');
  assert.equal(await page.locator('.pp-app').count(),11);
  assert.equal(await page.locator('.pp-haze-art').count(),0);
  await phone.screenshot({path:resolve(output,'enamel-classic-before.png')});

  await page.locator('[data-app="settings"]').click();
  await page.locator('[data-section="appearance"]').click();
  const originalWallpaper = await page.locator('.pp-swatch[aria-pressed="true"]').getAttribute('data-wallpaper');
  await page.locator('[data-setting="theme"]').selectOption('enamel');
  assert.equal(await page.locator('.pp-layer').getAttribute('data-skin'),'enamel');
  assert.equal(await page.locator('.pp-layer').getAttribute('data-theme'),'light');
  assert.equal(await page.locator('.pp-layer').getAttribute('data-wallpaper'),'haze');
  assert.equal(await page.locator('.pp-swatch[aria-pressed="true"]').getAttribute('data-wallpaper'),'haze');
  assert.equal(await page.locator('[data-wallpaper]').count()>=5,true);
  await page.getByRole('button',{name:'返回',exact:true}).click();
  await phone.screenshot({path:resolve(output,'enamel-settings.png')});

  await page.getByRole('button',{name:'回到桌面',exact:true}).click();
  assert.equal(await page.locator('.pp-haze-art').count(),11);
  const shapes = await page.locator('.pp-haze-art path[stroke="#c6a67d"]').count();
  assert.equal(shapes,11,'all badges have enamel-metal edging');
  const noOverflow = await page.locator('.pp-content').evaluate(el=>el.scrollWidth<=el.clientWidth+1);
  assert.ok(noOverflow,'enamel desktop has no horizontal overflow');
  await phone.screenshot({path:resolve(output,'enamel-home-390.png')});

  await page.locator('[data-app="whatsapp"]').click();
  assert.equal(await phone.getAttribute('data-active-app'),'whatsapp');
  const appBackground = await phone.evaluate(el=>getComputedStyle(el).backgroundColor);
  await phone.screenshot({path:resolve(output,'enamel-whatsapp.png')});
  await page.getByRole('button',{name:'回到桌面',exact:true}).click();
  await page.getByRole('button',{name:'收起手机',exact:true}).click();

  const launcher = page.locator('.pp-launcher');
  assert.equal(await phone.isVisible(),false);
  assert.equal(await page.locator('.pp-haze-launcher-art:visible').count(),1);
  await page.waitForTimeout(570);
  await page.screenshot({path:resolve(output,'enamel-floating-closed.png')});
  await launcher.click();
  await page.waitForTimeout(180);
  assert.equal(await page.locator('.pp-haze-spark').count(),12);
  const burst = await launcher.evaluate(el=>el.classList.contains('pp-haze-burst'));
  assert.ok(burst,'click triggers the finite snow/star burst');
  const bounding = await launcher.boundingBox();
  const clip={x:Math.max(0,bounding.x-44),y:Math.max(0,bounding.y-44),width:Math.min(126,390-Math.max(0,bounding.x-44)),height:Math.min(126,844-Math.max(0,bounding.y-44))};
  await page.screenshot({path:resolve(output,'enamel-floating-burst.png'),clip});
  await page.getByRole('button',{name:'收起手机',exact:true}).click();
  await page.waitForTimeout(570);
  await launcher.evaluate(el=>el.classList.remove('pp-haze-burst'));
  const before=await launcher.boundingBox();
  await page.mouse.move(before.x+17,before.y+17);
  await page.mouse.down();
  await page.mouse.move(before.x-95,before.y-100,{steps:12});
  await page.mouse.up();
  assert.equal(await phone.isVisible(),false,'dragging cannot trigger open');
  assert.equal(await launcher.evaluate(el=>el.classList.contains('pp-haze-burst')),false,'dragging cannot emit particles');

  await launcher.click();
  await page.setViewportSize({width:320,height:568});
  assert.ok(await page.locator('.pp-content').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'narrow home has no horizontal overflow');
  await phone.screenshot({path:resolve(output,'enamel-home-320.png')});
  await page.locator('[data-app="settings"]').click();
  await page.locator('[data-section="appearance"]').click();
  await page.locator('[data-setting="theme"]').selectOption('light');
  assert.equal(await page.locator('.pp-layer').getAttribute('data-skin'),'classic');
  assert.equal(await page.locator('.pp-layer').getAttribute('data-wallpaper'),originalWallpaper,'classic wallpaper survives enamel switch');
  await page.getByRole('button',{name:'回到桌面',exact:true}).click();
  assert.equal(await page.locator('.pp-haze-art').count(),0,'classic icons return without reloading');
  await page.locator('[data-app="whatsapp"]').click();
  assert.equal(await phone.evaluate(el=>getComputedStyle(el).backgroundColor),appBackground,'brand app shell matches classic light');
  await context.close();

  const reduced = await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  const reducePage = await reduced.newPage();
  await reducePage.goto(origin+'/preview.html');
  await reducePage.locator('.pp-launcher').waitFor();
  const settings = await reducePage.evaluate(()=>JSON.parse(localStorage.getItem('pocket_phone_preview_v010')||'{}'));
  assert.ok(settings && typeof settings==='object');
  await reduced.close();
  assert.deepEqual(errors,[],'no browser runtime errors');
  console.log('PASS enamel Chromium acceptance; screenshots saved under qa-results/');
} finally {
  await browser.close();
  await new Promise(resolveClose=>server.close(resolveClose));
}
