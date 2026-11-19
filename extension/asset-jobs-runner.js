import { classifyAssetError, findAssetJob, hasPendingAssets, isAssetJobComplete,
  markAssetFailure, markAssetUploaded, normalizeAssetJob } from './asset-attach.js';
import { captureUrl } from './queue.js';

/** 素材任务执行器：先持久化再联网；失败保留 Blob/任务，成功或取消才删除。 */
export function createAssetJobFlusher({ attachments, request, notifyIconTasks = null, write, now = Date.now }) {
  const jobsOf = state => (state.assetJobs || []).map(normalizeAssetJob);
  const setJobs = (state, jobs) => { state.assetJobs = jobs; };
  function replaceJob(state, job) {
    const jobs = jobsOf(state);
    const index = jobs.findIndex(value => value.captureId === job.captureId);
    if (index >= 0) jobs[index] = job;
    setJobs(state, jobs);
  }
  async function uploadJobAsset(state, connection, job, kind) {
    const source = kind === 'icon' ? job.iconAttachment : job.attachment;
    const record = await attachments.get(source.id);
    if (!record) throw Object.assign(new Error('本地素材已丢失，请重新采集。'), { status: 0, code: 'asset_missing' });
    const form = new FormData();
    if (kind === 'preview') {
      for (const [key, value] of Object.entries({ clientAssetId: source.id, expectedVersion: job.siteVersion,
        sourceEndpointId: source.sourceEndpointId || '', sourceUrl: source.sourceUrl, homepageUrl: source.homepageUrl || '',
        pageKind: source.pageKind || 'current', userConfirmedHomepage: String(source.userConfirmedHomepage === true),
        capturedAt: source.capturedAt || now() })) form.append(key, value);
      form.append('file', record.blob, 'preview.webp');
    } else {
      for (const [key, value] of Object.entries({ clientAssetId: source.id, expectedVersion: job.siteVersion,
        sourceUrl: job.savedUrl || source.sourceUrl })) form.append(key, value);
      form.append('file', record.blob, 'icon.webp');
    }
    const result = await request(`/api/extension/v2/captures/${job.captureId}/${kind}`,
      { ...connection, method: 'POST', form });
    if (!result.assetId || result.status !== 'complete' || !Number.isInteger(result.siteVersion)) {
      throw new Error('服务器尚未确认素材。');
    }
    return result;
  }
  async function refreshVersionOnlyIfOwnAdvance(state, connection, job, kind, error) {
    if (classifyAssetError(error).kind !== 'version_conflict') return { safe: false, reason: '非版本冲突' };
    if (!job.savedUrl || !job.siteId) return { safe: false, reason: '缺少站点归属，不能自动续传' };
    let data;
    try {
      data = await request(`/api/extension/lookup?url=${encodeURIComponent(captureUrl(job.savedUrl))}`, connection);
    } catch (lookupError) {
      if ([401, 403].includes(lookupError.status)) state.connection = { ...connection, paused: true, pauseReason: lookupError.message };
      return { safe: false, reason: '无法确认工作台当前状态' };
    }
    const site = data?.site;
    if (!site?.id || String(site.id) !== String(job.siteId)) return { safe: false, reason: '站点归属已变化' };
    if (site.deleted || site.archived) return { safe: false, reason: '站点已删除或归档' };
    if (!Number.isInteger(site.version) || site.version < job.siteVersion || site.version > job.siteVersion + 1) {
      return { safe: false, reason: '版本推进来源不明确，需人工确认' };
    }
    const currentRevision = site[`${kind}Revision`] || null;
    const knownRevision = job[`${kind}Revision`] || null;
    if (currentRevision !== knownRevision) return { safe: false, reason: '对应素材已被外部更新、删除或更换' };
    // 只允许“同任务已确认的版本推进”或非素材字段变化后继续：对应素材 revision 未变才安全。
    const jobs = jobsOf(state);
    const index = jobs.findIndex(value => value.captureId === job.captureId);
    if (index < 0) return { safe: false, reason: '任务已不存在' };
    jobs[index] = { ...jobs[index], siteVersion: site.version, state: 'pending', attempts: 0,
      nextAttemptAt: 0, lastError: '已确认素材未变化，继续上传。', updatedAt: now(),
      previewRevision: site.previewRevision ? String(site.previewRevision) : null,
      iconRevision: site.iconRevision ? String(site.iconRevision) : null };
    setJobs(state, jobs);
    await write(state);
    return { safe: true, reason: '' };
  }
  async function markConflict(state, job, kind, error) {
    const jobs = jobsOf(state);
    const index = jobs.findIndex(value => value.captureId === job.captureId);
    const next = { ...job, state: 'conflict', nextAttemptAt: 0, updatedAt: now(),
      lastError: `素材冲突，已保留本地文件：${String(error?.message || '需要到工作台确认')}`.slice(0, 300),
      lastErrorCode: String(error?.code || 'conflict'), [`${kind}Blocked`]: true };
    if (index >= 0) jobs[index] = next;
    setJobs(state, jobs);
    await write(state);
    if (notifyIconTasks && kind === 'icon') {
      await notifyIconTasks('onAssetConflict', job.captureId, { reason: next.lastError }).catch(() => {});
    }
    return next;
  }
  async function flush(state, connection) {
    if (!attachments) return;
    for (const original of jobsOf(state).slice(0, 10)) {
      if (connection.paused) return;
      if (original.server !== connection.server || original.userId !== String(connection.user.id)) continue;
      if (!original.siteId || !Number.isInteger(original.siteVersion)) continue;
      if (['failed', 'conflict'].includes(original.state)) continue;
      if (!hasPendingAssets(original) || now() < original.nextAttemptAt) continue;
      let job = original;
      for (const kind of ['preview', 'icon']) {
        const key = kind === 'icon' ? 'iconAttachment' : 'attachment';
        if (!job[key] || job[`${kind}Uploaded`] || job[`${kind}Blocked`]) continue;
        try {
          const result = await uploadJobAsset(state, connection, job, kind);
          const sourceId = job[key].id;
          job = markAssetUploaded(job, kind, result, now());
          await attachments.remove(sourceId);
          if (kind === 'icon') await notifyIconTasks('onIconUploaded', job.captureId, { connection, result });
          replaceJob(state, job);
          await write(state);
        } catch (error) {
          const plan = classifyAssetError(error);
          if (plan.kind === 'version_conflict') {
            const checked = await refreshVersionOnlyIfOwnAdvance(state, connection, job, kind, error);
            if (checked.safe) {
              const refreshed = findAssetJob(jobsOf(state), job.captureId);
              if (refreshed) job = refreshed;
              continue;
            }
            job = await markConflict(state, job, kind, { ...error, message: checked.reason || error.message });
            break;
          }
          if (['source_changed', 'idempotency_conflict', 'conflict'].includes(plan.kind)) {
            job = await markConflict(state, job, kind, error);
            break;
          }
          job = markAssetFailure(job, kind, error, now());
          if (plan.kind === 'auth') {
            state.connection = { ...connection, paused: true, pauseReason: error.message };
          }
          if (kind === 'icon') await notifyIconTasks?.('onIconUploadFailed', job.captureId, { connection, error });
          replaceJob(state, job);
          await write(state);
          break;
        }
      }
      replaceJob(state, job);
      if (isAssetJobComplete(job)) setJobs(state, jobsOf(state).filter(value => value.captureId !== job.captureId));
      await write(state);
    }
  }
  return { flush };
}
