import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWorkspace } from '../src/workspace-loader.js';

test('loads bounded pages and removes duplicate ids', async () => {
  const paths = [];
  const request = async path => {
    paths.push(path);
    return paths.length === 1
      ? { user: { id: 7 }, sites: [{ id: 'a' }], nextSitePage: 2 }
      : { userId: 7, sites: [{ id: 'a' }, { id: 'b' }], nextPage: null };
  };
  const data = await loadWorkspace({ request });
  assert.deepEqual(data.sites.map(s => s.id), ['a', 'b']);
  assert.deepEqual(paths, ['/api/workspace', '/api/sites?page=2&limit=250']);
});

test('rejects cross-account pages and repeating cursors', async () => {
  for (const page of [
    { userId: 8, sites: [{ id: 'b' }], nextPage: null },
    { userId: 7, sites: [{ id: 'b' }], nextPage: 2 },
  ]) {
    let count = 0;
    await assert.rejects(loadWorkspace({ request: async () => ++count === 1
      ? { user: { id: 7 }, sites: [{ id: 'a' }], nextSitePage: 2 } : page }));
  }
});
