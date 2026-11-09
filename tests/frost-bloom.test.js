import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {frostBloomLauncherArt} from '../src/frost-bloom.js';
import {enamelLauncherArt,enamelParticles} from '../src/enamel-icons.js';
import {normalizeSettings} from '../src/config.js';

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

test('animation is scoped to selected launcher and respects reduced motion and keyboard focus',()=>{
  assert.match(css,/\.pp-layer\[data-launcher="enamel"\] \.pp-frost-/);
  assert.match(css,/@keyframes pp-frost-bloom/);
  assert.match(css,/@keyframes pp-frost-fold/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(css,/\.pp-launcher:focus-visible/);
  assert.doesNotMatch(css,/\.pp-layer\[data-skin="enamel"\] \.pp-frost-/);
});
