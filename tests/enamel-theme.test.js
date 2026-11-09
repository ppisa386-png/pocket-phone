import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APPS, normalizeSettings } from '../src/config.js';
import { enamelIcon, enamelNames, enamelLauncherArt, enamelParticles } from '../src/enamel-icons.js';

test('Soft Haze is opt-in and classic appearance/wallpaper remain intact', () => {
  const original = normalizeSettings({ theme: 'dark', wallpaper: 'sand', apps: { x: false } });
  assert.equal(original.theme, 'dark');
  assert.equal(original.wallpaper, 'sand');
  assert.equal(original.enamelWallpaper, 'haze');
  const selected = normalizeSettings({ ...original, theme: 'enamel', enamelWallpaper: 'ocean' });
  assert.equal(selected.theme, 'enamel');
  assert.equal(selected.wallpaper, 'sand', 'existing wallpaper is a separate preference');
  assert.equal(selected.enamelWallpaper, 'ocean');
  assert.equal(selected.apps.x, false);
  assert.deepEqual(normalizeSettings(selected), selected);
  assert.equal(normalizeSettings({ ...selected, theme: 'light' }).wallpaper, 'sand');
  assert.equal(normalizeSettings({ theme: 'unknown' }).theme, 'dark');
});

test('eleven unique desktop enamel badges are custom scalable SVGs', () => {
  const visible = APPS.filter(app => app.id !== 'snapchat').map(app => app.id);
  const names = [...visible, 'settings'];
  assert.deepEqual(new Set(enamelNames), new Set(names));
  const outlines = new Set();
  for (const name of names) {
    const svg = enamelIcon(name);
    assert.match(svg, /<svg viewBox="0 0 64 64"/);
    assert.match(svg, /linearGradient/);
    assert.match(svg, /stroke="#c6a67d"/);
    assert.doesNotMatch(svg, /<image\b|<text\b|emoji/i);
    outlines.add(svg.match(/<path d="([^"]+)"/)?.[1]);
  }
  assert.equal(outlines.size, names.length, 'badge silhouettes are not repeated rounded squares');
  assert.equal(enamelIcon('unknown'), '');
  assert.match(enamelLauncherArt(), /pp-haze-launcher-art/);
  assert.equal((enamelParticles().match(/class="pp-haze-spark /g)||[]).length,12);
});

test('theme styles are isolated and original base stylesheet remains independent', () => {
  const css = readFileSync(new URL('../style-enamel.css', import.meta.url),'utf8');
  const ui = readFileSync(new URL('../src/ui.js', import.meta.url),'utf8');
  const original = readFileSync(new URL('../style.css', import.meta.url),'utf8');
  assert.match(css,/data-skin="enamel"/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /data-home="true"/);
  assert.match(css, /data-active-app=""/);
  assert.match(css, /@container pp-phone/);
  assert.match(css, /pp-haze-sparkle/);
  assert.doesNotMatch(css, /^\.pp-(?:phone|home|launcher)\b/m, 'new rules need a skin guard');
  assert.match(original, /\.pp-layer\[data-theme="light"\]/);
  assert.match(ui, /settings\.theme === 'enamel' \? 'light' : settings\.theme/);
  assert.match(ui, /settings\.theme === 'enamel' \? settings\.enamelWallpaper : settings\.wallpaper/);
  assert.match(ui, /enamelIcon\(app\.id\) \|\| icon\(app\.id\)/);
  assert.match(ui, /if\(key==='theme'\)renderAppearance\(\)/);
  assert.match(ui, /if \(dragging\.moved\)/, 'original drag threshold logic remains');
});
