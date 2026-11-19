import test from 'node:test';
import assert from 'node:assert/strict';
import { screenshotResourceReducer, screenshotResourceKey } from '../src/screenshot-resource.js';

const preview = revision => ({ present: true, revision, fullUrl: `/api/sites/a/preview/image?size=full&rev=${revision}` });
const ready = { status: 'ready', error: '', zoom: 1.5, offerUpdate: false, objectUrl: 'blob:old', requestId: 2 };

test('resource identity includes site and revision', () => {
  assert.equal(screenshotResourceKey('a', preview('r1')), 'a|r1|/api/sites/a/preview/image?size=full&rev=r1');
});

test('a failed resource retries on a new revision without a stale error callback winning', () => {
  const failed = { ...ready, status: 'error', error: 'not_found', offerUpdate: false };
  const loading = screenshotResourceReducer(failed, { type: 'revision', requestId: 3 });
  assert.equal(loading.status, 'loading');
  assert.equal(loading.error, '');
  const stale = screenshotResourceReducer(loading, { type: 'error', requestId: 2, error: 'stale' });
  assert.equal(stale.status, 'loading');
  const recovered = screenshotResourceReducer(stale, { type: 'success', requestId: 3, objectUrl: 'blob:new' });
  assert.equal(recovered.status, 'ready');
  assert.equal(recovered.objectUrl, 'blob:new');
});

test('a ready image offers a refresh instead of unexpectedly changing content', () => {
  const next = screenshotResourceReducer(ready, { type: 'revision', requestId: 3 });
  assert.equal(next.status, 'ready');
  assert.equal(next.offerUpdate, true);
  assert.equal(next.objectUrl, 'blob:old');
});

test('switching site resets error, zoom and stale object URL', () => {
  const next = screenshotResourceReducer({ ...ready, status: 'error', error: 'decode' }, { type: 'start', requestId: 4 });
  assert.equal(next.status, 'loading');
  assert.equal(next.zoom, 1);
  assert.equal(next.error, '');
  assert.equal(next.objectUrl, '');
});
