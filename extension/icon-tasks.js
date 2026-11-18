/**
 * 图标任务的持久化模型：文字先入库，图标获取/兜底/上传是独立任务。
 * 任务按 server+user 隔离，绑定 capture ID，浏览器重启后由 service worker 恢复。
 */
export const ICON_TASK_SCHEMA = 1;
export const ICON_TASK_STORAGE_KEY = 'workspaceIconTasks';
export const ICON_NOTICE_KEY = 'workspaceIconNotice';
export const ICON_TASK_STATES = Object.freeze(['pending_acquisition', 'acquiring', 'ready_to_upload',
  'complete', 'retryable_failure', 'unsupported', 'cancelled']);
export const ICON_TASK_MAX_ATTEMPTS = 5;
const DAY = 86400000;
export const ICON_TASK_EXPIRY_MS = 7 * DAY;
const BACKOFF = [0, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];

export const iconTaskKey = (server, userId, captureId) => `${server}|${String(userId)}|${captureId}`;
export const nextAttemptAt = (attempts, now = Date.now()) => now + (BACKOFF[Math.min(Math.max(0, attempts), BACKOFF.length - 1)] || 0);

export function normalizeIconTask(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const state = ICON_TASK_STATES.includes(raw.state) ? raw.state : 'pending_acquisition';
  const attempts = Number.isFinite(Number(raw.attempts)) ? Math.max(0, Math.trunc(Number(raw.attempts))) : 0;
  return {
    schemaVersion: ICON_TASK_SCHEMA,
    captureId: String(raw.captureId || ''),
    server: String(raw.server || ''),
    userId: String(raw.userId || ''),
    pageUrl: String(raw.pageUrl || ''),
    savedUrl: String(raw.savedUrl || ''),
    duplicate: raw.duplicate === true,
    allowUpdate: raw.allowUpdate === true,
    state,
    reason: raw.reason ? String(raw.reason).slice(0, 240) : '',
    code: raw.code ? String(raw.code).slice(0, 80) : '',
    diagnostics: raw.diagnostics && typeof raw.diagnostics === 'object' ? raw.diagnostics : null,
    attempts,
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
    notBefore: Number(raw.notBefore) || 0,
    lastAttemptAt: Number(raw.lastAttemptAt) || 0,
    tabId: Number.isInteger(raw.tabId) ? raw.tabId : null,
    clientCandidates: Array.isArray(raw.clientCandidates)
      ? raw.clientCandidates.filter(value => typeof value === 'string').slice(0, 4) : [],
    clientAttempted: raw.clientAttempted === true,
    nextAttemptAt: Number(raw.nextAttemptAt) || 0,
    completedAt: Number(raw.completedAt) || 0,
  };
}

export function createIconTask({ server, userId, captureId, pageUrl = '', savedUrl = '', duplicate = false, allowUpdate = false,
  now = Date.now(), notBefore = 0, tabId = null, clientCandidates = [] }) {
  return normalizeIconTask({ server, userId, captureId, pageUrl, savedUrl, duplicate, allowUpdate,
    state: 'pending_acquisition', createdAt: now, updatedAt: now, notBefore, tabId, clientCandidates });
}

/** 只有文字已确认、当前连接匹配、到达退避时间且任务未终态时才尝试兜底。 */
export function shouldProcessTask(task, { connection = null, queueCaptureIds = new Set(), now = Date.now() } = {}) {
  if (!task || !connection || connection.paused) return { run: false, reason: '连接不可用' };
  if (task.server !== connection.server || task.userId !== String(connection.user?.id)) return { run: false, reason: '账号或服务器不匹配' };
  if (['complete', 'unsupported', 'cancelled'].includes(task.state)) return { run: false, reason: '任务已终态' };
  if (queueCaptureIds.has(task.captureId)) return { run: false, reason: '等待文字入库' };
  if (now < (task.notBefore || 0)) return { run: false, reason: '等待 popup 附带的素材先上传' };
  if (now < task.nextAttemptAt) return { run: false, reason: '退避中' };
  if (now - task.createdAt > ICON_TASK_EXPIRY_MS) return { run: false, reason: '任务已过期' };
  return { run: true, reason: '' };
}

export function markAttempt(task, now = Date.now()) {
  const attempts = task.attempts + 1;
  return { ...task, state: 'acquiring', attempts, lastAttemptAt: now, updatedAt: now,
    nextAttemptAt: nextAttemptAt(attempts, now), reason: '', code: '' };
}

