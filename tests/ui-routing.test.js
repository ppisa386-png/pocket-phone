import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Exercise the real desktop render dispatcher, not a duplicated route map.
// A weather timer cleanup previously split its else-if chain and silently
// prevented the three data-heavy apps from rendering.
const source=readFileSync(new URL('../src/ui.js',import.meta.url),'utf8');
const match=source.match(/    function render\(\) \{[\s\S]*?\n    \}\n\n    function navigate\(/);
assert.ok(match,'desktop render and navigate functions must remain discoverable');
const renderFunction=match[0].slice(0,match[0].lastIndexOf('\n\n    function navigate(')).trim();

function renderRoute(id){
    const calls=[];
    const apps=['assets','amazon','food','weather','daily','x','phone','messages'].map(id=>({id,name:id}));
    const context={
        destroyed:false,
        pressMenu:{close:()=>{}},
        settings:{enabled:true},
        route:id==='home'||id==='settings'?id:'app:'+id,
        history:[],
        phone:{dataset:{}},
        shadow:{querySelector:()=>({hidden:false})},
        visibleApps:apps,
        title:{textContent:''},
        SECTIONS:[],
        chatPanels:{},
        content:{scrollTop:0,scrollHeight:0},
        selectedSMSContactId:null,
        updateClock:()=>calls.push('clock'),
        clearWeatherThemeTimer:()=>calls.push('clear-weather-timer'),
        ...Object.fromEntries(['Home','Settings','Appearance','API','Errors','Apps','Prompts','ContactSettings','Retry',
            'Phone','Messages','Chat','Snapchat','X','Daily','Weather','Assets','Amazon','Food','EmptyApp']
            .map(name=>['render'+name,()=>calls.push(name)]))
    };
    runInNewContext(renderFunction+'\nrender();',context);
    return calls;
}

test('desktop opens assets, Amazon and food through their actual rendering functions',()=>{
    for(const app of ['Assets','Amazon','Food']){
        assert.deepEqual(renderRoute(app.toLowerCase()),[app,'clear-weather-timer','clock'],
            app+' must render before unrelated weather timer cleanup');
    }
});

test('weather timer cleanup stays independent from screen dispatch',()=>{
    assert.deepEqual(renderRoute('weather'),['Weather','clock'],'weather keeps its timer');
    assert.deepEqual(renderRoute('daily'),['Daily','clear-weather-timer','clock']);
    assert.deepEqual(renderRoute('x'),['X','clear-weather-timer','clock']);
    assert.deepEqual(renderRoute('home'),['Home','clear-weather-timer','clock']);
    assert.deepEqual(renderRoute('settings'),['Settings','clear-weather-timer','clock']);
});
