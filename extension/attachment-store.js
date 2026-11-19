const DATABASE = 'website-workspace-attachments';
const STORE = 'previews';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开本地图片存储'));
    request.onblocked = () => reject(new Error('本地图片存储被其他页面阻塞'));
  });
}

export function createAttachmentStore() {
  async function transaction(mode, operation) {
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const tx = database.transaction(STORE, mode);
        const request = operation(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('本地图片操作失败'));
        tx.onabort = () => reject(tx.error || new Error('本地图片事务已中止'));
      });
    } finally { database.close(); }
  }
  return {
    async put(record) {
      if (!record?.id || !(record.blob instanceof Blob) || !record.server || !record.userId) {
        throw new Error('图片草稿缺少身份或内容');
      }
      if (record.blob.size > 200 * 1024) throw new Error('图片超过 200KiB，请重新截图。');
      if (navigator.storage?.estimate) {
        const { quota, usage } = await navigator.storage.estimate();
        if (quota && quota - usage < record.blob.size + 256 * 1024) {
          throw new Error('本地空间不足，未保存；可移除图片后只保存文字。');
        }
      }
      await transaction('readwrite', store => store.put({ ...record, bytes: record.blob.size }));
      return record;
    },
    get: id => transaction('readonly', store => store.get(id)),
    remove: id => transaction('readwrite', store => store.delete(id)),
    async all() {
      return transaction('readonly', store => store.getAll());
    },
    async prune(validIds, now = Date.now()) {
      const records = await this.all();
      await Promise.all(records.filter(record => !validIds.has(record.id) && now - record.createdAt > 86400000)
        .map(record => this.remove(record.id)));
    },
  };
}
