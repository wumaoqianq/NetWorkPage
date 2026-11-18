import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCapture } from '../queue.js';
import { collectAutomaticAssets, persistAutomaticAssets } from '../automatic-assets.js';
import { deriveImage } from '../screenshot.js';

const connection = { server: 'https://workspace.example', user: { id: 7 } };
const clientCaptureId = '05c70488-1cef-491f-93cc-9e680c535716';

test('notes stay independent from purpose and ordinary captures stay out of inbox', () => {
  const item = makeCapture(connection, { clientCaptureId, url: 'https://example.com/', title: '示例',
    notes: '我的私人备注', purpose: '', later: false });
  assert.equal(item.payload.notes, '我的私人备注');
  assert.equal(item.payload.purpose, '');
  assert.equal(item.payload.later, false);
});

test('automatic asset failure degrades independently without blocking text', async () => {
  const result = await collectAutomaticAssets({ tab: { id: 1, url: 'https://example.com/' },
    capture: async () => { throw new Error('截图权限失败'); },
    icon: async () => { throw new Error('跨源图标不可读'); } });
  assert.equal(result.preview.status, 'unavailable');
  assert.equal(result.icon.status, 'unavailable');
  assert.match(result.preview.reason, /截图权限失败/);
  assert.match(result.icon.reason, /跨源图标不可读/);
});

test('homepage scope never relabels a subpage capture as homepage', async () => {
  const result = await collectAutomaticAssets({ tab: { id: 1, url: 'https://example.com/subpage' }, scope: 'home',
    homepage: 'https://example.com/', capture: async () => { throw new Error('must not capture'); },
    icon: async () => ({ blob: new Blob(['icon']), sourceUrl: 'https://example.com/subpage' }) });
  assert.equal(result.preview.status, 'unavailable');
  assert.match(result.preview.reason, /首页/);
});


test('real deriveImage display data URL never replaces the webpage source URL', async () => {
  const originalDocument = globalThis.document;
  const originalBitmap = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => ({ width: 1600, height: 900, close() {} });
  globalThis.document = { createElement: () => ({ width: 0, height: 0,
    getContext: () => ({ drawImage() {} }),
    toBlob: resolve => resolve(new Blob(['derived'], { type: 'image/webp' })),
    toDataURL: () => 'data:image/webp;base64,ZGVyaXZlZA==' }) };
  try {
    const raw = { url: 'https://example.com/articles/1', blob: new Blob(['screen']), capturedAt: '2026-01-01T00:00:00Z' };
    const derived = await deriveImage(raw.blob);
    assert.match(derived.url, /^data:image\/webp/);
    const assets = await collectAutomaticAssets({ tab: { id: 1, url: raw.url }, icon: async () => { throw new Error('无图标'); },
      capture: async () => ({ ...raw, ...derived, sourceUrl: raw.url }) });
    assert.equal(assets.preview.status, 'ready');
    assert.equal(assets.preview.sourceUrl, raw.url);
    assert.equal(assets.preview.displayUrl, derived.url);
    const records = [];
    const persisted = await persistAutomaticAssets({ store: { put: async record => records.push(record) }, connection,
      captureId: clientCaptureId, assets, savedUrl: raw.url });
    assert.deepEqual(persisted.errors, []);
    assert.equal(persisted.attachment.sourceUrl, raw.url);
    assert.equal(records[0].sourceUrl, raw.url);
    assert.equal(records[0].blob, derived.blob);
  } finally {
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
    if (originalBitmap === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = originalBitmap;
  }
});
