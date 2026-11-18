import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutbox, buildPayload, fingerprint, classifyError, displayState, OUTBOX_SCHEMA } from '../outbox.js';
import { createMemoryOutboxStore } from '../outbox-store.js';

const server = 'https://workspace.example';
const captureId = '05c70488-1cef-491f-93cc-9e680c535716';
const captureId2 = '15b21246-9cc8-4832-8e57-16cbd7ca0f24';
const conn = () => ({ server, token: 'secret', user: { id: 7, email: 'a@example.com' },
  device: { id: 2 }, expiresAt: '2099-01-01', paused: false });
const target = id => ({ url: `https://site-${id}.example/`, title: `站点 ${id}`,
  description: '简介', descriptionSource: 'page_meta', scope: '公网', tabId: 41, windowId: 3, capturedAt: 1000 });
const form = () => ({ category: 'AI', notes: '我的备注', later: false });

function context({ request, now = 1000, store = createMemoryOutboxStore() } = {}) {
  let clock = now;
  const calls = [];
  const req = request || (async () => ({ site: { id: 'site-1', version: 1, category: 'AI', inbox: false },
    duplicate: false, outcome: 'created', canAttachPreview: true, canAttachIcon: true }));
  const wrapped = async (path, options) => { calls.push({ path, options }); return req(path, options); };
  const readConnection = async () => conn();
  const paused = [];
  const writeConnection = async value => { paused.push(value); };
  const make = () => createOutbox({ store, request: wrapped, readConnection, writeConnection,
    now: () => clock, workerId: 'w1' });
  return { make, outbox: make(), store, calls, paused, advance: ms => { clock += ms; }, now: () => clock };
}

test('先本地事务成功才反馈已存本地；联网幂等确认后才 complete', async () => {
  const ctx = context();
  await ctx.outbox.openDraft({ draftId: captureId, target: target('a') });
  const draft = await ctx.outbox.getDraft(captureId);
  assert.equal(draft.phase, 'draft');
  assert.equal(draft.payload, null); // 草稿未提交，不上传
  const saved = await ctx.outbox.submitDraft({ draftId: captureId, form: form(), connection: conn() });
  assert.equal(saved.phase, 'local_saved');
  assert.equal(ctx.calls.length, 0, '提交阶段尚未联网');
  assert.equal((await ctx.store.load()).captures[captureId].phase, 'local_saved', '本地事务已持久化');
  await ctx.outbox.flush(conn());
  const record = (await ctx.store.load()).captures[captureId];
  assert.equal(record.phase, 'complete');
  assert.equal(record.receipt.siteId, 'site-1');
  assert.equal(ctx.calls.length, 1);
});

test('服务端已确认但本地未写回：重启(新实例)重发不重复建站、不重复追加备注', async () => {
  const created = new Set();
  const store = createMemoryOutboxStore();
  let killAfterConfirm = false;
  const ctx = context({ store, request: async (path, options) => {
    const body = options.body;
    const marker = body.clientCaptureId + '|' + fingerprint(body);
    if (!created.has(marker)) created.add(marker); // 服务端按 fingerprint 幂等，只建一次
    return { site: { id: 'site-1', version: 1 }, duplicate: created.size > 1, outcome: created.size > 1 ? 'existing' : 'created',
      canAttachPreview: false, canAttachIcon: false };
  } });
  await ctx.outbox.openDraft({ draftId: captureId, target: target('a') });
  await ctx.outbox.submitDraft({ draftId: captureId, form: form(), connection: conn() });
  await ctx.outbox.flush(conn()); // 第一次：服务端确认
  assert.equal(created.size, 1);
  // 模拟“已确认但回执写回前 worker 被杀”：把记录退回 creating_site
  const snap = await store.load();
  snap.captures[captureId].phase = 'creating_site';
  snap.captures[captureId].lease = { owner: 'dead-worker', until: 5 }; // 过期租约
  await store.commit({ capturePut: [[captureId, snap.captures[captureId]]] });
  ctx.advance(60000);
  await ctx.make().flush(conn()); // 全新实例重发
  assert.equal(created.size, 1, '未重复创建站点');
  assert.equal((await store.load()).captures[captureId].phase, 'complete');
  assert.equal(killAfterConfirm, false);
});

