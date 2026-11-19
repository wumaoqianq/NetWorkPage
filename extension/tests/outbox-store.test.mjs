import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryOutboxStore } from '../outbox-store.js';

test('任务与 Blob 在同一 commit 事务内保存：一起提交', async () => {
  const store = createMemoryOutboxStore();
  await store.commit({
    capturePut: [['c1', { captureId: 'c1', phase: 'local_saved' }]],
    blobPut: [['b1', { bytes: 4, blob: 'data' }]],
    metaPut: [['schemaVersion', 1]],
  });
  const snap = await store.load();
  assert.equal(snap.captures.c1.phase, 'local_saved');
  assert.equal(snap.blobs.b1.bytes, 4);
  assert.equal(snap.meta.schemaVersion, 1);
});

test('事务中止：commit 失败时任务与 Blob 都不落盘（原子性）', async () => {
  const store = createMemoryOutboxStore();
  await store.commit({ capturePut: [['base', { captureId: 'base' }]] });
  store.failNextCommit = true;
  await assert.rejects(() => store.commit({
    capturePut: [['c2', { captureId: 'c2', phase: 'local_saved' }]],
    blobPut: [['b2', { bytes: 9, blob: 'x' }]],
  }));
  const snap = await store.load();
  assert.equal(snap.captures.c2, undefined, '任务未写入');
  assert.equal(snap.blobs.b2, undefined, 'Blob 未写入');
  assert.ok(snap.captures.base, '旧数据不受影响');
});

test('load 返回快照副本，调用方修改不影响权威状态', async () => {
  const store = createMemoryOutboxStore();
  await store.commit({ capturePut: [['c1', { captureId: 'c1', phase: 'local_saved' }]] });
  const snap = await store.load();
  snap.captures.c1.phase = 'complete';
  snap.captures.c2 = { captureId: 'c2' };
  const again = await store.load();
  assert.equal(again.captures.c1.phase, 'local_saved');
  assert.equal(again.captures.c2, undefined);
});

test('删除操作在 commit 中生效', async () => {
  const store = createMemoryOutboxStore();
  await store.commit({ capturePut: [['c1', { captureId: 'c1' }]], blobPut: [['b1', { bytes: 1 }]] });
  await store.commit({ captureDelete: ['c1'], blobDelete: ['b1'] });
  const snap = await store.load();
  assert.equal(snap.captures.c1, undefined);
  assert.equal(snap.blobs.b1, undefined);
});
