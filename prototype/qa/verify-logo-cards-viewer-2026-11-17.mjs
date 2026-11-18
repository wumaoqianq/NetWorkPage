import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const errors = [], requests = [];
const target = await fetch('http://127.0.0.1:9225/json/new?about:blank', { method: 'PUT' }).then(response => response.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
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
  if (message.method === 'Network.requestWillBeSent') requests.push({ url: message.params.request.url, method: message.params.request.method });
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
  throw new Error(`Timed out: ${selector}`);
}
async function input(selector, value) {
  await waitFor(selector);
  await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value').set.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); })()`);
}
async function click(selector) { await waitFor(selector); await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus(); document.querySelector(${JSON.stringify(selector)}).click()`); }
async function screenshot(name) {
  const result = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true });
  writeFileSync(new URL(`./${name}`, import.meta.url), Buffer.from(result.data, 'base64'));
}
async function viewport(width, height = 1000, mobile = false) { await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }); await sleep(250); }
function shell(code) {
  return execFileSync('.venv/Scripts/python.exe', ['server/manage.py', 'shell', '-c', code], { env: { ...process.env,
    DATA_DIR: '.local/qa-viewer', DATABASE_PATH: '.local/qa-viewer/workspace.sqlite3', DEBUG: 'True', ALLOW_LOCAL_SETUP: 'True', SETUP_ENABLED: 'True' }, encoding: 'utf8' });
}
const asset = "from workspace.models import PreviewAsset; from django.conf import settings; from pathlib import Path; a=PreviewAsset.objects.get(); p=Path(settings.MEDIA_ROOT)/a.storage_key";
await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
await navigate('http://127.0.0.1:4180/');
if (await evaluate(`Boolean(document.querySelector('input[type="email"]'))`)) {
  await input('input[type="email"]', 'viewer@example.test'); await input('input[type="password"]', 'Viewer-Only!234');
  await click('.auth-form button[type="submit"]'); await sleep(1200);
}
await waitFor('.site-card');
assert.equal(await evaluate(`document.querySelectorAll('.site-card').length`), 30);
assert.equal(requests.filter(item => item.url.includes('/preview/image')).length, 0);
const metrics = [];
for (const width of [360, 768, 1280, 1440, 1920]) {
  await viewport(width, 900, width === 360);
  metrics.push(await evaluate(`(() => { const card = document.querySelector('.site-card'); const grid = document.querySelector('.site-grid');
    return { viewport: ${width}, columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length, width: card.getBoundingClientRect().width,
      height: card.getBoundingClientRect().height, logo: document.querySelector('.card-logo').getBoundingClientRect().width,
      overflow: document.documentElement.scrollWidth > innerWidth, transform: getComputedStyle(card).transform }; })()`));
}
assert.ok(metrics.every(item => !item.overflow && item.transform === 'none'));
await viewport(1440); await screenshot('logo-cards-standard-2026-11-17.png');
await click('.site-card .screenshot-button'); await waitFor('.viewer-image.fit');
await evaluate(`document.querySelector('.viewer-image.fit').decode()`);
const initial = await evaluate(`({ width: document.querySelector('.viewer-image.fit').naturalWidth, src: document.querySelector('.viewer-image.fit').src })`);
assert.equal(initial.width, 960); assert.match(initial.src, /^blob:/);
assert.equal(requests.filter(item => item.url.includes('/preview/image')).length, 1);
await click('.viewer-toolbar button:nth-child(2)');
await evaluate(`document.querySelectorAll('.viewer-toolbar button')[1].click()`);
await screenshot('screenshot-viewer-original-2026-11-17.png');
await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(250);
assert.equal(await evaluate(`document.activeElement.classList.contains('screenshot-button')`), true);
await navigate('http://127.0.0.1:4180/'); await click('.site-card .screenshot-button'); await waitFor('.viewer-image.fit');
await evaluate(`document.querySelector('.viewer-image.fit').decode()`);
assert.equal(await evaluate(`document.querySelector('.viewer-image.fit').naturalWidth`), 960);
await cdp('Page.navigate', { url: 'http://127.0.0.1:4180/' }); await sleep(400);
shell(`${asset}; p.rename(p.with_suffix('.bak'))`);
await click('.site-card .screenshot-button'); await waitFor('.viewer-message[role="alert"]');
assert.match(await evaluate(`document.querySelector('.viewer-message').textContent`), /截图暂不可用/);
shell(`${asset}; p.with_suffix('.bak').rename(p)`);
await click('.viewer-error-actions .primary-button'); await waitFor('.viewer-image.fit');
await evaluate(`document.querySelector('.viewer-image.fit').decode()`);
assert.equal(await evaluate(`document.querySelector('.viewer-image.fit').naturalWidth`), 960);
await cdp('Page.navigate', { url: 'http://127.0.0.1:4180/' }); await sleep(400);
shell(`${asset}; p.rename(p.with_suffix('.bak'))`);
await click('.site-card .screenshot-button'); await waitFor('.viewer-message[role="alert"]');
shell(`${asset}; import uuid; from django.utils import timezone; a.storage_key='1/screenshot-b.webp'; a.revision=uuid.uuid4(); a.save(); p.with_suffix('.bak').unlink(); a.site.version += 1; a.site.save(update_fields=['version','updated_at'])`);
await evaluate(`window.dispatchEvent(new Event('focus'))`); await sleep(1500);
await waitFor('.viewer-image.fit');
assert.equal(await evaluate(`document.querySelector('.viewer-image.fit').naturalWidth`), 960);
shell(`${asset}; import uuid; a.storage_key='1/screenshot-c.webp'; a.revision=uuid.uuid4(); a.save(); a.site.version += 1; a.site.save(update_fields=['version','updated_at'])`);
await evaluate(`window.dispatchEvent(new Event('focus'))`); await sleep(1500);
await waitFor('.viewer-update');
assert.match(await evaluate(`document.querySelector('.viewer-update').textContent`), /有新截图/);
await click('.viewer-update .secondary-button'); await waitFor('.viewer-image.fit');
await evaluate(`document.querySelector('.viewer-image.fit').decode()`);
await click('.dialog-header .icon-button');
const sizeRequestStart = requests.length;
await click('.card-size-presets button:nth-child(1)'); await sleep(350);
const compact = await evaluate(`({ columns: getComputedStyle(document.querySelector('.site-grid')).gridTemplateColumns.split(' ').length,
  target: document.querySelector('.site-grid').style.getPropertyValue('--card-target') })`);
assert.equal(compact.target, '220px');
await input('.card-size-slider input', '320'); await sleep(500);
await navigate('http://127.0.0.1:4180/');
assert.equal(await evaluate(`document.querySelector('.site-grid').style.getPropertyValue('--card-target')`), '320px');
const preference = await evaluate(`Object.keys(localStorage).filter(key => key.includes('workspace-card-preferences-v1:http://127.0.0.1:4180:user:'))`);
assert.equal(preference.length, 1);
const dragWrites = requests.slice(sizeRequestStart).filter(item => ['POST', 'PATCH', 'DELETE'].includes(item.method));
assert.equal(dragWrites.length, 0);
await click('.card-size-presets button:nth-child(3)'); await sleep(350);
await viewport(1440); await screenshot('logo-cards-wide-2026-11-17.png');
shell(`${asset}; a.site.payload['archived']=True; a.site.save(update_fields=['payload','updated_at'])`);
await evaluate(`window.dispatchEvent(new Event('focus'))`); await sleep(1400);
await evaluate(`[...document.querySelectorAll('.nav-item')].find(button => button.textContent.includes('归档网站')).click()`); await sleep(300);
await click('.site-card .screenshot-button'); await waitFor('.viewer-image.fit');
await evaluate(`document.querySelector('.viewer-image.fit').decode()`);
await click('.dialog-header .icon-button');
shell(`${asset}; a.site.payload['deleted']=True; a.site.payload['archived']=False; a.site.save(update_fields=['payload','updated_at'])`);
await evaluate(`window.dispatchEvent(new Event('focus'))`); await sleep(1400);
await evaluate(`[...document.querySelectorAll('.nav-item')].find(button => button.textContent.includes('回收站')).click()`); await sleep(300);
await click('.site-card .screenshot-button'); await waitFor('.viewer-image.fit');
await evaluate(`document.querySelector('.viewer-image.fit').decode()`);
assert.deepEqual(errors, []);
console.log(JSON.stringify({ metrics, initialImageWidth: initial.width, refreshRecovered: true, retryRecovered: true,
  revisionRecovered: true, replacementOffered: true, archiveAndTrashReadable: true, compact, preference, dragWrites: dragWrites.length,
  screenshotRequests: requests.filter(item => item.url.includes('/preview/image')).length, errors }, null, 2));
socket.close();
