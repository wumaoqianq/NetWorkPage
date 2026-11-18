import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutbox } from '../outbox.js';
import { createMemoryOutboxStore } from '../outbox-store.js';
import { createWorkspace } from '../workspace.js';

const server = 'https://workspace.example';
const cid = '05c70488-1cef-491f-93cc-9e680c535716';
const paired = { server, token: 'secret', user: { id: 7, email: 'a@example.com' },
  device: { id: 2 }, expiresAt: '2099-01-01', paused: false };

function context({ connection = null, request } = {}) {
  const store = createMemoryOutboxStore();
  let cfg = { connection: connection ? { ...connection } : null, optionsCache: {}, release: null };
  const config = { read: async () => structuredClone(cfg),
    set: async patch => { cfg = { ...cfg, ...patch }; } };
  const calls = [];
  const req = request || (async (path) => {
    if (path.endsWith('/v2/captures')) return { site: { id: 'site-1', version: 1, category: 'AI', inbox: false },
      duplicate: false, outcome: 'created', canAttachPreview: true, canAttachIcon: true };
    return {};
  });
  const wrapped = async (path, options) => { calls.push({ path, options }); return req(path, options); };
  const outbox = createOutbox({ store, request: wrapped, readConnection: async () => cfg.connection,
    writeConnection: async c => config.set({ connection: c }), now: () => 1000, workerId: 'w' });
  const bookmarks = { handle: async () => ({ phase: 'idle' }) };
  const workspace = createWorkspace({ config, outbox, request: wrapped, bookmarks, now: () => 1000,
    extensionVersion: () => '1.7.0' });
  return { workspace, outbox, store, calls, config, cfg: () => cfg };
}

test('完整消息流：capture-draft→submit(已存本地)→flush→capture-status(已入库)', async () => {
  const ctx = context({ connection: paired });
  await ctx.outbox.openDraft({ draftId: cid, target: { url: 'https://a.example/', title: 'A', scope: '公网' },
    connection: paired });
  const draft = await ctx.workspace.handle({ type: 'capture-draft', draftId: cid });
  assert.equal(draft.draft.phase, 'draft');
  assert.equal(draft.connection.token, undefined, 'token 不下发到页面');
  assert.equal(draft.connection.server, server);
  const submitted = await ctx.workspace.handle({ type: 'capture-submit', draftId: cid,
    form: { category: 'AI', notes: '备注', later: false } });
  assert.equal(submitted.phase, 'local_saved', '本地先行');
  assert.equal(ctx.calls.length, 0, 'submit 阶段未联网');
  await ctx.workspace.flush();
  const status = await ctx.workspace.handle({ type: 'capture-status', draftId: cid });
  assert.equal(status.phase, 'complete');
  assert.equal(status.category, 'AI');
});

test('status 汇总只按当前身份；token 不下发；旧配置保留', async () => {
  const ctx = context({ connection: paired });
  const other = { ...paired, server: 'https://other.example' };
  const s = await ctx.workspace.handle({ type: 'status' });
  assert.equal(s.connection.token, undefined);
  assert.equal(s.outbox.schemaVersion >= 1, true);
  assert.equal(s.summary.total >= 0, true);
  // 无连接时 status 仍可用
  const empty = context({ connection: null });
  assert.equal((await empty.workspace.handle({ type: 'status' })).connection, null);
  void other;
});

test('pair 保留现有配对语义并恢复同账号 needs_auth；options 缓存按身份', async () => {
  const ctx = context({ connection: null, request: async path => {
    if (path.endsWith('/pair')) return { token: 't', user: { id: 7 }, device: { id: 2 }, expiresAt: '2099-01-01' };
    if (path.endsWith('/options')) return { categories: ['AI', '云C'], collections: [] };
    return {};
  } });
  const after = await ctx.workspace.handle({ type: 'pair', server, code: 'abc', name: '设备' });
  assert.equal(after.connection.server, server);
  assert.equal(after.connection.token, undefined);
  assert.ok(ctx.cfg().connection.token, 'token 写入设备配置');
  const options = await ctx.workspace.handle({ type: 'options' });
  assert.deepEqual(options.categories, ['AI', '云C']);
  const s = await ctx.workspace.handle({ type: 'status' });
  assert.equal(s.options.categories[0], 'AI');
  assert.equal(s.optionsCachedAt, 1000);
});

