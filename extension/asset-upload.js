// 阶段 C 素材条件上传的纯逻辑：把 Outbox 记录里的附件按「独立 revision + 来源指纹」
// 条件写上传到 v3 端点。成功确认才释放 Blob；冲突/换图/删图/来源变化保留 Blob 并暂停。
export { dataUrlToBlob } from './capture-compress.js';

export function classifyAssetError(error) {
  const status = Number(error?.status) || 0;
  const code = String(error?.code || '');
  // 只有 401 是凭据失效；403（无附件许可/回执被拒）是单次冲突，绝不暂停整个连接。
  if (status === 401) return { kind: 'auth', needsAuth: true, conflict: false, retry: false, delay: 0 };
  if (status === 403) return { kind: 'forbidden', needsAuth: false, conflict: true, retry: false, delay: 0 };
  if (status === 409 || ['asset_conflict', 'asset_source_changed', 'idempotency_conflict',
    'version_conflict', 'preview_source_changed'].includes(code)) {
    return { kind: 'conflict', needsAuth: false, conflict: true, retry: false, delay: 0 };
  }
  if (status === 429) return { kind: 'rate', needsAuth: false, conflict: false, retry: true,
    delay: Math.max(30_000, Number(error?.retryAfter) * 1000 || 0) };
  if (status === 0 || status === 408 || status === 425 || status >= 500) {
    return { kind: 'network', needsAuth: false, conflict: false, retry: true, delay: 0 };
  }
  return { kind: 'permanent', needsAuth: false, conflict: true, retry: false, delay: 0 };
}

/** 构造 v3 条件写表单：expectedAssetRevision 用基线（'absent' 或 revision），绝不 lookup 猜版本。 */
export function buildAssetForm({ asset, baseline, kind, blob, sourceUrl, capturedAt }) {
  const form = new FormData();
  form.append('clientAssetId', String(asset.assetId));
  form.append('expectedAssetRevision', baseline?.revision || 'absent');
  form.append('expectedSourceFingerprint', baseline?.sourceFingerprint || '');
  form.append('sourceUrl', String(sourceUrl || ''));
  if (kind === 'preview') {
    form.append('sourceEndpointId', '');
    form.append('pageKind', 'current');
    form.append('homepageUrl', '');
    form.append('userConfirmedHomepage', 'false');
    form.append('capturedAt', new Date(Number(capturedAt) || Date.now()).toISOString());
  }
  form.append('file', blob, kind === 'preview' ? 'preview.webp' : 'icon.webp');
  return form;
}
