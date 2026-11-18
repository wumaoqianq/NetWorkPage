// 单一权威 Outbox：一个 IndexedDB 数据库、一个对象仓库、一次 readwrite 事务
// 同时保存任务记录、附件 Blob、schemaVersion/迁移标记。不存在跨库半成品。
const DATABASE = 'website-workspace-outbox';
const STORE = 'outbox';
const KEY = 'state';
export const OUTBOX_SCHEMA = 1;

const emptyState = () => ({ schemaVersion: OUTBOX_SCHEMA, captures: {}, blobs: {}, meta: {} });

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开发件箱数据库'));
    request.onblocked = () => reject(new Error('发件箱数据库被其他页面阻塞'));
  });
}

function applyOps(state, ops) {
  for (const [key, record] of ops.capturePut || []) state.captures[key] = record;
  for (const key of ops.captureDelete || []) delete state.captures[key];
  for (const [id, blob] of ops.blobPut || []) state.blobs[id] = blob;
  for (const id of ops.blobDelete || []) delete state.blobs[id];
  for (const [key, value] of ops.metaPut || []) state.meta[key] = value;
  for (const key of ops.metaDelete || []) delete state.meta[key];
  state.schemaVersion = OUTBOX_SCHEMA;
  return state;
}

/** 生产实现：load 只读；commit 在同一 readwrite 事务内 get→apply→put，失败整体回滚。 */
export function createOutboxStore() {
  async function load() {
    const db = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(KEY);
        req.onsuccess = () => resolve({ ...emptyState(), ...(req.result || {}) });
        req.onerror = () => reject(req.error || new Error('发件箱读取失败'));
        tx.onabort = () => reject(tx.error || new Error('发件箱读取事务中止'));
      });
    } finally { db.close(); }
  }
  async function commit(ops) {
    const db = await openDatabase();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const get = store.get(KEY);
        get.onsuccess = () => {
          const current = { ...emptyState(), ...(get.result || {}) };
          store.put(applyOps(current, ops), KEY);
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('发件箱写入失败'));
        tx.onabort = () => reject(tx.error || new Error('发件箱事务已中止'));
      });
    } finally { db.close(); }
  }
  return { load, commit };
}

/** 与生产同语义的内存实现，供 Node 回归与独立副本迁移验证；commit 可注入失败以验证回滚。 */
export function createMemoryOutboxStore() {
  let state = emptyState();
  const clone = value => JSON.parse(JSON.stringify(value));
  return {
    async load() { return clone(state); },
    async commit(ops) {
      if (this.failNextCommit) { this.failNextCommit = false; throw new Error('事务中止（测试注入）'); }
      state = applyOps(clone(state), ops);
    },
    failNextCommit: false,
  };
}
