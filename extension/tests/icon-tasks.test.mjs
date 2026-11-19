import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFallbackError, completeTask, createIconTask, createIconTaskStore, ICON_TASK_MAX_ATTEMPTS, markAttempt,
  nextAttemptAt, normalizeIconTask, shouldProcessTask } from '../icon-tasks.js';

const base = { server: 'https://workspace.example', userId: '7', captureId: '05c70488-1cef-491f-93cc-9e680c535716', pageUrl: 'https://www.qianwen.com/', savedUrl: 'https://www.qianwen.com/' };

function fakeStorage(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    async get(keys) { return Object.fromEntries(keys.filter(key => key in data).map(key => [key, structuredClone(data[key])])); },
    async set(values) { Object.assign(data, structuredClone(values)); },
    async remove(key) { delete data[key]; },
  };
}

test('任务默认状态为等待获取并保留 capture/server/user 绑定', () => {
  const task = createIconTask(base);
  assert.equal(task.state, 'pending_acquisition');
  assert.equal(task.server, base.server);
  assert.equal(task.userId, '7');
  assert.equal(task.captureId, base.captureId);
  assert.equal(normalizeIconTask({ state: 'weird' }).state, 'pending_acquisition');
});

test('只有匹配的连接且文字已确认、到达退避时间才执行兜底', () => {
  const task = createIconTask(base);
  assert.equal(shouldProcessTask(task, { connection: { server: base.server, user: { id: 7 } } }).run, true);
  assert.equal(shouldProcessTask(task, { connection: { server: base.server, user: { id: 8 } } }).run, false);
  assert.equal(shouldProcessTask(task, { connection: { server: 'https://other.example', user: { id: 7 } } }).run, false);
  assert.equal(shouldProcessTask(task, { connection: { server: base.server, user: { id: 7 } }, queueCaptureIds: new Set([base.captureId]) }).run, false);
  assert.equal(shouldProcessTask(task, { connection: { server: base.server, user: { id: 7 } }, now: Date.now() + 300000 }).run, true);
  assert.equal(shouldProcessTask(task, { connection: { server: base.server, user: { id: 7 }, paused: true } }).run, false);
});

test('退避有限且不会无限等待；终态不再执行', () => {
  const task = createIconTask(base);
  let current = markAttempt(task, 1000);
  assert.equal(current.attempts, 1);
  assert.equal(nextAttemptAt(1, 0), 60_000);
  assert.ok(nextAttemptAt(5, 0) >= 6 * 60 * 60_000);
  assert.equal(shouldProcessTask(current, { connection: { server: base.server, user: { id: 7 } }, now: 30_000 }).run, false);
  const grace = createIconTask({ ...base, notBefore: 9000 });
  assert.equal(shouldProcessTask(grace, { connection: { server: base.server, user: { id: 7 } }, now: 8000 }).run, false);
  assert.equal(shouldProcessTask(grace, { connection: { server: base.server, user: { id: 7 } }, now: 9500 }).run, true);
  const done = completeTask(task, { code: 'complete' });
  assert.equal(done.state, 'complete');
  assert.equal(shouldProcessTask(done, { connection: { server: base.server, user: { id: 7 } } }).run, false);
});

test('兜底错误按类型分类：SVG/私网/配额终态降级，网络错误有限重试', () => {
  const svg = classifyFallbackError({ status: 415, code: 'icon_svg_only', message: '仅提供 SVG' }, 1);
  assert.equal(svg.state, 'unsupported');
  const privateSite = classifyFallbackError({ status: 400, code: 'icon_refresh_private', message: '本机入口' }, 1);
  assert.equal(privateSite.state, 'unsupported');
  const quota = classifyFallbackError({ status: 413, code: 'icon_quota_exceeded' }, 1);
  assert.equal(quota.state, 'unsupported');
  const network = classifyFallbackError({ status: 0, code: 'network', message: 'timeout' }, 1);
  assert.equal(network.state, 'retryable_failure');
  assert.match(network.reason, /重试/);
  const exhausted = classifyFallbackError({ status: 503, code: 'server_busy' }, ICON_TASK_MAX_ATTEMPTS);
  assert.match(exhausted.reason, /手动/);
  assert.equal(classifyFallbackError({ status: 403, code: 'forbidden' }, 1).state, 'retryable_failure');
});

test('存储按 server/user 隔离，pendingCount 和通知可持久化', async () => {
  const storage = fakeStorage();
  const store = createIconTaskStore({ storage, now: () => 1000 });
  await store.ensure(createIconTask({ ...base, now: 1000 }));
  await store.ensure(createIconTask({ ...base, userId: '8', captureId: 'other', now: 1000 }));
  assert.equal((await store.list()).length, 2);
  assert.ok(await store.get(base.server, '7', base.captureId));
  assert.equal(await store.get(base.server, '8', base.captureId), null);
  assert.equal(await store.pendingCount(base.server, 7), 1);
  await store.setNotice({ server: base.server, userId: '7', captureId: base.captureId, status: 'complete' });
  const notice = await store.takeNotice(base.server, 7);
  assert.equal(notice.status, 'complete');
  assert.equal(await store.takeNotice(base.server, 7), null);
});

test('ensure 不会重置已存在任务进度', async () => {
  const store = createIconTaskStore({ storage: fakeStorage(), now: () => 1000 });
  const task = await store.ensure(createIconTask({ ...base, now: 1000 }));
  await store.update(task, { attempts: 2, state: 'retryable_failure', nextAttemptAt: 999999 });
  const again = await store.ensure(createIconTask({ ...base, now: 2000 }));
  assert.equal(again.attempts, 2);
  assert.equal(again.state, 'retryable_failure');
  assert.equal(again.nextAttemptAt, 999999);
});
