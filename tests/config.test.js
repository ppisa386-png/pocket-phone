import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, clampPosition, PROMPTS } from '../src/config.js';

test('malformed or old saved settings do not prevent startup', () => {
    for (const value of [null, undefined, [], 'bad', 3]) {
        assert.equal(normalizeSettings(value).launcherVisible, true);
    }
    const config = normalizeSettings({ retries: Infinity, fontSize: -40, phoneWidth: 9999, apps: null, prompts: [], position: { x: 9, y: -3 } });
    assert.equal(config.retries, 2);
    assert.equal(config.fontSize, 14);
    assert.equal(config.phoneWidth, 420);
    assert.deepEqual(config.position, { x: 1, y: 0 });
    assert.equal(config.prompts.phone, PROMPTS.phone.text);
});

test('disabled apps, zero retries and user prompt edits survive settings migration', () => {
    const config = normalizeSettings({ retries: 0, apps: { x: false }, prompts: { phone: '', x: '<script>alert(1)</script>' }, futureField: { keep: true } });
    assert.equal(config.retries, 0);
    assert.equal(config.apps.x, false);
    assert.equal(config.apps.phone, true);
    assert.equal(config.prompts.phone, '');
    assert.equal(config.prompts.x, '<script>alert(1)</script>');
    assert.deepEqual(config.futureField, { keep: true });
    assert.deepEqual(normalizeSettings(config), config);
});

test('launcher stays inside small screens and after orientation changes', () => {
    for (const view of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1280, height: 720 }]) {
        const point = clampPosition({ x: 20000, y: -500 }, view);
        assert.ok(point.x + 52 <= view.width - 8);
        assert.ok(point.y >= 8);
        assert.ok(clampPosition(null, view).y + 52 <= view.height - 8);
    }
});