test('两个 capture 交错：各自独立 draft/submit/flush，不依赖 lastResult', async () => {
  const ctx = context();
  await ctx.outbox.openDraft({ draftId: captureId, target: target('a') });
  await ctx.outbox.openDraft({ draftId: captureId2, target: target('b') });
  await ctx.outbox.submitDraft({ draftId: captureId2, form: { ...form(), notes: 'B' }, connection: conn() });
  await ctx.outbox.submitDraft({ draftId: captureId, form: { ...form(), notes: 'A' }, connection: conn() });
  const snap = await ctx.store.load();
  assert.equal(snap.captures[captureId].payload.notes, 'A');
  assert.equal(snap.captures[captureId2].payload.notes, 'B');
  await ctx.outbox.flush(conn());
  const after = await ctx.store.load();
  assert.equal(after.captures[captureId].phase, 'complete');
  assert.equal(after.captures[captureId2].phase, 'complete');
  assert.notEqual(after.captures[captureId].payload.url, after.captures[captureId2].payload.url);
});

test('关闭表单不取消任务：draft 与已提交任务都持久化，重新打开可继续', async () => {
  const ctx = context();
  await ctx.outbox.openDraft({ draftId: captureId, target: target('a') });
  await ctx.outbox.submitDraft({ draftId: captureId, form: form(), connection: conn() });
  // 页面关闭 = 无任何 cancel 调用；新实例照常 flush
  await ctx.make().flush(conn());
  assert.equal((await ctx.store.load()).captures[captureId].phase, 'complete');
});

test('未提交草稿不上传，且按 TTL 清理', async () => {
  const ctx = context();
  await ctx.outbox.openDraft({ draftId: captureId, target: target('a') });
  await ctx.outbox.flush(conn());
  assert.equal(ctx.calls.length, 0);
  ctx.advance(31 * 60 * 1000);
  await ctx.outbox.prune();
  assert.equal((await ctx.store.load()).captures[captureId], undefined);
});

test('断网/5xx 有界退避并保持 waiting_network；恢复后自动完成', async () => {
  let fail = true;
  const ctx = context({ request: async () => {
    if (fail) throw Object.assign(new Error('网络不可用'), { status: 0 });
    return { site: { id: 'site-1', version: 1 }, duplicate: false, outcome: 'created' };
  } });
  await ctx.outbox.openDraft({ draftId: captureId, target: target('a') });
  await ctx.outbox.submitDraft({ draftId: captureId, form: form(), connection: conn() });
  await ctx.outbox.flush(conn());
  let rec = (await ctx.store.load()).captures[captureId];
  assert.equal(rec.phase, 'waiting_network');
  assert.equal(rec.attempts, 1);
  assert.ok(rec.nextAttemptAt > ctx.now());
  await ctx.outbox.flush(conn()); // 退避期内不重发
  assert.equal(ctx.calls.length, 1);
  ctx.advance(120000); fail = false;
  await ctx.outbox.flush(conn());
  assert.equal((await ctx.store.load()).captures[captureId].phase, 'complete');
});

test('429 遵守 Retry-After；401 暂停连接并置 needs_auth；409 转 conflict 不自动重传', async () => {
  for (const [status, errorPhase] of [[429, 'waiting_network'], [401, 'needs_auth'], [409, 'conflict']]) {
    const ctx = context({ request: async () => { throw Object.assign(new Error('x'), { status, code: status === 409 ? 'idempotency_conflict' : '', retryAfter: 45 }); } });
    await ctx.outbox.openDraft({ draftId: captureId, target: target('a') });
    await ctx.outbox.submitDraft({ draftId: captureId, form: form(), connection: conn() });
    await ctx.outbox.flush(conn());
    const rec = (await ctx.store.load()).captures[captureId];
    assert.equal(rec.phase, errorPhase, 'status ' + status);
    if (status === 429) assert.ok(rec.nextAttemptAt >= ctx.now() + 45000);
    if (status === 401) assert.equal(ctx.paused[0]?.paused, true);
    await ctx.outbox.flush(conn());
    assert.equal(ctx.calls.length, 1, 'status ' + status + ' 退避/暂停期内不立即二次重发');
  }
});

