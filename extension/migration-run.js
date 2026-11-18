// 迁移运行器：备份旧四套状态 + Blob → 在独立副本上先验证 → 原子写入新 Outbox。
// 旧 chrome.storage 与旧附件库绝不删除/清空：迁移失败保持旧数据可恢复。
import { planMigration, verifyMigration, applyMigration } from './migration.js';
import { createMemoryOutboxStore } from './outbox-store.js';

const LEGACY_STATE_KEY = 'workspaceState';
const ICON_TASKS_KEY = 'workspaceIconTasks';
const BACKUP_KEY = 'workspaceOutboxBackupV1';

/** 从旧附件 IndexedDB 读出摘要索引（id→bytes/digest），不搬 Blob 内容本身。 */
function blobIndexFromAttachments(records) {
  const index = {};
  for (const record of records || []) {
    if (record?.id) index[record.id] = { bytes: record.bytes || record.blob?.size || 0, digest: record.digest || null };
  }
  return index;
}

/**
 * @param storage  chrome.storage.local（get/set）
 * @param attachments  旧 attachment-store：{ all() }，返回旧附件记录
 * @param store   新 Outbox store
 * @param now     时间注入（测试可预测）
 */
export async function runMigration({ storage, attachments, store, now = Date.now,
  verify = verifyMigration, trialStore = createMemoryOutboxStore() }) {
  const snap = await store.load();
  if (snap.meta.migration) return { skipped: true, reason: '已迁移' };
  const stored = await storage.get([LEGACY_STATE_KEY, ICON_TASKS_KEY, BACKUP_KEY]);
  const legacy = stored[LEGACY_STATE_KEY] || {};
  const iconRaw = stored[ICON_TASKS_KEY]?.tasks || {};
  const iconTasks = Object.values(iconRaw);
  const queue = legacy.queue || [];
  const assetJobs = legacy.assetJobs || [];
  const captureReceipts = legacy.captureReceipts || {};
  let attachmentRecords = [];
  try { attachmentRecords = (await attachments?.all?.()) || []; } catch { /* 旧库不存在视为无附件 */ }
  const blobIndex = blobIndexFromAttachments(attachmentRecords);

  // 1) 先备份（幂等；已存在则不覆盖），保留旧数据可恢复。
  if (!stored[BACKUP_KEY]) {
    await storage.set({ [BACKUP_KEY]: { backedUpAt: now(),
      queue, assetJobs, captureReceipts, iconTasks,
      blobIds: attachmentRecords.map(record => record.id).filter(Boolean) } });
  }
  // 2) 生成迁移计划。
  const plan = planMigration({ queue, assetJobs, captureReceipts, iconTasks, blobIndex, now: now() });
  // 3) 在独立副本（内存 store）上先验证任务数/身份/Blob 摘要；不通过则抛错，绝不标记完成。
  const verification = verify(plan, { queue, blobIndex });
  if (!verification.ok) throw new Error(`迁移核对失败：${verification.reason}`);
  const trial = trialStore;
  await applyMigration(trial, plan, now()); // 独立副本试迁移
  const trialSnap = await trial.load();
  if (Object.keys(trialSnap.captures).length !== plan.records.length) throw new Error('独立副本试迁移记录数不符');
  // 4) 原子写入权威库。
  await applyMigration(store, plan, now());
  return { skipped: false, migrated: plan.records.length, warnings: plan.warnings,
    verification };
}
