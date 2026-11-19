import { writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const errors = [];
async function pages() { return fetch('http://127.0.0.1:9224/json/list').then(response => response.json()); }
async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const waiter = pending.get(message.id); pending.delete(message.id);
      if (message.error) waiter?.reject(new Error(JSON.stringify(message.error))); else waiter?.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (message.method === 'Fetch.requestPaused') void cdp('Fetch.failRequest', { requestId: message.params.requestId, errorReason: 'Failed' });
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
async function waitPage(predicate, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const page = (await pages()).find(predicate);
    if (page) return page;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
async function newPage(url) {
  const target = await fetch(`http://127.0.0.1:9224/json/new?${encodeURIComponent(url)}`, { method: 'PUT' }).then(response => response.json());
  const client = await connect(target.webSocketDebuggerUrl);
  await client.cdp('Page.enable'); await client.cdp('Runtime.enable');
  await client.cdp('Page.navigate', { url }); await sleep(400);
  return client;
}
async function waitFor(client, selector) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await client.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${selector}`);
}
async function input(client, selector, value) {
  await waitFor(client, selector);
  await client.evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value').set.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); })()`);
}
async function click(client, selector) {
  await waitFor(client, selector);
  const rect = await client.evaluate(`(() => { const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })()`);
  await client.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...rect, button: 'left', clickCount: 1 });
  await client.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...rect, button: 'left', clickCount: 1 });
}
async function triggerActionPopup(client) {
  await client.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 's', code: 'KeyS',
    windowsVirtualKeyCode: 83, nativeVirtualKeyCode: 83, modifiers: 9 });
  await client.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 's', code: 'KeyS',
    windowsVirtualKeyCode: 83, nativeVirtualKeyCode: 83, modifiers: 9 });
}
async function screenshot(client, name) {
  const result = await client.cdp('Page.captureScreenshot', { format: 'png', fromSurface: true });
  writeFileSync(new URL(`./${name}`, import.meta.url), Buffer.from(result.data, 'base64'));
}
let workerPage = (await pages()).find(page => page.url.endsWith('/service-worker.js'));
if (!workerPage) {
  await newPage('chrome-extension://fnjjeofjgnpneheohngempamfcgincbh/options.html');
  workerPage = await waitPage(page => page.url.endsWith('/service-worker.js'), 'extension worker');
}
let worker = await connect(workerPage.webSocketDebuggerUrl);
assert.equal(await worker.evaluate(`chrome.runtime.getManifest().version`), '1.3.1');
const extensionId = workerPage.url.match(/^chrome-extension:\/\/[^/]+/)[0];
const pairingCode = execFileSync('.venv/Scripts/python.exe', ['server/manage.py', 'shell', '-c',
  "from workspace.models import PairingCode; from workspace.http import digest; from django.contrib.auth.models import User; from django.utils import timezone; from datetime import timedelta; import secrets; code=secrets.token_urlsafe(12); PairingCode.objects.create(owner=User.objects.get(username='entity@example.test'),token_hash=digest(code),expires_at=timezone.now()+timedelta(minutes=5)); print(code)"], {
    env: { ...process.env, DATA_DIR: '.local/qa-entity', DATABASE_PATH: '.local/qa-entity/workspace.sqlite3', DEBUG: 'True', ALLOW_LOCAL_SETUP: 'True', SETUP_ENABLED: 'True' }, encoding: 'utf8' }).trim().split(/\r?\n/).pop();
