import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');

test('the shared scale layer keeps its computed logical height in every phone app', () => {
    const rule = css.match(/\.pp-phone-scale\s*\{([^}]*)\}/)?.[1];
    assert.ok(rule, 'common phone-scale rule exists');
    assert.match(rule, /\bflex:\s*0\s+0\s+auto\s*;/, 'flexbox must not grow or shrink the computed logical height');
    assert.match(rule, /\bheight:\s*var\(--pp-phone-logical-height\s*,/, 'logical height is computed independently of parent flex height');
    assert.match(rule, /transform:\s*scale\(var\(--pp-phone-scale/, 'visual scaling remains enabled');
    assert.match(rule, /transform-origin:\s*top left/, 'scaling remains anchored to the phone top-left');
    assert.match(ui, /--pp-phone-logical-height['"],\s*Math\.round\(phone\.clientHeight\s*\/\s*rounded\)/, 'window height is divided by the current scale');
    assert.match(ui, /'<div class="pp-phone-scale">'/, 'all app pages share the scale layer');
    assert.ok(ui.indexOf('class="pp-phone-scale"') < ui.indexOf('class="pp-content"'), 'content lives inside scale layer');
    assert.ok(ui.indexOf('class="pp-footer"') < ui.indexOf("'</div>' +"), 'footer is rendered with content in the scale layer');
});
