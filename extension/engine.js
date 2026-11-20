import { findAssetJob, normalizeAssetJob } from './asset-attach.js';
import { createAssetIntake } from './engine-assets.js';
import { createAssetJobFlusher } from './asset-jobs-runner.js';
import { createStateRepair } from './engine-repair.js';
import { normalizeServer, captureUrl, makeCapture, enqueue, eligibleItems, eligibleAttachments, eligibleIcons,
  acknowledge, failCapture, failAttachment, resumeQueue, retryQueue, queueSummary, attachmentStats, belongsTo } from './queue.js';
const identity = connection => `${connection.server}|${connection.user.id}`;
const extensionVersion = () => globalThis.chrome?.runtime?.getManifest?.().version || '1.10.1';
// 存储、IndexedDB 与网络由适配器注入，旧队列和新附件状态机均可独立验证。
export function createEngine({ read, write, request, attachments = null, iconTasks = null, now = Date.now }) {
  const assetFlusher = createAssetJobFlusher({ attachments, request, notifyIconTasks, write, now });
  const assetIntake = createAssetIntake({ attachments, write, now });
  const repairState = createStateRepair({ attachments, write, now });
  const jobsOf = state => (state.assetJobs || []).map(normalizeAssetJob);
  const setJobs = (state, jobs) => { state.assetJobs = jobs; };
  async function status() {
    const state = await read();
    const { token, ...publicConnection } = state.connection || {};
    const cached = state.connection ? state.optionsCache?.[identity(state.connection)] : null;
    return { connection: state.connection ? publicConnection : null, queue: state.queue,
      summary: queueSummary(state.queue, state.connection), lastResult: state.lastResult || null,
      assetJobs: jobsOf(state).map(job => ({ captureId: job.captureId, state: job.state,
        preview: Boolean(job.attachment), icon: Boolean(job.iconAttachment), lastError: job.lastError })),
      options: cached?.data || null, optionsCachedAt: cached?.fetchedAt || null, release: state.release || null };
  }
  async function pair(message, state) {
    const server = normalizeServer(message.server);
    const code = String(message.code || '').trim();
    const name = String(message.name || '').trim();
    if (!code || code.length > 100 || !name || name.length > 100) throw new Error('请输入配对码和 1–100 字的设备名。');
    const data = await request('/api/extension/pair', { server, method: 'POST',
      body: { code, name, extensionVersion: extensionVersion(), protocolVersion: 2 } });
    if (!data.token || !data.user?.id || !data.device?.id || !(Date.parse(data.expiresAt) > now())) {
      throw new Error('服务器配对响应不完整，请重新生成配对码。');
    }
    state.connection = { server, token: data.token, user: data.user, device: data.device,
      expiresAt: data.expiresAt, paused: false, pauseReason: '' };
    state.queue = resumeQueue(state.queue, state.connection, now());
    state.lastResult = null;
    await write(state);
  }
  async function lookup(message, state) {
    const connection = state.connection;
    if (!connection || connection.paused) throw new Error('连接已断开或暂停，请重新配对。');
    try { return await request(`/api/extension/lookup?url=${encodeURIComponent(captureUrl(message.url))}`, connection); }
    catch (error) {
      if ([401, 403].includes(error.status)) {
        state.connection = { ...connection, paused: true, pauseReason: error.message };
        await write(state);
      }
      throw error;
    }
  }
  async function loadOptions(state) {
    const connection = state.connection;
    if (!connection || connection.paused) throw new Error('请先连接工作台。');
    const data = await request('/api/extension/options', connection);
    if (!Array.isArray(data.categories) || !Array.isArray(data.collections)) throw new Error('整理选项响应不完整。');
    state.optionsCache = { ...(state.optionsCache || {}), [identity(connection)]: { data, fetchedAt: now() } };
    await write(state);
    return data;
  }
  async function checkRelease(state) {
    if (!state.connection) throw new Error('请先连接工作台。');
    state.release = { ...(state.release || {}), checkedAt: now(), currentVersion: extensionVersion() };
    await write(state);
    const data = await request('/api/extension/release', state.connection);
    state.release = { ...data, checkedAt: now(), currentVersion: extensionVersion() };
    await write(state);
    return state.release;
  }
  async function validateAttachment(item, source, kind) {
    if (!source) return;
    if (!attachments) throw new Error('本地图片存储不可用，请移除图片后重试。');
    const record = await attachments.get(source.id);
    if (!record || record.server !== item.server || record.userId !== item.userId
        || record.captureId !== item.payload.clientCaptureId || (record.kind && record.kind !== kind)) {
      throw new Error(`${kind === 'icon' ? '图标' : '预览'}草稿已丢失，请重新采集。`);
    }
  }
  async function addCapture(message, state) {
    if (state.queue.length >= 1000) throw new Error('本地待同步已达 1000 条，请先同步或清理。');
    const item = makeCapture(state.connection, message.capture, now());
    const replaced = message.capture.replacesCaptureId;
    if (replaced && replaced === item.payload.clientCaptureId) {
      throw new Error('修改被拒绝任务需要新的收藏编号，请重新提交修改。');
    }
    const stats = attachmentStats(state.queue);
    const bytes = (item.attachment?.bytes || 0) + (item.iconAttachment?.bytes || 0);
    if (stats.count + Number(Boolean(item.attachment)) + Number(Boolean(item.iconAttachment)) > 20
        || stats.bytes + bytes > 4 * 1024 * 1024) throw new Error('本地图片队列已满，可移除图片后只保存文字。');
    await validateAttachment(item, item.attachment, 'preview');
    await validateAttachment(item, item.iconAttachment, 'icon');
    if (replaced) item.replacesCaptureId = replaced;
    state.queue = enqueue(state.queue, item);
    await write(state);
    if (replaced) {
      state.queue = state.queue.map(value => belongsTo(value, state.connection)
        && value.payload.clientCaptureId === replaced ? { ...value, state: 'cancelled', replacedBy: item.payload.clientCaptureId,
          attachment: null, iconAttachment: null, lastError: '已由新的本地修订替代。' } : value);
      await write(state);
    }
  }
  async function handle(message) {
    const state = await read();
    switch (message.type) {
      case 'status': return status();
      case 'pair': await pair(message, state); break;
      case 'lookup': return lookup(message, state);
      case 'options': return loadOptions(state);
      case 'release': return checkRelease(state);
      case 'capture': await addCapture(message, state); break;
      case 'attach': await assetIntake.attach(message, state); break;
      case 'retry':
        state.queue = retryQueue(state.queue, state.connection, now());
        setJobs(state, jobsOf(state).map(job => ['retryable', 'failed'].includes(job.state)
          ? { ...job, state: 'pending', attempts: 0, nextAttemptAt: 0, lastError: '' } : job));
        await write(state); break;
      case 'disconnect': state.connection = null; state.lastResult = null; await write(state); break;
      case 'cancel-attachment': {
        const item = state.queue.find(value => value.id === message.id);
        const captureId = message.captureId || item?.payload.clientCaptureId;
        const icon = message.kind === 'icon';
        if (captureId) {
          const jobs = jobsOf(state);
          const index = jobs.findIndex(job => job.captureId === captureId);
          if (index >= 0) {
            const job = jobs[index];
            const source = icon ? job.iconAttachment : job.attachment;
            if (source && attachments) await attachments.remove(source.id);
            const next = { ...job, [icon ? 'iconAttachment' : 'attachment']: null, updatedAt: now(),
              lastError: '用户取消了该素材' };
            if (!next.attachment && !next.iconAttachment) jobs.splice(index, 1); else jobs[index] = next;
            setJobs(state, jobs);
            await write(state); break;
          }
        }
        const source = icon ? item?.iconAttachment : item?.attachment;
        if (source && attachments) await attachments.remove(source.id);
        const remaining = icon ? item?.attachment : item?.iconAttachment;
        state.queue = item?.siteId && !remaining ? acknowledge(state.queue, message.id)
          : state.queue.map(value => value.id === message.id ? { ...value, [icon ? 'iconAttachment' : 'attachment']: null } : value);
        await write(state); break;
      }
      case 'delete': {
        if (!Array.isArray(message.ids)) throw new Error('请明确选择要删除的本地待同步项。');
        const removed = state.queue.filter(item => message.ids.includes(item.id));
        if (attachments) await Promise.all(removed.flatMap(item => [item.attachment, item.iconAttachment])
          .filter(Boolean).map(source => attachments.remove(source.id)));
        state.queue = state.queue.filter(item => !message.ids.includes(item.id));
        await write(state); break;
      }
      default: throw new Error('未知扩展操作。');
    }
    return status();
  }
  async function notifyIconTasks(method, ...args) {
    if (!iconTasks || typeof iconTasks[method] !== 'function') return;
    try { await iconTasks[method](...args); } catch { /* 任务记录失败不阻断收藏主链路。 */ }
  }
  function confirmed(item, result) {
    return { at: now(), title: item.payload.title, clientCaptureId: item.payload.clientCaptureId,
      duplicate: result.duplicate === true, outcome: result.outcome || (result.duplicate ? 'existing' : 'created'),
      siteId: result.site.id, siteVersion: result.site.version, category: result.site.category || '', inbox: result.site.inbox === true,
      previewPending: false, previewUploaded: false, iconPending: false, iconUploaded: false };
  }
  function updateItem(state, item, changes) {
    return state.queue.map(value => value.id === item.id ? { ...value, ...changes } : value);
  }
  async function flushText(state, connection) {
    for (const item of eligibleItems(state.queue, connection, now()).slice(0, 10)) {
      try {
        const path = item.protocol === 2 ? '/api/extension/v2/captures' : '/api/extension/captures';
        const result = await request(path, { ...connection, method: 'POST', body: item.payload });
        if (!result.site?.id) throw new Error('服务器尚未确认保存，稍后重试。');
        state.lastResult = confirmed(item, result);
        assetIntake.rememberReceipt(state, item, result);
        const job = findAssetJob(jobsOf(state), item.payload.clientCaptureId);
        const preview = item.attachment && result.canAttachPreview === true;
        const icon = item.iconAttachment && result.canAttachIcon === true;
        if (job?.iconAttachment && result.canAttachIcon !== true) {
          await notifyIconTasks('onIconSkipped', item.payload.clientCaptureId, '服务器未允许附加图标');
        } else if (job?.iconAttachment || icon) {
          await notifyIconTasks('onIconReadyToUpload', item.payload.clientCaptureId, { connection });
        } else if (result.canAttachIcon !== true && item.iconAttachment) {
          await notifyIconTasks('onIconSkipped', item.payload.clientCaptureId, '服务器未允许附加图标');
        } else {
          // 文字已入库但图标尚未取得：保留持久化任务，由后台兜底继续。
          await notifyIconTasks('onCaptureConfirmedWithoutIcon', item.payload.clientCaptureId, { connection,
            siteId: result.site.id, siteVersion: result.site.version });
        }
        if (preview || icon) {
          if (!Number.isInteger(result.site.version)) throw new Error('附件许可缺少网站版本。');
          state.queue = updateItem(state, item, { state: 'preview_pending', siteId: result.site.id,
            siteVersion: result.site.version, attempts: 0, lastError: '', attachment: preview ? item.attachment : null,
            iconAttachment: icon ? item.iconAttachment : null, iconNextAttemptAt: now() });
          state.lastResult.previewPending = Boolean(preview); state.lastResult.iconPending = Boolean(icon);
          if (!preview && item.attachment && attachments) await attachments.remove(item.attachment.id);
          if (!icon && item.iconAttachment && attachments) await attachments.remove(item.iconAttachment.id);
        } else {
          state.queue = acknowledge(state.queue, item.id);
          if (attachments) for (const source of [item.attachment, item.iconAttachment].filter(Boolean)) await attachments.remove(source.id);
        }
      } catch (error) {
        state.queue = failCapture(state.queue, item.id, error, now());
        if ([401, 403].includes(error.status)) state.connection = { ...connection, paused: true, pauseReason: error.message };
        await write(state); return;
      }
      await write(state);
    }
  }
  function finishAsset(state, item, kind, result) {
    const current = state.queue.find(value => value.id === item.id) || item;
    // 文字回执里的服务端分类/重复状态必须保留到素材上传完成之后，否则成功提示会退回“未分类”。
    const previous = state.lastResult?.clientCaptureId === current.payload.clientCaptureId ? state.lastResult : null;
    const changes = { siteVersion: result.siteVersion, [`${kind}Uploaded`]: true,
      [kind === 'icon' ? 'iconAttachment' : 'attachment']: null };
    const remaining = kind === 'icon' ? current.attachment : current.iconAttachment;
    if (remaining) changes.state = 'preview_pending';
    state.queue = updateItem(state, current, changes);
    const complete = !remaining;
    if (complete) state.queue = acknowledge(state.queue, item.id);
    state.lastResult = { ...confirmed(current, { site: { id: current.siteId, version: result.siteVersion,
      category: previous?.category ?? current.payload.category, inbox: previous?.inbox ?? current.payload.later },
      duplicate: previous?.duplicate, outcome: previous?.outcome || 'updated' }),
      updatedAssets: previous?.duplicate === true || previous?.outcome === 'updated',
      updatedPreview: kind === 'preview' || previous?.updatedPreview === true,
      updatedIcon: kind === 'icon' || previous?.updatedIcon === true,
      previewUploaded: kind === 'preview' || current.previewUploaded === true,
      iconUploaded: kind === 'icon' || current.iconUploaded === true,
      previewPending: kind === 'icon' && Boolean(current.attachment), iconPending: kind === 'preview' && Boolean(current.iconAttachment) };
  }
  async function flushPreview(state, connection) {
    const item = eligibleAttachments(state.queue, connection, now())[0];
    if (!item || !attachments) return;
    try {
      const record = await attachments.get(item.attachment.id);
      if (!record) throw new Error('本地图片已丢失，请重新采集。');
      const source = item.attachment;
      const form = new FormData();
      for (const [key, value] of Object.entries({ clientAssetId: source.id, expectedVersion: item.siteVersion,
        sourceEndpointId: source.sourceEndpointId, sourceUrl: source.sourceUrl, homepageUrl: source.homepageUrl || '',
        pageKind: source.pageKind, userConfirmedHomepage: String(source.userConfirmedHomepage === true),
        capturedAt: source.capturedAt })) form.append(key, value);
      form.append('file', record.blob, 'preview.webp');
      const result = await request(`/api/extension/v2/captures/${item.payload.clientCaptureId}/preview`,
        { ...connection, method: 'POST', form });
      if (!result.assetId || result.status !== 'complete' || !Number.isInteger(result.siteVersion)) throw new Error('服务器尚未确认图片。');
      finishAsset(state, item, 'preview', result);
      await attachments.remove(item.attachment.id);
    } catch (error) {
      state.queue = failAttachment(state.queue, item.id, error, now());
      if ([401, 403].includes(error.status)) state.connection = { ...connection, paused: true, pauseReason: error.message };
    }
    await write(state);
  }
  async function flushIcon(state, connection) {
    const item = eligibleIcons(state.queue, connection, now())[0];
    if (!item || !attachments) return;
    try {
      const record = await attachments.get(item.iconAttachment.id);
      if (!record) throw new Error('本地图标已丢失，请重新采集。');
      const source = item.iconAttachment;
      const form = new FormData();
      for (const [key, value] of Object.entries({ clientAssetId: source.id, expectedVersion: item.siteVersion,
        sourceUrl: source.sourceUrl })) form.append(key, value);
      form.append('file', record.blob, 'icon.webp');
      const result = await request(`/api/extension/v2/captures/${item.payload.clientCaptureId}/icon`,
        { ...connection, method: 'POST', form });
      if (!result.assetId || result.status !== 'complete' || !Number.isInteger(result.siteVersion)) throw new Error('服务器尚未确认图标。');
      finishAsset(state, item, 'icon', result);
      await attachments.remove(item.iconAttachment.id);
      await notifyIconTasks('onIconUploaded', item.payload.clientCaptureId, { connection, result });
    } catch (error) {
      state.queue = failAttachment(state.queue, item.id, error, now())
        .map(value => value.id === item.id ? { ...value, iconNextAttemptAt: value.nextAttemptAt } : value);
      if ([401, 403].includes(error.status)) state.connection = { ...connection, paused: true, pauseReason: error.message };
      else if ([400, 409, 413].includes(error.status)) {
        await notifyIconTasks('onIconUploadFailed', item.payload.clientCaptureId, { connection, error });
      }
    }
    await write(state);
  }
  async function flush() {
    const state = await read();
    await repairState(state);
    const connection = state.connection;
    if (!connection || connection.paused) return;
    if (Date.parse(connection.expiresAt) <= now()) {
      state.connection = { ...connection, paused: true, pauseReason: '凭证已过期，请重新配对。' };
      await write(state); return;
    }
    await flushText(state, connection);
    if (!state.connection.paused) await assetFlusher.flush(state, state.connection);
    if (!state.connection.paused) await flushPreview(state, state.connection);
    if (!state.connection.paused) await flushIcon(state, state.connection);
  }
  return { handle, flush };
}