test('身份切换不转投旧任务；重新配对同账号可继续', async () => {
  const store = createMemoryOutboxStore();
  const ctx = context({ store });
  await ctx.outbox.openDraft({ draftId: captureId, target: target('a') });
  await ctx.outbox.submitDraft({ draftId: captureId, form: form(), connection: conn() });
  const other = { ...conn(), user: { id: 8, email: 'b@example.com' } };
  await ctx.outbox.flush(other);
  assert.equal(ctx.calls.length, 0, '不同账号不提交');
  const st = await ctx.outbox.status(other);
  assert.equal(st.summary.current, 0);
  assert.equal(st.summary.other, 1);
  // 重新配对同账号
  await ctx.outbox.flush(conn());
  assert.equal(ctx.calls.length, 1);
  assert.equal((await store.load()).captures[captureId].phase, 'complete');
});

test('短租约避免同一 worker 两轮并发重复发送', async () => {
  const ctx = context();
  await ctx.outbox.openDraft({ draftId: captureId, target: target('a') });
  await ctx.outbox.submitDraft({ draftId: captureId, form: form(), connection: conn() });
  // 人为设置未过期租约（另一轮正在发送）
  const snap = await ctx.store.load();
  snap.captures[captureId].phase = 'creating_site';
  snap.captures[captureId].lease = { owner: 'w2', until: 999999999 };
  await ctx.store.commit({ capturePut: [[captureId, snap.captures[captureId]]] });
  await ctx.outbox.flush(conn());
  assert.equal(ctx.calls.length, 0, '租约未过期，跳过');
});

test('cancel/remove 是显式用户动作才删记录；retry 只重置当前身份可重试项', async () => {
  const ctx = context({ request: async () => { throw Object.assign(new Error('x'), { status: 429, retryAfter: 60 }); } });
  await ctx.outbox.openDraft({ draftId: captureId, target: target('a') });
  await ctx.outbox.submitDraft({ draftId: captureId, form: form(), connection: conn() });
  await ctx.outbox.flush(conn());
  assert.equal((await ctx.store.load()).captures[captureId].phase, 'waiting_network');
  await ctx.outbox.retry(captureId, conn());
  assert.equal((await ctx.store.load()).captures[captureId].phase, 'local_saved');
  await ctx.outbox.cancel(captureId);
  assert.equal((await ctx.store.load()).captures[captureId].phase, 'cancelled');
  await ctx.outbox.remove([captureId]);
  assert.equal((await ctx.store.load()).captures[captureId], undefined);
});

test('buildPayload 只含服务器允许的字段，URL 固定为目标，不改写入口', () => {
  const payload = buildPayload({ form: { ...form(), url: 'https://evil.example/' }, target: target('a'), captureId });
  assert.equal(payload.url, 'https://site-a.example/');
  assert.equal(payload.clientCaptureId, captureId);
  const allowed = new Set(['clientCaptureId', 'url', 'title', 'description', 'descriptionSource', 'purpose',
    'notes', 'category', 'tags', 'collectionIds', 'pinned', 'later', 'homepageUrl', 'scope',
    'updateFields', 'expectedVersion', 'updateExisting', 'appendNotes', 'autoIcon']);
  for (const key of Object.keys(payload)) assert.ok(allowed.has(key), 'unexpected field ' + key);
  assert.equal(payload.autoIcon, true, '默认允许自动补图');
  assert.equal(buildPayload({ form: { ...form(), autoIcon: false }, target: target('a'), captureId }).autoIcon, false,
    '用户可拒绝自动补图');
  assert.equal(fingerprint(payload), fingerprint(buildPayload({ form: { ...form() }, target: target('a'), captureId })),
    '相同内容指纹稳定');
});

test('classifyError / displayState 纯函数', () => {
  assert.equal(classifyError({ status: 401 }, 0, 1000).phase, 'needs_auth');
  assert.equal(classifyError({ status: 409, code: 'version_conflict' }, 0, 1000).phase, 'conflict');
  assert.equal(classifyError({ status: 500 }, 0, 1000).phase, 'waiting_network');
  assert.equal(classifyError({ status: 400 }, 0, 1000).phase, 'failed');
  assert.equal(classifyError({ status: 0 }, 20, 1000).phase, 'failed', '超过重试上限');
  assert.equal(displayState('local_saved'), 'pending');
  assert.equal(OUTBOX_SCHEMA, 1);
});
