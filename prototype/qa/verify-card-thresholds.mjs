import assert from 'node:assert/strict';
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
const results = [];
for (const width of [239, 240, 299, 300]) {
  const response = await cdp('Runtime.evaluate', { expression: `(async () => {
    const card = document.querySelector('.site-card'); card.style.maxWidth = '${width}px'; card.style.width = '${width}px';
    await new Promise(resolve => setTimeout(resolve, 180));
    const logo = document.querySelector('.card-logo').getBoundingClientRect();
    const footer = document.querySelector('.card-footer').getBoundingClientRect();
    return { width: ${width}, logo: logo.width, footerHeight: footer.height, overflow: document.documentElement.scrollWidth > innerWidth };
  })()`, awaitPromise: true, returnByValue: true });
  results.push(response.result.value);
}
assert.deepEqual(results.map(item => item.logo), [36, 48, 48, 64]);
assert.ok(results.every(item => !item.overflow && item.footerHeight >= 32));
await cdp('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
const zoomed = await cdp('Runtime.evaluate', { expression: `({ overflow: document.documentElement.scrollWidth > innerWidth,
  actions: [...document.querySelectorAll('.site-card .screenshot-button, .site-card .open-site')].every(button => {
    const rect = button.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.height > 0;
  }) })`, returnByValue: true });
assert.equal(zoomed.result.value.overflow, false);
assert.equal(zoomed.result.value.actions, true);
await cdp('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
console.log(JSON.stringify({ thresholds: results, zoom200: zoomed.result.value }, null, 2));
socket.close();
