// 工具栏小弹窗 + 单一 IndexedDB Outbox（1.10.0 恢复弹窗）。
// - manifest.action.default_popup 让点击直接在当前网页上方弹出，不打开新标签页、不跳转工作台。
// - 弹窗只做交互；截图/元数据/图标采集与全部业务写入都在后台，经 serial 串行。
// - 文字草稿 + 原始截图 Blob + 图标 Blob 同一个 captureId 一次性事务落盘；关闭弹窗后继续同步。
// - 原始快照有界，弹窗 DOM/canvas 或后台 OffscreenCanvas 压缩成 WebP 后原子清除。
import { request } from './api.js';
import { createOutbox } from './outbox.js';
import { createOutboxStore } from './outbox-store.js';
import { createWorkspace } from './workspace.js';
import { runMigration } from './migration-run.js';
import { createBookmarkImporter } from './bookmark-engine.js';
import { createAttachmentStore } from './attachment-store.js';
import { createCaptureEntry, MAX_RAW_PREVIEW_BYTES } from './capture-entry.js';
import { captureIconInPage } from './icon-page-capture.js';
import { buildIconCandidates } from './icon-format.js';
import { dataUrlToBlob } from './capture-compress.js';
import { compressInWorker } from './worker-compress.js';

const SYNC_ALARM = 'workspace-outbox-sync';
const CONFIG_KEY = 'workspaceState'; // 仅设备配置：connection / optionsCache / release

const storage = chrome.storage.local;
const config = {
  async read() {
    const stored = await storage.get(CONFIG_KEY);
    return stored[CONFIG_KEY] || { connection: null, optionsCache: {}, release: null };
  },
  async set(patch) {
    const current = await config.read();
    await storage.set({ [CONFIG_KEY]: { ...current, ...patch } });
    await refreshBadge();
  },
};
const outboxStore = createOutboxStore();
const outbox = createOutbox({ store: outboxStore,
  request, readConnection: async () => (await config.read()).connection,
  writeConnection: async connection => config.set({ connection }),
  now: Date.now, workerId: crypto.randomUUID(), attachmentStore: { dataUrlToBlob } });
const bookmarks = createBookmarkImporter({ request,
  read: async () => config.read(), write: async state => storage.set({ [CONFIG_KEY]: state }),
  permission: () => chrome.permissions.contains({ permissions: ['bookmarks'] }) });
const workspace = createWorkspace({ config, outbox, request, bookmarks, now: Date.now,
  extensionVersion: () => chrome.runtime.getManifest().version });

let chain = Promise.resolve();
function serial(operation) {
  const result = chain.then(operation);
  chain = result.catch(error => console.warn('网站工作台：', error.message));
  return result;
}
async function refreshBadge() {
  const connection = (await config.read()).connection;
  const view = await outbox.status(connection);
  await chrome.action.setBadgeText({ text: view.summary.current ? String(view.summary.current) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#087e63' });
}
async function ensureAlarm() {
  if (!await chrome.alarms.get(SYNC_ALARM)) await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 1 });
}
async function migrateLegacy() {
  try {
    return await runMigration({ storage, attachments: createAttachmentStore(), store: outboxStore, now: Date.now });
  } catch (error) {
    console.warn('网站工作台：旧数据迁移未完成，旧存储保持可恢复：', error.message);
    return { skipped: false, error: error.message };
  }
}
async function synchronize() {
  // 弹窗可能在压缩前就被关闭：后台用原生 OffscreenCanvas 把已落盘的原始快照压成有界 WebP。
  // 有界重试，不依赖弹窗存活；压缩成功后同一事务清除原始 Blob。
  await outbox.compressPendingRaw(dataUrl => compressInWorker(dataUrl, { maxRawBytes: MAX_RAW_PREVIEW_BYTES }));
  await workspace.flush();
  await outbox.prune();
  await refreshBadge();
}

// 短窗口采集：只接收页面声明的同源栅格候选，跨域候选交阶段 D 服务端，不在客户端抓取。
async function readMetadata(tabId) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId, allFrames: false }, func: () => {
    const meta = selector => document.querySelector(selector)?.getAttribute('content') || '';
    return { title: document.title || '',
      description: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
      iconLinks: [...document.querySelectorAll('link[rel]')]
        .filter(link => /(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/i.test(link.rel))
        .map(link => ({ href: link.href, rel: link.rel, type: link.getAttribute('type') || '',
          sizes: link.getAttribute('sizes') || '', media: link.getAttribute('media') || '' }))
        .filter(link => link.href).slice(0, 10) };
  } });
  return result?.result || { title: '', description: '', iconLinks: [] };
}
async function captureIcon(tabId, iconLinks) {
  const origin = new URL((await chrome.tabs.get(tabId)).url).origin;
  const candidates = buildIconCandidates({ pageUrl: `${origin}/`, iconLinks })
    .filter(candidate => !candidate.crossOrigin && !candidate.data && candidate.format !== 'svg')
    .slice(0, 4).map(candidate => candidate.url);
  if (!candidates.length) return null;
  try {
    const [value] = await chrome.scripting.executeScript({ target: { tabId },
      func: captureIconInPage, args: [candidates] });
    return value?.result?.dataUrl || null;
  } catch { return null; }
}

const entry = createCaptureEntry({ getConnection: async () => (await config.read()).connection,
  tabsGet: tabId => chrome.tabs.get(tabId),
  captureVisibleTab: (windowId, options) => chrome.tabs.captureVisibleTab(windowId, options),
  readMetadata, captureIcon,
  openDraft: args => outbox.openDraft(args),
  getRecord: id => outbox.record(id),
  setRawPreview: args => outbox.setRawPreview(args),
  now: Date.now, maxRawBytes: MAX_RAW_PREVIEW_BYTES, generateId: () => crypto.randomUUID() });

// 1.10.0：default_popup 由浏览器直接弹出，不再注册 action.onClicked（打开新标签页的旧入口）。
// 保留的 _execute_action 快捷键同样打开弹窗；所有采集由弹窗的 capture-open 消息触发。
chrome.runtime.onInstalled.addListener(() => {
  void storage.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  void ensureAlarm();
  void serial(async () => { await migrateLegacy(); await synchronize(); });
});
chrome.runtime.onStartup.addListener(() => {
  void ensureAlarm();
  void serial(async () => { await migrateLegacy(); await synchronize(); });
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === SYNC_ALARM) void serial(synchronize);
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
  const task = message.type === 'capture-open'
    ? entry.openForPopup(message.tab || {})
    : message.type === 'capture-recapture'
      ? entry.recapture(message.draftId)
      : workspace.handle(message);
  serial(() => task).then(data => {
    respond({ ok: true, data });
    if (['capture-open', 'capture-recapture', 'capture-submit', 'capture-compress',
      'capture-retry', 'capture', 'retry', 'pair'].includes(message.type)) {
      void serial(synchronize);
    }
  }, error => respond({ ok: false, error: error.message, code: error.code, status: error.status }));
  return true;
});
void ensureAlarm();
// 顶级 SW 唤醒也尝试一次：覆盖「重新加载」不触发 onStartup/onInstalled 的情况。
void serial(async () => { await migrateLegacy(); await synchronize(); });
