// 入口：用户点击工具栏时固定「实际点击的 tab」，短窗口采集截图/元数据/同源图标，
// 一次性事务持久化到后台单一 Outbox；不打开新标签页（1.10.0 恢复小弹窗）。
// 目标 tab/window/URL 前后校验：切换窗口或源页面导航都不会把新页面冒充旧页面。
// 只把不可猜的 draftId 放进扩展页内部；sourceUrl（入口地址）与图片 displayUrl 严格分离。
import { captureUrl, inferScope, cleanDescription } from './queue.js';

// 2560×1440 内容丰富的页面 PNG 可达数 MB；旧 700KB 上限会静默丢弃截图（真实缺图根因）。
// 放宽到有界 8MB，页面内 canvas 压缩成功后立即清除原始快照；超限仍省略，不无界保存。
export const MAX_RAW_PREVIEW_BYTES = 8 * 1024 * 1024;

export function checkTarget(tab) {
  if (!tab || typeof tab.id !== 'number' || typeof tab.windowId !== 'number') return 'no-active-tab';
  if (tab.incognito) return 'incognito';
  try { captureUrl(tab.url || ''); } catch { return 'unsupported-url'; }
  return null;
}

export function createCaptureEntry({ getConnection, tabsGet, captureVisibleTab, readMetadata,
  captureIcon, tabsCreate = null, getURL = null, openDraft, getRecord = null, setRawPreview = null,
  now = Date.now, maxRawBytes = MAX_RAW_PREVIEW_BYTES,
  generateId = () => globalThis.crypto.randomUUID() }) {

  /** 短窗口采集 + 单一 openDraft 事务（文字草稿与原始截图/图标同一个 captureId）。 */
  async function capture(tab) {
    const reason = checkTarget(tab);
    const connection = await getConnection();
    const draftId = generateId();
    const target = { url: tab.url || '', title: tab.title || tab.url || '',
      description: '', descriptionSource: 'manual', scope: '公网',
      tabId: tab.id, windowId: tab.windowId, capturedAt: now(), unsupportedReason: reason || '' };
    let rawPreview = null, icon = null, meta = null;
    if (!reason) {
      // 采集前复核：tab 仍是点击时的那一页，且仍属于调用窗口。
      let before = null;
      try { before = await tabsGet(tab.id); } catch { /* 目标不可读 */ }
      if (before && before.url === tab.url && before.windowId === tab.windowId) {
        try { meta = await readMetadata(tab.id); } catch { /* 元数据失败不阻塞文字 */ }
        if (meta) {
          target.title = meta.title || target.title;
          target.description = cleanDescription(meta.description);
          target.descriptionSource = meta.description ? 'page_meta' : 'manual';
          target.scope = inferScope(tab.url);
        }
        try {
          const shot = await captureVisibleTab(tab.windowId, { format: 'png' });
          if (shot && String(shot).startsWith('data:image') && String(shot).length <= maxRawBytes) rawPreview = shot;
        } catch { /* 截图失败不阻塞文字草稿 */ }
        try {
          const value = await captureIcon(tab.id, meta?.iconLinks || []);
          if (value && String(value).startsWith('data:image')) icon = value;
        } catch { /* 图标失败不阻塞，后台补图兜底 */ }
        // 采集后复核：来源页导航则丢弃截图，绝不把新页面冒充旧页面。
        let after = null;
        try { after = await tabsGet(tab.id); } catch { /* 页面关闭 */ }
        if (after && after.url !== tab.url) rawPreview = null;
        if (!after) rawPreview = null;
      }
    }
    const sourceUrl = tab.url || ''; // 入口地址，与图片 displayUrl 严格分离
    await openDraft({ draftId, target, connection, rawPreview, icon, sourceUrl });
    return { draftId, target, connection, rawPreview, icon, sourceUrl, reason: reason || '',
      hasPreview: Boolean(rawPreview), hasIcon: Boolean(icon) };
  }

  /** 旧普通标签页（仅调试/恢复页，不再由工具栏自动打开）。 */
  async function openForTab(tab) {
    const c = await capture(tab);
    if (tabsCreate && getURL) await tabsCreate({ windowId: tab.windowId,
      url: getURL(`capture.html?draft=${encodeURIComponent(c.draftId)}`), index: (tab.index ?? 0) + 1 });
    return { draftId: c.draftId, hasPreview: c.hasPreview, hasIcon: c.hasIcon, reason: c.reason };
  }

  /** 工具栏小弹窗：不创建任何标签页，用户留在当前网页。
   *  不把含设备凭据的 connection 回传页面；弹窗通过 capture-draft 只拿脱敏连接信息。 */
  async function openForPopup(tab) {
    const c = await capture(tab);
    return { draftId: c.draftId, target: c.target,
      hasPreview: c.hasPreview, hasIcon: c.hasIcon, reason: c.reason };
  }

  /** 截图尚未取得时的例外恢复：只在仍能确认原标签与权限时重采，绝不拿切换后的页面凑数。 */
  async function recapture(draftId) {
    if (!getRecord || !setRawPreview) return { ok: false, reason: '后台未就绪，无法重新截图' };
    const rec = await getRecord(draftId);
    if (!rec) return { ok: false, reason: '草稿不存在，无法重新截图' };
    const prev = rec.preview;
    if (prev && ['uploaded', 'uploading', 'conflict'].includes(prev.state))
      return { ok: false, reason: '已有截图正在同步或已入库，不覆盖' };
    const t = rec.target || {};
    if (typeof t.tabId !== 'number' || !t.url) return { ok: false, reason: '原标签信息缺失，不能拿别的页面凑数' };
    let before = null;
    try { before = await tabsGet(t.tabId); } catch { before = null; }
    if (!before || before.url !== t.url || (typeof t.windowId === 'number' && before.windowId !== t.windowId))
      return { ok: false, reason: '原标签已切换或关闭，不能拿切换后的页面凑数' };
    let shot = null;
    try { shot = await captureVisibleTab(before.windowId, { format: 'png' }); } catch { shot = null; }
    let accepted = null;
    if (shot && String(shot).startsWith('data:image') && String(shot).length <= maxRawBytes) {
      let after = null;
      try { after = await tabsGet(t.tabId); } catch { after = null; }
      if (after && after.url === t.url) accepted = shot;
    }
    if (!accepted) return { ok: false, reason: '截图不可用，这次未附截图' };
    await setRawPreview({ draftId, rawPreview: accepted, sourceUrl: t.url });
    return { ok: true, reason: '', hasPreview: true };
  }

  return { openForTab, openForPopup, recapture };
}
