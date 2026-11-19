// Outbox 纯函数：稳定的取值的模型，不含 IO。便于回归与压缩 outbox.js 行数。
import { OUTBOX_SCHEMA } from './outbox-store.js';
import { cleanDescription } from './queue.js';
export { OUTBOX_SCHEMA };

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAX_ATTEMPTS = 12;
export const LEASE_MS = 30_000;
export const DRAFT_TTL = 30 * 60 * 1000;
export const DONE_TTL = 24 * 60 * 60 * 1000;
export const SUBMITTABLE = new Set(['local_saved', 'waiting_network', 'creating_site', 'uploading_assets']);
export const ownerOf = connection => String(connection?.user?.id ?? '');
export const sameOwner = (record, connection) => !!connection && record.server === connection.server
  && record.ownerId === ownerOf(connection);

export function fingerprint(payload) {
  const text = JSON.stringify(payload);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildPayload({ form = {}, target = {}, captureId }) {
  const value = (raw, max) => String(raw || '').trim().slice(0, max);
  return {
    clientCaptureId: captureId,
    url: String(target.url || ''),
    title: value(form.title ?? target.title, 100),
    description: cleanDescription(form.description ?? target.description),
    descriptionSource: target.descriptionSource === 'page_meta' ? 'page_meta' : 'manual',
    purpose: value(form.purpose, 1000),
    notes: value(form.notes, 2000),
    category: value(form.category, 100),
    tags: [], collectionIds: [], pinned: false,
    later: form.later === true,
    homepageUrl: '',
    scope: target.scope || '公网',
    updateFields: [], updateExisting: false, appendNotes: false,
    // 阶段 D：用户未拒绝时由服务端在后台登记缺图补齐 Job；false 表示这次不自动补图。
    autoIcon: form.autoIcon !== false,
  };
}

export function classifyError(error, attempts, now = Date.now()) {
  const status = Number(error?.status) || 0;
  const code = String(error?.code || '');
  if (status === 401 || status === 403) return { phase: 'needs_auth', kind: 'auth', delay: 0 };
  if (status === 409 || code === 'idempotency_conflict') return { phase: 'conflict', kind: 'conflict', delay: 0 };
  if (status === 429) return { phase: 'waiting_network', kind: 'rate_limited',
    delay: Math.min(Math.max(30, Number(error?.retryAfter) || 0) * 1000, 3_600_000) };
  if (status >= 400 && status < 500) return { phase: 'failed', kind: 'permanent', delay: 0 };
  if (attempts + 1 >= MAX_ATTEMPTS) return { phase: 'failed', kind: 'exhausted', delay: 0 };
  return { phase: 'waiting_network', kind: 'network',
    delay: Math.min(60_000 * 2 ** Math.min(attempts, 6), 3_600_000) };
}

export function displayState(phase) {
  return ({ local_saved: 'pending', creating_site: 'pending', waiting_network: 'pending',
    uploading_assets: 'preview_pending', needs_auth: 'auth', conflict: 'conflict', failed: 'blocked',
    cancelled: 'cancelled' })[phase] || phase;
}

export function receiptOf(result) {
  const site = result?.site || {};
  return { siteId: site.id || null, siteVersion: Number.isInteger(site.version) ? site.version : null,
    duplicate: result?.duplicate === true, outcome: result?.outcome || (result?.duplicate ? 'existing' : 'created'),
    category: site.category || '', inbox: site.inbox === true,
    canAttachPreview: result?.canAttachPreview === true, canAttachIcon: result?.canAttachIcon === true,
    previewBaseline: site.previewBaseline || result?.previewBaseline || null,
    iconBaseline: site.iconBaseline || result?.iconBaseline || null,
    iconJob: site.iconJob || result?.iconJob || null };
}

export function queueItem(record) {
  return { id: record.captureId, server: record.server, userId: record.ownerId,
    state: displayState(record.phase),
    payload: { title: record.payload?.title || record.target?.title || '',
      url: record.payload?.url || record.target?.url || '' },
    lastError: record.lastError || '', attachment: record.preview || null,
    iconAttachment: record.icon || null, needsUserAction: record.needsUserAction === true };
}
