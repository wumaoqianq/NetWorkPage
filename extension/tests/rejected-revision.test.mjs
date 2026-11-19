import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../engine.js';
import * as queue from '../queue.js';

const captureIdForSubmission = (...args) => queue.captureIdForSubmission(...args);
const server = 'https://workspace.example';
const oldId = '05c70488-1cef-491f-93cc-9e680c535716';
const newId = '8f4997b1-97e0-4b6f-a42f-e37e15a1f341';
const paired = { token: 'secret', user: { id: 7, email: 'a@example.com' }, device: { id: 2 }, expiresAt: '2099-01-01' };
const oldAttachment = { id: 'old-asset', bytes: 1000, createdAt: 900, capturedAt: '2026-01-01T00:00:00Z',
  sourceEndpointId: '', sourceUrl: 'https://site.example/', homepageUrl: '', pageKind: 'current', userConfirmedHomepage: false };
const newAttachment = { ...oldAttachment, id: 'new-asset', homepageUrl: 'https://site.example/', pageKind: 'home', userConfirmedHomepage: true };

function oldItem() {
  return { id: `${server}|7|${oldId}`, server, userId: '7', protocol: 2,
    payload: { clientCaptureId: oldId, url: 'https://site.example/', title: '被拒绝的旧内容', homepageUrl: '' },
    attachment: oldAttachment, siteId: null, siteVersion: null, createdAt: 900, attempts: 1, nextAttemptAt: 1000,
    state: 'blocked', lastError: '内容被拒绝' };
}

function fixture(respond, onWrite = async () => {}) {
  let state = { connection: { server, ...paired, paused: false }, queue: [oldItem()] };
  const records = new Map([
    ['old-asset', { id: 'old-asset', blob: new Blob(['old']), server, userId: '7', captureId: oldId, createdAt: 900 }],
    ['new-asset', { id: 'new-asset', blob: new Blob(['new']), server, userId: '7', captureId: newId, createdAt: 900 }],
  ]);
  const attachments = { get: async id => records.get(id), remove: async id => records.delete(id), prune: async () => {} };
  const calls = [];
  const engine = createEngine({ read: async () => structuredClone(state), attachments, now: () => 1000,
    write: async value => { await onWrite(value); state = structuredClone(value); },
    request: async (path, options) => { calls.push({ path, options }); return respond(path, options); } });
  return { engine, records, calls, state: () => state };
}

function revisedCapture(clientCaptureId = newId) {
  return { clientCaptureId, replacesCaptureId: oldId, url: 'https://site.example/', title: '修改后的内容',
    description: '新简介', homepageUrl: 'https://site.example/', attachment: newAttachment };
}

test('editing a rejected capture creates one new id and local retries reuse it', () => {
  const revised = captureIdForSubmission(oldId, oldId, () => newId);
  assert.equal(revised, newId);
  assert.notEqual(revised, oldId);
  assert.equal(captureIdForSubmission(revised, oldId, () => { throw new Error('must not regenerate'); }), revised);
});

test('same-id replacement is rejected without cancelling the old task', async () => {
  const context = fixture(async () => ({ site: { id: 'site-1', version: 1 } }));
  await assert.rejects(context.engine.handle({ type: 'capture', capture: { ...revisedCapture(oldId), attachment: null } }), /新的收藏编号/);
  assert.equal(context.state().queue.length, 1);
  assert.equal(context.state().queue[0].state, 'blocked');
  assert.equal(context.state().queue[0].payload.title, '被拒绝的旧内容');
});

test('rejected edit persists replacement and attachment then syncs successfully', async () => {
  const context = fixture(async path => path.endsWith('/preview')
    ? { assetId: 'server-asset', siteVersion: 2, status: 'complete' }
    : { site: { id: 'site-1', name: '修改后的内容', version: 1 }, duplicate: false, outcome: 'created', canAttachPreview: true });
  const revised = captureIdForSubmission(oldId, oldId, () => newId);
  await context.engine.handle({ type: 'capture', capture: revisedCapture(revised) });
  const old = context.state().queue.find(item => item.payload.clientCaptureId === oldId);
  assert.equal(old.state, 'cancelled');
  assert.equal(old.replacedBy, newId);
  const queued = context.state().queue.find(item => item.payload.clientCaptureId === newId);
  assert.equal(queued.attachment.id, 'new-asset');
  assert.equal(queued.replacesCaptureId, oldId);
  assert.equal(context.records.get('new-asset').captureId, newId);
  await context.engine.flush();
  assert.equal(context.calls.filter(call => call.path.endsWith('/v2/captures')).length, 1);
  assert.equal(context.calls.filter(call => call.path.endsWith('/preview')).length, 1);
  assert.equal(context.state().lastResult.clientCaptureId, newId);
  assert.equal(context.state().lastResult.previewUploaded, true);
  assert.equal(context.state().queue.some(item => item.payload.clientCaptureId === newId), false);
});

test('failed initial persistence preserves old task, form revision attachment and does not report success', async () => {
  const context = fixture(async () => ({ site: { id: 'site-1', version: 1 } }), async value => {
    const old = value.queue.find(item => item.payload.clientCaptureId === oldId);
    assert.equal(old.state, 'blocked', 'the new task must persist before the old task is replaced');
    throw Object.assign(new Error('本地空间不足'), { status: 0 });
  });
  await assert.rejects(context.engine.handle({ type: 'capture', capture: revisedCapture() }), /本地空间不足/);
  assert.equal(context.state().queue[0].state, 'blocked');
  assert.equal(context.state().queue.length, 1);
  assert.equal(context.records.get('new-asset').captureId, newId);
  assert.equal(context.state().lastResult?.previewUploaded, undefined);
});

test('failed replacement write leaves the persisted new task and original task recoverable', async () => {
  let writes = 0;
  const context = fixture(async () => ({ site: { id: 'site-1', version: 1 } }), async () => {
    writes++;
    if (writes === 2) throw new Error('替代关系写入失败');
  });
  await assert.rejects(context.engine.handle({ type: 'capture', capture: revisedCapture() }), /替代关系写入失败/);
  const old = context.state().queue.find(item => item.payload.clientCaptureId === oldId);
  const revised = context.state().queue.find(item => item.payload.clientCaptureId === newId);
  assert.equal(old.state, 'blocked');
  assert.equal(revised.state, 'pending');
  assert.equal(context.records.has('new-asset'), true);
});
