import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pages = await fetch('http://127.0.0.1:9225/json/list').then(response => response.json());
const page = pages.find(item => item.url === 'http://127.0.0.1:4180/');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(resolve => { socket.onopen = resolve; });
let sequence = 0;
const pending = new Map();
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  pending.get(message.id)(message.result); pending.delete(message.id);
};
function cdp(method, params = {}) {
  const id = ++sequence;
  return new Promise(resolve => { pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })); });
}
function shell(code) {
  return execFileSync('.venv/Scripts/python.exe', ['server/manage.py', 'shell', '-c', code], { env: { ...process.env,
    DATA_DIR: '.local/qa-viewer', DATABASE_PATH: '.local/qa-viewer/workspace.sqlite3', DEBUG: 'True', ALLOW_LOCAL_SETUP: 'True', SETUP_ENABLED: 'True' }, encoding: 'utf8' });
}
const change = revision => shell(`from workspace.models import SiteIconAsset; import uuid; a=SiteIconAsset.objects.get(); a.revision=${JSON.stringify(revision)}; a.save(); a.site.version += 1; a.site.save(update_fields=['version','updated_at'])`);
const current = crypto.randomUUID();
change('11111111-1111-4111-8111-111111111111');
await cdp('Runtime.evaluate', { expression: `window.dispatchEvent(new Event('focus'))` }); await sleep(1400);
await cdp('Runtime.evaluate', { expression: `window.dispatchEvent(new Event('focus'))` }); await sleep(400);
change(current); await sleep(300);
await cdp('Runtime.evaluate', { expression: `document.querySelector('.card-logo img').src += '&qa-retry=1'` }); await sleep(400);
const fallback = await cdp('Runtime.evaluate', { expression: `Boolean(document.querySelector('.icon-fallback-letter'))`, returnByValue: true });
assert.equal(fallback.result.value, true);
change(current);
await cdp('Runtime.evaluate', { expression: `window.dispatchEvent(new Event('focus'))` }); await sleep(1400);
await cdp('Runtime.evaluate', { expression: `window.dispatchEvent(new Event('focus'))` }); await sleep(400);
const recovered = await cdp('Runtime.evaluate', { expression: `document.querySelector('.card-logo img')?.naturalWidth || 0`, returnByValue: true });
assert.ok(recovered.result.value > 0);
console.log(JSON.stringify({ fallbackAfterInvalidRevision: true, recoveredNaturalWidth: recovered.result.value }));
socket.close();
