import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api.js';

test('网页写入携带当前CSRF token和会话cookie', async () => {
  let observed;
  const client = createApi({ cookie: () => 'csrftoken=fresh-token', fetcher: async (url, options) => { observed = { url, options }; return new Response(JSON.stringify({ id: 'saved' }), { status: 200 }); } });
  const result = await client.request('/api/sites', { method: 'POST', body: { name: '网站' } });
  assert.equal(result.id, 'saved');
  assert.equal(observed.options.credentials, 'same-origin');
  assert.equal(observed.options.headers['X-CSRFToken'], 'fresh-token');
  assert.equal(JSON.parse(observed.options.body).name, '网站');
});
test('服务器写入失败向调用方抛出明确错误而不是返回假成功', async () => {
  const client = createApi({ cookie: () => '', fetcher: async () => new Response(JSON.stringify({ error: '资料已被修改', code: 'version_conflict' }), { status: 409 }) });
  await assert.rejects(() => client.request('/api/sites/x', { method: 'PATCH', body: {} }), error => error.message === '资料已被修改' && error.code === 'version_conflict' && error.status === 409);
});
test('拒绝向外部地址发送会话凭据', async () => {
  let called = false;
  const client = createApi({ fetcher: async () => { called = true; return new Response('{}'); } });
  await assert.rejects(() => client.request('https://external.example/api/sites'));
  assert.equal(called, false);
});
test('会话失效通知根页面重新登录', async () => {
  let expired = false;
  const client = createApi({ fetcher: async () => new Response('{"error":"请登录","code":"auth_required"}', { status: 401 }), onUnauthorized: () => { expired = true; } });
  await assert.rejects(() => client.request('/api/workspace'));
  assert.equal(expired, true);
});
test('multipart 表单原样发送且不手动设置 Content-Type（图标本地上传）', async () => {
  let observed;
  const client = createApi({ cookie: () => 'csrftoken=tok', fetcher: async (url, options) => { observed = options; return new Response(JSON.stringify({ status: 'complete' }), { status: 200 }); } });
  const form = new FormData(); form.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), 'icon.png');
  const result = await client.request('/api/sites/x/icon/upload', { method: 'POST', form });
  assert.equal(result.status, 'complete');
  assert.equal(observed.body, form, 'FormData 原样作为 body');
  assert.equal(observed.headers['Content-Type'], undefined, 'boundary 交给浏览器');
  assert.equal(observed.headers['X-CSRFToken'], 'tok');
});
