import test from 'node:test';
import assert from 'node:assert/strict';
import { createBookmarkImporter } from '../bookmark-engine.js';

const connection = { server: 'https://workspace.test', user: { id: 7, email: 'a@test' }, token: 'private-token', device: { id: 1 }, expiresAt: '2099-01-01T00:00:00Z' };
function fixture(request) {
  let state = { connection: structuredClone(connection), queue: [] };
  const importer = createBookmarkImporter({ read: async () => structuredClone(state), write: async next => { state = structuredClone(next); }, request, permission: async () => true });
  return { importer, changeOwner: () => { state.connection.user.id = 8; }, state: () => state };
}
const items = n => Array.from({ length: n }, (_, i) => ({ title: String(i), url: `https://example.test/${i}`, folder: '' }));
test('saves stable batch IDs before sending and resumes a lost response without duplicate totals', async () => {
  const receipts = new Map(); let lose = true;
  const f = fixture(async (path, options) => {
    const { batchId, items } = options.body;
    const value = receipts.get(batchId) || { batchId, ownerId: 7, imported: items.length, skipped: 0 };
    receipts.set(batchId, value);
    if (lose) { lose = false; throw new Error('response lost'); }
    return value;
  });
  await f.importer.handle({ type: 'bookmarks-start', confirmed: true, items: items(501) });
  await assert.rejects(f.importer.handle({ type: 'bookmarks-step' }));
  assert.equal(f.state().bookmarkImport.batches[0].id, [...receipts.keys()][0]);
  await f.importer.handle({ type: 'bookmarks-step' });
  const status = await f.importer.handle({ type: 'bookmarks-step' });
  assert.equal(status.phase, 'complete');
  assert.equal(status.imported, 501);
  assert.equal(receipts.size, 2);
  assert.equal(JSON.stringify(status).includes('private-token'), false);
});
test('requires explicit confirmation and never sends a pending task under another owner', async () => {
  let sent = 0;
  const f = fixture(async () => { sent++; });
  await assert.rejects(f.importer.handle({ type: 'bookmarks-start', items: items(1) }));
  await f.importer.handle({ type: 'bookmarks-start', confirmed: true, items: items(1) });
  f.changeOwner();
  await assert.rejects(f.importer.handle({ type: 'bookmarks-step' }));
  assert.equal(sent, 0);
});
test('permission denial cannot create or send an import task', async () => {
  let state = { connection, queue: [] }, sent = 0;
  const importer = createBookmarkImporter({ read: async () => structuredClone(state), write: async value => { state = value; },
    permission: async () => false, request: async () => { sent++; } });
  await assert.rejects(importer.handle({ type: 'bookmarks-start', confirmed: true, items: items(1) }));
  assert.equal(sent, 0);
  assert.equal(state.bookmarkImport, undefined);
});
test('stop preserves completed batch totals and discards only remaining local snapshot', async () => {
  let sent = 0;
  const f = fixture(async (path, options) => { sent++; return { batchId: options.body.batchId, ownerId: 7, imported: options.body.items.length, skipped: 0 }; });
  await f.importer.handle({ type: 'bookmarks-start', confirmed: true, items: items(501) });
  await f.importer.handle({ type: 'bookmarks-step' });
  const stopped = await f.importer.handle({ type: 'bookmarks-cancel' });
  assert.equal(stopped.phase, 'cancelled');
  assert.equal(stopped.imported, 500);
  await f.importer.handle({ type: 'bookmarks-step' });
  assert.equal(sent, 1);
});
