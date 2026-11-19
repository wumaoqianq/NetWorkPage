const pages = await fetch('http://127.0.0.1:9226/json/list').then(response => response.json());
const page = pages.find(item => item.url.endsWith('/options.html'));
if (!page) throw new Error('No options page');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(resolve => { socket.onopen = resolve; });
const result = await new Promise(resolve => {
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id === 1) resolve(message);
  };
  socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: `(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('website-workspace-attachments', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const records = await new Promise((resolve, reject) => {
      const request = database.transaction('previews', 'readonly').objectStore('previews').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return records.map(record => ({ id: record.id, kind: record.kind, captureId: record.captureId,
      bytes: record.blob.size, sourceUrl: record.sourceUrl, createdAt: record.createdAt }));
  })()`, returnByValue: true, awaitPromise: true } }));
});
console.log(JSON.stringify(result));
socket.close();
