import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('food phone chrome has its own opaque background variables', () => {
    assert.match(css, /\.pp-phone\[data-active-app="food"\]\{--fd-bg:#F6F0E6;--fd-ink:#2D251F\}/);
    assert.match(css, /\.pp-phone\[data-active-app="food"\],\.pp-phone\[data-active-app="food"\] \.pp-topline,\.pp-phone\[data-active-app="food"\] \.pp-header,[^\n]*background:var\(--fd-bg\)/);
});

test('restaurant menu remains scrollable and floating docks do not double-count the device safe area', () => {
    assert.match(css, /\.pp-food-menu\{flex:1 1 auto;min-height:0;overflow-y:auto/);
    assert.match(css, /\.pp-food-store-heading\{[^}]*min-height:56px/);
    assert.match(css, /\.pp-food\.is-shop \.pp-food-body\{overflow:hidden;padding-bottom:0\}/);
    assert.doesNotMatch(css, /\.pp-food-detail-cover\{/);
    const dock = css.match(/\.pp-food-bar\{min-height:56px;[^}]*\}/)?.[0];
    const tabs = css.match(/\.pp-food \.pp-food-tabs\{[^}]*padding:4px 20px 5px;[^}]*\}/)?.[0];
    const popover = css.match(/\.pp-food-buy-popover\{right:13px;bottom:56px;left:13px\}/)?.[0];
    assert.ok(dock && tabs && popover);
    assert.doesNotMatch(dock + tabs + popover, /safe-area-inset-bottom/);
});
