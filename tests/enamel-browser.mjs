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
const fixtureHTML = "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\"><title>榴莲手机·真实模块视觉验收</title><style>body{margin:0;background:#e9e5e4;font-family:system-ui}main{padding:20px;color:#726c70;font-size:12px}</style></head><body><main>实际 HTML / CSS / SVG 浏览器测试（离线数据）</main><script type=\"module\">\nimport { mountPhone } from '/src/ui.js';\nimport { normalizeSettings } from '/src/config.js';\nconst KEY='pocket_phone_preview_v010';\nlet settings=normalizeSettings(JSON.parse(localStorage.getItem(KEY)||'{}'));\nconst adapter={\n  load:()=>settings,\n  save(next){settings=next;localStorage.setItem(KEY,JSON.stringify(next));},\n  onChange(){},\n  storyChat:()=>[{is_user:false,mes:'当前时间：2026-11-09 13:13'}],\n  userName:()=> '用户',\n  diagnostics:{add(error){console.error(error);},text:()=>'',persistent:()=>true},\n  connectionName:()=> '离线视觉验收'\n};\nconst styles=await (await fetch('/style.css')).text()+'\\n'+await (await fetch('/style-enamel.css')).text();\nwindow.controller=mountPhone({adapter,styles});\nwindow.controller.open();\nwindow.ready=true;\n</script></body></html>";
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/enamel-fixture') { res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixtureHTML);return; }
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
  await page.goto(origin+'/enamel-fixture');
  const phone = page.locator('.pp-phone');
  try { await phone.waitFor({state:'visible',timeout:12000}); }
  catch (error) {
    const state = await page.evaluate(()=>({title:document.title,phoneRoot:!!document.querySelector('#personal-pocket-phone-root'),ready:window.ready||false,bodyText:document.body.innerText.slice(0,250),scripts:document.scripts.length}));
    console.error('Browser bootstrap diagnostics', JSON.stringify({errors,state}));
    throw error;
  }
  assert.equal(await page.locator('.pp-layer').getAttribute('data-skin'),'classic');
  assert.equal(await page.locator('.pp-layer').getAttribute('data-launcher'),'classic');
  assert.equal(await page.locator('.pp-app').count(),11);
  assert.equal(await page.locator('.pp-haze-art').count(),0);
  assert.equal(await page.locator('.pp-status-time').isHidden(),true,'desktop top-left time is hidden');
  assert.equal(await page.locator('.pp-big-time').isVisible(),true,'desktop central clock remains');
  assert.equal(await page.locator('.pp-big-time').innerText(),'13:13','preview uses a representative fictional story time, not wall time');
  assert.match(await page.locator('.pp-date').innerText(),/2026-11-09/,'desktop has a real date layout');
  assert.equal(await page.locator('.pp-island').count(),1,'status island remains for dragging');
  await phone.screenshot({path:resolve(output,'enamel-classic-before.png')});

  await page.locator('[data-app="settings"]').click();
  await page.locator('[data-section="appearance"]').click();
  const originalWallpaper = await page.locator('.pp-swatch[aria-pressed="true"]').getAttribute('data-wallpaper');
  const launcherChoice=page.locator('[data-setting="launcherStyle"]');
  assert.equal(await launcherChoice.inputValue(),'classic');
  await page.locator('[data-setting="theme"]').selectOption('enamel');
  assert.equal(await page.locator('.pp-layer').getAttribute('data-launcher'),'enamel','entering enamel selects its Frost Bloom launcher');
  assert.equal(await launcherChoice.inputValue(),'enamel','the launcher setting reflects the theme default');
  await page.locator('[data-setting="theme"]').selectOption('dark');
  await launcherChoice.selectOption('classic');
  assert.equal(await page.locator('.pp-layer').getAttribute('data-launcher'),'classic','manual classic selection still works');
  await launcherChoice.selectOption('enamel');
  assert.equal(await page.locator('.pp-layer').getAttribute('data-skin'),'classic');
  assert.equal(await page.locator('.pp-layer').getAttribute('data-launcher'),'enamel');
  const independentFrostArt = await page.locator('.pp-frost-art').evaluate(el=>el.outerHTML);
  assert.equal(await page.locator('.pp-haze-launcher-art').isVisible(),true,'enamel ball works with dark phone theme');
  await page.locator('[data-setting="theme"]').selectOption('enamel');
  assert.equal(await page.locator('.pp-layer').getAttribute('data-skin'),'enamel');
  assert.equal(await page.locator('.pp-layer').getAttribute('data-theme'),'light');
  assert.equal(await page.locator('.pp-layer').getAttribute('data-wallpaper'),'haze');
  assert.equal(await page.locator('.pp-layer').getAttribute('data-launcher'),'enamel','launcher survives theme switch');
  assert.equal(await page.locator('.pp-frost-art').evaluate(el=>el.outerHTML),independentFrostArt,'theme default and independent style share one SVG, not stale copies');
  assert.equal(await page.locator('.pp-swatch[aria-pressed="true"]').getAttribute('data-wallpaper'),'haze');
  await page.locator('[data-setting="launcherStyle"]').selectOption('classic');
  assert.equal(await page.locator('.pp-haze-launcher-art').isVisible(),false,'classic ball works inside enamel theme');
  assert.equal(await page.locator('.pp-layer').getAttribute('data-skin'),'enamel');
  await page.locator('[data-setting="launcherStyle"]').selectOption('enamel');
  assert.equal(await page.locator('[data-wallpaper]').count()>=5,true);
  await page.getByRole('button',{name:'返回',exact:true}).click();
  assert.equal(await page.locator('.pp-status-time').isVisible(),true,'settings retain the status time');
  assert.equal(await page.locator('.pp-page-lead, [data-phone-enabled]').count(),0,'redundant settings rows removed');
  assert.equal(await page.locator('.pp-page .pp-card').first().locator('[data-section="appearance"]').count(),1);
  await phone.screenshot({path:resolve(output,'enamel-settings.png')});

  await page.getByRole('button',{name:'回到桌面',exact:true}).click();
  assert.equal(await page.locator('.pp-haze-art').count(),11);
  const shapes = await page.locator('.pp-haze-art path[stroke="#c6a67d"]').count();
  assert.equal(shapes,11,'all badges have enamel-metal edging');
  const noOverflow = await page.locator('.pp-content').evaluate(el=>el.scrollWidth<=el.clientWidth+1);
  assert.ok(noOverflow,'enamel desktop has no horizontal overflow');
  const rhythm=await page.locator('.pp-home').evaluate(home=>{
    const clock=home.querySelector('.pp-home-clock').getBoundingClientRect();
    const grid=home.querySelector('.pp-app-grid').getBoundingClientRect();
    const dock=home.querySelector('.pp-dock').getBoundingClientRect();
    return {upper:grid.top-clock.bottom,lower:dock.top-grid.bottom};
  });
  assert.ok(Math.abs(rhythm.upper-rhythm.lower)<4,`desktop icon grid balances clock and dock (${JSON.stringify(rhythm)})`);
  await phone.screenshot({path:resolve(output,'enamel-home-390.png')});
  await page.setViewportSize({width:360,height:740});
  assert.ok(await page.locator('.pp-content').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'360px home remains within its phone');
  await phone.screenshot({path:resolve(output,'enamel-home-360.png')});
  await page.setViewportSize({width:390,height:844});

  await page.locator('[data-app="whatsapp"]').click();
  assert.equal(await page.locator('.pp-status-time').isVisible(),true,'app pages retain the status time');
  assert.equal(await phone.getAttribute('data-active-app'),'whatsapp');
  const appBackground = await phone.evaluate(el=>getComputedStyle(el).backgroundColor);
  await phone.screenshot({path:resolve(output,'enamel-whatsapp.png')});
  await page.getByRole('button',{name:'回到桌面',exact:true}).click();
  await page.locator('[data-app="x"]').click();
  const photoField=page.locator('[data-x-field="imageDescription"]');
  const postField=page.locator('[data-x-field="post"]');
  assert.equal(await photoField.getAttribute('placeholder'),'图片描述，不带也可以～');
  assert.equal(await photoField.isVisible(),true);
  const photoBox=await photoField.boundingBox(),postBox=await postField.boundingBox();
  assert.ok(photoBox.y<postBox.y && photoBox.height<postBox.height,'optional image box is slimmer and above the tweet');
  assert.ok(photoBox.height<=36,'image description starts as a compact one-line field');
  const photoStyle=await photoField.evaluate(el=>{
    const style=getComputedStyle(el);
    return {background:style.backgroundColor,borderTop:style.borderTopWidth,borderLeft:style.borderLeftWidth,
      radius:style.borderTopLeftRadius,font:style.fontFamily,mainFont:getComputedStyle(el.closest('form').querySelector('[data-x-field="post"]')).fontFamily};
  });
  assert.equal(photoStyle.background,'rgba(0, 0, 0, 0)','media input has no filled card background');
  assert.equal(photoStyle.borderTop,'0px');assert.equal(photoStyle.borderLeft,'0px');
  assert.equal(photoStyle.radius,'0px','media input uses the same borderless X editor');
  assert.equal(photoStyle.font,photoStyle.mainFont,'both editors share typography');
  await phone.screenshot({path:resolve(output,'enamel-x-composer.png')});
  await photoField.click();
  assert.equal(await photoField.evaluate(el=>getComputedStyle(el,'::placeholder').opacity),'0','placeholder vanishes on focus');
  await photoField.fill('橱窗边的黑胶唱片与暖色灯光\\n黑胶封套与木架\\n玻璃窗外的雨滴');
  const expanded=await photoField.boundingBox();
  assert.ok(expanded.height>photoBox.height&&expanded.height<=110,'filled photo description grows only as needed');
  await postField.fill('午后在唱片店躲雨。');
  await page.setViewportSize({width:320,height:568});
  assert.ok(await page.locator('.pp-x-body').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'borderless composer fits a 320px phone');
  await phone.screenshot({path:resolve(output,'enamel-x-composer-320.png')});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.locator('.pp-x-body').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'X composer fits phone width');
  await page.getByRole('button',{name:'回到桌面',exact:true}).click();
  await page.getByRole('button',{name:'收起手机',exact:true}).click();

  const launcher = page.locator('.pp-launcher');
  assert.equal(await phone.isVisible(),false);
  assert.equal(await page.locator('.pp-haze-launcher-art:visible').count(),1);
  await page.waitForTimeout(570);
  await page.screenshot({path:resolve(output,'enamel-floating-closed.png')});
  // Test-only framing: move the launcher away from the viewport edge so the
  // entire 36px orb and sixfold bloom are visible in un-clipped real captures.
  await launcher.evaluate(el=>{el.style.left='160px';el.style.top='232px';});
  await launcher.click();
  await page.waitForTimeout(180);
  assert.equal(await page.locator('.pp-haze-spark').count(),12);
  const arms = page.locator('.pp-frost-branch');
  assert.equal(await arms.count(),6,'one original crystal arm per direction');
  assert.equal(await page.locator('.pp-frost-heart').count(),1,'one original inlaid center');
  assert.equal(await arms.first().evaluate(el=>getComputedStyle(el).animationName),'pp-frost-facet','six existing facets animate without changing SVG rotations');
  const burst = await launcher.evaluate(el=>el.classList.contains('pp-haze-burst'));
  assert.ok(burst,'click triggers the finite snow/star burst');
  assert.equal(await launcher.evaluate(el=>getComputedStyle(el).zIndex),'3','snowflake blooms over the newly opened phone, not underneath it');
  assert.ok(Number(await page.locator('.pp-frost-snow').evaluate(el=>getComputedStyle(el).opacity))>.1,'six-branch snowflake is perceptibly visible at 180ms');
  const bounding = await launcher.boundingBox();
  const clip={x:Math.max(0,bounding.x-44),y:Math.max(0,bounding.y-44),width:Math.min(126,390-Math.max(0,bounding.x-44)),height:Math.min(126,844-Math.max(0,bounding.y-44))};
  await page.screenshot({path:resolve(output,'enamel-floating-burst.png'),clip});
  await page.waitForTimeout(180);
  assert.ok(Number(await page.locator('.pp-frost-snow').evaluate(el=>getComputedStyle(el).opacity))>.9,'snowflake reaches its visible mid-bloom peak');
  await page.screenshot({path:resolve(output,'enamel-floating-burst-peak.png'),clip});
  const armValues=await arms.evaluateAll(elements=>elements.map(el=>({
    delay:parseFloat(getComputedStyle(el).animationDelay),
    opacity:Number(getComputedStyle(el).opacity)
  })));
  assert.deepEqual(armValues.map(x=>x.delay),[0,.016,.032,.048,.064,.08],'short optical cascade across six branches');
  assert.ok(armValues.every(x=>x.opacity>.65),'all arms remain legible at 36px bloom peak');
  assert.ok(Number(await page.locator('.pp-frost-heart').evaluate(el=>getComputedStyle(el).opacity))>.8,'center inlay catches light at peak');
  await page.waitForTimeout(360);
  assert.equal(await launcher.evaluate(el=>el.classList.contains('pp-haze-burst')),false,'burst returns to normal stacking and visual state after 680ms');
  assert.equal(await page.locator('.pp-frost-orb').evaluate(el=>getComputedStyle(el).opacity),'1','orb returns to fully visible');
  assert.equal(await page.locator('.pp-frost-snow').evaluate(el=>getComputedStyle(el).opacity),'0','snowflake is completely hidden after the cycle');
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
  await page.waitForTimeout(750); // the jewel must finish its 680ms foreground reveal before stable layout capture
  await page.setViewportSize({width:320,height:568});
  assert.ok(await page.locator('.pp-content').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'narrow home has no horizontal overflow');
  await phone.screenshot({path:resolve(output,'enamel-home-320.png')});
  await page.locator('[data-app="settings"]').click();
  await page.locator('[data-section="appearance"]').click();
  await page.locator('[data-setting="theme"]').selectOption('light');
  assert.equal(await page.locator('.pp-layer').getAttribute('data-skin'),'classic');
  assert.equal(await page.locator('.pp-layer').getAttribute('data-launcher'),'enamel');
  assert.equal(await page.locator('.pp-haze-launcher-art').isVisible(),true,'enamel launcher persists on light theme');
  await page.locator('[data-setting="launcherStyle"]').selectOption('classic');
  assert.equal(await page.locator('.pp-haze-launcher-art').isVisible(),false,'switching to classic restores original launcher');
  assert.equal(await page.locator('.pp-layer').getAttribute('data-launcher'),'classic');
  assert.equal(await page.locator('.pp-layer').getAttribute('data-wallpaper'),originalWallpaper,'classic wallpaper survives enamel switch');
  await page.getByRole('button',{name:'回到桌面',exact:true}).click();
  assert.equal(await page.locator('.pp-haze-art').count(),0,'classic icons return without reloading');
  await page.locator('[data-app="whatsapp"]').click();
  assert.equal(await phone.evaluate(el=>getComputedStyle(el).backgroundColor),appBackground,'brand app shell matches classic light');
  await page.reload();
  await page.locator('.pp-phone').waitFor();
  assert.equal(await page.locator('.pp-layer').getAttribute('data-launcher'),'classic','launcher style persists across reload');
  assert.equal(await page.locator('.pp-layer').getAttribute('data-skin'),'classic');
  await context.close();

  const reduced = await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  const reducePage = await reduced.newPage();
  await reducePage.goto(origin+'/enamel-fixture');
  await reducePage.locator('.pp-launcher').waitFor();
  const settings = await reducePage.evaluate(()=>JSON.parse(localStorage.getItem('pocket_phone_preview_v010')||'{}'));
  assert.ok(settings && typeof settings==='object');
  await reducePage.locator('[data-app="settings"]').click();
  await reducePage.locator('[data-section="appearance"]').click();
  await reducePage.locator('[data-setting="launcherStyle"]').selectOption('enamel');
  await reducePage.getByRole('button',{name:'收起手机',exact:true}).click();
  await reducePage.locator('.pp-launcher').click();
  assert.equal(await reducePage.locator('.pp-launcher').evaluate(el=>el.classList.contains('pp-haze-burst')),false,'reduced-motion tap opens without jewel choreography');
  assert.equal(await reducePage.locator('.pp-frost-snow').evaluate(el=>getComputedStyle(el).opacity),'0','reduced-motion snow stays hidden');
  assert.equal(await reducePage.locator('.pp-frost-orb').evaluate(el=>getComputedStyle(el).opacity),'1','reduced-motion jewel stays legible');
  await reduced.close();
  assert.deepEqual(errors,[],'no browser runtime errors');
  console.log('PASS enamel Chromium acceptance; screenshots saved under qa-results/');
} finally {
  await browser.close();
  await new Promise(resolveClose=>server.close(resolveClose));
}
