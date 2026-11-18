import { captureVisible, deriveImage, homepageMatch } from './screenshot.js';
import { fetchSiteIcon } from './site-icon.js';
import { captureUrl } from './queue.js';

const unavailable = (kind, reason, details = {}) => ({ kind, status: 'unavailable', reason: String(reason || '暂不可用'), ...details });

export async function captureAutomaticPreview(tab) {
  const raw = await captureVisible(tab);
  const derived = await deriveImage(raw.blob);
  return { sourceUrl: raw.url, displayUrl: derived.url, blob: derived.blob, capturedAt: raw.capturedAt };
}

function readyPreview(captured) {
  return { kind: 'preview', status: 'ready', sourceUrl: captured.sourceUrl || captured.url,
    displayUrl: captured.displayUrl || captured.url, blob: captured.blob, capturedAt: captured.capturedAt };
}

export function createAutomaticAssetTasks({ tab, scope = 'page', homepage = '', enabled = true,
  capture = captureAutomaticPreview, icon = fetchSiteIcon } = {}) {
  const preview = (async () => {
    if (!enabled) return { kind: 'preview', status: 'disabled', reason: '本次不保存页面预览' };
    if (scope === 'home' && !homepageMatch(tab?.url, homepage)) {
      return unavailable('preview', '当前不是指定首页，未使用子页截图冒充首页');
    }
    try { return readyPreview(await capture(tab)); }
    catch (error) { return unavailable('preview', error.message); }
  })();
  const iconTask = (async () => {
    try { return { kind: 'icon', status: 'ready', ...await icon(tab) }; }
    catch (error) {
      return unavailable('icon', error.message, { code: error.code || 'icon_unavailable',
        diagnostics: error.diagnostics || null });
    }
  })();
  return { preview, icon: iconTask };
}

/** 收藏时只等快速截图；图标由持久化任务在后台继续，不能阻塞文字入库。 */
export async function waitForPreview(tasks, { timeout = 1200, onResult = () => {} } = {}) {
  const deadline = Date.now() + timeout;
  let timer;
  const expired = new Promise(resolve => { timer = setTimeout(() => resolve(null), Math.max(0, deadline - Date.now())); });
  const value = await Promise.race([tasks.preview, expired]);
  clearTimeout(timer);
  const result = value || unavailable('preview', '准备超过 1.2 秒，本次未附带素材');
  onResult(result);
  return result;
}

export async function waitForAutomaticAssets(tasks, { timeout = 2000, onResult = () => {} } = {}) {
  const results = {};
  const deadline = Date.now() + timeout;
  for (const kind of ['preview', 'icon']) {
    let timer;
    const remaining = Math.max(0, deadline - Date.now());
    const expired = new Promise(resolve => { timer = setTimeout(() => resolve(null), remaining); });
    const value = await Promise.race([tasks[kind], expired]);
    clearTimeout(timer);
    results[kind] = value || unavailable(kind, '准备超过 2 秒，本次未附带素材');
    onResult({ ...results });
  }
  return results;
}

export async function collectAutomaticAssets(options) {
  const tasks = createAutomaticAssetTasks(options);
  const [preview, icon] = await Promise.all([tasks.preview, tasks.icon]);
  return { preview, icon };
}

export async function persistAutomaticAssets({ store, connection, captureId, assets, savedUrl, includePreview = true, includeIcon = true }) {
  const result = { attachment: null, iconAttachment: null, errors: [] };
  const preview = assets?.preview;
  if (includePreview && preview?.status === 'ready') {
    try {
      if (captureUrl(preview.sourceUrl) !== captureUrl(savedUrl)) throw new Error('保存地址已变化，本次不带页面预览');
      const id = crypto.randomUUID();
      const record = { id, kind: 'preview', blob: preview.blob, sourceUrl: preview.sourceUrl,
        server: connection.server, userId: String(connection.user.id), captureId, createdAt: Date.now() };
      await store.put(record);
      result.attachment = { id, bytes: record.blob.size, createdAt: record.createdAt, capturedAt: preview.capturedAt,
        sourceEndpointId: '', sourceUrl: preview.sourceUrl, homepageUrl: '', pageKind: 'current', userConfirmedHomepage: false };
    } catch (error) { result.errors.push(`页面预览未保存：${error.message}`); }
  }
  const icon = assets?.icon;
  if (includeIcon && icon?.status === 'ready') {
    try {
      const id = crypto.randomUUID();
      const record = { id, kind: 'icon', blob: icon.blob, sourceUrl: icon.sourceUrl || savedUrl,
        server: connection.server, userId: String(connection.user.id), captureId, createdAt: Date.now() };
      await store.put(record);
      result.iconAttachment = { id, bytes: record.blob.size, createdAt: record.createdAt, sourceUrl: savedUrl };
    } catch (error) { result.errors.push(`网站图标未保存：${error.message}`); }
  }
  return result;
}
