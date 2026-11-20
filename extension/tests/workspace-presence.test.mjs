import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('仅向当前页回报版本，拒绝其他 frame、来源及非探测消息', async () => {
  const script = await readFile(new URL('../workspace-presence.js', import.meta.url), 'utf8');
  const origin = 'https://wumaoqian.top';
  const replies = [];
  let receive;
  const window = { addEventListener(type, handler) { receive = handler; }, postMessage(data, destination) { replies.push([data, destination]); } };
  runInNewContext(script, { window, location: { origin }, chrome: { runtime: { getManifest: () => ({ version: '1.10.1', key: 'private-field' }) } } });
  const data = { channel: 'website-workspace:extension-presence:v1', type: 'probe', nonce: '05c70488-1cef-491f-93cc-9e680c535716' };
  receive({ source: {}, origin, data });
  receive({ source: window, origin: 'https://example.org', data });
  receive({ source: window, origin, data: { ...data, type: 'present' } });
  receive({ source: window, origin, data: { ...data, nonce: '' } });
  assert.equal(replies.length, 0);
  receive({ source: window, origin, data });
  assert.deepEqual(JSON.parse(JSON.stringify(replies)), [[{ ...data, type: 'present', version: '1.10.1' }, origin]]);
});
