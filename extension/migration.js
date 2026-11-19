// 旧四套状态（queue / assetJobs / iconTasks / captureReceipts）→ 单一 Outbox 的迁移。
// 纯计划函数便于在独立副本上先验证；apply 在单个事务里写入记录 + schemaVersion + 迁移标记。
// 旧 chrome.storage 与旧 IndexedDB 附件库绝不删除：迁移失败保持旧数据可恢复。
import { OUTBOX_SCHEMA, fingerprint } from './outbox.js';

const ownerOf = item => String(item.userId ?? '');
const identity = item => `${item.server}|${ownerOf(item)}`;

function pendingRecord(item, now) {
  const payload = { ...item.payload };
  return {
    captureId: payload.clientCaptureId, server: item.server, ownerId: ownerOf(item),
    schemaVersion: OUTBOX_SCHEMA, phase: 'local_saved',
    target: { url: payload.url, title: payload.title, description: payload.description || '',
      descriptionSource: payload.descriptionSource || 'manual', scope: payload.scope || '公网' },
    payload, fingerprint: fingerprint(payload), receipt: null,
    preview: null, icon: null, attempts: 0, nextAttemptAt: now, lastError: '',
    lastErrorCode: '', lease: null, needsUserAction: false,
    createdAt: item.createdAt || now, updatedAt: now, migratedFrom: 'legacy',
  };
}

/** 把旧队列状态映射到新阶段：冲突/认证失效/拒绝/取消绝不迁成可自动提交。 */
export function planMigration({ queue = [], assetJobs = [], captureReceipts = {}, iconTasks = [],
  blobIndex = {}, now = Date.now() } = {}) {
  const records = [], warnings = [], blobChecks = [], seen = new Set();
  for (const item of queue) {
    const cid = item.payload?.clientCaptureId;
    if (!cid || seen.has(cid)) { warnings.push(`跳过无标识或重复的旧任务 ${item.id || ''}`); continue; }
    seen.add(cid);
    const rec = pendingRecord(item, now);
    const state = item.state;
    if (state === 'auth') { rec.phase = 'needs_auth'; rec.needsUserAction = true; rec.lastError = item.lastError || '凭据失效'; }
    else if (['blocked', 'conflict'].includes(state)) {
      rec.phase = 'conflict'; rec.needsUserAction = true; rec.lastError = item.lastError || '资料冲突，需用户确认';
    } else if (state === 'cancelled') { rec.phase = 'cancelled'; }
    else if (state === 'preview_pending' || item.siteId) {
      // 文字已入库：用旧回执补 receipt，标记 complete，避免重新建站；附件留给后续阶段处理。
      const receipt = captureReceipts[cid];
      rec.phase = 'complete';
      rec.receipt = { siteId: item.siteId || receipt?.siteId || null,
        siteVersion: item.siteVersion ?? receipt?.siteVersion ?? null,
        duplicate: true, outcome: 'existing', category: '', inbox: false,
        canAttachPreview: receipt?.canAttachPreview === true, canAttachIcon: receipt?.canAttachIcon === true };
    }
    // 附件：仅登记引用与基线，不把 Blob 内容搬进记录；缺失则在 warnings 里明确，deferred。
    for (const [kind, source] of [['preview', item.attachment], ['icon', item.iconAttachment]]) {
      if (!source) continue;
      const info = blobIndex[source.id];
      const asset = { blobId: source.id, bytes: source.bytes || info?.bytes || 0,
        sourceUrl: source.sourceUrl || '', displayUrl: source.sourceUrl || '',
        baselineRevision: null, uploaded: false, state: 'retained', deferred: true };
      if (!info) warnings.push(`旧附件 Blob ${source.id} 未找到，保留引用但需用户处理`);
      else blobChecks.push({ id: source.id, bytes: info.bytes, digest: info.digest || null });
      rec[kind] = asset;
    }
    // 合并旧 assetJobs 的图标引用（不新建第四套状态，只补进同一记录）。
    const job = assetJobs.find(value => value.captureId === cid);
    if (job?.iconAttachment && !rec.icon) {
      rec.icon = { blobId: job.iconAttachment.id, bytes: job.iconAttachment.bytes || 0,
        sourceUrl: job.iconAttachment.sourceUrl || '', displayUrl: job.iconAttachment.sourceUrl || '',
        baselineRevision: job.iconRevision || null, uploaded: false, state: 'retained', deferred: true };
    }
    records.push(rec);
  }
  const identities = queue.map(identity);
  const verification = {
    sourceCount: queue.length, migratedCount: records.length,
    identities, assetJobCount: assetJobs.length, iconTaskCount: iconTasks.length,
    blobCount: blobChecks.length,
    blobDigests: Object.fromEntries(blobChecks.map(check => [check.id, check.digest])),
  };
  return { records, warnings, blobChecks, verification, plannedAt: now };
}

/** 在独立副本上核对：任务数量、身份、Blob 摘要。任一不符返回 ok:false，绝不标记迁移完成。 */
export function verifyMigration(plan, { queue = [], blobIndex = {} } = {}) {
  const v = plan.verification;
  if (v.sourceCount !== queue.length) return { ok: false, reason: `任务数量不符：计划 ${v.sourceCount}，副本 ${queue.length}` };
  const planIds = plan.records.map(rec => `${rec.server}|${rec.ownerId}`).sort();
  const copyIds = queue.map(identity).sort();
  if (JSON.stringify(planIds) !== JSON.stringify(copyIds)) {
    return { ok: false, reason: '任务身份(server+owner)不符' };
  }
  for (const check of plan.blobChecks) {
    const info = blobIndex[check.id];
    if (!info || (info.digest && check.digest && info.digest !== check.digest)) {
      return { ok: false, reason: `Blob 摘要不符：${check.id}` };
    }
  }
  return { ok: true, reason: '' };
}

/** 原子写入：所有记录 + schemaVersion + 迁移标记一次性 commit；失败整体回滚，旧数据不动。 */
export async function applyMigration(store, plan, now = Date.now()) {
  await store.commit({
    capturePut: plan.records.map(rec => [rec.captureId, rec]),
    metaPut: [
      ['schemaVersion', OUTBOX_SCHEMA],
      ['migration', { at: now, schemaVersion: OUTBOX_SCHEMA, sourceCount: plan.verification.sourceCount,
        migratedCount: plan.verification.migratedCount, blobCount: plan.verification.blobCount,
        warnings: plan.warnings }],
    ],
  });
}
