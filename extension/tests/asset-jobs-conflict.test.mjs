import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../engine.js';

const paired = { token: 'secret', user: { id: 7, email: 'a@example.com' }, device: { id: 2 }, expiresAt: '2099-01-01' };
const server = 'https://workspace.example';
const captureId = '05c70488-1cef-491f-93cc-9e680c535716';
const preview = { id: 'asset-1', bytes: 1000, createdAt: 900, capturedAt: '2026-01-01T00:00:00Z',
  sourceEndpointId: '', sourceUrl: 'https://site.example/', homepageUrl: '', pageKind: 'current', userConfirmedHomepage: false };
const icon = { id: 'icon-1', bytes: 900, createdAt: 900, sourceUrl: 'https://site.example/' };
const job = (overrides = {}) => ({ captureId, server, userId: '7', savedUrl: 'https://site.example/', siteId: 'site-1',
  siteVersion: 1, attachment: null, iconAttachment: null, state: 'pending', attempts: 0, nextAttemptAt: 0,
  previewRevision: null, iconRevision: null, createdAt: 900, updatedAt: 900, ...overrides });

function fixture(respond, initial) {
  let state = structuredClone(initial); let clock = 1000;
  const records = new Map([
    ['asset-1', { id: 'asset-1', kind: 'preview', blob: new Blob(['image']), server, userId: '7', captureId, createdAt: 900 }],
    ['icon-1', { id: 'icon-1', kind: 'icon', blob: new Blob(['icon']), server, userId: '7', captureId, createdAt: 900 }],
  ]);
  const removed = [], calls = [];
  const attachments = { get: async id => records.get(id), remove: async id => { removed.push(id); records.delete(id); }, prune: async () => {} };
  const notified = [];
  const engine = createEngine({ read: async () => structuredClone(state), write: async value => { state = structuredClone(value); },
    attachments, now: () => clock, request: async (path, options) => { calls.push({ path, options }); return respond(path, options); },
    iconTasks: { onAssetConflict: async (...args) => notified.push(args), onIconUploadFailed: async () => {} } });
  return { engine, state: () => state, records, removed, calls, notified, advance: ms => { clock += ms; } };
}
const baseState = () => ({ connection: { server, ...paired, paused: false }, queue: [], assetJobs: [], captureReceipts: {} });
const conflictError = (code = 'version_conflict') => Object.assign(new Error('版本冲突'), { status: 409, code });

test('409 版本冲突但对应图标 revision 未变：验证后安全续传', async () => {
  let uploads = 0;
  const context = fixture(path => {
    if (path.includes('/lookup')) return { site: { id: 'site-1', version: 2, iconRevision: null, previewRevision: null,
      deleted: false, archived: false } };
    if (path.endsWith('/icon')) {
      uploads++;
      if (uploads === 1) throw conflictError();
      return { assetId: 'a', revision: 'new-icon', status: 'complete', siteVersion: 3 };
    }
    return {};
  }, { ...baseState(), assetJobs: [job({ iconAttachment: icon })] });
  await context.engine.flush();
  assert.equal(context.state().assetJobs[0].state, 'pending');
  assert.equal(context.state().assetJobs[0].siteVersion, 2);
  context.advance(60000);
  await context.engine.flush();
  assert.equal(context.state().assetJobs.length, 0);
  assert.equal(context.records.has('icon-1'), false);
});

test('旧任务恢复时已有新图/用户删图/来源变化/幂等冲突：保留 Blob 并暂停，不覆盖', async () => {
  const cases = [
    { name: '已有新图', lookup: { id: 'site-1', version: 3, iconRevision: 'new', previewRevision: null }, error: conflictError() },
    { name: '用户删图', job: { iconRevision: 'old' }, lookup: { id: 'site-1', version: 3, iconRevision: null, previewRevision: null }, error: conflictError() },
    { name: '来源变化', lookup: null, error: conflictError('preview_source_changed') },
    { name: '幂等冲突', lookup: null, error: conflictError('idempotency_conflict') },
  ];
  for (const item of cases) {
    const context = fixture(path => {
      if (path.includes('/lookup')) return { site: { deleted: false, archived: false, ...(item.lookup || {}) } };
      if (path.endsWith('/icon')) throw item.error;
      return {};
    }, { ...baseState(), assetJobs: [job({ iconAttachment: icon, ...(item.job || {}) })] });
    await context.engine.flush();
    const current = context.state().assetJobs[0];
    assert.equal(current.state, 'conflict', item.name);
    assert.equal(current.iconAttachment.id, 'icon-1', item.name);
    assert.equal(context.records.has('icon-1'), true, item.name);
    assert.equal(context.removed.includes('icon-1'), false, item.name);
    assert.equal(context.notified[0][0], captureId, item.name);
    assert.match(context.notified[0][1].reason, /冲突|素材/, item.name);
    context.advance(600000);
    await context.engine.flush();
    assert.equal(context.state().assetJobs[0].state, 'conflict', item.name + ' 不自动重试');
    assert.equal(context.calls.filter(call => call.path.endsWith('/icon')).length, 1, item.name);
  }
});

test('同任务 preview 推进版本后 icon 冲突：对应 revision 匹配才安全续传', async () => {
  let iconAttempts = 0;
  const context = fixture((path, options) => {
    if (path.includes('/lookup')) return { site: { id: 'site-1', version: 3, previewRevision: 'own-preview', iconRevision: null,
      deleted: false, archived: false } };
    if (path.endsWith('/preview')) return { assetId: 'p', revision: 'own-preview', status: 'complete', siteVersion: 2 };
    if (path.endsWith('/icon')) {
      iconAttempts++;
      if (iconAttempts === 1) throw conflictError();
      return { assetId: 'i', revision: 'own-icon', status: 'complete', siteVersion: 4 };
    }
    return {};
  }, { ...baseState(), assetJobs: [job({ attachment: preview, iconAttachment: icon })] });
  await context.engine.flush();
  assert.equal(context.state().assetJobs[0].previewUploaded, true);
  assert.equal(context.state().assetJobs[0].previewRevision, 'own-preview');
  context.advance(60000);
  await context.engine.flush();
  assert.equal(context.state().assetJobs.length, 0);
  assert.equal(context.records.has('asset-1'), false);
  assert.equal(context.records.has('icon-1'), false);
});

test('409 非 version_conflict 错误码不会触发 lookup 或自动重传', async () => {
  const context = fixture(path => {
    if (path.includes('/lookup')) return { site: { id: 'site-1', version: 9 } };
    if (path.endsWith('/icon')) throw conflictError('idempotency_conflict');
    return {};
  }, { ...baseState(), assetJobs: [job({ iconAttachment: icon })] });
  await context.engine.flush();
  assert.equal(context.calls.some(call => call.path.includes('/lookup')), false);
  assert.equal(context.state().assetJobs[0].state, 'conflict');
  assert.equal(context.records.has('icon-1'), true);
});
