import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../engine.js';
import { cleanDescription } from '../queue.js';
import { homepageMatch } from '../screenshot.js';

const paired = { token: 'secret', user: { id: 7, email: 'a@example.com' }, device: { id: 2 }, expiresAt: '2099-01-01' };
const captureId = '05c70488-1cef-491f-93cc-9e680c535716';
const attachment = { id: 'asset-1', bytes: 1000, createdAt: 900, capturedAt: '2026-01-01T00:00:00Z',
  sourceEndpointId: '', sourceUrl: 'https://site.example/', homepageUrl: 'https://site.example/',
  pageKind: 'home', userConfirmedHomepage: true };
const capture = { clientCaptureId: captureId, url: 'https://site.example/', title: '首页', description: '简介',
  homepageUrl: 'https://site.example/', attachment };

function fixture(respond, initial = null) {
  let state = initial || { connection: null, queue: [] };
  const records = new Map([['asset-1', { id: 'asset-1', kind: 'preview', blob: new Blob(['image']), server: 'https://workspace.example',
    userId: '7', captureId, createdAt: 900 }], ['icon-1', { id: 'icon-1', kind: 'icon', blob: new Blob(['icon']),
    server: 'https://workspace.example', userId: '7', captureId, createdAt: 900 }]]);
  const attachments = { get: async id => records.get(id), remove: async id => records.delete(id), prune: async () => {} };
  const calls = [];
  const engine = createEngine({ read: async () => structuredClone(state), write: async value => { state = structuredClone(value); },
    attachments, now: () => 1000, request: async (path, options) => { calls.push({ path, options }); return respond(path, options); } });
  return { engine, attachments, records, calls, state: () => state };
}

test('description is plain bounded text and homepage requires an exact normalized URL', () => {
  assert.equal(cleanDescription('  网站\n 提供\u0000服务  '), '网站 提供 服务');
  assert.equal(homepageMatch('https://example.com/', 'https://EXAMPLE.com'), true);
  assert.equal(homepageMatch('https://example.com/subpage', 'https://example.com/'), false);
});

test('text and preview are acknowledged separately and retry uses the same asset', async () => {
  let uploads = 0;
  const context = fixture(path => {
    if (path.endsWith('/pair')) return paired;
    if (path.endsWith('/preview')) { uploads++; return { assetId: 'server-asset', siteVersion: 2, status: 'complete' }; }
    return { site: { id: 'site-1', name: '首页', version: 1 }, duplicate: false, outcome: 'created', canAttachPreview: true };
  });
  await context.engine.handle({ type: 'pair', server: 'https://workspace.example', code: '123', name: 'Chrome' });
  await context.engine.handle({ type: 'capture', capture });
  await context.engine.flush();
  assert.equal(context.state().queue.length, 0);
  assert.equal(context.state().lastResult.previewUploaded, true);
  assert.equal(context.state().lastResult.updatedAssets, false);
  assert.equal(uploads, 1);
  assert.equal(context.records.has('asset-1'), false);
});

test('duplicate confirmation never uploads or overwrites with an attachment', async () => {
  const context = fixture(path => path.endsWith('/pair') ? paired
    : { site: { id: 'site-1', version: 4 }, duplicate: true, outcome: 'existing', canAttachPreview: false });
  await context.engine.handle({ type: 'pair', server: 'https://workspace.example', code: '123', name: 'Chrome' });
  await context.engine.handle({ type: 'capture', capture });
  await context.engine.flush();
  assert.equal(context.calls.some(call => call.path.endsWith('/preview')), false);
  assert.equal(context.state().queue.length, 0);
  assert.equal(context.records.has('asset-1'), false);
});

test('failed preview retains confirmed text and can be retried without a new capture', async () => {
  let fail = true;
  const context = fixture(path => {
    if (path.endsWith('/pair')) return paired;
    if (path.endsWith('/preview')) {
      if (fail) throw Object.assign(new Error('暂时失败'), { status: 503 });
      return { assetId: 'asset-1', siteVersion: 2, status: 'complete' };
    }
    return { site: { id: 'site-1', version: 1 }, canAttachPreview: true, duplicate: false };
  });
  await context.engine.handle({ type: 'pair', server: 'https://workspace.example', code: '123', name: 'Chrome' });
  await context.engine.handle({ type: 'capture', capture });
  await context.engine.flush(); await context.engine.flush();
  assert.equal(context.state().queue[0].siteId, 'site-1');
  assert.equal(context.state().queue[0].state, 'preview_pending');
  fail = false; await context.engine.handle({ type: 'retry' }); await context.engine.flush();
  assert.equal(context.calls.filter(call => call.path.endsWith('/v2/captures')).length, 1);
  assert.equal(context.state().lastResult.previewUploaded, true);
});

