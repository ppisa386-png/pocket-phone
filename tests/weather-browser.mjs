// Chromium acceptance for Window Weather Diary. All weather values are fixtures; no model or network service is called.
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

const fixtureHTML = [
'<!doctype html>',
'<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>天气窗视觉验收</title></head><body>',
'<main>Window Weather Diary browser fixture</main>',
'<script type="module">',
'import { mountPhone } from "/src/ui.js";',
'import { normalizeSettings } from "/src/config.js";',
'const settings = normalizeSettings({phoneWidth:390,phoneHeight:844,apps:{weather:true}});',
'const hours = Array.from({length:24},(_,hour)=>({hour,type:hour%4===0?"partly":"sunny",temp:20+Math.round(Math.sin(hour/4)*4)}));',
'const weekday = ["星期二","星期三","星期四","星期五","星期六","星期日","星期一"];',
'const days = Array.from({length:7},(_,index)=>({today:index===0,weekday:weekday[index],lo:17+index%3,hi:24+index%4,type:index===2?"rain":"partly",label:index===2?"小雨":"晴间多云",hours}));',
'window.fixtureWeather = {status:"ok",city:"上海",date:"2026-11-10",clock:{day:0,hour:13},report:{type:"rain",label:"中雨",temp:23,feels:24,wind:3,humidity:56,precip:1.2,uv:5,uvLevel:"中等",aqi:32,aqiLevel:"优",date:"2026-11-10",time:"13:13",warnings:[{color:"yellow",level:"黄色",grade:"Ⅲ级",title:"强降雨预警",detail:"当前有持续降雨。"},{color:"blue",level:"蓝色",grade:"Ⅳ级",title:"大风预警",detail:"阵风增强，注意户外物品。"}]},forecast:{days}};',
'const adapter = {',
' load:()=>settings, save(next){Object.assign(settings,next);}, onChange(){return ()=>{};},',
' storyChat:()=>[{is_user:false,mes:"2026-11-10 13:13"}], userName:()=>"用户",',
' weatherAssetBase:location.origin+"/assets/weather/",',
' weather:{report:()=>window.fixtureWeather,refresh:async()=>({ok:true}),editLocation:async()=>({ok:true})},',
' phone:{subscribe:()=>()=>{},markCallsRead:()=>{},markMessagesRead:()=>{}},',
' diagnostics:{add(error){console.error(error);},text:()=>"",persistent:()=>true},',
' connectionName:()=>"离线天气视觉验收"',
'};',
'const paths=["/style.css","/style-enamel.css","/style-food.css","/style-wechat.css","/style-weather.css","/assets/weather/fonts/weather-fonts.css"];',
'const responses=await Promise.all(paths.map(path=>fetch(path)));',
'if(responses.some(response=>!response.ok))throw new Error("Weather fixture could not load local styles.");',
'const chunks=await Promise.all(responses.map(response=>response.text()));',
'chunks[5]=chunks[5].replaceAll("__WEATHER_FONT_BASE__/",location.origin+"/assets/weather/fonts/");',
'window.controller=mountPhone({adapter,styles:chunks.join("\\n")});',
'window.controller.open();',
'window.fixtureReady=true;',
'</script></body></html>'
].join("\n");

