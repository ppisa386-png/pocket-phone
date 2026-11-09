import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {frostBloomLauncherArt} from '../src/frost-bloom.js';
import {enamelLauncherArt,enamelParticles} from '../src/enamel-icons.js';
import {normalizeSettings,appearanceSettingsPatch} from '../src/config.js';

const css=readFileSync(new URL('../style-enamel.css',import.meta.url),'utf8');
const ui=readFileSync(new URL('../src/ui.js',import.meta.url),'utf8');

test('Frost Bloom gemstone has six precise 2D cuts, six snow branches, four settings and exact colors',()=>{
  const art=frostBloomLauncherArt();
  assert.match(art,/class="pp-haze-launcher-art pp-frost-bloom"/);
  assert.equal((art.match(/class="pp-frost-orb-petal"/g)||[]).length,6);
  assert.equal((art.match(/class="pp-frost-branch"/g)||[]).length,6);
  assert.equal((art.match(/class="pp-frost-setting"/g)||[]).length,4);
  assert.ok((art.match(/<path\b/g)||[]).length>170);
  for(const color of ['#EDF8FA','#B9DAE2','#D3C7F0','#A8D4CF','#E6D8C5'])assert.ok(art.includes(color));
  assert.match(art,/rotate\(300 50 50\)/);
  assert.doesNotMatch(art,/<image\b|<foreignObject\b|url\(https?:|emoji|<text\b/i);
  assert.equal(enamelLauncherArt(),art,'existing enamel style must render the new gemstone');
});

test('snowflake retains faceted terminal gems and the refined six-sided smaller central inlay',()=>{
  const art=frostBloomLauncherArt();
  assert.match(art,/M50 4\.6 53\.9 10\.4 50 16\.3 46\.1 10\.4Z/);
  assert.match(art,/M50 38\.8 60 44\.4 60 55\.6 50 61\.2/);
  assert.ok((art.match(/fill-opacity=/g)||[]).length>30);
});

test('original enamel option is replaced in place, not added, while saved values stay compatible',()=>{
  assert.match(ui,/selectField\('launcherStyle', '悬浮球样式', \[\['classic', '经典悬浮球'\], \['enamel', '霜华晶球'\]\]/);
  assert.doesNotMatch(ui,/'珐琅水晶球 · 雪晶绽放'/);
  assert.equal(normalizeSettings({launcherStyle:'enamel',theme:'dark'}).launcherStyle,'enamel');
  assert.equal(normalizeSettings({launcherStyle:'classic',theme:'enamel'}).launcherStyle,'classic');
  assert.match(ui,/if \(dragging\.moved\)/);
  assert.equal((enamelParticles().match(/class="pp-haze-spark /g)||[]).length,12);
});

test('entering Soft Haze Enamel selects Frost Bloom; the manual style control remains usable',()=>{
  const original=normalizeSettings({theme:'light',launcherStyle:'classic'});
  const selected=normalizeSettings({...original,...appearanceSettingsPatch(original,'theme','enamel')});
  assert.equal(selected.theme,'enamel');
  assert.equal(selected.launcherStyle,'enamel');
  const manual=normalizeSettings({...selected,...appearanceSettingsPatch(selected,'launcherStyle','classic')});
  assert.equal(manual.launcherStyle,'classic','manual classic choice is honored while already on enamel');
  assert.deepEqual(appearanceSettingsPatch(manual,'theme','enamel'),{theme:'enamel'},'same-theme selection does not override manual choice');
  const light=normalizeSettings({...manual,...appearanceSettingsPatch(manual,'theme','light')});
  assert.equal(light.launcherStyle,'classic','leaving enamel does not change preference');
  const reentered=normalizeSettings({...light,...appearanceSettingsPatch(light,'theme','enamel')});
  assert.equal(reentered.launcherStyle,'enamel','re-entering enamel chooses its included launcher');
  assert.equal(normalizeSettings({...reentered,launcherStyle:'classic'}).launcherStyle,'classic','saved explicit choices remain valid');
  assert.match(ui,/persist\(appearanceSettingsPatch\(settings, key, value\)\)/);
});

test('animation is scoped to selected launcher and respects reduced motion and keyboard focus',()=>{
  assert.match(css,/\.pp-layer\[data-launcher="enamel"\] \.pp-frost-/);
  assert.match(css,/@keyframes pp-frost-bloom/);
  assert.match(css,/@keyframes pp-frost-fold/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(css,/\.pp-launcher:focus-visible/);
  assert.doesNotMatch(css,/\.pp-layer\[data-skin="enamel"\] \.pp-frost-/);
  assert.match(css,/z-index:3; \/\* keep the six-point bloom visible/);
  assert.match(ui,/event.animationName === 'pp-frost-bloom'/,'the temporary foreground stacking must be cleared on animation end');
});


test('Emil motion refinement is one shared, finite 680ms sequence with staggered crystal detail',()=>{
  const art=frostBloomLauncherArt();
  assert.equal((art.match(/--pp-frost-delay:/g)||[]).length,6,'one stagger value on every existing branch');
  assert.deepEqual([...art.matchAll(/--pp-frost-delay:(\d+)ms/g)].map(m=>Number(m[1])),[0,16,32,48,64,80]);
  assert.equal((art.match(/class="pp-frost-heart"/g)||[]).length,1,'central inlay is animated, never duplicated');
  for(const name of ['pp-frost-fold','pp-frost-bloom','pp-frost-facet','pp-frost-heartlight','pp-frost-glints']){
    assert.match(css,new RegExp('@keyframes '+name));
  }
  assert.match(css,/pp-frost-bloom 680ms linear both/);
  assert.match(css,/pp-frost-fold 680ms linear both/);
  assert.match(css,/pp-frost-facet 510ms/);
  assert.match(css,/cubic-bezier\(\.23,1,\.32,1\)/,'press motion responds promptly');
  assert.match(css,/\[data-launcher="enamel"\] \.pp-haze-burst \.pp-haze-spark/);
  assert.match(css,/\[data-launcher="enamel"\] \.pp-launcher:active:not\(\.pp-haze-burst\)/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(css,/\.pp-frost-branch,\s*\n\s*\.pp-layer\[data-launcher="enamel"\] \.pp-launcher\.pp-haze-burst \.pp-frost-heart/);
  assert.match(ui,/if \(!launcher\.classList\.contains\('pp-haze-burst'\)\)/,'rapid taps do not rewind in-flight motion');
  assert.doesNotMatch(ui,/void launcher\.offsetWidth/,'no forced reflow to restart the animation');
});
