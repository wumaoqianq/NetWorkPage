import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareBookmarkFile, browserSources } from '../src/bookmark-import.js';

const file = (name, content, size = content.length) => ({ name, size, text: async () => content });
test('browser selection includes Chrome, Edge and confirmed ego(lite)', () => {
  assert.deepEqual(browserSources.slice(0, 3).map(s => s.id), ['chrome', 'edge', 'ego-lite']);
});
test('recognizes exported HTML from content regardless of extension', async () => {
  const result = await prepareBookmarkFile(file('wrong.json', '\uFEFF<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><A HREF="https://a.test">A</A></DL>'), 'edge');
  assert.equal(result.format, 'html');
  assert.equal(result.source, 'edge');
});
test('recognizes extensionless Chromium Bookmarks for ego(lite)', async () => {
  const result = await prepareBookmarkFile(file('Bookmarks', JSON.stringify({ roots: { bookmark_bar: { type: 'folder', children: [] } } })), 'ego-lite');
  assert.equal(result.format, 'chromium');
});
test('rejects full archives, unrelated data, large files and unknown sources', async () => {
  for (const [input, source] of [[file('backup.zip', 'binary'), 'ego-lite'], [file('passwords.csv', 'user,password'), 'chrome'],
    [file('profile.json', '{"cookies":[]}'), 'edge'], [file('large.html', 'x', 2097153), 'chrome'], [file('x.html', '<DL></DL>'), 'unknown']]) {
    await assert.rejects(prepareBookmarkFile(input, source));
  }
});
