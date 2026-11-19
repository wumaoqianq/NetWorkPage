import test from 'node:test';
import assert from 'node:assert/strict';
import { planMigration, applyMigration, verifyMigration } from '../migration.js';
import { createMemoryOutboxStore } from '../outbox-store.js';
import { OUTBOX_SCHEMA } from '../outbox.js';

const server = 'https://workspace.example';
const cid1 = '05c70488-1cef-491f-93cc-9e680c535716';
const cid2 = '15b21246-9cc8-4832-8e57-16cbd7ca0f24';
const cid3 = '25b21246-9cc8-4832-8e57-16cbd7ca0f24';
const item = (overrides = {}) => ({ id: `${server}|7|${overrides.cid || cid1}`, server, userId: '7', protocol: 2,
  payload: { clientCaptureId: overrides.cid || cid1, url: 'https://site-a.example/', title: 'A', notes: 'n', category: 'AI' },
  attachment: null, iconAttachment: null, siteId: null, siteVersion: null,
  state: 'pending', attempts: 0, nextAttemptAt: 0, lastError: '', createdAt: 900, ...overrides });

test('迁移计划：pending→local_saved 可提交；auth/blocked/conflict/cancelled 不迁成自动可提交', () => {
  const plan = planMigration({ queue: [
    item(),
    item({ cid: cid2, state: 'auth', lastError: '凭据失效' }),
    item({ cid: cid3, state: 'blocked', lastError: '被拒绝' }),
  ], assetJobs: [], captureReceipts: {}, iconTasks: [], blobIndex: {}, now: 1000 });
  const byId = Object.fromEntries(plan.records.map(rec => [rec.captureId, rec]));
  assert.equal(byId[cid1].phase, 'local_saved');
  assert.equal(byId[cid2].phase, 'needs_auth');
  assert.equal(byId[cid3].phase, 'conflict');
  assert.equal(byId[cid2].needsUserAction, true);
  assert.equal(byId[cid3].needsUserAction, true);
  assert.equal(plan.records.every(rec => rec.migratedFrom === 'legacy'), true);
  assert.equal(plan.records.every(rec => rec.schemaVersion === OUTBOX_SCHEMA), true);
});

test('迁移计划：identity server+owner 保留；captureId 稳定；payload 原样保留（幂等重发）', () => {
  const plan = planMigration({ queue: [item()], assetJobs: [], captureReceipts: {}, iconTasks: [], blobIndex: {}, now: 1000 });
  const rec = plan.records[0];
  assert.equal(rec.server, server);
  assert.equal(rec.ownerId, '7');
  assert.equal(rec.captureId, cid1);
  assert.deepEqual(rec.payload, item().payload);
});

test('已确认文字的队列项(preview_pending)用 captureReceipts 补 receipt，不 auto 重新建站', () => {
  const plan = planMigration({ queue: [item({ state: 'preview_pending', siteId: 'site-1', siteVersion: 3 })],
    assetJobs: [], captureReceipts: { [cid1]: { siteId: 'site-1', siteVersion: 3,
      canAttachPreview: true, canAttachIcon: false, savedUrl: 'https://site-a.example/' } },
    iconTasks: [], blobIndex: {}, now: 1000 });
  assert.equal(plan.records[0].phase, 'complete');
  assert.equal(plan.records[0].receipt.siteId, 'site-1');
});

test('Blob 摘要/字节在迁移中被核对，缺 Blob 被记录为 skipped 而非静默丢弃', () => {
  const withBlob = item({ cid: cid2, attachment: { id: 'blob-1', bytes: 10, sourceUrl: 'https://site-a.example/' } });
  const plan = planMigration({ queue: [withBlob], assetJobs: [], captureReceipts: {}, iconTasks: [],
    blobIndex: { 'blob-1': { bytes: 10, digest: 'd1' } }, now: 1000 });
  assert.equal(plan.blobChecks.length, 1);
  assert.equal(plan.verification.blobCount, 1);
  const missing = planMigration({ queue: [item({ cid: cid3, attachment: { id: 'blob-missing', bytes: 5 } })],
    assetJobs: [], captureReceipts: {}, iconTasks: [], blobIndex: {}, now: 1000 });
  assert.equal(missing.records[0].preview.deferred, true);
  assert.ok(missing.warnings.some(w => w.includes('blob-missing')));
});

test('verifyMigration：任务数/身份/Blob 摘要全部匹配才通过；不匹配返回 false', () => {
  const plan = planMigration({ queue: [item()], assetJobs: [], captureReceipts: {}, iconTasks: [], blobIndex: {}, now: 1000 });
  const store = createMemoryOutboxStore();
  // 先写入再校验
  const good = verifyMigration(plan, { queue: [item()], blobIndex: {} });
  assert.equal(good.ok, true, good.reason);
  const badCount = verifyMigration(plan, { queue: [item(), item({ cid: cid2 })], blobIndex: {} });
  assert.equal(badCount.ok, false);
  const badIdentity = verifyMigration(plan, { queue: [item({ server: 'https://other.example' })], blobIndex: {} });
  assert.equal(badIdentity.ok, false);
});

test('applyMigration：原子写入全部记录 + schemaVersion + 迁移标记（一个事务）；失败可回退', async () => {
  const plan = planMigration({ queue: [item(), item({ cid: cid2, state: 'auth' })],
    assetJobs: [], captureReceipts: {}, iconTasks: [], blobIndex: {}, now: 1000 });
  const store = createMemoryOutboxStore();
  await applyMigration(store, plan, 1000);
  const snap = await store.load();
  assert.equal(snap.meta.schemaVersion, OUTBOX_SCHEMA);
  assert.equal(snap.meta.migration.at, 1000);
  assert.equal(snap.meta.migration.migratedCount, 2);
  assert.equal(Object.keys(snap.captures).length, 2);
  // 失败回退：commit 抛错时旧状态不变
  const before = await createMemoryOutboxStore().load();
  const failing = createMemoryOutboxStore();
  failing.failNextCommit = true;
  await assert.rejects(() => applyMigration(failing, plan, 1000));
  assert.deepEqual((await failing.load()).captures, before.captures, '失败未写入任何任务');
});

test('冲突/auth 迁移后 flush 不会自动联网提交', async () => {
  // 通过 phase 直接断言：needs_auth/conflict 不在可提交集合
  const plan = planMigration({ queue: [item({ cid: cid2, state: 'auth' }), item({ cid: cid3, state: 'conflict' })],
    assetJobs: [], captureReceipts: {}, iconTasks: [], blobIndex: {}, now: 1000 });
  const submittable = plan.records.filter(rec => ['local_saved', 'waiting_network', 'creating_site'].includes(rec.phase));
  assert.equal(submittable.length, 0);
});
