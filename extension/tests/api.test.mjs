import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { request } from '../api.js';

async function withServer(handler, run) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const allow = () => { globalThis.chrome = { permissions: { contains: async () => true } }; };

test('real HTTP transport sends independent bearer and exact capture JSON without Cookie', async () => {
  allow();
  let observed;
  await withServer(async (incoming, response) => {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    observed = { headers: incoming.headers, body: JSON.parse(Buffer.concat(chunks)) };
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ site: { id: 9 }, duplicate: false }));
  }, async server => {
    const body = { clientCaptureId: 'id', url: 'https://site.example/app?t=7#board', title: '标题', purpose: '' };
    const result = await request('/api/extension/captures', { server, token: 'device-only', method: 'POST', body });
    assert.equal(result.site.id, 9);
    assert.equal(observed.headers.authorization, 'Bearer device-only');
    assert.equal(observed.headers.cookie, undefined);
    assert.deepEqual(observed.body, body);
  });
});
test('real HTTP redirect is rejected before any followup request can expose bearer', async () => {
  allow();
  let followups = 0;
  await withServer((incoming, response) => {
    if (incoming.url === '/target') { followups++; response.end('{}'); return; }
    response.writeHead(302, { Location: '/target' });
    response.end();
  }, async server => {
    await assert.rejects(request('/api/extension/captures', { server, token: 'device-only' }), /网络不可用/);
    assert.equal(followups, 0);
  });
});
test('removed origin permission blocks transport without issuing HTTP', async () => {
  globalThis.chrome = { permissions: { contains: async () => false } };
  let requests = 0;
  await withServer((incoming, response) => { requests++; response.end('{}'); }, async server => {
    await assert.rejects(request('/api/extension/lookup?url=x', { server, token: 'secret' }),
      failure => failure.status === 403);
    assert.equal(requests, 0);
  });
});
test('real HTTP error preserves stable server error code and status', async () => {
  allow();
  await withServer((incoming, response) => {
    response.writeHead(401, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: '设备已撤销', code: 'device_revoked' }));
  }, async server => {
    await assert.rejects(request('/api/extension/lookup?url=x', { server, token: 'secret' }),
      failure => failure.status === 401 && failure.code === 'device_revoked' && failure.message === '设备已撤销');
  });
});
