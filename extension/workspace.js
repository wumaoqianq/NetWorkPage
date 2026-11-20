// 统一业务写入入口：页面与 worker 的所有业务消息都经此串行处理（SW 用 serial 包裹）。
// 权威任务状态只在 Outbox(IndexedDB)；chrome.storage 仅保留设备配置(connection/optionsCache/release)
// 与旧数据备份。旧 popup/options/bookmarks 的消息协议保持兼容，但不再写四套并行任务状态。
import { normalizeServer, captureUrl } from './queue.js';

const identity = connection => `${connection.server}|${connection.user.id}`;
const publicConnection = connection => {
  if (!connection) return null;
  const { token, ...rest } = connection;
  return rest;
};

export function createWorkspace({ config, outbox, request, bookmarks, now = Date.now,
  extensionVersion = () => '1.10.1' }) { // 运行期由 SW 注入真实 manifest 版本
  async function readConfig() { return config.read(); }
  async function status() {
    const cfg = await readConfig();
    const connection = cfg.connection || null;
    const cached = connection ? cfg.optionsCache?.[identity(connection)] : null;
    const view = await outbox.status(connection);
    return {
      connection: publicConnection(connection),
      queue: view.queue, summary: view.summary, assetJobs: view.assetJobs,
      lastResult: null, // 新页面按 captureId 查状态，不再依赖唯一 lastResult
      options: cached?.data || null, optionsCachedAt: cached?.fetchedAt || null,
      release: cfg.release || null,
      outbox: { schemaVersion: view.schemaVersion, migration: view.migration },
    };
  }
  function requireConnection(cfg) {
    const connection = cfg.connection;
    if (!connection || connection.paused) throw new Error('请先连接工作台或重新配对。');
    return connection;
  }
  async function pair(message) {
    const server = normalizeServer(message.server);
    const code = String(message.code || '').trim();
    const name = String(message.name || '').trim();
    if (!code || code.length > 100 || !name || name.length > 100) throw new Error('请输入配对码和 1–100 字的设备名。');
    const data = await request('/api/extension/pair', { server, method: 'POST',
      body: { code, name, extensionVersion: extensionVersion(), protocolVersion: 2 } });
    if (!data.token || !data.user?.id || !data.device?.id || !(Date.parse(data.expiresAt) > now())) {
      throw new Error('服务器配对响应不完整，请重新生成配对码。');
    }
    const connection = { server, token: data.token, user: data.user, device: data.device,
      expiresAt: data.expiresAt, paused: false, pauseReason: '' };
    await config.set({ connection });
    await outbox.resumeOwner(connection); // 同账号重新配对：恢复 needs_auth，不转投其他账号
    return status();
  }
  async function loadOptions() {
    const cfg = await readConfig();
    const connection = requireConnection(cfg);
    const data = await request('/api/extension/options', connection);
    if (!Array.isArray(data.categories) || !Array.isArray(data.collections)) throw new Error('整理选项响应不完整。');
    await config.set({ optionsCache: { ...(cfg.optionsCache || {}),
      [identity(connection)]: { data, fetchedAt: now() } } });
    return data;
  }
  async function checkRelease() {
    const cfg = await readConfig();
    if (!cfg.connection) throw new Error('请先连接工作台。');
    const currentVersion = extensionVersion();
    await config.set({ release: { ...(cfg.release || {}), checkedAt: now(), currentVersion } });
    const data = await request('/api/extension/release', cfg.connection);
    const release = { ...data, checkedAt: now(), currentVersion };
    await config.set({ release });
    return release;
  }
  async function lookup(message) {
    const connection = requireConnection(await readConfig());
    try { return await request(`/api/extension/lookup?url=${encodeURIComponent(captureUrl(message.url))}`, connection); }
    catch (error) {
      if ([401, 403].includes(error.status)) await config.set({ connection: { ...connection, paused: true, pauseReason: error.message } });
      throw error;
    }
  }
  async function captureDraft(message) {
    const cfg = await readConfig();
    const connection = cfg.connection || null;
    const cached = connection ? cfg.optionsCache?.[identity(connection)] : null;
    let draft, restoredStatus = null;
    try {
      draft = await outbox.getDraft(message.draftId, connection);
    } catch (error) {
      // 浏览器重启恢复了已提交的表单标签页：返回真实阶段而不是「草稿不存在」错误。
      const rec = await outbox.record(message.draftId);
      if (!rec || rec.phase === 'draft') throw error;
      draft = { captureId: rec.captureId, phase: rec.phase, target: rec.target, payload: rec.payload };
      restoredStatus = { phase: rec.phase, receipt: rec.receipt, lastError: rec.lastError,
        needsUserAction: rec.needsUserAction === true, category: rec.receipt?.category || '' };
    }
    return { draft, connection: publicConnection(connection), options: cached?.data || null, restoredStatus };
  }
  async function captureSubmit(message) {
    const connection = requireConnection(await readConfig());
    const record = await outbox.submitDraft({ draftId: message.draftId, form: message.form || {}, connection });
    return { captureId: record.captureId, phase: record.phase }; // 本地事务成功：界面反馈「已存本地」
  }
  async function captureStatus(message) {
    const rec = await outbox.record(message.draftId);
    if (!rec) return { phase: 'missing' };
    return { phase: rec.phase, receipt: rec.receipt, lastError: rec.lastError,
      needsUserAction: rec.needsUserAction === true, category: rec.receipt?.category || '',
      iconJob: rec.receipt?.iconJob || null,
      preview: rec.preview ? { state: rec.preview.state, displayUrl: rec.preview.displayUrl } : null,
      icon: rec.icon ? { state: rec.icon.state, displayUrl: rec.icon.displayUrl } : null };
  }
  async function handle(message) {
    switch (message.type) {
      case 'status': return status();
      case 'pair': return pair(message);
      case 'options': return loadOptions();
      case 'release': return checkRelease();
      case 'lookup': return lookup(message);
      case 'disconnect': await config.set({ connection: null }); return status();
      case 'retry': await outbox.retryAll((await readConfig()).connection); return status();
      case 'delete': await outbox.remove(message.ids || []); return status();
      case 'cancel-attachment': await outbox.removeAttachment(message.id, message.kind); return status();
      // 旧 popup 兼容：文字收编进单 Outbox；attach 在阶段 C 接入图片，此阶段明确滞后但不丢文字。
      case 'capture': {
        const connection = requireConnection(await readConfig());
        await outbox.adoptPayload(message.capture || {}, connection); return status();
      }
      case 'attach': return status();
      // 新普通扩展页协议
      case 'capture-draft': return captureDraft(message);
      case 'capture-submit': return captureSubmit(message);
      case 'capture-status': return captureStatus(message);
      case 'capture-cancel': await outbox.cancel(message.draftId); return captureStatus(message);
      case 'capture-retry': await outbox.retry(message.draftId, (await readConfig()).connection); return captureStatus(message);
      // 阶段 C：页面内压缩结果原子替换原始快照；用户明确取消素材才删 Blob。
      case 'capture-compress':
        return outbox.compressAsset({ draftId: message.draftId, kind: message.kind,
          dataUrl: message.dataUrl, bytes: message.bytes, width: message.width, height: message.height });
      case 'capture-cancel-asset':
        await outbox.cancelAsset(message.draftId, message.kind); return captureStatus(message);
      default:
        if (String(message.type || '').startsWith('bookmarks-')) return bookmarks.handle(message);
        throw new Error('未知扩展操作。');
    }
  }
  async function flush() {
    const connection = (await readConfig()).connection;
    return outbox.flush(connection);
  }
  return { handle, flush, status };
}
