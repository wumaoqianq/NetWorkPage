import test from 'node:test';
import assert from 'node:assert/strict';
import { runMigration } from '../migration-run.js';
import { createMemoryOutboxStore } from '../outbox-store.js';

const server = 'https://workspace.example';
const cid = '05c70488-1cef-491f-93cc-9e680c535716';
const legacyItem = (state = 'pending') => ({ id: `${server}|7|${cid}`, server, userId: '7', protocol: 2,
  payload: { clientCaptureId: cid, url: 'https://a.example/', title: 'A', notes: 'n', category: 'AI' },
  state, attempts: 0, nextAttemptAt: 0, lastError: '', createdAt: 900 });

function storage(initial = {}) {
  let data = { ...initial };
  const writes = [];
  return { get: async keys => Object.fromEntries(keys.map(key => [key, data[key]])),
    set: async patch => { writes.push(patch); data = { ...data, ...patch }; },
    writes, raw: () => data };
}

test('迁移：备份→独立副本验证→原子写入；旧数据保留不清空', async () => {
  const st = storage({ workspaceState: { queue: [legacyItem()], assetJobs: [], captureReceipts: {} },
    workspaceIconTasks: { tasks: {} } });
  const store = createMemoryOutboxStore();
  const attachments = { all: async () => [] };
  const result = await runMigration({ storage: st, attachments, store, now: () => 1000 });
  assert.equal(result.migrated, 1);
  const snap = await store.load();
  assert.equal(snap.captures[cid].phase, 'local_saved');
  assert.equal(snap.meta.schemaVersion, 1);
  assert.equal(snap.meta.migration.migratedCount, 1);
  // 备份写入、旧数据仍在
  assert.ok(st.raw().workspaceOutboxBackupV1);
  assert.equal(st.raw().workspaceState.queue.length, 1);
});

test('迁移幂等：已有迁移标记则跳过，不重复写入', async () => {
  const st = storage({ workspaceState: { queue: [legacyItem()] } });
  const store = createMemoryOutboxStore();
  await runMigration({ storage: st, attachments: { all: async () => [] }, store, now: () => 1000 });
  const second = await runMigration({ storage: st, attachments: { all: async () => [] }, store, now: () => 2000 });
  assert.equal(second.skipped, true);
  assert.equal((await store.load()).meta.migration.at, 1000);
});

test('冲突/auth 迁移后不可自动提交；备份不覆盖已有备份', async () => {
  const other = { ...legacyItem('blocked'), id: `${server}|7|25b21246-9cc8-4832-8e57-16cbd7ca0f24`,
    payload: { ...legacyItem().payload, clientCaptureId: '25b21246-9cc8-4832-8e57-16cbd7ca0f24' } };
  const st = storage({ workspaceState: { queue: [legacyItem('auth'), other] },
    workspaceOutboxBackupV1: { backedUpAt: 5, keep: true } });
  const store = createMemoryOutboxStore();
  await runMigration({ storage: st, attachments: { all: async () => [] }, store, now: () => 1000 });
  assert.equal(st.raw().workspaceOutboxBackupV1.keep, true, '已有备份不被覆盖');
  const records = Object.values((await store.load()).captures);
  assert.ok(records.every(rec => !['local_saved', 'waiting_network', 'creating_site'].includes(rec.phase)));
});

test('核对失败（注入不通过）抛错且不写入迁移标记、旧数据可恢复', async () => {
  const st = storage({ workspaceState: { queue: [legacyItem()] } });
  const store = createMemoryOutboxStore();
  await assert.rejects(() => runMigration({ storage: st, attachments: { all: async () => [] }, store,
    now: () => 1000, verify: () => ({ ok: false, reason: '身份不符' }) }), /迁移核对失败/);
  assert.equal((await store.load()).meta.migration, undefined);
  assert.equal(st.raw().workspaceState.queue.length, 1, '旧数据保留');
});

test('独立副本试迁移失败（原子回滚）不会写入权威库', async () => {
  const st = storage({ workspaceState: { queue: [legacyItem()] } });
  const store = createMemoryOutboxStore();
  const failingTrial = createMemoryOutboxStore();
  failingTrial.failNextCommit = true;
  await assert.rejects(() => runMigration({ storage: st, attachments: { all: async () => [] }, store,
    now: () => 1000, trialStore: failingTrial }));
  assert.equal((await store.load()).meta.migration, undefined);
});
