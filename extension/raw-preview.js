// 原始截图快照的例外恢复与后台压缩：与 outbox.js 共用同一 store 事务边界。
// 单独成模块保持每个源码文件 ≤300 行；不引入第二套状态。
export function createRawPreviewHelper({ store, load, put, compressAsset, estimateBytes, newId, now, keyOf }) {

  /** 「重新截图」：只在原标签仍可确认时由后台调用，同一个 captureId 写入有界原始快照。 */
  async function setRawPreview({ draftId, rawPreview, sourceUrl = '' }) {
    const snap = await load();
    const record = snap.captures[keyOf(draftId)];
    if (!record) throw new Error('草稿不存在，无法重新截图。');
    if (record.preview && ['uploaded', 'uploading', 'conflict'].includes(record.preview.state))
      throw new Error('已有截图正在同步或已入库，不覆盖。');
    const rawBlobId = newId();
    const blobPut = [[rawBlobId, { id: rawBlobId, kind: 'raw-preview', dataUrl: rawPreview,
      bytes: estimateBytes(rawPreview), createdAt: now() }]];
    const blobDelete = [record.preview?.rawBlobId, record.preview?.blobId].filter(Boolean);
    const next = { ...record, preview: { state: 'raw', rawBlobId, blobId: null,
      assetId: record.preview?.assetId || newId(), displayUrl: rawPreview,
      sourceUrl: sourceUrl || record.target?.url || '', bytes: estimateBytes(rawPreview),
      width: null, height: null, baseline: record.preview?.baseline || null,
      assetRevision: null, compressedAt: null, compressAttempts: 0 } };
    await store.commit({ capturePut: [[keyOf(draftId), { ...next, updatedAt: now() }]], blobPut, blobDelete });
    return next.preview;
  }

  /** 后台 worker 压缩：把仍为 raw 的原始快照压成有界 WebP（同事务清除原始 Blob）。
   *  compress 由注入（service worker 用 OffscreenCanvas，Node 回归用夹具），失败有界重试不无限循环。 */
  async function compressPendingRaw(compress) {
    const snap = await load();
    let done = 0;
    for (const record of Object.values(snap.captures)) {
      const preview = record.preview;
      if (!preview || preview.state !== 'raw' || !preview.rawBlobId) continue;
      if ((preview.compressAttempts || 0) >= 3) continue; // 有界重试，避免 worker 不支持时无限循环
      const blobRecord = snap.blobs[preview.rawBlobId];
      if (!blobRecord?.dataUrl) continue;
      let result = null;
      try { result = await compress(blobRecord.dataUrl); } catch { result = null; }
      if (result?.dataUrl) {
        await compressAsset({ draftId: record.captureId, kind: 'preview', dataUrl: result.dataUrl,
          bytes: result.bytes, width: result.width, height: result.height });
        done++;
      } else {
        const next = { ...record, preview: { ...preview, compressAttempts: (preview.compressAttempts || 0) + 1 } };
        await put(next);
      }
    }
    return done;
  }

  return { setRawPreview, compressPendingRaw };
}
