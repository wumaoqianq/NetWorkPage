import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutomaticAssetTasks, waitForAutomaticAssets } from '../automatic-assets.js';

test('a slow icon does not discard an already ready preview at the save deadline', async () => {
  let finishIcon;
  const tasks = createAutomaticAssetTasks({ tab: { id: 1, url: 'https://example.com/' },
    capture: async () => ({ sourceUrl: 'https://example.com/', displayUrl: 'data:image/webp;base64,cHJldmlldw==',
      blob: new Blob(['preview']), capturedAt: '2026-01-01T00:00:00Z' }),
    icon: () => new Promise(resolve => { finishIcon = resolve; }) });
  const updates = [];
  const result = await waitForAutomaticAssets(tasks, { timeout: 20, onResult: value => updates.push(value) });
  assert.equal(result.preview.status, 'ready');
  assert.equal(result.preview.sourceUrl, 'https://example.com/');
  assert.equal(result.icon.status, 'unavailable');
  assert.match(result.icon.reason, /2 秒/);
  assert.ok(updates.some(value => value.preview.status === 'ready'));
  finishIcon({ blob: new Blob(['icon']), sourceUrl: 'https://example.com/' });
});
