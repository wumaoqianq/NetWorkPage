import { applyCaptureReceipt, findAssetJob, mergeAssetJob, normalizeAssetJob } from './asset-attach.js';

/** 接收迟到的素材引用：只写独立素材任务，不改变文字队列状态。 */
export function createAssetIntake({ attachments, write, now = Date.now }) {
  const jobsOf = state => (state.assetJobs || []).map(normalizeAssetJob);
  const receiptsOf = state => state.captureReceipts || {};
  const setJobs = (state, jobs) => { state.assetJobs = jobs; };
  async function attach(message, state) {
    const connection = state.connection;
    if (!connection) throw new Error('请先连接工作台，素材会在连接后重试。');
    if (!message.captureId) throw new Error('缺少 capture ID');
    if (!message.attachment && !message.iconAttachment) return;
    const captureId = String(message.captureId);
    const jobs = jobsOf(state);
    let job = mergeAssetJob(findAssetJob(jobs, captureId), message, { server: connection.server,
      userId: connection.user.id, savedUrl: message.savedUrl || '', now: now() });
    for (const [kind, source] of [['preview', job.attachment], ['icon', job.iconAttachment]]) {
      if (!source) continue;
      const record = attachments ? await attachments.get(source.id) : null;
      if (!record || record.server !== connection.server || String(record.userId) !== String(connection.user.id)
          || record.captureId !== captureId || (record.kind && record.kind !== kind)) {
        throw new Error(`${kind === 'icon' ? '图标' : '截图'}草稿已丢失，请重新采集。`);
      }
    }
    const receipt = receiptsOf(state)[captureId];
    if (receipt) job = applyCaptureReceipt(job, receipt, { canAttachPreview: receipt.canAttachPreview !== false,
      canAttachIcon: receipt.canAttachIcon !== false, now: now() });
    const index = jobs.findIndex(value => value.captureId === captureId);
    if (index >= 0) jobs[index] = job; else jobs.push(job);
    setJobs(state, jobs);
    await write(state);
  }
  function rememberReceipt(state, item, result) {
    const receipts = { ...receiptsOf(state) };
    receipts[item.payload.clientCaptureId] = { siteId: result.site.id, siteVersion: result.site.version,
      canAttachPreview: result.canAttachPreview === true, canAttachIcon: result.canAttachIcon === true,
      previewRevision: result.site.previewRevision || null, iconRevision: result.site.iconRevision || null,
      savedUrl: item.payload.url, at: now() };
    const bounded = Object.entries(receipts).sort((left, right) => (right[1].at || 0) - (left[1].at || 0)).slice(0, 200);
    state.captureReceipts = Object.fromEntries(bounded);
    const jobs = jobsOf(state);
    const index = jobs.findIndex(job => job.captureId === item.payload.clientCaptureId);
    if (index >= 0) {
      jobs[index] = applyCaptureReceipt(jobs[index], { siteId: result.site.id, siteVersion: result.site.version,
        previewRevision: result.site.previewRevision || null, iconRevision: result.site.iconRevision || null },
        { canAttachPreview: result.canAttachPreview === true, canAttachIcon: result.canAttachIcon === true, now: now() });
      setJobs(state, jobs);
    }
    return receipts[item.payload.clientCaptureId];
  }
  return { attach, rememberReceipt };
}
