import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCaptureEntry, checkTarget, MAX_RAW_PREVIEW_BYTES } from '../capture-entry.js';
import { createOutbox } from '../outbox.js';
import { createMemoryOutboxStore } from '../outbox-store.js';

const tab = { id: 41, windowId: 3, index: 1, url: 'https://site.example/page', title: 'T', incognito: false };
const conn = { server: 'https://workspace.example', user: { id: 7 }, expiresAt: '2099-01-01', paused: false };
const DRAFT = 'd1e2f3a4-5b6c-478d-89ab-cdef01234567';
const root = fileURLToPath(new URL('../', import.meta.url));

function fixture(overrides = {}) {
  const calls = [], opened = [], recaptured = [];
  const record = { captureId: DRAFT, phase: 'draft',
    target: { url: tab.url, title: tab.title, tabId: tab.id, windowId: tab.windowId } };
  const entry = createCaptureEntry({
    getConnection: async () => conn,
    tabsGet: async () => ({ ...tab }),
    captureVisibleTab: async () => 'data:image/png;base64,AAAA',
    readMetadata: async () => ({ title: 'T', description: 'D', iconLinks: [] }),
    captureIcon: async () => null,
    tabsCreate: async options => { opened.push(options); return { id: 99 } },
    getURL: path => `chrome-extension://abc/${path}`,
    openDraft: async args => { calls.push(args); return { captureId: args.draftId } },
    getRecord: async () => record,
    setRawPreview: async args => { recaptured.push(args); return {} },
    now: () => 1000,
    generateId: () => DRAFT,
    ...overrides,
  });
  return { entry, calls, opened, recaptured };
}

test('manifest 恢复 default_popup：点击工具栏不再派发 onClicked 新标签页', () => {
  const manifest = JSON.parse(readFileSync(root + 'manifest.json', 'utf8'));
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.equal(manifest.permissions.includes('activeTab'), true);
});

test('openForPopup 不创建任何标签页（用户留在当前网页）', async () => {
  const ctx = fixture();
  const result = await ctx.entry.openForPopup(tab);
  assert.equal(ctx.opened.length, 0, '绝不打开新标签页');
  assert.equal(result.draftId, DRAFT);
  assert.equal(result.hasPreview, true);
});

test('openForPopup 把目标+原始截图+图标一次性交给 openDraft（同一 captureId 持久化）', async () => {
  const ctx = fixture({ captureIcon: async () => 'data:image/webp;base64,BBBB' });
  await ctx.entry.openForPopup(tab);
  assert.equal(ctx.calls.length, 1);
  const args = ctx.calls[0];
  assert.equal(args.target.url, tab.url);
  assert.equal(args.target.tabId, 41);
  assert.equal(args.target.windowId, 3);
  assert.ok(args.rawPreview.startsWith('data:image/png'));
  assert.ok(args.icon.startsWith('data:image/webp'));
});

test('原始截图放宽到有界 8MB：内容丰富的 2560×1440 页面不再被 700KB 静默丢弃', async () => {
  assert.ok(MAX_RAW_PREVIEW_BYTES > 700_000);
  const big = 'data:image/png;base64,' + 'A'.repeat(900_000); // 大于旧 700KB 上限
  const ctx = fixture({ captureVisibleTab: async () => big });
  const r = await ctx.entry.openForPopup(tab);
  assert.equal(r.hasPreview, true, '900KB 原始快照应保留，由页面压缩到有界 WebP');
  assert.equal(ctx.calls[0].rawPreview, big);
});

test('原始快照仍有上界：超过 8MB 省略截图，不无界保存高分辨率画面', async () => {
  const huge = 'data:image/png;base64,' + 'A'.repeat(MAX_RAW_PREVIEW_BYTES + 10);
  const ctx = fixture({ captureVisibleTab: async () => huge });
  const r = await ctx.entry.openForPopup(tab);
  assert.equal(r.hasPreview, false);
  assert.equal(ctx.calls[0].rawPreview, null);
});

test('openForPopup 目标前后校验：源页导航后不把新页面冒充旧页面截图', async () => {
  let n = 0;
  const ctx = fixture({ tabsGet: async () => (++n === 1 ? { ...tab } : { ...tab, url: 'https://other.example/' }) });
  const r = await ctx.entry.openForPopup(tab);
  assert.equal(r.hasPreview, false);
  assert.equal(ctx.calls[0].target.url, tab.url, '仍绑定点击时的固定 URL');
});

test('截图失败仍建立文字草稿并明确标记不可用', async () => {
  const ctx = fixture({ captureVisibleTab: async () => { throw new Error('no active tab') } });
  const r = await ctx.entry.openForPopup(tab);
  assert.equal(r.hasPreview, false);
  assert.equal(ctx.calls.length, 1, '文字草稿照常落盘');
});

