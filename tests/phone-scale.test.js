import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const pressMenu = readFileSync(new URL('../src/press-menu.js', import.meta.url), 'utf8');

test('floating phone reflows at its own dimensions instead of scaling a fixed-width canvas', () => {
    const phone = css.match(/(?:^|\n)\.pp-phone\s*\{([^}]*)\}/)?.[1] || '';
    const canvas = css.match(/\.pp-phone-scale\s*\{([^}]*)\}/)?.[1] || '';
    assert.match(phone, /container:\s*pp-phone\s*\/\s*size\s*;/);
    assert.match(canvas, /\bwidth:\s*100%\s*;/);
    assert.match(canvas, /\bheight:\s*100%\s*;/);
    assert.match(canvas, /\bflex:\s*1\s+1\s+auto\s*;/);
    assert.doesNotMatch(canvas, /transform|390px|--pp-phone-logical-height/);
    assert.doesNotMatch(ui, /PHONE_BASE_WIDTH|syncPhoneScale|--pp-phone-scale|--pp-phone-logical-height/);
    assert.doesNotMatch(pressMenu, /--pp-phone-scale/);
    assert.match(ui, /'<div class="pp-phone-scale">'/);
    assert.match(css, /@container pp-phone \(max-width:360px\)/);
    assert.match(css, /@container pp-phone \(max-width:330px\)/);
    assert.match(css, /@container pp-phone \(max-height: 590px\)/);
    assert.match(ui, /phone\.style\.width = width \+ 'px'; phone\.style\.height = height \+ 'px';/);
});

test('settings remove redundant introduction and master switch, desktop alone hides status time', () => {
    const index = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    assert.ok(css.includes('.pp-phone[data-home="true"] .pp-status-time { display: none; }'));
    assert.match(ui, /pp-status-time/);
    assert.match(ui, /pp-home-clock/);
    assert.match(ui, /pp-big-time/);
    assert.match(ui, /\.pp-status-time'\)\.textContent = time/);
    assert.doesNotMatch(ui, /按你的习惯设置手机|data-phone-enabled|榴莲手机已停用/);
    assert.match(ui, /content\.innerHTML = '<div class="pp-page"><div class="pp-card">'/);
    assert.match(ui, /SECTIONS\.map\(section =>/);
    assert.match(index, /data-pp-enabled/);
    assert.match(index, /controller\.setEnabled\(master\.checked\)/);
});
