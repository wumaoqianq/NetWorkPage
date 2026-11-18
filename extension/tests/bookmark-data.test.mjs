import test from 'node:test';
import assert from 'node:assert/strict';
import { bookmarkFolders, collectBookmarks } from '../bookmark-data.js';

const tree = [{ id: '0', title: '', children: [{ id: '1', title: '收藏栏', children: [
  { id: '2', title: '工具', children: [{ id: '3', title: 'A', url: 'https://a.test' }, { id: '4', title: '重复', url: 'https://a.test/' }] },
  { id: '5', title: '内部', url: 'chrome://settings' }, { id: '6', title: '隐私', url: 'https://u:p@secret.test/' },
  { id: '7', title: 'B', url: 'https://b.test/' },
] }] }];
test('reads only HTTP bookmark fields, paths and deduplicates locally', () => {
  const result = collectBookmarks(tree);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].folder, '收藏栏 / 工具');
  assert.equal(result.skipped, 2);
  assert.equal(result.duplicates, 1);
  assert.deepEqual(Object.keys(result.items[0]).sort(), ['folder', 'title', 'url']);
});
test('folder selection limits the snapshot without touching the source tree', () => {
  const before = JSON.stringify(tree);
  assert.equal(bookmarkFolders(tree).find(item => item.id === '2').label, '收藏栏 / 工具');
  assert.equal(collectBookmarks(tree, '2').items.length, 1);
  assert.equal(JSON.stringify(tree), before);
  assert.throws(() => collectBookmarks(tree, 'missing'));
});
