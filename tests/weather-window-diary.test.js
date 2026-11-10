import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = path => readFileSync(join(root, path), 'utf8');

test('five user supplied window illustrations are bundled locally at the expected 4:5 names', () => {
    const folder = join(root, 'assets', 'weather', 'windows');
    const expected = ['sunny.webp', 'cloudy.webp', 'rainy-day.webp', 'snowy.webp', 'good-night.webp'];
    const actual = readdirSync(folder).sort();
    for (const name of expected) {
        assert.ok(actual.includes(name), 'missing ' + name);
        assert.ok(statSync(join(folder, name)).size > 1000, name + ' should be a real local image');
    }
    assert.ok(read('assets/weather/windows/README.md').includes('用户提供'));
});

test('weather-only styles and Fontsource files are wired into runtime and preview builds', () => {
    const index = read('index.js');
    const builder = read('tools/build_preview.mjs');
    const styles = read('style-weather.css');
    const base = read('style.css');
    const fonts = read('assets/weather/fonts/weather-fonts.css');
    assert.match(index, /style-weather\.css\?v=1\.2\.37/);
    assert.match(index, /assets\/weather\/fonts\/weather-fonts\.css/);
    assert.match(index, /replaceAll\('__WEATHER_FONT_BASE__\/', weatherFontBase\)/);
    assert.match(builder, /style-weather\.css/);
    assert.match(builder, /weather-fonts\.css/);
    assert.match(builder, /fs\.cpSync\(source, target/);
    assert.match(styles, /#FDF4EB/);
    assert.match(styles, /#46545E/);
    assert.match(styles, /@container pp-phone \(max-width:360px\)/);
    assert.match(styles, /@container pp-phone \(max-width:300px\)/);
    assert.match(styles, /@container pp-phone \(max-height:590px\)/);
    assert.match(fonts, /__WEATHER_FONT_BASE__\//);
    assert.ok(readdirSync(join(root, 'assets', 'weather', 'fonts')).some(name => name.endsWith('.woff2')));
    assert.ok(readdirSync(join(root, 'assets', 'weather', 'fonts')).includes('LICENSE-Manrope-OFL.txt'));
    assert.ok(readdirSync(join(root, 'assets', 'weather', 'fonts')).includes('LICENSE-Noto-Sans-SC-OFL.txt'));
    assert.doesNotMatch(base, /\.pp-weather(?:[\s.#:[,{>]|$)/, 'legacy weather CSS is removed from the shared sheet');
    assert.match(read('manifest.json'), /1\.2\.37/);
    assert.match(read('package.json'), /1\.2\.37/);
});

test('weather CSS uses a light fixed page and keeps layout classes scoped to the weather view', () => {
    const styles = read('style-weather.css');
    assert.match(styles, /\.pp-phone\[data-active-app="weather"\]/);
    assert.match(styles, /background:#FDF4EB!important/);
    assert.match(styles, /grid-template-columns:minmax\(0,1fr\) clamp\(92px,39%,126px\)/);
    assert.match(styles, /aspect-ratio:4\/5/);
    assert.match(styles, /pp-weather-warning-list/);
    assert.match(styles, /grid-template-columns:repeat\(2,minmax\(0,1fr\)/);
    assert.doesNotMatch(styles, /https?:\/\//);
});
