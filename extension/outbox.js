// 单一权威发件箱引擎：每个 capture 一条记录；文字阶段与附件子阶段在同一记录里，
// 不反向改写文字阶段。任务与 Blob 经 outbox-store 的同一事务保存。
import { OUTBOX_SCHEMA, UUID, LEASE_MS, DRAFT_TTL, DONE_TTL, SUBMITTABLE, ownerOf, sameOwner,
  fingerprint, buildPayload, classifyError, displayState, receiptOf, queueItem } from './outbox-model.js';
import { dataUrlToBlob } from './asset-upload.js';
import { applyBaselines, assetsTerminal, uploadReadyAssets } from './asset-manager.js';
import { createRawPreviewHelper } from './raw-preview.js';
export { OUTBOX_SCHEMA, fingerprint, buildPayload, classifyError, displayState };

const newId = () => globalThis.crypto.randomUUID();
const estimateBytes = dataUrl => Math.floor((String(dataUrl).length - (String(dataUrl).indexOf(',') + 1)) * 3 / 4);

export function createOutbox({ store, request, readConnection, writeConnection, now = Date.now,
  workerId = 'worker', attachmentStore = null }) {
  const toBlob = attachmentStore?.dataUrlToBlob || dataUrlToBlob;
  const keyOf = captureId => captureId;
  async function load() { return store.load(); }
  async function put(record, extra = {}) {
    return store.commit({ capturePut: [[keyOf(record.captureId), { ...record, updatedAt: now() }]], ...extra });
  }
  async function requireDraft(draftId) {
    const rec = (await load()).captures[keyOf(draftId)];
    if (!rec || rec.phase !== 'draft') throw new Error('草稿不存在或已提交，请从工具栏重新打开收藏。');
    return rec;
  }

  /** 入口：打开表单前把目标元数据 + 已取得的原始快照/图标一次性事务持久化（不联网、不上传）。 */
  async function openDraft({ draftId, target, connection = null, rawPreview = null, icon = null }) {
    if (!UUID.test(String(draftId))) throw new Error('草稿标识必须为 UUID。');
    const snap = await load();
    if (snap.captures[keyOf(draftId)]) return snap.captures[keyOf(draftId)];
    const record = { captureId: draftId, server: connection?.server || null,
      ownerId: connection ? ownerOf(connection) : null, schemaVersion: OUTBOX_SCHEMA,
      phase: 'draft', target: { ...target }, payload: null, fingerprint: null, receipt: null,
      preview: null, icon: null, attempts: 0, nextAttemptAt: 0, assetNextAttemptAt: 0,
      lastError: '', lastErrorCode: '', lease: null, needsUserAction: false,
      createdAt: now(), updatedAt: now(), migratedFrom: null };
    const blobPut = [];
    if (rawPreview) {
      const rawBlobId = newId();
      blobPut.push([rawBlobId, { id: rawBlobId, kind: 'raw-preview', dataUrl: rawPreview,
        bytes: estimateBytes(rawPreview), createdAt: now() }]);
      record.preview = { state: 'raw', rawBlobId, blobId: null, assetId: newId(),
        displayUrl: rawPreview, sourceUrl: String(target.url || ''), bytes: estimateBytes(rawPreview),
        width: null, height: null, baseline: null, assetRevision: null, compressedAt: null };
    }
    if (icon) {
      const blobId = newId();
      blobPut.push([blobId, { id: blobId, kind: 'icon', dataUrl: icon,
        bytes: estimateBytes(icon), createdAt: now() }]);
      record.icon = { state: 'ready', blobId, assetId: newId(), displayUrl: icon,
        sourceUrl: String(target.url || ''), bytes: estimateBytes(icon),
        width: null, height: null, baseline: null, assetRevision: null, compressedAt: now() };
    }
    await store.commit({ capturePut: [[keyOf(draftId), record]], blobPut });
    return record;
  }

  async function getDraft(draftId, connection = null) {
    const record = await requireDraft(draftId);
    if (connection && record.server && (record.server !== connection.server || record.ownerId !== ownerOf(connection))) {
      throw new Error('该草稿属于另一账号或服务器，请从工具栏重新打开收藏。');
    }
    return { captureId: record.captureId, phase: record.phase, target: { ...record.target },
      payload: record.payload, preview: record.preview, icon: record.icon,
      server: record.server, ownerId: record.ownerId, createdAt: record.createdAt };
  }

  async function submitDraft({ draftId, form = {}, connection }) {
    if (!connection?.server || !connection.user?.id) throw new Error('请先连接工作台再收藏。');
    const record = await requireDraft(draftId);
    if (record.server && (record.server !== connection.server || record.ownerId !== ownerOf(connection))) {
      throw new Error('该草稿属于另一账号或服务器，请从工具栏重新打开收藏。');
    }
    const payload = buildPayload({ form, target: record.target, captureId: record.captureId });
    const next = { ...record, phase: 'local_saved', server: connection.server, ownerId: ownerOf(connection),
      payload, fingerprint: fingerprint(payload), attempts: 0, nextAttemptAt: now(), lastError: '',
      lastErrorCode: '', lease: null };
    // 已取得的原始快照必须保留：它与文字草稿同一个 captureId、同事务落盘。
    // 关闭弹窗/重启后由后台 worker 压缩并上传；绝不因为「用户存得快」就静默丢图。
    // 原始快照有界（MAX_RAW_PREVIEW_BYTES），压缩成功即原子清除，失败有界重试。
    await put(next);
    return next;
  }

  const { setRawPreview, compressPendingRaw } = createRawPreviewHelper({ store, load, put,
    compressAsset, estimateBytes, newId, now, keyOf });

  /** 兼容旧 popup 的 {type:'capture'}：同一 Outbox 收编完整 payload。 */
  async function adoptPayload(capture = {}, connection) {
    if (!connection?.server || !connection.user?.id) throw new Error('请先连接工作台再收藏。');
    if (!UUID.test(String(capture.clientCaptureId || ''))) throw new Error('收藏标识必须为 UUID。');
    const payload = buildPayload({ form: capture, target: { url: capture.url, title: capture.title,
      description: capture.description, descriptionSource: capture.descriptionSource, scope: capture.scope },
      captureId: capture.clientCaptureId });
    const record = { captureId: capture.clientCaptureId, server: connection.server, ownerId: ownerOf(connection),
      schemaVersion: OUTBOX_SCHEMA, phase: 'local_saved', target: { url: payload.url, title: payload.title,
        description: payload.description, descriptionSource: payload.descriptionSource, scope: payload.scope },
      payload, fingerprint: fingerprint(payload), receipt: null, preview: null, icon: null,
      attempts: 0, nextAttemptAt: now(), assetNextAttemptAt: 0, lastError: '', lastErrorCode: '',
      lease: null, needsUserAction: false, createdAt: now(), updatedAt: now(), migratedFrom: null };
    await put(record);
    return record;
  }

  /** 页面内压缩成功后：原子地用压缩 Blob 替换原始快照，原始快照立即清除。 */
  async function compressAsset({ draftId, kind = 'preview', dataUrl, bytes, width = null, height = null }) {
    const snap = await load();
    const record = snap.captures[keyOf(draftId)];
    if (!record) throw new Error('草稿不存在。');
    const field = kind === 'icon' ? 'icon' : 'preview';
    const asset = record[field];
    if (!asset) throw new Error('该素材不存在。');
    const blobId = newId();
    const blobPut = [[blobId, { id: blobId, kind, dataUrl, bytes, width, height, createdAt: now() }]];
    const blobDelete = [asset.rawBlobId, asset.blobId].filter(Boolean);
    const next = { ...record, [field]: { ...asset, state: 'ready', blobId, rawBlobId: null,
      displayUrl: dataUrl, bytes, width, height, compressedAt: now() } };
    await store.commit({ capturePut: [[keyOf(draftId), { ...next, updatedAt: now() }]], blobPut, blobDelete });
    return next[field];
  }

  /** 用户明确取消素材：删除 Blob，保留已确认文字。 */
  async function cancelAsset(captureId, kind = 'preview') {
    const snap = await load();
    const record = snap.captures[keyOf(captureId)];
    if (!record) return;
    const field = kind === 'icon' ? 'icon' : 'preview';
    const asset = record[field];
    if (!asset) return;
    const blobDelete = [asset.rawBlobId, asset.blobId].filter(Boolean);
    const next = { ...record, [field]: { ...asset, state: 'cancelled', blobId: null, rawBlobId: null } };
    await store.commit({ capturePut: [[keyOf(captureId), { ...next, updatedAt: now() }]], blobDelete });
  }

  /** 单一 flush：文字幂等提交 -> 记录回执与两条基线 -> 逐附件条件上传（同事务释放 Blob）。 */
  async function flush(connection = null) {
    const conn = connection || await readConnection?.();
    if (!conn || conn.paused || Date.parse(conn.expiresAt) <= now()) return { processed: 0, paused: true };
    const snap = await load();
    let processed = 0, paused = false;
    for (const record of Object.values(snap.captures)) {
      if (!sameOwner(record, conn)) continue;
      const eligible = SUBMITTABLE.has(record.phase);
      const due = record.nextAttemptAt <= now() && record.assetNextAttemptAt <= now();
      if (!eligible || !due) continue;
      if (record.lease && record.lease.until > now()) continue;
      await put({ ...record, lease: { owner: workerId, until: now() + LEASE_MS } });
      let current = record;
      // 文字阶段
      if (!record.receipt) {
        try {
          const result = await request('/api/extension/v2/captures', { ...conn, method: 'POST', body: record.payload });
          if (!result?.site?.id) throw new Error('服务器尚未确认保存，稍后重试。');
          const confirmed = receiptOf(result);
          current = { ...applyBaselines({ ...current, receipt: confirmed, lease: null,
            attempts: 0, nextAttemptAt: 0, lastError: '', lastErrorCode: '' }, confirmed),
            phase: 'complete' };
          await put(current); // 先记录回执与文字完成，确认成功但本地未写回时重启重发仍幂等
        } catch (error) {
          const plan = classifyError(error, record.attempts, now());
          await put({ ...record, phase: plan.phase, lease: null, attempts: record.attempts + 1,
            nextAttemptAt: now() + plan.delay, lastError: String(error.message || '同步失败').slice(0, 300),
            lastErrorCode: plan.kind });
          if (plan.kind === 'auth') { paused = true; break; }
          continue;
        }
      }
      // 附件阶段：有条件写上传；成功才释放 Blob
      const hasReady = ['preview', 'icon'].some(kind => current[kind]
        && ['ready', 'uploading'].includes(current[kind].state) && current[kind].blobId);
      if (hasReady) {
        const outcome = await uploadReadyAssets({ record: current, connection: conn, store, request, now, toBlob });
        current = outcome.record;
        const conflict = ['preview', 'icon'].some(kind => current[kind]?.state === 'conflict');
        current = { ...current, needsUserAction: conflict || current.needsUserAction,
          phase: outcome.needsAuth ? 'needs_auth' : assetsTerminal(current) ? 'complete' : 'uploading_assets' };
        await store.commit({ capturePut: [[keyOf(current.captureId), { ...current, updatedAt: now(), lease: null }]],
          blobDelete: outcome.blobDeletes });
        if (outcome.needsAuth) { paused = true; break; }
      } else {
        // 文字已确认且无待上传附件：把 creating_site/重试态收敛为 complete（服务端确认成功但本地未写回的场景）。
        const conflict = ['preview', 'icon'].some(kind => current[kind]?.state === 'conflict');
        current = { ...current, phase: current.receipt ? 'complete' : current.phase,
          needsUserAction: conflict || current.needsUserAction, lease: null };
        await put(current);
      }
      processed++;
    }
    if (paused && writeConnection) {
      await writeConnection({ ...conn, paused: true, pauseReason: '凭据失效，请用原账号重新配对。' });
    }
    return { processed, paused };
  }

  async function status(connection = null) {
    const conn = connection || await readConnection?.();
    const snap = await load();
    const queue = [], assetJobs = [];
    let current = 0, other = 0;
    for (const record of Object.values(snap.captures)) {
      if (['draft', 'complete', 'cancelled'].includes(record.phase)) continue;
      if (sameOwner(record, conn)) current++; else other++;
      queue.push(queueItem(record));
      if (record.preview || record.icon) assetJobs.push({ captureId: record.captureId,
        preview: Boolean(record.preview), icon: Boolean(record.icon) });
    }
    return { queue, summary: { current, other, total: current + other }, assetJobs,
      lastResult: null, schemaVersion: snap.schemaVersion, migration: snap.meta.migration || null };
  }

  async function record(captureId) { return (await load()).captures[keyOf(captureId)] || null; }
  async function cancel(captureId) {
    const rec = await record(captureId);
    if (rec) await put({ ...rec, phase: 'cancelled', lease: null, nextAttemptAt: 0 });
  }
  async function retry(captureId, connection = null) {
    const conn = connection || await readConnection?.();
    const rec = await record(captureId);
    if (!rec || !sameOwner(rec, conn)) return;
    if (!['waiting_network', 'failed', 'needs_auth', 'conflict', 'uploading_assets'].includes(rec.phase)) return;
    await put({ ...rec, phase: 'local_saved', attempts: 0, nextAttemptAt: now(), assetNextAttemptAt: 0,
      lease: null, lastError: '', lastErrorCode: '', needsUserAction: false });
  }
  async function remove(ids = []) {
    const snap = await load();
    const keys = ids.filter(id => snap.captures[keyOf(id)]);
    const blobIds = keys.flatMap(id => { const r = snap.captures[keyOf(id)];
      return [r.preview?.rawBlobId, r.preview?.blobId, r.icon?.rawBlobId, r.icon?.blobId]; }).filter(Boolean);
    await store.commit({ captureDelete: keys, blobDelete: blobIds });
  }
  async function prune() {
    const snap = await load();
    const captureDelete = [], blobDelete = [];
    for (const rec of Object.values(snap.captures)) {
      const age = now() - rec.updatedAt;
      if ((rec.phase === 'draft' && age > DRAFT_TTL)
          || (['complete', 'cancelled'].includes(rec.phase) && age > DONE_TTL)) {
        captureDelete.push(rec.captureId);
        for (const a of [rec.preview, rec.icon]) if (a) {
          if (a.rawBlobId) blobDelete.push(a.rawBlobId);
          if (a.blobId) blobDelete.push(a.blobId);
        }
      }
    }
    if (captureDelete.length) await store.commit({ captureDelete, blobDelete });
  }
  async function resumeOwner(connection = null) {
    const conn = connection || await readConnection?.();
    const capturePut = Object.values((await load()).captures)
      .filter(rec => sameOwner(rec, conn) && rec.phase === 'needs_auth')
      .map(rec => [keyOf(rec.captureId), { ...rec, phase: 'local_saved', attempts: 0,
        nextAttemptAt: now(), assetNextAttemptAt: 0, lease: null, lastError: '',
        lastErrorCode: '', needsUserAction: false }]);
    if (capturePut.length) await store.commit({ capturePut });
    return capturePut.length;
  }
  async function retryAll(connection = null) {
    const conn = connection || await readConnection?.();
    const capturePut = Object.values((await load()).captures)
      .filter(rec => sameOwner(rec, conn) && ['waiting_network', 'failed', 'conflict', 'needs_auth', 'uploading_assets'].includes(rec.phase))
      .map(rec => [keyOf(rec.captureId), { ...rec, phase: 'local_saved', attempts: 0,
        nextAttemptAt: now(), assetNextAttemptAt: 0, lease: null, lastError: '',
        lastErrorCode: '', needsUserAction: false }]);
    if (capturePut.length) await store.commit({ capturePut });
    return capturePut.length;
  }
  async function removeAttachment(captureId, kind = 'preview') { await cancelAsset(captureId, kind); }
  return { openDraft, getDraft, submitDraft, adoptPayload, compressAsset, cancelAsset, flush, status,
    setRawPreview, compressPendingRaw, record, cancel, retry, remove, prune, resumeOwner, retryAll, removeAttachment };
}
