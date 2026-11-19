import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaptureEntry, checkTarget } from '../capture-entry.js';

const tab = { id: 41, windowId: 3, index: 1, url: 'https://site.example/page', title: 'T', incognito: false };
const conn = { server: 'https://workspace.example', user: { id: 7 } };

function fixture(overrides = {}) {
  const calls = [];
  const opened = [];
  const entry = createCaptureEntry({
    getConnection: async () => conn,
    tabsGet: async () => ({ ...tab }),
    captureVisibleTab: async () => 'data:image/png;base64,AAAA',
    readMetadata: async () => ({ title: 'T', description: 'D', iconLinks: [] }),
    captureIcon: async () => null,
    tabsCreate: async options => { opened.push(options); return { id: 99 } },
    getURL: path => `chrome-extension://abc/${path}`,
    openDraft: async args => { calls.push(args); return { captureId: args.draftId } },
    now: () => 1000,
    maxRawBytes: 700_000,
    generateId: () => 'draft-uuid-1',
    ...overrides,
  });
  return { entry, calls, opened };
}

test('截图/图标/元数据都在打开表单标签页之前完成（顺序）', async () => {
  const order = [];
  const created = [];
  const ctx = fixture({
    captureVisibleTab: async () => { order.push('capture'); return 'data:image/png;base64,AAAA' },
    readMetadata: async () => { order.push('meta'); return { title: 'T', description: '', iconLinks: [] } },
    captureIcon: async () => { order.push('icon'); return null },
    tabsCreate: async o => { order.push('create'); created.push(o); return { id: 99 } },
  });
  await ctx.entry.openForTab(tab);
  assert.deepEqual(order, ['meta', 'capture', 'icon', 'create']);
  assert.match(created[0].url, /capture\.html\?draft=draft-uuid-1/);
  assert.equal(created[0].windowId, 3, '表单绑定用户点击的同一窗口');
});

test('URL 只含不可猜 draftId，不含远程/工作台 URL', async () => {
  const ctx = fixture();
  await ctx.entry.openForTab(tab);
  const url = ctx.opened[0].url;
  assert.equal(url.includes('site.example'), false);
  assert.equal(url.includes('workspace.example'), false);
  assert.equal(url.includes('draft=draft-uuid-1'), true);
});

test('目标前后校验：tab 导航后不把新页面冒充旧页面截图', async () => {
  let n = 0;
  const ctx = fixture({ tabsGet: async () => (++n === 1 ? { ...tab } : { ...tab, url: 'https://other.example/' }) });
  const r = await ctx.entry.openForTab(tab);
  assert.equal(r.hasPreview, false, '导航后省略截图');
  assert.equal(ctx.calls[0].target.url, 'https://site.example/page', '目标仍是点击时的固定 URL');
});

test('截图失败/超限不阻塞文字草稿', async () => {
  const a = fixture({ captureVisibleTab: async () => { throw new Error('no active tab') } });
  const r1 = await a.entry.openForTab(tab);
  assert.equal(r1.hasPreview, false);
  assert.equal(a.opened.length, 1, '表单照常打开');
  const b = fixture({ captureVisibleTab: async () => 'data:image/png;base64,' + 'A'.repeat(800_000) });
  const r2 = await b.entry.openForTab(tab);
  assert.equal(r2.hasPreview, false, '超限直接省略截图');
  assert.equal(b.calls[0].rawPreview, null);
});

test('checkTarget：隐身/非 HTTP(S)/缺 tabId 明确拒绝，不改选其它窗口', () => {
  assert.equal(checkTarget(tab), null);
  assert.equal(checkTarget({ ...tab, incognito: true }), 'incognito');
  assert.equal(checkTarget({ ...tab, url: 'edge://extensions/' }), 'unsupported-url');
  assert.equal(checkTarget({ ...tab, id: undefined }), 'no-active-tab');
});

test('已取得的原始快照与图标先持久化（与草稿同一 openDraft 调用），再打开表单', async () => {
  const ctx = fixture({ captureIcon: async () => 'data:image/webp;base64,BBBB' });
  await ctx.entry.openForTab(tab);
  const args = ctx.calls[0];
  assert.equal(args.rawPreview.startsWith('data:image/png'), true);
  assert.equal(args.icon.startsWith('data:image/webp'), true);
  assert.equal(ctx.opened.length, 1);
});
