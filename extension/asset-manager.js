// 阶段 C：附件独立阶段机。按「独立 revision + 来源指纹」条件写上传，
// 服务端确认才释放 Blob；换图/删图/来源变化/幂等冲突 -> conflict 保留，网络/429 有界退避，401 暂停。
import { buildAssetForm, classifyAssetError } from './asset-upload.js';

const KINDS = ['preview', 'icon'];
const TERMINAL = new Set(['uploaded', 'conflict', 'cancelled', 'skipped']);

/** 文字回执确认后，把两条素材基线写进各自附件子状态（不反向改写文字阶段）。
 *  重复收藏（canAttachPreview/canAttachIcon=false）默认不覆盖图片：对应素材直接标跳过、不上传。 */
export function applyBaselines(record, receipt) {
  const base = kind => receipt?.[`${kind}Baseline`] || { present: false, revision: null, sourceFingerprint: '' };
  let changed = false;
  const next = { ...record };
  for (const kind of KINDS) {
    const asset = record[kind];
    if (!asset || asset.state === 'cancelled') continue;
    const allowed = kind === 'preview' ? receipt?.canAttachPreview === true : receipt?.canAttachIcon === true;
    if (!allowed) { next[kind] = { ...asset, state: 'skipped' }; changed = true; continue; }
    next[kind] = { ...asset, baseline: base(kind) };
    changed = true;
  }
  return changed ? next : record;
}

export function assetsTerminal(record) {
  return KINDS.every(kind => !record[kind] || TERMINAL.has(record[kind].state)
    || !['ready', 'uploading'].includes(record[kind].state));
}

/**
 * 逐附件条件上传。返回 { record, blobDeletes, needsAuth }；调用方负责在同一事务里
 * 提交 record 与 blobDeletes，保证「确认成功」与「释放 Blob」原子一致。
 */
export async function uploadReadyAssets({ record, connection, store, request, now, toBlob }) {
  let current = record;
  const blobDeletes = [];
  let needsAuth = false;
  for (const kind of KINDS) {
    const asset = current[kind];
    if (!asset || !['ready', 'uploading'].includes(asset.state) || !asset.blobId) continue;
    const blobRecord = (await store.load()).blobs[asset.blobId];
    if (!blobRecord?.dataUrl) { current = setAsset(current, kind, asset, { state: 'conflict' }, now); continue; }
    const form = buildAssetForm({ asset, baseline: asset.baseline, kind,
      blob: toBlob(blobRecord.dataUrl), sourceUrl: asset.sourceUrl,
      capturedAt: current.target?.capturedAt });
    const path = `/api/extension/v3/captures/${current.captureId}/${kind}`;
    try {
      const result = await request(path, { ...connection, method: 'POST', form });
      if (!result?.status || result.status !== 'complete') throw new Error('服务器尚未确认素材');
      current = setAsset(current, kind, asset, { state: 'uploaded', blobId: null,
        assetRevision: result.assetRevision || result.revision || null }, now);
      blobDeletes.push(asset.blobId);
    } catch (error) {
      const plan = classifyAssetError(error);
      if (plan.needsAuth) { needsAuth = true; current = setAsset(current, kind, asset, { state: 'ready' }, now); break; }
      if (plan.conflict) { current = setAsset(current, kind, asset, { state: 'conflict' }, now); }
      else { current = setAsset(current, kind, asset, { state: 'ready' }, now);
        current = { ...current, assetNextAttemptAt: now() + Math.max(plan.delay, 60_000) }; }
    }
  }
  return { record: current, blobDeletes, needsAuth };
}

function setAsset(record, kind, asset, changes, now) {
  return { ...record, [kind]: { ...asset, ...changes }, updatedAt: now() };
}
