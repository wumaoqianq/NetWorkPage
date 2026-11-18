import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCaptureReceipt, classifyAssetError, isAssetJobComplete, markAssetFailure, markAssetUploaded,
  mergeAssetJob, nextAssetAttempt, normalizeAssetJob } from '../asset-attach.js';

const base = { captureId: 'cap-1', server: 'https://w.example', userId: '7', savedUrl: 'https://site.example/' };
const preview = { id: 'asset-1', sourceUrl: 'https://site.example/', sourceEndpointId: '', homepageUrl: '',
  pageKind: 'current', userConfirmedHomepage: false, capturedAt: 1 };

test('附加素材只写独立任务，不包含也不修改文字队列状态', () => {
  const job = mergeAssetJob(null, { captureId: 'cap-1', attachment: preview }, { server: base.server, userId: '7', now: 10 });
  assert.equal(job.captureId, 'cap-1');
  assert.equal(job.attachment.id, 'asset-1');
  assert.equal(job.siteId, null);
  assert.equal(job.state, 'pending');
  assert.equal('queue' in job, false);
  assert.equal('lastResult' in job, false);
});

test('文字回执只给任务补 siteId/version，不改变 Blob 引用', () => {
  const job = mergeAssetJob(null, { captureId: 'cap-1', attachment: preview }, { server: base.server, userId: '7', now: 10 });
  const applied = applyCaptureReceipt(job, { siteId: 'site-1', siteVersion: 3 }, { now: 20 });
  assert.equal(applied.siteId, 'site-1');
  assert.equal(applied.siteVersion, 3);
  assert.equal(applied.attachment.id, 'asset-1');
  assert.equal(applied.state, 'pending');
});

test('成功才移除引用；失败保留 Blob 引用并进入有限退避', () => {
  const job = mergeAssetJob(null, { captureId: 'cap-1', attachment: preview }, { server: base.server, userId: '7', now: 10 });
  const failed = markAssetFailure(job, 'preview', { status: 503, message: '暂时不可用' }, 1000);
  assert.equal(failed.state, 'retryable');
  assert.equal(failed.attachment.id, 'asset-1');
  assert.ok(failed.nextAttemptAt > 1000);
  const uploaded = markAssetUploaded({ ...job, siteId: 'site-1', siteVersion: 3 }, 'preview',
    { siteVersion: 4 }, 2000);
  assert.equal(uploaded.previewUploaded, true);
  assert.equal(uploaded.attachment, null);
  assert.equal(uploaded.siteVersion, 4);
  assert.equal(isAssetJobComplete(uploaded), true);
});

test('错误分类：网络/5xx/429/认证可重试，400/413 终态但不删除内容', () => {
  assert.equal(classifyAssetError({ status: 0 }).retryable, true);
  assert.equal(classifyAssetError({ status: 503 }).kind, 'network');
  assert.equal(classifyAssetError({ status: 429 }).retryable, true);
  assert.equal(classifyAssetError({ status: 401 }).kind, 'auth');
  assert.equal(classifyAssetError({ status: 403 }).kind, 'permission');
  assert.equal(classifyAssetError({ status: 403 }).retryable, false);
  assert.equal(classifyAssetError({ status: 409, code: 'version_conflict' }).kind, 'version_conflict');
  assert.equal(classifyAssetError({ status: 409, code: 'preview_source_changed' }).kind, 'source_changed');
  assert.equal(classifyAssetError({ status: 409, code: 'idempotency_conflict' }).kind, 'idempotency_conflict');
  assert.equal(classifyAssetError({ status: 413 }).retryable, false);
  const job = mergeAssetJob(null, { captureId: 'cap-1', attachment: preview }, { server: base.server, userId: '7', now: 10 });
  const terminal = markAssetFailure(job, 'preview', { status: 413, message: '过大' }, 1000);
  assert.equal(terminal.state, 'failed');
  assert.equal(terminal.previewBlocked, true);
  assert.equal(terminal.attachment.id, 'asset-1');
  assert.equal(nextAssetAttempt(0, 1000), 1000);
  assert.ok(nextAssetAttempt(2, 1000) > 1000);
});

test('任务字段规范化且未知状态回到 pending', () => {
  assert.equal(normalizeAssetJob({ state: 'weird' }).state, 'pending');
  assert.equal(normalizeAssetJob({ attempts: -1 }).attempts, 0);
  assert.equal(normalizeAssetJob({ siteVersion: '3' }).siteVersion, null);
});
