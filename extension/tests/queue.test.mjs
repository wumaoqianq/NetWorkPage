import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeServer, captureUrl, makeCapture, enqueue, eligibleItems,
  acknowledge, failCapture, resumeQueue, retryQueue, queueSummary, inferScope,
  describeCaptureTarget, resolveInvocationTarget, targetMessage } from '../queue.js';

const connection = { server: 'https://workspace.example', user: { id: 7 }, token: 'secret' };
const input = { clientCaptureId: '05c70488-1cef-491f-93cc-9e680c535716',
  url: 'https://service.example/app?team=1#board', title: '协作看板', purpose: '' };
const item = () => makeCapture(connection, input, 1000);

test('server accepts HTTPS origins and normalizes slash/casing', () => {
  assert.equal(normalizeServer(' https://WORKSPACE.example/ '), connection.server);
});
test('server permits HTTP only for loopback development', () => {
  for (const server of ['http://localhost:4173', 'http://127.0.0.1:4173', 'http://[::1]:4173']) {
    assert.equal(normalizeServer(server), server);
  }
  for (const server of ['http://example.com', 'http://192.168.1.3', 'http://localhost.evil.test']) {
    assert.throws(() => normalizeServer(server), /HTTPS/);
  }
});
test('server rejects embedded credentials, paths, query, hash and non HTTP protocols', () => {
  for (const server of ['https://a:b@example.com', 'https://example.com/base',
    'https://example.com/?key=1', 'https://example.com/#x', 'file:///tmp', 'bad']) {
    assert.throws(() => normalizeServer(server));
  }
});
test('current-page capture preserves business query and hash; homepage is explicit', () => {
  assert.equal(captureUrl(input.url, 'page'), input.url);
  assert.equal(captureUrl(input.url, 'home'), 'https://service.example/');
  assert.throws(() => captureUrl('chrome://extensions', 'page'));
  assert.throws(() => captureUrl('https://user:pass@example.com', 'page'));
});
test('empty purpose remains empty for server inbox behavior', () => {
  assert.equal(item().payload.purpose, '');
  assert.equal(item().payload.updateExisting, false);
  assert.throws(() => makeCapture(connection, { ...input, clientCaptureId: 'not-uuid' }));
});
test('client id is stable and enqueue is idempotent for the same owner', () => {
  const first = item();
  const queue = enqueue(enqueue([], first), first);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].payload.clientCaptureId, input.clientCaptureId);
  assert.equal(queue[0].userId, '7');
});
test('different account or server cannot send an old queue', () => {
  const queue = [item()];
  assert.equal(eligibleItems(queue, connection, 1000).length, 1);
  assert.equal(eligibleItems(queue, { ...connection, user: { id: 8 } }, 1000).length, 0);
  assert.equal(eligibleItems(queue, { ...connection, server: 'https://other.example' }, 1000).length, 0);
  assert.equal(eligibleItems(queue, null, 1000).length, 0);
});
test('retry keeps data and id, backs off and never acknowledges a failure', () => {
  const queue = failCapture([item()], item().id, { status: 503, message: '暂时离线' }, 1000);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].attempts, 1);
  assert.equal(queue[0].payload.clientCaptureId, input.clientCaptureId);
  assert.equal(queue[0].nextAttemptAt, 61000);
  assert.equal(eligibleItems(queue, connection, 60000).length, 0);
  assert.equal(eligibleItems(queue, connection, 61000).length, 1);
});
test('auth failures pause without deleting; same account pairing on a new device resumes', () => {
  let queue = failCapture([item()], item().id, { status: 401, message: '凭证失效' }, 1000);
  assert.equal(queue[0].state, 'auth');
  assert.equal(eligibleItems(queue, connection, 100000).length, 0);
  queue = resumeQueue(queue, { ...connection, token: 'new', device: { id: 99 } }, 2000);
  assert.equal(eligibleItems(queue, connection, 2000).length, 1);
  assert.equal(queue[0].payload.clientCaptureId, input.clientCaptureId);
});
test('pairing another user never resumes old auth items', () => {
  const queue = failCapture([item()], item().id, { status: 403, message: '设备撤销' }, 1000);
  assert.equal(resumeQueue(queue, { ...connection, user: { id: 8 } }, 2000)[0].state, 'auth');
});
test('permanent validation errors need explicit retry; acknowledgement only removes matching id', () => {
  const queue = failCapture([item()], item().id, { status: 422, message: '资料有误' }, 1000);
  assert.equal(queue[0].state, 'blocked');
  assert.equal(eligibleItems(queue, connection, 100000).length, 0);
  assert.equal(retryQueue(queue, connection, 2000)[0].state, 'pending');
  assert.equal(acknowledge(queue, 'unknown').length, 1);
  assert.deepEqual(acknowledge(queue, item().id), []);
});
test('summary separates current owner and locally retained other accounts', () => {
  const other = makeCapture({ ...connection, user: { id: 8 } }, input, 1000);
  assert.deepEqual(queueSummary([item(), other], connection), { total: 2, current: 1, other: 1 });
});

