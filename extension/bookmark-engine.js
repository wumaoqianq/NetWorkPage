import { normalizeServer } from './queue.js';

const unfinished = plan => plan && !['complete', 'cancelled'].includes(plan.phase);
const sameOwner = (plan, connection) => connection && plan.server === connection.server && plan.ownerId === connection.user.id;

/** 每次仅发送一个持久化批次，MV3 页面关闭/响应丢失后可以用原 UUID 继续。 */
export function createBookmarkImporter({ read, write, request, permission, now = Date.now }) {
  async function status() {
    const state = await read(), plan = state.bookmarkImport;
    if (!plan) return null;
    return { phase: plan.phase, total: plan.total, owner: plan.owner, server: plan.server,
      completedBatches: plan.batches.filter(batch => batch.result).length, totalBatches: plan.batches.length,
      imported: plan.batches.reduce((n, b) => n + (b.result?.imported || 0), 0),
      skipped: plan.batches.reduce((n, b) => n + (b.result?.skipped || 0), 0),
      error: plan.error || '', canResume: sameOwner(plan, state.connection) && !state.connection.paused };
  }
  async function connected(state) {
    const connection = state.connection;
    if (!connection || connection.paused || Date.parse(connection.expiresAt) <= now()) throw new Error('请先连接或重新配对自己的工作台');
    if (!await permission()) throw new Error('书签权限未授权或已撤回，请点击授权读取收藏');
    return connection;
  }
  async function start(message, state) {
    if (message.confirmed !== true) throw new Error('请先预览并明确确认导入');
    const connection = await connected(state);
    if (unfinished(state.bookmarkImport)) throw new Error('还有未完成的导入，请继续或先停止旧任务');
    const items = message.items;
    if (!Array.isArray(items) || !items.length || items.length > 10000 || new TextEncoder().encode(JSON.stringify(items)).length > 4 * 1024 * 1024) throw new Error('收藏为空或过大，请选择一个文件夹');
    const batches = [];
    for (let i = 0; i < items.length; i += 500) batches.push({ id: crypto.randomUUID(), items: items.slice(i, i + 500), result: null });
    state.bookmarkImport = { phase: 'pending', server: normalizeServer(connection.server), ownerId: connection.user.id,
      owner: connection.user.email, total: items.length, batches, error: '' };
    await write(state);
  }
  async function step(state) {
    const plan = state.bookmarkImport;
    if (!unfinished(plan)) return;
    const connection = await connected(state);
    if (!sameOwner(plan, connection)) throw new Error('当前连接的账号不同，不能把旧任务导入另一个账号；请连接原账号');
    const batch = plan.batches.find(item => !item.result);
    if (!batch) { plan.phase = 'complete'; await write(state); return; }
    plan.phase = 'sending'; plan.error = '';
    await write(state);
    try {
      const result = await request('/api/extension/bookmarks/import', { ...connection, method: 'POST', body: { batchId: batch.id, items: batch.items } });
      if (result.batchId !== batch.id || result.ownerId !== plan.ownerId || !Number.isInteger(result.imported) || !Number.isInteger(result.skipped) || result.imported < 0 || result.skipped < 0 || result.imported + result.skipped !== batch.items.length) throw new Error('服务器确认不完整，任务保留，可重新继续');
      batch.result = { imported: result.imported, skipped: result.skipped };
      delete batch.items;
      plan.phase = plan.batches.every(item => item.result) ? 'complete' : 'pending';
    } catch (error) {
      plan.phase = 'error'; plan.error = error.message;
      if ([401, 403].includes(error.status)) state.connection = { ...connection, paused: true, pauseReason: error.message };
      await write(state);
      throw error;
    }
    await write(state);
  }
  async function handle(message) {
    const state = await read();
    if (message.type === 'bookmarks-start') await start(message, state);
    else if (message.type === 'bookmarks-step') await step(state);
    else if (message.type === 'bookmarks-cancel') {
      if (state.bookmarkImport) {
        state.bookmarkImport.phase = 'cancelled';
        for (const batch of state.bookmarkImport.batches) delete batch.items;
        await write(state);
      }
    } else if (message.type !== 'bookmarks-status') throw new Error('未知书签导入操作');
    return status();
  }
  return { handle };
}
