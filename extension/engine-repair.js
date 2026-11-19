import { isAssetJobComplete, normalizeAssetJob } from './asset-attach.js';
import { acknowledge } from './queue.js';

/** 修复本地状态：清理孤立 Blob，但保留失败任务记录和用户队列状态。 */
export function createStateRepair({ attachments, write, now = Date.now }) {
  return async function repair(state) {
    if (!attachments) return;
    const jobs = (state.assetJobs || []).map(normalizeAssetJob);
    const validIds = new Set([...state.queue.flatMap(item => [item.attachment, item.iconAttachment]),
      ...jobs.flatMap(job => [job.attachment, job.iconAttachment])].filter(Boolean).map(source => source.id));
    await attachments.prune(validIds, now());
    const repairedJobs = [];
    for (const job of jobs) {
      let next = job;
      for (const kind of ['preview', 'icon']) {
        const key = kind === 'icon' ? 'iconAttachment' : 'attachment';
        if (!next[key]) continue;
        if (await attachments.get(next[key].id)) continue;
        next = { ...next, [key]: null, state: 'failed',
          lastError: '本地素材丢失，已保留任务记录；可重新采集或取消。', updatedAt: now() };
      }
      if (!isAssetJobComplete(next) || next.state === 'failed') repairedJobs.push(next);
    }
    state.assetJobs = repairedJobs;
    for (const item of [...state.queue]) {
      for (const key of ['attachment', 'iconAttachment']) {
        if (!item[key] || await attachments.get(item[key].id)) continue;
        state.queue = state.queue.map(value => value.id === item.id ? { ...value, [key]: null,
          lastError: '本地素材丢失，网站文字保留，可重新采集。' } : value);
        const current = state.queue.find(value => value.id === item.id);
        if (item.siteId && current && !current.attachment && !current.iconAttachment) {
          state.queue = acknowledge(state.queue, item.id);
          state.lastResult = { clientCaptureId: item.payload.clientCaptureId, status: 'preview_missing',
            message: '网站已入库，但本地素材丢失，请重新收藏并选择更新素材。' };
        }
      }
    }
    for (const item of state.queue) {
      if ([item.attachment, item.iconAttachment].some(source => source && now() - source.createdAt > 7 * 86400000)) {
        Object.assign(item, { state: 'blocked', lastError: '素材已保留超过 7 天，请重试、重新采集或移除任务。' });
      }
    }
    await write(state);
  };
}
