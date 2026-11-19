// 队列只按服务器与用户绑定；设备凭据轮换后，同账号可继续同步。
export function normalizeServer(value) {
  const url = new URL(String(value).trim());
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('服务器必须使用 HTTPS；仅本机开发地址可使用 HTTP。');
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('请输入服务器根地址，不要包含路径、密码、查询或片段。');
  }
  return url.origin;
}

export function captureUrl(value, scope = 'page') {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('只能收藏不含用户名和密码的 HTTP/HTTPS 页面。');
  }
  return scope === 'home' ? `${url.origin}/` : url.href;
}

export const cleanDescription = value => String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ')
  .replace(/\s+/g, ' ').trim().slice(0, 500);
export const belongsTo = (item, connection) => !!connection && item.server === connection.server
  && item.userId === String(connection.user.id);

export function makeCapture(connection, input, now = Date.now()) {
  if (!connection?.user?.id) throw new Error('请先连接账号。');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(input.clientCaptureId)) throw new Error('收藏标识必须为 UUID。');
  const server = normalizeServer(connection.server);
  const userId = String(connection.user.id);
  return {
    id: `${server}|${userId}|${input.clientCaptureId}`, server, userId, protocol: 2,
    payload: { clientCaptureId: input.clientCaptureId, url: captureUrl(input.url),
      title: String(input.title || '').trim().slice(0, 100),
      description: cleanDescription(input.description), descriptionSource: input.descriptionSource === 'page_meta' ? 'page_meta' : 'manual',
      purpose: String(input.purpose || '').trim().slice(0, 1000), notes: String(input.notes || '').trim().slice(0, 2000),
      category: String(input.category || '').slice(0, 100),
      tags: (input.tags || []).slice(0, 30).map(tag => String(tag).trim().slice(0, 100)).filter(Boolean),
      collectionIds: (input.collectionIds || []).slice(0, 30), pinned: input.pinned === true,
      later: input.later === true, homepageUrl: input.homepageUrl || '', scope: input.scope || '公网',
      updateFields: input.updateFields || [], updateExisting: false, appendNotes: input.appendNotes === true,
      ...(input.expectedVersion == null ? {} : { expectedVersion: input.expectedVersion }) },
    attachment: input.attachment || null, iconAttachment: input.iconAttachment || null, siteId: null, siteVersion: null,
    createdAt: now, attempts: 0, nextAttemptAt: now, state: 'pending', lastError: '',
  };
}

export const enqueue = (queue, item) => queue.some(existing => existing.id === item.id) ? queue : [...queue, item];
export const captureIdForSubmission = (captureId, replacementFor, generate = () => crypto.randomUUID()) =>
  replacementFor && captureId === replacementFor ? generate() : captureId;
export function eligibleItems(queue, connection, now = Date.now()) {
  if (!connection || connection.paused) return [];
  return queue.filter(item => belongsTo(item, connection) && item.state === 'pending' && item.nextAttemptAt <= now);
}
export function eligibleAttachments(queue, connection, now = Date.now()) {
  if (!connection || connection.paused) return [];
  return queue.filter(item => belongsTo(item, connection) && item.state === 'preview_pending'
    && item.nextAttemptAt <= now && item.attachment && now - item.attachment.createdAt <= 7 * 86400000);
}
export function eligibleIcons(queue, connection, now = Date.now()) {
  if (!connection || connection.paused) return [];
  return queue.filter(item => belongsTo(item, connection) && ['preview_pending', 'blocked', 'conflict'].includes(item.state)
    && (item.iconNextAttemptAt || 0) <= now && item.iconAttachment
    && now - item.iconAttachment.createdAt <= 7 * 86400000);
}
export const acknowledge = (queue, id) => queue.filter(item => item.id !== id);

export function failCapture(queue, id, error, now = Date.now()) {
  return queue.map(item => {
    if (item.id !== id) return item;
    const status = error.status || 0;
    const auth = status === 401 || status === 403;
    const permanent = status >= 400 && status < 500 && ![408, 425, 429].includes(status);
    const attempts = item.attempts + 1;
    const retryAfter = Number(error.retryAfter) * 1000 || 0;
    return { ...item, attempts, state: auth ? 'auth' : permanent ? (error.status === 409 ? 'conflict' : 'blocked') : 'pending',
      nextAttemptAt: now + Math.max(retryAfter, Math.min(60_000 * 2 ** Math.min(attempts - 1, 10), 3_600_000)),
      lastError: String(error.message || '暂时无法连接服务器').slice(0, 300) };
  });
}

export const failAttachment = (queue, id, error, now = Date.now()) => failCapture(queue, id, error, now)
  .map(item => item.id !== id || ['auth', 'conflict', 'blocked'].includes(item.state) ? item : { ...item, state: 'preview_pending' });