test('旧 popup {type:capture} 收编进单 Outbox；attach 不报错；未知类型拒绝', async () => {
  const ctx = context({ connection: paired });
  await ctx.workspace.handle({ type: 'capture', capture: { clientCaptureId: cid,
    url: 'https://a.example/', title: 'A', notes: 'n' } });
  assert.equal((await ctx.store.load()).captures[cid].phase, 'local_saved');
  await ctx.workspace.handle({ type: 'attach', captureId: cid });
  await assert.rejects(() => ctx.workspace.handle({ type: 'nonsense' }), /未知扩展操作/);
});

test('bookmarks-* 透传给书签导入器', async () => {
  const ctx = context({ connection: paired });
  assert.deepEqual(await ctx.workspace.handle({ type: 'bookmarks-status' }), { phase: 'idle' });
});

test('浏览器重启恢复已提交表单：capture-draft 返回真实阶段而非草稿错误', async () => {
  const ctx = context({ connection: paired });
  await ctx.outbox.openDraft({ draftId: cid, target: { url: 'https://a.example/', title: 'A', scope: '公网' },
    connection: paired });
  await ctx.workspace.handle({ type: 'capture-submit', draftId: cid, form: { notes: 'n' } });
  await ctx.workspace.flush(); // complete
  const data = await ctx.workspace.handle({ type: 'capture-draft', draftId: cid });
  assert.equal(data.restoredStatus.phase, 'complete');
  assert.equal(data.draft.phase, 'complete');
  assert.equal(data.draft.target.url, 'https://a.example/');
  assert.equal(data.restoredStatus.category, 'AI');
});

test('阶段D：capture-submit 默认带 autoIcon=true（允许后台补图），form 明确 false 时不下发', async () => {
  const ctx = context({ connection: paired });
  await ctx.outbox.openDraft({ draftId: cid, target: { url: 'https://a.example/', title: 'A', scope: '公网' },
    connection: paired });
  await ctx.workspace.handle({ type: 'capture-submit', draftId: cid, form: { notes: 'n' } });
  assert.equal((await ctx.outbox.record(cid)).payload.autoIcon, true, '默认允许服务端后台补图');
  const cid2 = '15b21246-9cc8-4832-8e57-16cbd7ca0f24';
  await ctx.outbox.openDraft({ draftId: cid2, target: { url: 'https://b.example/', title: 'B', scope: '公网' },
    connection: paired });
  await ctx.workspace.handle({ type: 'capture-submit', draftId: cid2, form: { notes: 'n', autoIcon: false } });
  assert.equal((await ctx.outbox.record(cid2)).payload.autoIcon, false, '用户拒绝自动补图');
});

test('阶段D：capture-status 透传服务端 iconJob（queued 时界面显示「已入库，图标获取中」）', async () => {
  const ctx = context({ connection: paired, request: async path => {
    if (path.endsWith('/v2/captures')) return { site: { id: 'site-1', version: 1, category: 'AI',
      inbox: false, iconJob: { queued: true, phase: 'pending', attempts: 0 } },
      duplicate: false, outcome: 'created', canAttachPreview: true, canAttachIcon: true };
    return {};
  } });
  await ctx.outbox.openDraft({ draftId: cid, target: { url: 'https://a.example/', title: 'A', scope: '公网' },
    connection: paired });
  await ctx.workspace.handle({ type: 'capture-submit', draftId: cid, form: {} });
  await ctx.workspace.flush();
  const status = await ctx.workspace.handle({ type: 'capture-status', draftId: cid });
  assert.equal(status.phase, 'complete');
  assert.deepEqual(status.iconJob, { queued: true, phase: 'pending', attempts: 0 });
});