export function completeTask(task, { reason = '', code = 'complete', now = Date.now() } = {}) {
  return { ...task, state: 'complete', reason, code, completedAt: now, updatedAt: now, nextAttemptAt: 0 };
}

/** 失败分类：身份/权限、格式/私网/配额等不可自动恢复的进入 unsupported；网络/5xx 进入有限退避。 */
export function classifyFallbackError(error, attempts) {
  const status = Number(error?.status) || 0;
  const code = String(error?.code || '');
  const permanent = ['icon_svg_only', 'icon_refresh_private', 'icon_quota_exceeded', 'icon_refresh_invalid',
    'icon_refresh_too_large', 'icon_exists_unsupported'].includes(code) || [400, 413, 415].includes(status);
  const auth = status === 401 || status === 403;
  if (permanent) return { state: 'unsupported', code: code || 'unsupported', reason: String(error?.message || '图标格式或站点类型不支持自动获取') };
  if (auth) return { state: 'retryable_failure', code: 'auth_failed', reason: '身份或权限失效；重新连接后会重试。' };
  if (attempts >= ICON_TASK_MAX_ATTEMPTS) {
    return { state: 'retryable_failure', code: code || 'retry_exhausted', reason: '多次自动重试未成功，可在工作台卡片菜单手动更新图标。' };
  }
  return { state: 'retryable_failure', code: code || 'retryable',
    reason: `图标暂时无法获取，稍后会自动重试${error?.message ? `（${String(error.message).slice(0, 120)}）` : '。'}` };
}

/** 存储适配器：默认 chrome.storage.local，可在测试中注入假对象。 */
export function createIconTaskStore({ storage = globalThis.chrome?.storage?.local, now = Date.now } = {}) {
  if (!storage) throw new Error('图标任务需要本地存储');
  async function readAll() {
    const stored = await storage.get([ICON_TASK_STORAGE_KEY]);
    const raw = stored?.[ICON_TASK_STORAGE_KEY];
    const tasks = raw?.tasks && typeof raw.tasks === 'object' ? raw.tasks : {};
    return { schemaVersion: ICON_TASK_SCHEMA, tasks: Object.fromEntries(Object.entries(tasks).map(([key, value]) => [key, normalizeIconTask(value)])) };
  }
  async function writeAll(data) { await storage.set({ [ICON_TASK_STORAGE_KEY]: data }); }
  function keyOf(task) { return iconTaskKey(task.server, task.userId, task.captureId); }
  return {
    async list() {
      const data = await readAll();
      return Object.values(data.tasks).filter(task => now() - task.createdAt <= ICON_TASK_EXPIRY_MS).sort((left, right) => left.createdAt - right.createdAt);
    },
    async get(server, userId, captureId) { return (await readAll()).tasks[iconTaskKey(server, userId, captureId)] || null; },
    async ensure(task) {
      const data = await readAll(); const key = keyOf(task);
      if (!data.tasks[key]) data.tasks[key] = normalizeIconTask({ ...task, updatedAt: now() });
      await writeAll(data);
      return data.tasks[key];
    },
    async update(task, changes) {
      const data = await readAll(); const key = keyOf(task);
      if (!data.tasks[key]) return null;
      data.tasks[key] = normalizeIconTask({ ...data.tasks[key], ...changes, updatedAt: now() });
      await writeAll(data);
      return data.tasks[key];
    },
    async remove(task) {
      const data = await readAll(); delete data.tasks[keyOf(task)]; await writeAll(data);
    },
    async pendingCount(server, userId) {
      return (await this.list()).filter(task => task.server === server && task.userId === String(userId)
        && ['pending_acquisition', 'acquiring', 'ready_to_upload', 'retryable_failure'].includes(task.state)).length;
    },
    async setNotice(notice) { await storage.set({ [ICON_NOTICE_KEY]: { ...notice, at: notice.at || now() } }); },
    async takeNotice(server, userId) {
      const stored = await storage.get([ICON_NOTICE_KEY]);
      const notice = stored?.[ICON_NOTICE_KEY];
      if (!notice || notice.server !== server || String(notice.userId) !== String(userId)) return null;
      if (now() - Number(notice.at || 0) > DAY) return null;
      await storage.remove?.(ICON_NOTICE_KEY);
      return notice;
    },
  };
}
