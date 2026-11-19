import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../engine.js';
import { eligibleItems } from '../queue.js';

const paired = { token: 'secret', user: { id: 7, email: 'a@example.com' }, device: { id: 2 }, expiresAt: '2099-01-01' };
const server = 'https://workspace.example';
const captureId = '05c70488-1cef-491f-93cc-9e680c535716';
const preview = { id: 'asset-1', bytes: 1000, createdAt: 900, capturedAt: '2026-01-01T00:00:00Z',
  sourceEndpointId: '', sourceUrl: 'https://site.example/', homepageUrl: '', pageKind: 'current', userConfirmedHomepage: false };
const icon = { id: 'icon-1', bytes: 900, createdAt: 900, sourceUrl: 'https://site.example/' };
const queueItem = { id: `${server}|7|${captureId}`, server, userId: '7', protocol: 2,
  payload: { clientCaptureId: captureId, url: 'https://site.example/', title: '首页' },
  createdAt: 900, attempts: 0, nextAttemptAt: 0, state: 'pending', attachment: null, iconAttachment: null };

function fixture(respond, initial) {
  let state = structuredClone(initial);
  let clock = 1000;
  const records = new Map([
    ['asset-1', { id: 'asset-1', kind: 'preview', blob: new Blob(['image']), server, userId: '7', captureId, createdAt: 900 }],
    ['icon-1', { id: 'icon-1', kind: 'icon', blob: new Blob(['icon']), server, userId: '7', captureId, createdAt: 900 }],
    ['asset-2', { id: 'asset-2', kind: 'preview', blob: new Blob(['image2']), server, userId: '7', captureId: '15b21246-9cc8-4832-8e57-16cbd7ca0f24', createdAt: 900 }],
  ]);
  const removed = [], calls = [];
  const attachments = { get: async id => records.get(id), remove: async id => { removed.push(id); records.delete(id); },
    prune: async () => {} };
  const make = () => createEngine({ read: async () => structuredClone(state), write: async value => { state = structuredClone(value); },
    attachments, now: () => clock, request: async (path, options) => { calls.push({ path, options }); return respond(path, options); } });
  return { make, engine: make(), state: () => state, records, removed, calls, advance: ms => { clock += ms; } };
}

const baseState = () => ({ connection: { server, ...paired, paused: false }, queue: [], assetJobs: [], captureReceipts: {} });
const job = (overrides = {}) => ({ captureId, server, userId: '7', savedUrl: 'https://site.example/', siteId: null,
  siteVersion: null, attachment: null, iconAttachment: null, state: 'pending', attempts: 0, nextAttemptAt: 0,
  createdAt: 900, updatedAt: 900, ...overrides });

test('迟到素材只登记独立任务；文字仍 pending 且可继续提交，确认后才上传', async () => {
  const context = fixture(path => {
    if (path.endsWith('/v2/captures')) return { site: { id: 'site-1', version: 1 }, canAttachPreview: true, canAttachIcon: true, duplicate: false };
    if (path.endsWith('/preview')) return { assetId: 'a', status: 'complete', siteVersion: 2 };
    return {};
  }, { ...baseState(), queue: [queueItem] });
  await context.engine.handle({ type: 'attach', captureId, attachment: preview, savedUrl: 'https://site.example/' });
  assert.equal(context.state().queue[0].state, 'pending');
  assert.equal(context.state().queue[0].siteId ?? null, null);
  assert.equal(eligibleItems(context.state().queue, context.state().connection, 1000).length, 1);
  assert.equal(context.state().assetJobs[0].attachment.id, 'asset-1');
  await context.engine.flush();
  assert.equal(context.state().queue.length, 0);
  assert.equal(context.state().assetJobs.length, 0);
  assert.equal(context.records.has('asset-1'), false);
  assert.equal(context.calls.filter(call => call.path.endsWith('/preview')).length, 1);
});

test('上传网络失败保留 Blob 与任务；新引擎实例（浏览器重启）自动恢复成功', async () => {
  let fail = true;
  const context = fixture(path => {
    if (path.endsWith('/preview')) {
      if (fail) throw Object.assign(new Error('网络不可用'), { status: 0 });
      return { assetId: 'a', status: 'complete', siteVersion: 2 };
    }
    return {};
  }, { ...baseState(), assetJobs: [job({ siteId: 'site-1', siteVersion: 1, attachment: preview })] });
  await context.engine.flush();
  const failed = context.state().assetJobs[0];
  assert.equal(failed.state, 'retryable');
  assert.equal(failed.attachment.id, 'asset-1');
  assert.equal(context.records.has('asset-1'), true);
  assert.equal(context.removed.length, 0);
  fail = false;
  context.advance(60000);
  const restarted = context.make();
  await restarted.flush();
  assert.equal(context.state().assetJobs.length, 0);
  assert.equal(context.records.has('asset-1'), false);
  assert.equal(context.removed.includes('asset-1'), true);
});

