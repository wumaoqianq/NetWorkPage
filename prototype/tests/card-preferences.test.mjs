import test from 'node:test';
import assert from 'node:assert/strict';
import { cardPreferenceKey, normalizeCardPreference, cardGap, CARD_PRESETS } from '../src/card-preferences.js';

test('view preferences are isolated by origin and account including demo', () => {
  assert.notEqual(cardPreferenceKey('https://a.example', 1), cardPreferenceKey('https://a.example', 2));
  assert.notEqual(cardPreferenceKey('https://a.example', 1), cardPreferenceKey('https://b.example', 1));
  assert.notEqual(cardPreferenceKey('https://a.example', 1, true), cardPreferenceKey('https://a.example', 1));
});

test('card width is bounded and snapped without using site data', () => {
  assert.equal(normalizeCardPreference({ target: 1 }).target, 200);
  assert.equal(normalizeCardPreference({ target: 999 }).target, 340);
  assert.equal(normalizeCardPreference({ target: 269 }).target, 260);
  assert.equal(normalizeCardPreference(null).target, CARD_PRESETS.standard);
  assert.equal(normalizeCardPreference({ target: 260 }).schemaVersion, 1);
});

test('compact and wider layouts use real gaps rather than transforms', () => {
  assert.equal(cardGap(220), 12);
  assert.equal(cardGap(260), 16);
  assert.equal(cardGap(340), 16);
});
