import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../engine.js';

const paired = { token: 'private-token', user: { id: 7, email: 'a@example.com', name: '测试' },
  device: { id: 2, name: '笔记本' }, expiresAt: '2099-01-01T00:00:00Z' };
const server = 'https://workspace.example';
const capture = { clientCaptureId: '05c70488-1cef-491f-93cc-9e680c535716',
  url: 'https://site.example/path?key=1#id', title: '页面', purpose: '' };
function fixture(request) {
  let state = { connection: null, queue: [] };
  return createEngine({ read: async () => structuredClone(state),
    write: async value => { state = structuredClone(value); }, request, now: () => 1000 });
}
async function pair(engine) {
  await engine.handle({ type: 'pair', server, code: '12345678', name: '笔记本' });
}
test('status never reveals the bearer token', async () => {
  const engine = fixture(async () => paired);
  await pair(engine);
  assert.equal(JSON.stringify(await engine.handle({ type: 'status' })).includes('private-token'), false);
});
test('capture is durable before network request; only server acknowledgment removes it', async () => {
  const engine = fixture(async path => path.endsWith('/pair') ? paired : { site: { id: 10 }, duplicate: false });
  await pair(engine);
  await engine.handle({ type: 'capture', capture });
  assert.equal((await engine.handle({ type: 'status' })).summary.current, 1);
  await engine.flush();
  assert.equal((await engine.handle({ type: 'status' })).summary.current, 0);
});
test('auth denial pauses connection without discarding queued capture', async () => {
  const engine = fixture(async path => {
    if (path.endsWith('/pair')) return paired;
    throw Object.assign(new Error('已撤销'), { status: 403 });
  });
  await pair(engine);
  await engine.handle({ type: 'capture', capture });
  await engine.flush();
  const state = await engine.handle({ type: 'status' });
  assert.equal(state.connection.paused, true);
  assert.equal(state.queue[0].state, 'auth');
  assert.equal(state.summary.total, 1);
});
test('malformed success cannot lose a pending item', async () => {
  const engine = fixture(async path => path.endsWith('/pair') ? paired : {});
  await pair(engine);
  await engine.handle({ type: 'capture', capture });
  await engine.flush();
  assert.equal((await engine.handle({ type: 'status' })).summary.total, 1);
});
test('disconnect keeps queue; pairing same owner with new device restores sync', async () => {
  let calls = 0;
  const engine = fixture(async path => {
    if (path.endsWith('/pair')) return { ...paired, device: { id: ++calls } };
    if (calls === 1) throw Object.assign(new Error('expired'), { status: 401 });
    return { site: { id: 9 }, duplicate: true };
  });
  await pair(engine);
  await engine.handle({ type: 'capture', capture });
  await engine.flush();
  await engine.handle({ type: 'disconnect' });
  assert.equal((await engine.handle({ type: 'status' })).summary.total, 1);
  await pair(engine);
  await engine.flush();
  assert.equal((await engine.handle({ type: 'status' })).summary.total, 0);
});
test('new paired account does not send old pending capture', async () => {
  let userId = 7;
  let captureRequests = 0;
  const engine = fixture(async path => {
    if (path.endsWith('/pair')) return { ...paired, user: { ...paired.user, id: userId } };
    captureRequests++;
    return { site: { id: 9 } };
  });
  await pair(engine);
  await engine.handle({ type: 'capture', capture });
  userId = 8;
  await pair(engine);
  await engine.flush();
  assert.equal(captureRequests, 0);
  assert.equal((await engine.handle({ type: 'status' })).summary.other, 1);
});
test('server confirmation identifies exact capture rather than any removed queue item', async () => {
  const engine = fixture(async path => path.endsWith('/pair') ? paired : { site: { id: 10 } });
  await pair(engine);
  await engine.handle({ type: 'capture', capture });
  await engine.flush();
  const state = await engine.handle({ type: 'status' });
  assert.equal(state.lastResult.clientCaptureId, capture.clientCaptureId);
});
