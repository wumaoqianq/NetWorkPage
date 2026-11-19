import { normalizeServer } from './queue.js';

// Bearer 仅发往用户配置的 origin；不附带网页 Cookie，也不跟随跨站重定向。
export async function request(path, { server, token, method = 'GET', body, form }) {
  const origin = normalizeServer(server);
  if (!await chrome.permissions.contains({ origins: [`${origin}/*`] })) {
    throw Object.assign(new Error('服务器访问权限已移除，请在扩展设置中重新配对。'), { status: 403 });
  }
  let response;
  try {
    response = await fetch(`${origin}${path}`, {
      method, credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: form || (body ? JSON.stringify(body) : undefined),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error('网络不可用或请求超时，收藏将保留在本地等待重试。');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const retry = response.headers.get('Retry-After');
    const seconds = retry && Number.isFinite(Number(retry)) ? Number(retry)
      : Math.max(0, (Date.parse(retry) - Date.now()) / 1000);
    throw Object.assign(new Error(data.error || `服务器返回 ${response.status}`), {
      status: response.status, code: data.code, retryAfter: Number.isFinite(seconds) ? seconds : 0,
    });
  }
  return data;
}
