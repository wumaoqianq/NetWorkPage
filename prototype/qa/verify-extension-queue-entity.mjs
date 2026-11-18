import { execFileSync, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pages = () => fetch('http://127.0.0.1:9224/json/list').then(response => response.json());
async function connect(page) {
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(resolve => { socket.onopen = resolve; });
  const pending = new Map(); let sequence = 0;
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const waiter = pending.get(message.id); pending.delete(message.id);
    if (message.error) waiter?.reject(new Error(JSON.stringify(message.error))); else waiter?.resolve(message.result);
  };
  function cdp(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  }
  async function evaluate(expression) {
    const response = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result?.value;
  }
  return { socket, cdp, evaluate };
}
const workerPage = (await pages()).find(page => page.url.endsWith('/service-worker.js'));
assert.ok(workerPage);
let worker = await connect(workerPage);
let popupPage = (await pages()).find(page => page.url.endsWith('/popup.html'));
if (!popupPage) {
  const target = await connect((await pages()).find(page => page.url.startsWith('http://127.0.0.1:4181/')));
  await target.cdp('Page.bringToFront');
  await worker.evaluate(`chrome.action.openPopup()`); await sleep(600);
  popupPage = (await pages()).find(page => page.url.endsWith('/popup.html'));
}
assert.ok(popupPage);
const popup = await connect(popupPage);
execFileSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -like '*127.0.0.1:4180*' } | ForEach-Object { Stop-Process -Id $_.ProcessId }"]);
await sleep(600);
const offlineUrl = await popup.evaluate(`document.querySelector('#url').value + '&offline=${crypto.randomUUID()}'`);
await popup.evaluate(`(() => { const input = document.querySelector('#url'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(offlineUrl)});
  input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await popup.evaluate(`(() => { const input = document.querySelector('#notes'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '离线队列保留验证');
  input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await popup.evaluate(`document.querySelector('#capture-form').requestSubmit()`); await sleep(1800);
const before = await worker.evaluate(`chrome.storage.local.get('workspaceState').then(value => value.workspaceState)`);
assert.equal(before.queue.length, 1, JSON.stringify(before));
const account = before.connection.user.email;
await worker.evaluate(`chrome.runtime.reload()`); await sleep(2200);
const reloaded = (await pages()).find(page => page.url.endsWith('/service-worker.js'));
worker = await connect(reloaded);
const after = await worker.evaluate(`chrome.storage.local.get('workspaceState').then(value => value.workspaceState)`);
assert.equal(after.connection.user.email, account);
assert.equal(after.queue.length, 1);
const server = spawn('.venv/Scripts/python.exe', ['server/manage.py', 'runserver', '127.0.0.1:4180', '--noreload'], {
  env: { ...process.env, DATA_DIR: '.local/qa-entity', DATABASE_PATH: '.local/qa-entity/workspace.sqlite3', DEBUG: 'True',
    ALLOW_LOCAL_SETUP: 'True', SETUP_ENABLED: 'True', ALLOWED_HOSTS: '127.0.0.1,localhost',
    CSRF_TRUSTED_ORIGINS: 'http://127.0.0.1:4180', COOKIE_SECURE: 'False' }, stdio: 'ignore' });
await sleep(1800);
await popup.evaluate(`document.querySelector('#retry').click()`); await sleep(3500);
const synced = await worker.evaluate(`chrome.storage.local.get('workspaceState').then(value => value.workspaceState)`);
assert.equal(synced.queue.length, 0);
server.kill();
const result = { account, queueBeforeReload: before.queue.length, queueAfterReload: after.queue.length,
  queueAfterRetry: synced.queue.length, lastStatus: synced.lastResult?.outcome };
writeFileSync(new URL('./extension-1.3.1-queue-entity-2026-11-16.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
worker.socket.close(); popup.socket.close();
process.exit(0);
