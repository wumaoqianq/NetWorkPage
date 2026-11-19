const pages = await fetch('http://127.0.0.1:9226/json/list').then(response => response.json());
const extensionId = 'chrome-extension://mgoiiimmoehjajddbejpjljhmondnbem';
const created = await fetch(`http://127.0.0.1:9226/json/new?${encodeURIComponent(`${extensionId}/options.html`)}`, { method: 'PUT' }).then(response => response.json());
const socket = new WebSocket(created.webSocketDebuggerUrl);
await new Promise(resolve => { socket.onopen = resolve; });
let sequence = 0;
const pending = new Map();
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const waiter = pending.get(message.id); pending.delete(message.id);
  if (message.error) waiter.reject(new Error(JSON.stringify(message.error))); else waiter.resolve(message.result);
};
function cdp(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
}
await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Page.bringToFront');
await new Promise(resolve => setTimeout(resolve, 1000));
await cdp('Runtime.evaluate', { expression: `document.querySelector('#check-release').addEventListener('click', () => chrome.permissions.request({ origins: ['https://example.com/*'] }))` });
const rect = await cdp('Runtime.evaluate', { expression: `(() => { const rect = document.querySelector('#check-release').getBoundingClientRect(); return { x: rect.x + 20, y: rect.y + 20 }; })()`, returnByValue: true });
console.log('Button rect', rect);
await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...rect.result.value, button: 'left', clickCount: 1 });
await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...rect.result.value, button: 'left', clickCount: 1 });
await new Promise(resolve => setTimeout(resolve, 500));
console.log('Permission request dispatched');
socket.close();