const server = createServer(async (req, res) => {
    try {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (pathname === '/weather-fixture') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(fixtureHTML);
            return;
        }
        const file = resolve(root, '.' + (pathname === '/' ? '/preview.html' : pathname));
        if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
        const types = {
            '.html':'text/html; charset=utf-8',
            '.js':'text/javascript; charset=utf-8',
            '.css':'text/css; charset=utf-8',
            '.woff2':'font/woff2',
            '.webp':'image/webp',
            '.svg':'image/svg+xml'
        };
        res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
        res.end(await readFile(file));
    } catch { res.writeHead(404).end(); }
});
await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']});
const errors = [];
const externalRequests = [];
try {
    const page = await browser.newPage({viewport:{width:414,height:900},isMobile:true,hasTouch:true});
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
        if (!request.url().startsWith(origin) && !request.url().startsWith('data:')) externalRequests.push(request.url());
    });
    await page.goto(origin + '/weather-fixture');
    const phone = page.locator('.pp-phone');
    await phone.waitFor({state:'visible',timeout:12000});
    await page.locator('.pp-app[data-app="weather"]').click();
    await page.waitForFunction(() => { const toast=document.querySelector('#personal-pocket-phone-root')?.shadowRoot?.querySelector('.pp-toast'); return !toast || toast.hidden; });
    const heroImage = page.locator('.pp-weather-window img');
    await heroImage.waitFor({state:'visible'});
    await page.waitForFunction(() => {
        const img = document.querySelector('#personal-pocket-phone-root')?.shadowRoot?.querySelector('.pp-weather-window img');
        return !!img && img.complete && img.naturalWidth > 0;
    });
    assert.equal(await page.locator('.pp-weather').getAttribute('data-wtheme'),'mist');
    assert.equal(await page.locator('.pp-weather-window').getAttribute('data-weather-window'),'rainy-day');
    assert.equal(await page.locator('.pp-weather-warning').count(),2,'all current warning records render');
    const warningOrder = await page.locator('.pp-weather').evaluate(el => {
        const hero = el.querySelector('.pp-weather-window');
        const warnings = el.querySelector('.pp-weather-warning-list');
        const hourly = el.querySelector('.pp-weather-hourly');
        return !!hero && !!warnings && !!hourly &&
            !!(hero.compareDocumentPosition(warnings) & Node.DOCUMENT_POSITION_FOLLOWING) &&
            !!(warnings.compareDocumentPosition(hourly) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    assert.equal(warningOrder,true,'warnings sit after the window illustration and before hourly forecast');
    const palette = await phone.evaluate(el => ({
        shell:getComputedStyle(el).backgroundColor,
        page:getComputedStyle(el.querySelector('.pp-weather')).backgroundColor,
        header:getComputedStyle(el.querySelector('.pp-header')).backgroundColor
    }));
    assert.deepEqual(palette,{shell:'rgb(253, 244, 235)',page:'rgb(253, 244, 235)',header:'rgb(253, 244, 235)'});
    const fonts = await page.evaluate(async () => {
        await document.fonts.load('300 56px "Manrope Variable"','23°');
        await document.fonts.load('400 14px "Noto Sans SC Variable"','天气');
        return {
            manrope:document.fonts.check('300 56px "Manrope Variable"','23°'),
            noto:document.fonts.check('400 14px "Noto Sans SC Variable"','天气')
        };
    });
    assert.deepEqual(fonts,{manrope:true,noto:true},'local Manrope and Noto Sans SC load');

    for (const width of [640,390,360,330,320,280]) {
        const height = 820;
        await page.setViewportSize({width:width+24,height:height+40});
        await phone.evaluate((el,size)=>{el.style.width=size.width+'px';el.style.height=size.height+'px';},{width,height});
        const layout = await page.locator('.pp-weather').evaluate(el => {
            const scroll=el.querySelector('.pp-weather-scroll');
            const copy=el.querySelector('.pp-weather-hero-copy')?.getBoundingClientRect();
            const window=el.querySelector('.pp-weather-window')?.getBoundingClientRect();
            const image=el.querySelector('.pp-weather-window img');
            const hourly=el.querySelector('.pp-weather-hours');
            return {
                width:scroll.clientWidth,scrollWidth:scroll.scrollWidth,scrollHeight:scroll.scrollHeight,clientHeight:scroll.clientHeight,
                pageWidth:el.clientWidth,pageScrollWidth:el.scrollWidth,
                imageWidth:image?.getBoundingClientRect().width||0,imageLoaded:!!image&&image.complete&&image.naturalWidth>0,
                heroOverlap:!!copy&&!!window&&copy.right>window.left+1,
                hourlyCount:el.querySelectorAll('.pp-weather-hour').length,
                hourlyScrolls:!!hourly&&hourly.scrollWidth>hourly.clientWidth,
                dayCount:el.querySelectorAll('.pp-weather-day').length,
                metricCount:el.querySelectorAll('.pp-weather-metric').length,
                warningCount:el.querySelectorAll('.pp-weather-warning').length
            };
        });
        assert.ok(layout.width>0,'weather scroll has a measurable width at '+width);
        assert.ok(layout.scrollWidth<=layout.width+1&&layout.pageScrollWidth<=layout.pageWidth+1,'no page-level horizontal overflow at '+width+': '+JSON.stringify(layout));
        assert.ok(layout.imageLoaded,'local illustration is loaded at '+width);
        assert.ok(layout.imageWidth<=126.5,'illustration remains compact at '+width);
        assert.equal(layout.heroOverlap,false,'temperature and illustration do not overlap at '+width);
        assert.equal(layout.hourlyCount,24,'all 24 hours remain available at '+width);
        assert.equal(layout.hourlyScrolls,true,'hourly strip scrolls independently at '+width);
        assert.equal(layout.dayCount,7,'all seven forecast days remain available at '+width);
        assert.equal(layout.metricCount,6,'all six weather metrics remain visible at '+width);
        assert.equal(layout.warningCount,2,'all current warnings remain present at '+width);
        await phone.screenshot({path:resolve(output,'weather-window-'+width+'.png')});
    }

    await page.setViewportSize({width:344,height:640});
    await phone.evaluate(el=>{el.style.width='320px';el.style.height='590px';});
    const shortLayout = await page.locator('.pp-weather-scroll').evaluate(el=>({
        scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight
    }));
    assert.ok(shortLayout.scrollWidth<=shortLayout.clientWidth+1,'short phone remains free of horizontal overflow');
    assert.ok(shortLayout.scrollHeight>shortLayout.clientHeight,'short phone keeps the forecast in a vertical scroll area');
    await phone.screenshot({path:resolve(output,'weather-window-320x590.png')});

    await page.evaluate(() => {
        window.fixtureWeather.clock.hour=13;
        window.fixtureWeather.report.type='partly';
        window.fixtureWeather.report.label='多云';
        window.fixtureWeather.forecast.days[0].rainyDay=true;
    });
    await page.locator('[data-action="home"]').click();
    await page.locator('.pp-app[data-app="weather"]').click();
    assert.equal(await page.locator('.pp-weather-window').getAttribute('data-weather-window'),'rainy-day',
        'the daily rain illustration remains during a brief cloudy break');
    assert.equal(await page.locator('.pp-weather-desc').textContent(),'多云',
        'the current conditions label still describes the current hour');
    await page.waitForTimeout(300);
    await page.screenshot({path:resolve(output,'weather-window-rainy-day-cloud-break.png')});

    await page.evaluate(() => {
        window.fixtureWeather.clock.hour=22;
        window.fixtureWeather.report.type='sunny';
        window.fixtureWeather.report.label='晴';
        window.fixtureWeather.report.warnings=[];
        window.fixtureWeather.forecast.days[0].rainyDay=false;
    });
    await page.locator('[data-action="home"]').click();
    await page.locator('.pp-app[data-app="weather"]').click();
    assert.equal(await page.locator('.pp-weather').getAttribute('data-wtheme'),'night');
    assert.equal(await page.locator('.pp-weather-window').getAttribute('data-weather-window'),'good-night');
    await page.waitForTimeout(300);
    assert.equal(await phone.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(253, 244, 235)','night stays on the light cream page');
    await phone.screenshot({path:resolve(output,'weather-window-night.png')});

    assert.deepEqual(errors,[],'no browser runtime errors');
    assert.deepEqual(externalRequests,[],'all weather imagery and fonts are local');
    console.log(JSON.stringify({viewports:[640,390,360,330,320,280,'320x590'],fonts,warningCards:2,nightScene:'good-night',screenshots:output}));
} finally {
    await browser.close();
    await new Promise(resolveDone => server.close(resolveDone));
}
