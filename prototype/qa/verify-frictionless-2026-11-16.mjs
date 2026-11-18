import { writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const target = await fetch('http://127.0.0.1:9223/json/new?about:blank', { method: 'PUT' }).then(response => response.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
const errors = [];
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const waiter = pending.get(message.id); pending.delete(message.id);
    if (message.error) waiter?.reject(new Error(JSON.stringify(message.error))); else waiter?.resolve(message.result);
  }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push('console.error');
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
async function navigate(url) { await cdp('Page.navigate', { url }); await sleep(1300); }
async function waitFor(selector) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${selector}`);
}
async function input(selector, value) {
  await waitFor(selector);
  await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value').set;
    setter.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); })()`);
}
async function screenshot(name) {
  const result = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true });
  writeFileSync(new URL(`./${name}`, import.meta.url), Buffer.from(result.data, 'base64'));
}
async function viewport(width, height = 1000, mobile = false) {
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }); await sleep(250);
}
async function api(path, { method = 'GET', body, token } = {}) {
  const serialized = body === undefined ? null : JSON.stringify(body);
  return evaluate(`(async () => {
    const session = await fetch('/api/auth/session').then(response => response.json());
    const headers = { Accept: 'application/json' };
    const payload = ${serialized === null ? 'null' : JSON.stringify(serialized)};
    if (payload !== null) headers['Content-Type'] = 'application/json';
    if (${token ? 'true' : 'false'}) headers.Authorization = 'Bearer ' + ${JSON.stringify(token || '')};
    if (${JSON.stringify(method)} !== 'GET') headers['X-CSRFToken'] = session.csrfToken;
    const response = await fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, headers,
      body: payload === null ? undefined : payload });
    const data = await response.json(); return { status: response.status, data };
  })()`);
}
await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
await navigate('http://127.0.0.1:4180/');
await waitFor('input[type="email"], .site-card');
if (await evaluate(`Boolean(document.querySelector('input[type="email"]'))`)) {
  await input('input[type="email"]', 'qa@example.test'); await input('input[type="password"]', 'QA-Only!23456');
  await evaluate(`document.querySelector('.auth-form').requestSubmit()`); await sleep(1400);
}
await waitFor('.site-card');
assert.ok(await evaluate(`document.querySelectorAll('.site-card').length`) >= 30);
const density = [];
for (const [width, columns] of [[1280, 3], [1440, 4], [1920, 5]]) {
  await viewport(width);
  const metric = await evaluate(`(() => { const grid = document.querySelector('.site-grid'); const card = document.querySelector('.site-card');
    return { columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length, height: document.querySelector('.site-card').getBoundingClientRect().height,
      width: card.getBoundingClientRect().width, cards: document.querySelectorAll('.site-card').length, overflow: document.documentElement.scrollWidth > innerWidth }; })()`);
  assert.equal(metric.columns, columns); assert.ok(metric.cards >= 30); assert.ok(metric.height >= 160 && metric.height <= 180); assert.equal(metric.overflow, false);
  density.push({ viewport: width, ...metric });
}
await screenshot('frictionless-30-cards-1440-2026-11-16.png');
await viewport(360, 800, true);
const mobile = await evaluate(`({ overflow: document.documentElement.scrollWidth > innerWidth, height: document.querySelector('.site-card').getBoundingClientRect().height,
  columns: getComputedStyle(document.querySelector('.site-grid')).gridTemplateColumns.split(' ').length })`);
