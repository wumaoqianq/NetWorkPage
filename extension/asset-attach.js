/**
 * 持久化素材任务：文字与素材解耦。
 * 关键约束：文字未确认时只登记引用，绝不改写文字队列状态；联网失败保留 Blob 和任务，
 * 只有服务端确认成功或用户明确取消才删除本地素材。
 */
export const ASSET_JOB_SCHEMA = 1;
export const ASSET_JOB_STATES = Object.freeze(['pending', 'uploading', 'retryable', 'failed', 'conflict', 'done']);
const BACKOFF = [0, 30_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

export const assetJobKey = (server, userId, captureId) => `${server}|${String(userId)}|${captureId}`;

export function normalizeAssetJob(raw = {}) {
  const attempts = Number.isFinite(Number(raw.attempts)) ? Math.max(0, Math.trunc(Number(raw.attempts))) : 0;
  const state = ASSET_JOB_STATES.includes(raw.state) ? raw.state : 'pending';
  return {
    schemaVersion: ASSET_JOB_SCHEMA,
    captureId: String(raw.captureId || ''),
    server: String(raw.server || ''),
    userId: String(raw.userId || ''),
    savedUrl: String(raw.savedUrl || ''),
    siteId: raw.siteId ? String(raw.siteId) : null,
    siteVersion: Number.isInteger(raw.siteVersion) ? raw.siteVersion : null,
    attachment: raw.attachment && typeof raw.attachment === 'object' ? raw.attachment : null,
    iconAttachment: raw.iconAttachment && typeof raw.iconAttachment === 'object' ? raw.iconAttachment : null,
    previewUploaded: raw.previewUploaded === true,
    iconUploaded: raw.iconUploaded === true,
    previewBlocked: raw.previewBlocked === true,
    iconBlocked: raw.iconBlocked === true,
    previewRevision: raw.previewRevision ? String(raw.previewRevision) : null,
    iconRevision: raw.iconRevision ? String(raw.iconRevision) : null,
    state,
    attempts,
    nextAttemptAt: Number(raw.nextAttemptAt) || 0,
    lastError: raw.lastError ? String(raw.lastError).slice(0, 300) : '',
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

export function findAssetJob(jobs, captureId) {
  return (jobs || []).find(job => job.captureId === captureId) || null;
}

/** 只合并附件引用，绝不触碰 queue/文字状态。 */
export function mergeAssetJob(existing, message, { server, userId, savedUrl = '', now = Date.now() } = {}) {
  const job = normalizeAssetJob(existing || { captureId: message.captureId, server, userId, savedUrl,
    createdAt: now, updatedAt: now });
  return {
    ...job,
    server: job.server || server,
    userId: job.userId || String(userId || ''),
    savedUrl: job.savedUrl || savedUrl,
    attachment: message.attachment ? { ...(job.attachment || {}), ...message.attachment } : job.attachment,
    iconAttachment: message.iconAttachment ? { ...(job.iconAttachment || {}), ...message.iconAttachment } : job.iconAttachment,
    state: job.state === 'done' ? 'pending' : job.state,
    updatedAt: now,
  };
}

export function applyCaptureReceipt(job, receipt, { canAttachPreview = true, canAttachIcon = true, now = Date.now() } = {}) {
  if (!receipt?.siteId || !Number.isInteger(receipt.siteVersion)) return job;
  return {
    ...job,
    siteId: String(receipt.siteId),
    siteVersion: receipt.siteVersion,
    previewRevision: receipt.previewRevision ? String(receipt.previewRevision) : job.previewRevision,
    iconRevision: receipt.iconRevision ? String(receipt.iconRevision) : job.iconRevision,
    previewBlocked: job.attachment && !canAttachPreview ? true : job.previewBlocked,
    iconBlocked: job.iconAttachment && !canAttachIcon ? true : job.iconBlocked,
    state: job.state === 'done' ? job.state : 'pending',
    updatedAt: now,
  };
}

export function hasPendingAssets(job) {
  return Boolean((job.attachment && !job.previewUploaded && !job.previewBlocked)
    || (job.iconAttachment && !job.iconUploaded && !job.iconBlocked));
}

export function isAssetJobComplete(job) {
  return !job.attachment && !job.iconAttachment;
}

export function nextAssetAttempt(attempts, now = Date.now(), retryAfter = 0) {
  const backoff = BACKOFF[Math.min(Math.max(0, attempts), BACKOFF.length - 1)] || 0;
  return now + Math.max(backoff, Number(retryAfter) * 1000 || 0);
}

/** 网络/超时/5xx/429 可重试；认证暂停但保留 Blob；409 可刷新版本；其余 4xx 终态失败。 */
export function classifyAssetError(error) {
  const status = Number(error?.status) || 0;
  const code = String(error?.code || '');
  if (status === 401) return { kind: 'auth', retryable: true, retryAfter: 3600 };
  // 403 是单次权限/回执许可问题，不应暂停整个账号连接；保留 Blob 供用户处理。
  if (status === 403) return { kind: 'permission', retryable: false, retryAfter: 0 };
  if (status === 409) {
    if (code === 'version_conflict') return { kind: 'version_conflict', retryable: true, retryAfter: 30, code };
    if (['preview_source_changed', 'icon_source_changed', 'source_changed'].includes(code)) {
      return { kind: 'source_changed', retryable: false, retryAfter: 0, code };
    }
    if (code === 'idempotency_conflict') return { kind: 'idempotency_conflict', retryable: false, retryAfter: 0, code };
    return { kind: 'conflict', retryable: false, retryAfter: 0, code };
  }
  if (status === 429) return { kind: 'rate_limited', retryable: true, retryAfter: Math.max(30, Number(error?.retryAfter) || 0) };
  if (status === 0 || status === 408 || status === 425 || status >= 500) return { kind: 'network', retryable: true, retryAfter: 0 };
  if (status >= 400 && status < 500) return { kind: 'permanent', retryable: false, retryAfter: 0 };
  return { kind: 'network', retryable: true, retryAfter: 0 };
}

export function markAssetFailure(job, kind, error, now = Date.now()) {
  const plan = classifyAssetError(error);
  const attempts = job.attempts + 1;
  const nextAttemptAt = plan.retryable ? nextAssetAttempt(attempts, now, plan.retryAfter) : 0;
  const conflict = ['source_changed', 'idempotency_conflict', 'conflict'].includes(plan.kind);
  const changes = {
    attempts,
    state: plan.retryable ? 'retryable' : conflict ? 'conflict' : 'failed',
    lastError: String(error?.message || '素材上传失败').slice(0, 300),
    nextAttemptAt,
    updatedAt: now,
  };
  if (plan.kind === 'permanent' || conflict) changes[`${kind}Blocked`] = true;
  return { ...job, ...changes, lastErrorCode: plan.kind };
}

/** 服务端确认成功后才移除引用；Blob 由调用方在同一确认点删除。 */
export function markAssetUploaded(job, kind, result, now = Date.now()) {
  return {
    ...job,
    siteVersion: Number.isInteger(result?.siteVersion) ? result.siteVersion : job.siteVersion,
    [`${kind}Uploaded`]: true,
    [kind === 'icon' ? 'iconAttachment' : 'attachment']: null,
    [`${kind}Revision`]: result?.revision ? String(result.revision) : job[`${kind}Revision`],
    attempts: 0,
    nextAttemptAt: 0,
    lastError: '',
    state: 'pending',
    updatedAt: now,
  };
}
