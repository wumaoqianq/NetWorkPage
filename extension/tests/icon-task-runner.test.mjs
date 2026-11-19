import test from 'node:test';
import assert from 'node:assert/strict';
import { createIconTaskRunner } from '../icon-task-runner.js';
import { createIconTask, createIconTaskStore } from '../icon-tasks.js';

const base = { server: 'https://workspace.example', userId: '7', captureId: '05c70488-1cef-491f-93cc-9e680c535716', pageUrl: 'https://www.qianwen.com/', savedUrl: 'https://www.qianwen.com/' };
const connection = { server: base.server, user: { id: 7 }, token: 'secret' };

function fakeStorage(initial = {}) {
  const data = structuredClone(initial);
  return { data,
    async get(keys) { return Object.fromEntries(keys.filter(key => key in data).map(key => [key, structuredClone(data[key])])); },
    async set(values) { Object.assign(data, structuredClone(values)); },
    async remove(key) { delete data[key]; } };
}
function harness({ respond, state = { connection, queue: [] }, now = () => 1_000_000 } = {}) {
  const storage = fakeStorage();
  const store = createIconTaskStore({ storage, now });
  const calls = [];
  const runner = createIconTaskRunner({ store, now,
    read: async () => state,
    request: async (path, options) => { calls.push({ path, options }); return respond(path, options); } });
  return { storage, store, calls, runner, state };
}

test('文字入库后由 service worker 调用受控兜底并标记完成', async () => {
  const context = harness({ respond: async () => ({ status: 'complete', revision: 'rev-1', siteVersion: 3, sourceHost: 'img.alicdn.com' }) });
  await context.store.ensure(createIconTask({ ...base, now: 1_000_000 }));
  const result = await context.runner.run();
  assert.equal(result.processed, 1);
  assert.equal(context.calls.length, 1);
  assert.match(context.calls[0].path, /\/api\/extension\/v2\/captures\/05c70488-1cef-491f-93cc-9e680c535716\/icon\/fallback$/);
  assert.equal(context.calls[0].options.method, 'POST');
  assert.equal(context.calls[0].options.token, 'secret');
  const [task] = await context.store.list();
  assert.equal(task.state, 'complete');
  assert.equal(await context.store.pendingCount(base.server, 7), 0);
  const notice = await context.store.takeNotice(base.server, 7);
  assert.equal(notice.status, 'complete');
});

test('文字仍在队列时不抢跑，同步后下一轮再执行', async () => {
  const context = harness({ state: { connection, queue: [{ payload: { clientCaptureId: base.captureId } }] },
    respond: async () => ({ revision: 'rev-1' }) });
  await context.store.ensure(createIconTask({ ...base, now: 1_000_000 }));
  await context.runner.run();
  assert.equal(context.calls.length, 0);
  context.state.queue = [];
  await context.runner.run();
  assert.equal(context.calls.length, 1);
});

test('已有图标时服务端返回 icon_exists，任务完成且不覆盖', async () => {
  const context = harness({ respond: async () => ({ status: 'icon_exists', siteVersion: 5 }) });
  await context.store.ensure(createIconTask({ ...base, now: 1_000_000 }));
  await context.runner.run();
  const [task] = await context.store.list();
  assert.equal(task.state, 'complete');
  assert.equal(task.reason, '已有图标，未覆盖');
});

test('客户端已取得图标等待上传时，不抢跑服务端兜底', async () => {
  const context = harness({ respond: async () => ({ revision: 'rev-1' }),
    state: { connection, queue: [], assetJobs: [{ captureId: base.captureId, iconAttachment: { id: 'client-icon' },
      iconBlocked: false, state: 'pending' }] } });
  await context.store.ensure(createIconTask({ ...base, now: 1_000_000 }));
  await context.runner.run();
  assert.equal(context.calls.length, 0);
  const [task] = await context.store.list();
  assert.equal(task.state, 'pending_acquisition');
});

test('SVG-only/私网等不可恢复错误进入明确降级状态', async () => {
  const context = harness({ respond: async () => { throw Object.assign(new Error('仅提供 SVG 图标'), { status: 415, code: 'icon_svg_only' }); } });
  await context.store.ensure(createIconTask({ ...base, now: 1_000_000 }));
  await context.runner.run();
  const [task] = await context.store.list();
  assert.equal(task.state, 'unsupported');
  assert.match(task.reason, /SVG/);
  const notice = await context.store.takeNotice(base.server, 7);
  assert.equal(notice.status, 'unsupported');
});

test('网络错误有限退避，账号不匹配或暂停时不转移任务', async () => {
  const context = harness({ respond: async () => { throw Object.assign(new Error('服务器暂不可用'), { status: 503 }); } });
  await context.store.ensure(createIconTask({ ...base, now: 1_000_000 }));
  await context.runner.run();
  const first = (await context.store.list())[0];
  assert.equal(first.state, 'retryable_failure');
  assert.ok(first.nextAttemptAt > 1_000_000);
  await context.runner.run();
  assert.equal(context.calls.length, 1, '未到退避时间不应重复请求');

  const other = harness({ respond: async () => ({ revision: 'x' }), state: { connection: { server: base.server, user: { id: 8 } }, queue: [] } });
  await other.store.ensure(createIconTask({ ...base, now: 1_000_000 }));
  await other.runner.run();
  assert.equal(other.calls.length, 0);

  const paused = harness({ respond: async () => ({ revision: 'x' }), state: { connection: { ...connection, paused: true }, queue: [] } });
  await paused.store.ensure(createIconTask({ ...base, now: 1_000_000 }));
  await paused.runner.run();
  assert.equal(paused.calls.length, 0);
});