test('两个 capture 交错附加和确认时各自恢复归属，不依赖唯一 lastResult', async () => {
  const otherId = '15b21246-9cc8-4832-8e57-16cbd7ca0f24';
  const otherPreview = { ...preview, id: 'asset-2', sourceUrl: 'https://other.example/' };
  const state = { ...baseState(), queue: [
    { ...queueItem, id: `${server}|7|${otherId}`, payload: { clientCaptureId: otherId, url: 'https://other.example/', title: 'Other' } },
    queueItem,
  ], lastResult: { clientCaptureId: 'stale-capture', siteId: 'wrong' } };
  const context = fixture(path => {
    if (path.endsWith('/v2/captures')) return { site: { id: 'site-1', version: 1 }, canAttachPreview: true, duplicate: false };
    if (path.endsWith('/preview')) return { assetId: 'a', status: 'complete', siteVersion: 2 };
    return {};
  }, state);
  // 两个任务各自附加；文字回执在 flush 时按各自 capture 返回相同站点也可验证路径。
  await context.engine.handle({ type: 'attach', captureId, attachment: preview, savedUrl: 'https://site.example/' });
  await context.engine.handle({ type: 'attach', captureId: otherId, attachment: otherPreview, savedUrl: 'https://other.example/' });
  assert.equal(context.state().assetJobs.length, 2);
  await context.engine.flush();
  const paths = context.calls.filter(call => call.path.endsWith('/preview')).map(call => call.path);
  assert.equal(paths.some(path => path.includes(captureId)), true);
  assert.equal(paths.some(path => path.includes(otherId)), true);
  assert.equal(context.state().assetJobs.length, 0);
});

test('认证失败保留 Blob 并暂停连接；413 终态失败也不删除素材', async () => {
  const auth = fixture(path => { if (path.endsWith('/preview')) throw Object.assign(new Error('登录失效'), { status: 401 }); return {}; },
    { ...baseState(), assetJobs: [job({ siteId: 'site-1', siteVersion: 1, attachment: preview })] });
  await auth.engine.flush();
  assert.equal(auth.state().connection.paused, true);
  assert.equal(auth.state().assetJobs[0].attachment.id, 'asset-1');
  assert.equal(auth.records.has('asset-1'), true);

  const terminal = fixture(path => { if (path.endsWith('/preview')) throw Object.assign(new Error('过大'), { status: 413 }); return {}; },
    { ...baseState(), assetJobs: [job({ siteId: 'site-1', siteVersion: 1, attachment: preview })] });
  await terminal.engine.flush();
  assert.equal(terminal.state().assetJobs[0].state, 'failed');
  assert.equal(terminal.state().assetJobs[0].attachment.id, 'asset-1');
  assert.equal(terminal.records.has('asset-1'), true);
});

test('版本冲突先刷新站点版本，下一次 flush 自动重试成功', async () => {
  let uploads = 0;
  const context = fixture(path => {
    if (path.includes('/lookup')) return { site: { id: 'site-1', version: 2 } };
    if (path.endsWith('/preview')) {
      uploads++;
      if (uploads === 1) throw Object.assign(new Error('版本冲突'), { status: 409, code: 'version_conflict' });
      return { assetId: 'a', status: 'complete', siteVersion: 3 };
    }
    return {};
  }, { ...baseState(), assetJobs: [job({ siteId: 'site-1', siteVersion: 1, attachment: preview })] });
  await context.engine.flush();
  assert.equal(context.state().assetJobs[0].siteVersion, 2);
  assert.equal(context.records.has('asset-1'), true);
  await context.engine.flush();
  assert.equal(context.state().assetJobs.length, 0);
  assert.equal(context.records.has('asset-1'), false);
});

test('离线收藏→迟到素材→恢复网络：文字与素材都自动完成，无需手动 retry', async () => {
  let online = false;
  const context = fixture(path => {
    if (path.endsWith('/v2/captures')) {
      if (!online) throw Object.assign(new Error('离线'), { status: 0 });
      return { site: { id: 'site-1', version: 1 }, canAttachPreview: true, duplicate: false };
    }
    if (path.endsWith('/preview')) return { assetId: 'a', status: 'complete', siteVersion: 2 };
    return {};
  }, { ...baseState(), queue: [queueItem] });
  await context.engine.handle({ type: 'attach', captureId, attachment: preview, savedUrl: 'https://site.example/' });
  await context.engine.flush();
  assert.equal(context.state().queue[0].state, 'pending');
  assert.equal(context.state().queue[0].attachment, null);
  assert.equal(context.state().assetJobs[0].attachment.id, 'asset-1');
  online = true;
  context.advance(60000);
  await context.engine.flush();
  assert.equal(context.state().queue.length, 0);
  assert.equal(context.state().assetJobs.length, 0);
  assert.equal(context.records.has('asset-1'), false);
});


test('图标上传使用站点入口 sourceUrl，而不是候选图标地址', async () => {
  let formSource = null;
  const context = fixture((path, options) => {
    if (path.endsWith('/icon')) { formSource = options.form.get('sourceUrl'); return { assetId: 'a', status: 'complete', siteVersion: 2 }; }
    return {};
  }, { ...baseState(), assetJobs: [job({ siteId: 'site-1', siteVersion: 1,
    iconAttachment: { id: 'icon-1', sourceUrl: 'https://site.example/favicon.ico' } })] });
  await context.engine.flush();
  assert.equal(formSource, 'https://site.example/');
  assert.equal(context.state().assetJobs.length, 0);
});

test('用户明确取消素材时才删除 Blob 与任务', async () => {
  const context = fixture(() => ({}), { ...baseState(),
    assetJobs: [job({ siteId: 'site-1', siteVersion: 1, attachment: preview, iconAttachment: icon })] });
  await context.engine.handle({ type: 'cancel-attachment', captureId, kind: 'preview' });
  assert.equal(context.records.has('asset-1'), false);
  assert.equal(context.state().assetJobs[0].iconAttachment.id, 'icon-1');
  await context.engine.handle({ type: 'cancel-attachment', captureId, kind: 'icon' });
  assert.equal(context.state().assetJobs.length, 0);
  assert.equal(context.records.has('icon-1'), false);
});
