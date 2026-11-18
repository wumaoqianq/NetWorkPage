/** 始终向同源 API 发送会话；CSRF 优先读取登录后轮换的 cookie。 */
export function createApi({ fetcher = (...args) => fetch(...args), cookie = () => globalThis.document?.cookie || '', onUnauthorized = () => globalThis.dispatchEvent?.(new Event('workspace:auth-expired')) } = {}) {
  let csrfToken = '';
  return {
    setCsrfToken(value) { csrfToken = value || ''; },
    async request(path, { method = 'GET', body, form, raw = false, headers = {} } = {}) {
      if (!path.startsWith('/api/')) throw new Error('只允许请求本站 API');
      const tokenCookie = cookie().split(';').map(value => value.trim()).find(value => value.startsWith('csrftoken='));
      const token = tokenCookie ? tokenCookie.slice('csrftoken='.length) : csrfToken;
      const requestHeaders = { Accept: 'application/json', ...headers };
      if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) requestHeaders['X-CSRFToken'] = token;
      // multipart 由浏览器设置带 boundary 的 Content-Type，不能手动指定。
      const payload = form !== undefined ? form : body === undefined ? undefined : JSON.stringify(body);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetcher(path, { method, headers: requestHeaders, credentials: 'same-origin', body: payload, signal: controller.signal });
        if (response.ok && raw) return response;
        const text = await response.text();
        let data;
        try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
        if (!response.ok) {
          if (response.status === 401 && !path.includes('/auth/')) onUnauthorized();
          const error = new Error(data.error || (response.status === 403 ? '请求未通过验证，请刷新页面后重试' : '服务暂时无法完成请求，请稍后重试'));
          error.code = data.code || 'request_failed'; error.status = response.status;
          throw error;
        }
        return data;
      } catch (error) {
        if (error.name === 'AbortError') throw new Error('请求超时，请检查连接后重试');
        if (error instanceof TypeError) throw new Error('无法连接服务，请检查网络或服务是否启动');
        throw error;
      } finally { clearTimeout(timer); }
    },
  };
}
export const api = createApi();