test('recapture：原标签 URL/窗口不变才允许继续采集', async () => {
  const ctx = fixture();
  const r = await ctx.entry.recapture(DRAFT);
  assert.equal(r.ok, true);
  assert.equal(ctx.recaptured.length, 1);
  assert.ok(ctx.recaptured[0].rawPreview.startsWith('data:image/png'));
});

test('recapture：原标签已切换/关闭时拒绝，不拿切换后的页面凑数', async () => {
  const changed = fixture({ tabsGet: async () => ({ ...tab, url: 'https://switched.example/' }) });
  const r1 = await changed.entry.recapture(DRAFT);
  assert.equal(r1.ok, false);
  assert.match(r1.reason, /切换|关闭|不可确认/);
  assert.equal(changed.recaptured.length, 0);
  const closed = fixture({ tabsGet: async () => { throw new Error('tab closed') } });
  const r2 = await closed.entry.recapture(DRAFT);
  assert.equal(r2.ok, false);
  assert.equal(closed.recaptured.length, 0);
});

test('recapture：已上传的截图不被覆盖（素材冲突保护）', async () => {
  const ctx = fixture({ getRecord: async () => ({ captureId: DRAFT, phase: 'complete',
    target: { url: tab.url, tabId: tab.id, windowId: tab.windowId }, preview: { state: 'uploaded' } }) });
  const r = await ctx.entry.recapture(DRAFT);
  assert.equal(r.ok, false);
  assert.equal(ctx.recaptured.length, 0);
});

test('submitDraft 不再静默丢弃仍为 raw 的截图（真实缺图的根因之一）', async () => {
  const store = createMemoryOutboxStore();
  const outbox = createOutbox({ store, request: async () => ({}), readConnection: async () => conn,
    writeConnection: async () => {}, now: () => 1000, workerId: 'w' });
  await outbox.openDraft({ draftId: DRAFT, target: { url: tab.url, tabId: 41 },
    connection: conn, rawPreview: 'data:image/png;base64,AAAA', icon: null });
  const rec = await outbox.submitDraft({ draftId: DRAFT, form: { notes: 'n' }, connection: conn });
  assert.equal(rec.phase, 'local_saved');
  assert.ok(rec.preview, 'raw 截图必须保留，等待压缩后上传');
  assert.equal(rec.preview.state, 'raw');
  assert.ok(rec.preview.rawBlobId);
});

test('compressPendingRaw：worker 压缩成功后原子替换为 ready（弹窗关闭也能续传截图）', async () => {
  const store = createMemoryOutboxStore();
  const outbox = createOutbox({ store, request: async () => ({}), readConnection: async () => conn,
    writeConnection: async () => {}, now: () => 1000, workerId: 'w' });
  await outbox.openDraft({ draftId: DRAFT, target: { url: tab.url, tabId: 41 },
    connection: conn, rawPreview: 'data:image/png;base64,AAAA', icon: null });
  await outbox.submitDraft({ draftId: DRAFT, form: {}, connection: conn });
  let seen = '';
  const n = await outbox.compressPendingRaw(async dataUrl => { seen = dataUrl;
    return { dataUrl: 'data:image/webp;base64,CCCC', bytes: 3, width: 960, height: 540 }; });
  assert.equal(n, 1);
  assert.ok(seen.startsWith('data:image/png'));
  const rec = await outbox.record(DRAFT);
  assert.equal(rec.preview.state, 'ready');
  assert.equal(rec.preview.displayUrl, 'data:image/webp;base64,CCCC');
  assert.equal(rec.preview.rawBlobId, null, '原始快照已清除');
});

test('compressPendingRaw：worker 不支持压缩时不丢文字也不无限重试', async () => {
  const store = createMemoryOutboxStore();
  const outbox = createOutbox({ store, request: async () => ({}), readConnection: async () => conn,
    writeConnection: async () => {}, now: () => 1000, workerId: 'w' });
  await outbox.openDraft({ draftId: DRAFT, target: { url: tab.url, tabId: 41 },
    connection: conn, rawPreview: 'data:image/png;base64,AAAA', icon: null });
  await outbox.submitDraft({ draftId: DRAFT, form: {}, connection: conn });
  let attempts = 0;
  for (let i = 0; i < 4; i++) await outbox.compressPendingRaw(async () => { attempts++; return null; });
  assert.ok(attempts <= 3, '有界重试，不无限循环');
  const rec = await outbox.record(DRAFT);
  assert.ok(rec.preview && rec.preview.state === 'raw', '保留有界原始快照供后续弹窗压缩');
  assert.equal(rec.phase, 'local_saved');
});

test('checkTarget 仍拒绝隐身/edge:// 页面', () => {
  assert.equal(checkTarget(tab), null);
  assert.equal(checkTarget({ ...tab, incognito: true }), 'incognito');
  assert.equal(checkTarget({ ...tab, url: 'edge://extensions/' }), 'unsupported-url');
});
