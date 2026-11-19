import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutPreferenceKey, normalizeLayoutPreference, SORT_OPTIONS } from '../src/layout-preferences.js';
import { CARD_PRESETS, cardGap, normalizeCardPreference } from '../src/card-preferences.js';

test('布局偏好默认值稳定且容忍损坏数据', () => {
  assert.deepEqual(normalizeLayoutPreference(null), { schemaVersion: 1, sidebar: null, sort: 'pinned', mode: 'grid' });
  assert.deepEqual(normalizeLayoutPreference({ sidebar: 'weird', sort: 'x', mode: 'table' }), { schemaVersion: 1, sidebar: null, sort: 'pinned', mode: 'grid' });
});

test('布局偏好保留合法侧栏/排序/视图选择', () => {
  assert.deepEqual(normalizeLayoutPreference({ schemaVersion: 1, sidebar: 'collapsed', sort: 'recent', mode: 'list' }),
    { schemaVersion: 1, sidebar: 'collapsed', sort: 'recent', mode: 'list' });
  assert.equal(SORT_OPTIONS.length, 3);
});

test('布局偏好与卡片尺寸偏好使用不同存储键，修改互不清空', () => {
  const layoutKey = layoutPreferenceKey('http://127.0.0.1:4173', 1);
  const cardKey = 'workspace-card-preferences-v1:http://127.0.0.1:4173:user:1';
  assert.notEqual(layoutKey, cardKey);
  const card = normalizeCardPreference({ target: 320 });
  const layout = normalizeLayoutPreference({ sort: 'name', mode: 'list', sidebar: 'expanded' });
  assert.equal(card.target, CARD_PRESETS.wide);
  assert.equal(cardGap(card.target), 16);
  assert.equal(layout.sort, 'name');
  assert.equal(layout.mode, 'list');
});