test('private and loopback URLs get an access hint without changing their URL', () => {
  assert.equal(inferScope('http://localhost:3000/path'), '本机');
  assert.equal(inferScope('http://127.0.0.1:3000/path'), '本机');
  assert.equal(inferScope('http://192.168.1.5/path'), '局域网');
  assert.equal(inferScope('https://example.com/path'), '公网');
  assert.equal(item().payload.scope, '公网');
});


test('capture target binds to the invocation window, never the most recent other window', async () => {
  const inspected = [];
  const resolution = await resolveInvocationTarget({
    getCurrentTab: async () => undefined,
    queryActive: async options => {
      inspected.push(options);
      return [{ id: 11, windowId: 1, active: true, url: 'https://window-a.example/page?x=1', title: 'A' }];
    },
    getCurrentWindow: async () => ({ id: 1 }),
  });
  assert.deepEqual(inspected, [{ active: true, currentWindow: true }]);
  assert.equal(resolution.reason, '');
  assert.equal(resolution.tab.id, 11);
  assert.equal(describeCaptureTarget({ id: 12, windowId: 2, active: true, url: 'https://window-b.example/' }).tab.id, 12);
});
test('debug data page opened as a tab is rejected instead of picking another window', async () => {
  const resolution = await resolveInvocationTarget({
    getCurrentTab: async () => ({ id: 90, url: 'chrome-extension://abc/popup.html' }),
    queryActive: async () => { throw new Error('must not query active tabs'); },
    getCurrentWindow: async () => ({ id: 1 }),
  });
  assert.equal(resolution.tab, null);
  assert.equal(resolution.reason, 'debug-page');
  assert.match(targetMessage('debug-page'), /独立打开的扩展调试页面/);
});
test('unsupported, incognito and missing tabs stay explicit and never fall back', async () => {
  const cases = [
    [{ id: 1, url: 'edge://settings/' }, {}, 'unsupported-url', /普通 HTTP\(S\)/],
    [{ id: 2, url: 'https://private.example/', incognito: true }, {}, 'incognito', /隐身/],
    [undefined, {}, 'no-active-tab', /活动标签页/],
    [{ id: 3, windowId: 2, url: 'https://window-a.example/' }, { windowId: 1 }, 'window-mismatch', /其他窗口/],
  ];
  for (const [tab, window, reason, pattern] of cases) {
    const resolution = await resolveInvocationTarget({
      getCurrentTab: async () => undefined,
      queryActive: async () => (tab ? [tab] : []),
      getCurrentWindow: async () => ({ id: 1, ...window }),
    });
    assert.equal(resolution.tab, null);
    assert.equal(resolution.reason, reason);
    assert.match(targetMessage(reason), pattern);
  }
});
test('query or window binding failures are explicit rather than silently replaced', async () => {
  assert.equal((await resolveInvocationTarget({ getCurrentTab: async () => undefined,
    queryActive: async () => { throw new Error('boom'); }, getCurrentWindow: async () => ({ id: 1 }) })).reason, 'query-failed');
  const tab = { id: 5, windowId: 1, url: 'https://window-a.example/' };
  assert.equal((await resolveInvocationTarget({ getCurrentTab: async () => undefined,
    queryActive: async () => [tab], getCurrentWindow: async () => { throw new Error('no window api'); } })).tab.id, 5);
});