const options = await newPage(`${extensionId}/options.html`);
await input(options, '#server', 'http://127.0.0.1:4180'); await input(options, '#code', pairingCode);
await input(options, '#device-name', '实体 Edge QA');
await click(options, '#pair'); await sleep(2200);
const pairMessage = await options.evaluate(`document.querySelector('#message').textContent`);
assert.match(pairMessage, /已连接到/);
const target = await waitPage(page => page.url.startsWith('http://127.0.0.1:4181/'), 'capture target');
const targetClient = await connect(target.webSocketDebuggerUrl);
await targetClient.cdp('Page.enable');
await targetClient.cdp('Page.navigate', { url: `http://127.0.0.1:4181/?run=${crypto.randomUUID()}` }); await sleep(500);
await targetClient.cdp('Page.bringToFront'); await sleep(800);
await worker.evaluate(`chrome.tabs.query({active:true,currentWindow:true}).then(tabs => tabs[0].id)`);
assert.equal(await worker.evaluate(`typeof chrome.action.openPopup`), 'function');
await triggerActionPopup(targetClient);
const popupPage = await waitPage(page => page.url === `${extensionId}/popup.html`, 'extension popup');
const popup = await connect(popupPage.webSocketDebuggerUrl);
await popup.cdp('Page.enable'); await popup.cdp('Runtime.enable');
await waitFor(popup, '#category option[value="设计工具"]');
await waitFor(popup, '#notes');
for (let attempt = 0; attempt < 100; attempt++) {
  const statuses = await popup.evaluate(`[document.querySelector('#asset-status-preview').textContent, document.querySelector('#asset-status-icon').textContent]`);
  if (statuses.every(value => value.includes('已就绪'))) break;
  if (attempt === 99) throw new Error(`Assets not ready: ${statuses.join(' | ')}`);
  await sleep(100);
}
await input(popup, '#notes', '实体 Edge 截图与图标验证备注');
await popup.evaluate(`(() => { const select = document.querySelector('#category'); select.value = '设计工具'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
const preview = await popup.evaluate(`({ source: document.querySelector('#automatic-image').src, icon: document.querySelector('#page-icon').src,
  category: document.querySelector('#category').value, notes: document.querySelector('#notes').value })`);
assert.match(preview.source, /^data:image\/webp/); assert.match(preview.icon, /^blob:/);
assert.equal(preview.category, '设计工具');
await screenshot(popup, 'extension-1.3.1-popup-entity-2026-11-16.png');
await click(popup, '#save'); await sleep(3500);
const finalMessage = await popup.evaluate(`document.querySelector('#message').textContent`);
assert.doesNotMatch(finalMessage, /未保存|失败|被拒绝/);
const state = await worker.evaluate(`chrome.storage.local.get('workspaceState').then(value => value.workspaceState)`);
assert.equal(state.queue.length, 0);
const siteId = state.lastResult.siteId;
assert.ok(siteId);
const workspace = await newPage('http://127.0.0.1:4180/');
if (await workspace.evaluate(`Boolean(document.querySelector('input[type="email"]'))`)) {
  await input(workspace, 'input[type="email"]', 'entity@example.test'); await input(workspace, 'input[type="password"]', 'Entity-Only!234');
  await click(workspace, '.auth-form button[type="submit"]'); await sleep(1200);
}
await workspace.cdp('Page.navigate', { url: `http://127.0.0.1:4180/?site=${siteId}` }); await sleep(1400);
await waitFor(workspace, '.detail-preview-image img');
const images = await workspace.evaluate(`(async () => { await new Promise(resolve => setTimeout(resolve, 700));
  return { preview: document.querySelector('.detail-preview-image img').naturalWidth,
    icon: document.querySelector('.detail-brand .site-icon img').naturalWidth,
    notes: document.querySelector('.preserve-lines').textContent,
    category: [...document.querySelectorAll('.detail-section .tags span')].map(value => value.textContent) }; })()`);
assert.ok(images.preview > 0); assert.ok(images.icon > 0); assert.equal(images.notes, '实体 Edge 截图与图标验证备注');
assert.ok(images.category.includes('设计工具'));
await screenshot(workspace, 'extension-1.3.1-detail-entity-2026-11-16.png');
execFileSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -like '*127.0.0.1:4180*' } | ForEach-Object { Stop-Process -Id $_.ProcessId }"]); await sleep(600);
await targetClient.cdp('Page.navigate', { url: `http://127.0.0.1:4181/?offline=${crypto.randomUUID()}` }); await sleep(400);
await targetClient.cdp('Page.bringToFront'); await sleep(800);
await worker.evaluate(`chrome.tabs.query({active:true,currentWindow:true}).then(tabs => tabs[0].id)`);
await triggerActionPopup(targetClient);
const offlinePopupPage = await waitPage(page => page.url === `${extensionId}/popup.html`, 'offline popup');
const offlinePopup = await connect(offlinePopupPage.webSocketDebuggerUrl);
await offlinePopup.cdp('Runtime.enable');
await waitFor(offlinePopup, '#notes');
await input(offlinePopup, '#notes', '离线队列保留验证');
await click(offlinePopup, '#save'); await sleep(1800);
const beforeReload = await worker.evaluate(`chrome.storage.local.get('workspaceState').then(value => value.workspaceState)`);
assert.equal(beforeReload.queue.length, 1);
const accountBefore = beforeReload.connection.user.email;
await worker.evaluate(`chrome.runtime.reload()`); await sleep(2200);
const reloadedPage = await waitPage(page => page.url.endsWith('/service-worker.js'), 'reloaded worker');
worker = await connect(reloadedPage.webSocketDebuggerUrl);
const afterReload = await worker.evaluate(`chrome.storage.local.get('workspaceState').then(value => value.workspaceState)`);
assert.equal(afterReload.connection.user.email, accountBefore);
assert.equal(afterReload.queue.length, 1);
const qaServer = spawn('.venv/Scripts/python.exe', ['server/manage.py', 'runserver', '127.0.0.1:4180', '--noreload'], {
  env: { ...process.env, DATA_DIR: '.local/qa-entity', DATABASE_PATH: '.local/qa-entity/workspace.sqlite3', DEBUG: 'True',
    ALLOW_LOCAL_SETUP: 'True', SETUP_ENABLED: 'True', ALLOWED_HOSTS: '127.0.0.1,localhost',
    CSRF_TRUSTED_ORIGINS: 'http://127.0.0.1:4180', COOKIE_SECURE: 'False' }, stdio: 'ignore' });
await sleep(1800);
await click(options, '#retry'); await sleep(3500);
const synced = await worker.evaluate(`chrome.storage.local.get('workspaceState').then(value => value.workspaceState)`);
assert.equal(synced.queue.length, 0);
qaServer.kill();
assert.deepEqual(errors, []);
console.log(JSON.stringify({ version: '1.3.1', popupCategory: preview.category, notes: images.notes,
  previewNaturalWidth: images.preview, iconNaturalWidth: images.icon, accountPreserved: accountBefore,
  offlineQueueBeforeReload: beforeReload.queue.length, offlineQueueAfterReload: afterReload.queue.length,
  queueAfterRetry: synced.queue.length, errors }, null, 2));
for (const client of [options, popup, workspace, offlinePopup, targetClient]) client.socket.close();
worker.socket.close();
