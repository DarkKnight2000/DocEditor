// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeViewSettings, DEFAULT_VIEW_SETTINGS } from './view_settings.js';

test('saved settings are kept when they are options', () => {
    assert.deepEqual(normalizeViewSettings({ textSize: 150, lineSpacing: 2, charSpacing: 0.05 }), { textSize: 150, lineSpacing: 2, charSpacing: 0.05 });
});

test('missing or unknown values fall back to the defaults', () => {
    assert.deepEqual(normalizeViewSettings(null), DEFAULT_VIEW_SETTINGS);
    assert.deepEqual(normalizeViewSettings({ textSize: 133, lineSpacing: '2', extra: 1 }), DEFAULT_VIEW_SETTINGS);
    assert.deepEqual(normalizeViewSettings({ charSpacing: 0.1 }), { ...DEFAULT_VIEW_SETTINGS, charSpacing: 0.1 });
});