test('preview failure does not block the independent icon upload', async () => {
  const context = fixture(path => {
    if (path.endsWith('/pair')) return paired;
    if (path.endsWith('/preview')) throw Object.assign(new Error('预览格式失败'), { status: 400 });
    if (path.endsWith('/icon')) return { assetId: 'server-icon', siteVersion: 2, status: 'complete' };
    return { site: { id: 'site-1', version: 1 }, canAttachPreview: true, canAttachIcon: true, duplicate: false };
  });
  const iconAttachment = { id: 'icon-1', bytes: 1000, createdAt: 900, sourceUrl: 'https://site.example/' };
  await context.engine.handle({ type: 'pair', server: 'https://workspace.example', code: '123', name: 'Chrome' });
  await context.engine.handle({ type: 'capture', capture: { ...capture, iconAttachment } });
  await context.engine.flush();
  assert.equal(context.calls.filter(call => call.path.endsWith('/icon')).length, 1);
  assert.equal(context.state().queue[0].attachment.id, 'asset-1');
  assert.equal(context.state().queue[0].iconAttachment, null);
  assert.equal(context.state().lastResult.iconUploaded, true);
  assert.equal(context.records.has('asset-1'), true);
  assert.equal(context.records.has('icon-1'), false);
});

test('missing blob keeps pending text but drops only the image reference', async () => {
  const initial = { connection: { server: 'https://workspace.example', ...paired, paused: false },
    queue: [{ id: 'https://workspace.example|7|' + captureId, server: 'https://workspace.example', userId: '7', protocol: 2,
      payload: { clientCaptureId: captureId, url: 'https://site.example/', title: '首页' }, attachment,
      createdAt: 900, attempts: 0, nextAttemptAt: 1000, state: 'pending' }] };
  const context = fixture(() => ({ site: { id: 'site-1', version: 1 }, canAttachPreview: false }), initial);
  context.records.clear(); await context.engine.flush();
  assert.equal(context.state().queue.length, 0);
  assert.equal(context.state().lastResult.previewPending, false);
  assert.equal(context.calls.filter(call => call.path.endsWith('/preview')).length, 0);
});

test('duplicate asset update keeps server category, duplicate and updated outcome after uploads', async () => {
  const iconAttachment = { id: 'icon-1', bytes: 900, createdAt: 900, sourceUrl: 'https://site.example/' };
  const context = fixture(path => {
    if (path.endsWith('/pair')) return paired;
    if (path.endsWith('/preview')) return { assetId: 'server-asset', siteVersion: 5, status: 'complete' };
    if (path.endsWith('/icon')) return { assetId: 'server-icon', siteVersion: 6, status: 'complete' };
    return { site: { id: 'site-1', version: 4, category: '开发工具' }, duplicate: true, outcome: 'updated',
      acceptedFields: ['preview', 'icon'], canAttachPreview: true, canAttachIcon: true };
  });
  await context.engine.handle({ type: 'pair', server: 'https://workspace.example', code: '123', name: 'Chrome' });
  await context.engine.handle({ type: 'capture', capture: { ...capture, category: '', updateFields: ['preview', 'icon'],
    expectedVersion: 3, iconAttachment } });
  await context.engine.flush();
  const result = context.state().lastResult;
  assert.equal(result.clientCaptureId, captureId);
  assert.equal(result.siteId, 'site-1');
  assert.equal(result.category, '开发工具');
  assert.equal(result.duplicate, true);
  assert.equal(result.outcome, 'updated');
  assert.equal(result.updatedAssets, true);
  assert.equal(result.updatedPreview, true);
  assert.equal(result.updatedIcon, true);
  assert.equal(result.previewUploaded, true);
  assert.equal(result.iconUploaded, true);
});

test('icon-only duplicate update reports icon change without claiming screenshot update', async () => {
  const iconAttachment = { id: 'icon-1', bytes: 900, createdAt: 900, sourceUrl: 'https://site.example/' };
  const context = fixture(path => {
    if (path.endsWith('/pair')) return paired;
    if (path.endsWith('/icon')) return { assetId: 'server-icon', siteVersion: 3, status: 'complete' };
    return { site: { id: 'site-1', version: 2, category: '开发工具' }, duplicate: true, outcome: 'updated',
      acceptedFields: ['icon'], canAttachPreview: false, canAttachIcon: true };
  });
  await context.engine.handle({ type: 'pair', server: 'https://workspace.example', code: '123', name: 'Chrome' });
  await context.engine.handle({ type: 'capture', capture: { ...capture, attachment: null, updateFields: ['icon'],
    expectedVersion: 2, iconAttachment } });
  await context.engine.flush();
  const result = context.state().lastResult;
  assert.equal(result.duplicate, true);
  assert.equal(result.category, '开发工具');
  assert.equal(result.updatedIcon, true);
  assert.equal(result.updatedPreview, false);
  assert.equal(result.previewUploaded, false);
  assert.equal(result.iconUploaded, true);
  assert.equal(context.calls.filter(call => call.path.endsWith('/preview')).length, 0);
});

