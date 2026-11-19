import { classifyFallbackError, completeTask, markAttempt, nextAttemptAt, shouldProcessTask } from './icon-tasks.js';

/**
 * 图标兜底执行器：在 service worker 中按 alarm 周期运行。
 * 只有文字已入库（不在队列）、账号/服务器匹配且到达退避时间的任务才会请求
 * 受控兜底接口；接口不接受任意 URL，只根据 capture 所属站点抓取其声明图标。
 */
export function createIconTaskRunner({ store, read, request, now = Date.now }) {
  async function run() {
    const state = await read();
    const connection = state?.connection || null;
    const tasks = await store.list();
    const queueCaptureIds = new Set((state?.queue || []).map(item => item.payload?.clientCaptureId).filter(Boolean));
    const clientPending = new Set((state?.assetJobs || []).filter(job => job.iconAttachment
      && !job.iconBlocked && job.state !== 'failed').map(job => job.captureId));
    let processed = 0;
    for (const task of tasks) {
      if (clientPending.has(task.captureId)) continue;
      const decision = shouldProcessTask(task, { connection, queueCaptureIds, now: now() });
      if (!decision.run) continue;
      const attempted = markAttempt(task, now());
      await store.update(task, attempted);
      try {
        const result = await request(`/api/extension/v2/captures/${encodeURIComponent(task.captureId)}/icon/fallback`,
          { ...connection, method: 'POST', body: {} });
        if (result?.status === 'icon_exists' || result?.revision) {
          const exists = result?.status === 'icon_exists';
          await store.update(task, completeTask(attempted, { code: exists ? 'icon_exists' : 'complete',
            reason: exists ? '已有图标，未覆盖' : '图标已自动补齐', now: now() }));
          await store.setNotice({ server: task.server, userId: task.userId, captureId: task.captureId,
            status: 'complete', siteVersion: result?.siteVersion || null, at: now() });
        } else {
          throw Object.assign(new Error('服务器未返回图标结果'), { code: 'invalid_response' });
        }
      } catch (error) {
        const plan = classifyFallbackError(error, attempted.attempts);
        await store.update(task, { ...plan, nextAttemptAt: nextAttemptAt(attempted.attempts, now()), updatedAt: now() });
        if (plan.state === 'unsupported' || attempted.attempts >= 5) {
          await store.setNotice({ server: task.server, userId: task.userId, captureId: task.captureId,
            status: plan.state === 'unsupported' ? 'unsupported' : 'failed', reason: plan.reason, at: now() });
        }
      }
      processed++;
    }
    return { processed, total: tasks.length };
  }
  return { run };
}