assert.equal(mobile.overflow, false); assert.equal(mobile.columns, 1); assert.ok(mobile.height <= 180);
await screenshot('frictionless-mobile-2026-11-16.png');
await cdp('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
assert.equal(await evaluate(`document.querySelector('.open-site').getBoundingClientRect().height >= 44`), true);
await cdp('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }); await viewport(1440);
await evaluate(`document.querySelector('.site-title').focus(); document.activeElement.classList.contains('site-title')`);
assert.equal(await evaluate(`document.activeElement.classList.contains('site-title')`), true);
await screenshot('frictionless-30-cards-1440-2026-11-16.png');
const firstId = await evaluate(`document.querySelector('.site-card').dataset.siteId`);
await navigate(`http://127.0.0.1:4180/?site=${firstId}`);
assert.equal(await evaluate(`location.search.includes('site=') && !!document.querySelector('.drawer-content')`), true);
await navigate('http://127.0.0.1:4180/');
await evaluate(`document.querySelector('.topbar-actions .primary-button').click()`); await sleep(200);
await input('.site-form input[name="name"]', '轮询期间正在编辑');
const beforeAdd = await evaluate(`document.querySelectorAll('.site-card').length`);
const created = await api('/api/sites', { method: 'POST', body: { name: '后台自动新增', description: '', notes: '自动备注定位', category: '', inbox: false,
  endpoints: [{ id: crypto.randomUUID(), label: '默认入口', url: `https://example.com/auto-added-${crypto.randomUUID()}`, scope: '公网' }] } });
assert.equal(created.status, 200, JSON.stringify(created)); assert.equal(created.data.inbox, false);
await evaluate(`window.dispatchEvent(new Event('focus'))`); await sleep(1500);
assert.equal(await evaluate(`document.querySelectorAll('.site-card').length`), beforeAdd + 1);
assert.equal(await evaluate(`document.querySelector('.site-form input[name="name"]').value`), '轮询期间正在编辑');
await evaluate(`document.querySelector('.form-footer .secondary-button').click()`);
await navigate(`http://127.0.0.1:4180/?site=${created.data.id}`);
assert.equal(await evaluate(`document.querySelector('.detail-brand h3').textContent`), '后台自动新增');
await navigate('http://127.0.0.1:4180/'); await input('.search-field input', '自动备注定位'); await sleep(250);
assert.ok(await evaluate(`document.querySelectorAll('.site-card').length`) >= 1);
const release = await api('/api/extension/release');
assert.equal(release.status, 200, JSON.stringify(release));
assert.equal(release.data.version, '1.3.0');
const download = await evaluate(`(async () => { const response = await fetch(${JSON.stringify(release.data.downloadPath)}); const bytes = await response.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes); return { status: response.status, cache: response.headers.get('cache-control'),
    sha256: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('') }; })()`);
assert.equal(download.status, 200); assert.equal(download.sha256, release.data.sha256); assert.equal(download.cache, 'private, no-store');
const code = await api('/api/extension/pairing-code', { method: 'POST', body: {} });
const paired = await api('/api/extension/pair', { method: 'POST', body: { code: code.data.code, name: 'QA Edge', extensionVersion: '1.3.0', protocolVersion: 2 } });
const token = paired.data.token;
const captureId = crypto.randomUUID();
const captured = await api('/api/extension/v2/captures', { method: 'POST', token, body: { clientCaptureId: captureId,
  url: 'https://example.com/notes-flow', title: '协议备注与图标', description: '自动简介', purpose: '', notes: '第一段备注', category: '', tags: [], collectionIds: [],
  pinned: false, later: false, homepageUrl: '', scope: '公网' } });
assert.equal(captured.status, 200); assert.equal(captured.data.site.inbox, false); assert.equal(captured.data.canAttachIcon, true);
const png = readFileSync(new URL('../../.local/qa-icon.png', import.meta.url)).toString('base64');
const icon = await evaluate(`(async () => { const form = new FormData(); form.append('clientAssetId', crypto.randomUUID()); form.append('expectedVersion', '1');
  form.append('sourceUrl', 'https://example.com/notes-flow'); form.append('file', new Blob([Uint8Array.from(atob(${JSON.stringify(png)}), c => c.charCodeAt(0))], { type: 'image/png' }), 'icon.png');
  const response = await fetch('/api/extension/v2/captures/${captureId}/icon', { method: 'POST', headers: { Authorization: 'Bearer ' + ${JSON.stringify(token)} }, body: form });
  return { status: response.status, data: await response.json() }; })()`);
assert.equal(icon.status, 200); assert.equal(icon.data.siteVersion, 2);
const lookup = await api(`/api/extension/lookup?url=${encodeURIComponent('https://example.com/notes-flow')}`, { token });
assert.equal('notes' in lookup.data.site, false);
const appended = await api('/api/extension/v2/captures', { method: 'POST', token, body: { clientCaptureId: crypto.randomUUID(),
  url: 'https://example.com/notes-flow', title: '协议备注与图标', description: '', purpose: '', notes: '第二段备注', category: '', tags: [], collectionIds: [],
  appendNotes: true, expectedVersion: 2, updateFields: [] } });
assert.equal(appended.status, 200);
const siteWithIcon = await api(`/api/sites/${captured.data.site.id}`);
assert.ok(siteWithIcon.data.notes.includes('第一段备注')); assert.ok(siteWithIcon.data.notes.includes('第二段备注'));
assert.equal(siteWithIcon.data.presentation.icon.present, true);
const privateIcon = await evaluate(`fetch(${JSON.stringify(siteWithIcon.data.presentation.icon.url)}).then(response => ({ status: response.status, cache: response.headers.get('cache-control') }))`);
assert.equal(privateIcon.status, 200); assert.equal(privateIcon.cache, 'private, no-store');
const manualSession = execFileSync('.venv/Scripts/python.exe', ['.local/manual-test-server.py', 'shell', '-c',
  "from django.contrib.sessions.backends.db import SessionStore; from django.contrib.auth.models import User; user=User.objects.order_by('id').first(); session=SessionStore(); session['_auth_user_id']=str(user.pk); session['_auth_user_backend']='django.contrib.auth.backends.ModelBackend'; session['_auth_user_hash']=user.get_session_auth_hash(); session.save(); print(session.session_key)"], { encoding: 'utf8' }).trim().split(/\r?\n/).pop();
await cdp('Network.setCookie', { name: 'sessionid', value: manualSession, url: 'http://127.0.0.1:4173/', httpOnly: true, sameSite: 'Lax' });
await navigate('http://127.0.0.1:4173/');
assert.equal(await evaluate(`document.querySelectorAll('.site-card').length`), 1);
assert.equal(await evaluate(`document.querySelector('.brand-mark').src.includes('workspace-mark.svg')`), true);
const localRelease = await api('/api/extension/release'); assert.equal(localRelease.data.version, '1.3.0');
await screenshot('local-4173-extension-1.3-2026-11-16.png');
assert.deepEqual(errors, []);
console.log(JSON.stringify({ density, mobile, autoDiscovered: true, editorPreserved: true, deepLink: true,
  downloadSha256: download.sha256, notesAppend: true, privateIcon: true, local4173: { existingCards: 1, release: localRelease.data.version }, errors }, null, 2));
socket.close();