export function resumeQueue(queue, connection, now = Date.now()) {
  return queue.map(item => belongsTo(item, connection) && item.state === 'auth'
    ? { ...item, state: item.siteId ? 'preview_pending' : 'pending', nextAttemptAt: now, lastError: '' } : item);
}
export function retryQueue(queue, connection, now = Date.now()) {
  return queue.map(item => belongsTo(item, connection) && item.state !== 'auth'
    ? { ...item, state: item.siteId && (item.attachment || item.iconAttachment) ? 'preview_pending' : 'pending',
      nextAttemptAt: now, iconNextAttemptAt: now } : item);
}
export const queueSummary = (queue, connection) => {
  const current = queue.filter(item => belongsTo(item, connection)).length;
  return { total: queue.length, current, other: queue.length - current };
};
export const attachmentStats = queue => ({ count: queue.filter(item => item.attachment || item.iconAttachment)
  .reduce((total, item) => total + Number(Boolean(item.attachment)) + Number(Boolean(item.iconAttachment)), 0),
  bytes: queue.reduce((total, item) => total + (item.attachment?.bytes || 0) + (item.iconAttachment?.bytes || 0), 0) });

// 收藏目标只来自“用户调用扩展的那个窗口里的活动标签页”。绝不遍历所有窗口或按
// lastAccessed 改选，否则会静默保存另一个窗口的网站；目标无法确认时由界面提示用户
// 回到目标网站重新调用扩展。
export function describeCaptureTarget(tab) {
  if (!tab || typeof tab.id !== 'number') return { tab: null, reason: 'no-active-tab' };
  if (tab.incognito) return { tab: null, reason: 'incognito' };
  try { captureUrl(tab.url || ''); } catch { return { tab: null, reason: 'unsupported-url' }; }
  return { tab, reason: '' };
}

const targetMessages = {
  'debug-page': '这是独立打开的扩展调试页面，不是收藏目标。请回到目标网站，点击工具栏图标或按 Alt+Shift+S 重新打开。',
  'no-active-tab': '无法确定当前窗口的活动标签页。请回到目标网站，点击工具栏图标或按 Alt+Shift+S 重新打开。',
  incognito: '隐身窗口暂不支持收藏。请在普通窗口打开目标网站后重新调用扩展。',
  'unsupported-url': '当前标签页不是可收藏的普通 HTTP(S) 网页（如浏览器设置页、扩展页）。请回到目标网站后重新调用扩展；不会改选其他窗口的页面。',
  'window-mismatch': '无法确认收藏目标窗口，本次不会保存其他窗口的页面。请回到目标网站后重新调用扩展。',
  'query-failed': '浏览器没有返回目标标签页。请回到目标网站后重新调用扩展。',
  'access-denied': '未能读取当前页（可能并非从工具栏打开，或扩展授权已失效）。文字收藏仍可使用；需要截图和图标时，请回到目标网站点击工具栏图标或快捷键重新打开。',
};

export const targetMessage = reason => targetMessages[reason]
  || '无法确定收藏目标，本次不会保存其他窗口的页面。请回到目标网站后重新调用扩展。';

// tabs.getCurrent() 在工具栏 popup 中返回 undefined，在把 popup.html 当普通标签页
// 打开（调试上下文）时返回该扩展页；据此区分两种上下文。windows.getCurrent() 用于
// 复核活动标签确实属于当前窗口；窗口 API 异常时仍以 currentWindow 查询为绑定依据。
export async function resolveInvocationTarget({ getCurrentTab, queryActive, getCurrentWindow } = {}) {
  let ownTab;
  try { ownTab = await (getCurrentTab || (() => chrome.tabs.getCurrent()))(); }
  catch { return { tab: null, reason: 'query-failed' }; }
  if (ownTab && typeof ownTab.id === 'number') return { tab: null, reason: 'debug-page' };
  let active;
  try {
    active = await (queryActive || (options => chrome.tabs.query(options)))({ active: true, currentWindow: true });
  } catch { return { tab: null, reason: 'query-failed' }; }
  const [tab] = Array.isArray(active) ? active : [];
  const described = describeCaptureTarget(tab);
  if (!described.tab) return described;
  try {
    const current = await (getCurrentWindow || (() => chrome.windows.getCurrent()))();
    if (current && typeof current.id === 'number' && current.id >= 0 && tab.windowId !== current.id) {
      return { tab: null, reason: 'window-mismatch' };
    }
  } catch { /* 窗口 API 不可用时以 currentWindow 查询结果为绑定依据。 */ }
  return described;
}

export function inferScope(value) {
  const hostname = new URL(value).hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '[::1]' || hostname.startsWith('127.')) return '本机';
  if (hostname.endsWith('.local') || hostname.endsWith('.lan') || hostname.startsWith('10.') || hostname.startsWith('192.168.')
      || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return '局域网';
  return '公网';
}
