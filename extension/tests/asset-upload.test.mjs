import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutbox } from '../outbox.js';
import { createMemoryOutboxStore } from '../outbox-store.js';
import { dataUrlToBlob } from '../asset-upload.js';

const server = 'https://workspace.example';
const cid = '05c70488-1cef-491f-93cc-9e680c535716';
const conn = { server, token: 'secret', user: { id: 7 }, device: { id: 2 }, expiresAt: '2099-01-01', paused: false };
const png = 'data:image/png;base64,AAAA';

function context({ baseResult, uploadResponse } = {}) {
  let clock = 1000;
  const store = createMemoryOutboxStore();
  const calls = [];
  const request = async (path, options) => {
    calls.push({ path, options });
    if (String(path).includes('/v3/captures/') && String(path).endsWith('/preview')) {
      return uploadResponse ? uploadResponse(options) : { assetId: 'asset-1', status: 'complete',
        siteVersion: 2, revision: 'rev-1' };
    }
    if (String(path).includes('/v3/captures/') && String(path).endsWith('/icon')) {
      return { assetId: 'asset-2', status: 'complete', siteVersion: 3, revision: 'rev-2' };
    }
    return baseResult || { site: { id: 'site-1', version: 1, category: 'AI', inbox: false },
      duplicate: false, outcome: 'created', canAttachPreview: true, canAttachIcon: true,
      previewBaseline: { present: false, revision: null, sourceFingerprint: 'fp1' },
      iconBaseline: { present: false, revision: null, sourceFingerprint: 'fp1' } };
  };
  const outbox = createOutbox({ store, request, readConnection: async () => conn,
    writeConnection: async () => {}, now: () => clock, workerId: 'w',
    attachmentStore: { dataUrlToBlob } });
  return { outbox, store, calls, advance: ms => { clock += ms; }, now: () => clock };
}

const draftTarget = () => ({ url: 'https://site.example/', title: 'A', scope: '公网',
  tabId: 41, windowId: 3, capturedAt: 1000 });

test('截图在提交时与文字任务同事务持久化为 Blob；sourceUrl 与 displayUrl 分离', async () => {
  const ctx = context();
  await ctx.outbox.openDraft({ draftId: cid, target: draftTarget(), connection: conn,
    rawPreview: png, icon: null });
  const rec = await ctx.outbox.record(cid);
  assert.equal(rec.preview.state, 'raw');
  assert.equal(rec.preview.displayUrl, png, 'displayUrl 仅用于页面显示');
  assert.equal(rec.preview.sourceUrl, 'https://site.example/', 'sourceUrl 是入口 URL，不是图片');
  assert.equal(rec.preview.blobId, null, '原始快照未压缩前不上传');
  const snap = await ctx.store.load();
  assert.ok(snap.blobs[rec.preview.rawBlobId], '原始 Blob 已持久化');
});

test('页面内压缩后：Blob 与任务记录原子更新，raw 清除；成功确认才释放 Blob', async () => {
  const ctx = context();
  await ctx.outbox.openDraft({ draftId: cid, target: draftTarget(), connection: conn, rawPreview: png });
  await ctx.outbox.compressAsset({ draftId: cid, kind: 'preview', dataUrl: 'data:image/webp;base64,CCCC',
    bytes: 4, width: 320, height: 200 });
  const rec = await ctx.outbox.record(cid);
  assert.equal(rec.preview.state, 'ready');
  assert.equal(rec.preview.rawBlobId, null, '转换成功即清除原始快照');
  assert.ok(rec.preview.blobId);
  assert.equal(rec.preview.sourceUrl, 'https://site.example/');
  assert.equal(rec.preview.displayUrl, 'data:image/webp;base64,CCCC');
  const snap = await ctx.store.load();
  assert.equal(Object.keys(snap.blobs).length, 1, '只剩压缩 Blob');
});

test('文字入库后按基线条件上传截图；成功后释放 Blob，文字阶段不被改写', async () => {
  const ctx = context();
  await ctx.outbox.openDraft({ draftId: cid, target: draftTarget(), connection: conn, rawPreview: png });
  await ctx.outbox.compressAsset({ draftId: cid, kind: 'preview', dataUrl: 'data:image/webp;base64,CCCC', bytes: 4 });
  await ctx.outbox.submitDraft({ draftId: cid, form: { notes: 'n' }, connection: conn });
  await ctx.outbox.flush(conn);
  const rec = await ctx.outbox.record(cid);
  assert.equal(rec.receipt.siteId, 'site-1', '文字回执保留');
  assert.equal(rec.preview.state, 'uploaded');
  assert.equal(rec.preview.blobId, null, '服务端确认后释放 Blob');
  const uploadCall = ctx.calls.find(c => String(c.path).endsWith('/preview'));
  assert.ok(uploadCall, '调用了 v3 条件上传');
  const form = uploadCall.options.form;
  assert.equal(form.get('expectedAssetRevision'), 'absent', '基线与站点版本无关');
  assert.equal(form.get('expectedSourceFingerprint'), 'fp1');
  assert.equal(form.get('sourceUrl'), 'https://site.example/');
  assert.equal(form.get('clientAssetId').length > 0, true);
});

test('用户换图/删图后基线冲突：保留 Blob 并暂停，不覆盖新内容、不静默套新版本', async () => {
  const ctx = context({ uploadResponse: () => { throw Object.assign(new Error('素材基线已变化'),
    { status: 409, code: 'asset_conflict' }); } });
  await ctx.outbox.openDraft({ draftId: cid, target: draftTarget(), connection: conn, rawPreview: png });
  await ctx.outbox.compressAsset({ draftId: cid, kind: 'preview', dataUrl: 'data:image/webp;base64,CCCC', bytes: 4 });
  await ctx.outbox.submitDraft({ draftId: cid, form: {}, connection: conn });
  await ctx.outbox.flush(conn);
  const rec = await ctx.outbox.record(cid);
  assert.equal(rec.preview.state, 'conflict');
  assert.ok(rec.preview.blobId, 'Blob 保留供用户处理');
  assert.equal(rec.needsUserAction, true);
  assert.equal(rec.receipt.siteId, 'site-1', '文字已确认不受影响');
  const snap = await ctx.store.load();
  assert.ok(snap.blobs[rec.preview.blobId]);
  assert.equal(ctx.calls.filter(c => String(c.path).includes('lookup')).length, 0, '不靠 lookup 猜版本');
  assert.equal(ctx.calls.filter(c => String(c.path).endsWith('/preview')).length, 1, '不自动重传');
});

test('网络失败/429 保留 Blob 有界退避；恢复后自动补传成功', async () => {
  let fail = true;
  const ctx = context({ uploadResponse: () => {
    if (fail) throw Object.assign(new Error('network'), { status: 503 });
    return { assetId: 'asset-1', status: 'complete', siteVersion: 2, revision: 'rev-1' };
  } });
  await ctx.outbox.openDraft({ draftId: cid, target: draftTarget(), connection: conn, rawPreview: png });
  await ctx.outbox.compressAsset({ draftId: cid, kind: 'preview', dataUrl: 'data:image/webp;base64,CCCC', bytes: 4 });
  await ctx.outbox.submitDraft({ draftId: cid, form: {}, connection: conn });
  await ctx.outbox.flush(conn);
  let rec = await ctx.outbox.record(cid);
  assert.ok(['ready', 'uploading'].includes(rec.preview.state), '失败后仍待上传');
  assert.ok((await ctx.store.load()).blobs[rec.preview.blobId], 'Blob 保留');
  ctx.advance(120000); fail = false;
  await ctx.outbox.flush(conn);
  rec = await ctx.outbox.record(cid);
  assert.equal(rec.preview.state, 'uploaded');
  assert.equal(rec.preview.blobId, null);
});

test('认证失败：整条任务 needs_auth 并暂停连接，截图 Blob 保留', async () => {
  const ctx = context({ uploadResponse: () => { throw Object.assign(new Error('expired'), { status: 401 }); } });
  await ctx.outbox.openDraft({ draftId: cid, target: draftTarget(), connection: conn, rawPreview: png });
  await ctx.outbox.compressAsset({ draftId: cid, kind: 'preview', dataUrl: 'data:image/webp;base64,CCCC', bytes: 4 });
  await ctx.outbox.submitDraft({ draftId: cid, form: {}, connection: conn });
  await ctx.outbox.flush(conn);
  const rec = await ctx.outbox.record(cid);
  assert.equal(rec.phase, 'needs_auth');
  assert.ok(rec.preview.blobId);
  assert.equal(rec.receipt.siteId, 'site-1', '文字阶段独立于素材');
});

test('重复收藏(canAttach=false)：跳过素材、不覆盖已有图片、不暂停连接、不上传附件', async () => {
  const ctx = context({ baseResult: { site: { id: 'site-1', version: 1, category: 'AI', inbox: false },
    duplicate: true, outcome: 'existing', canAttachPreview: false, canAttachIcon: false,
    previewBaseline: { present: true, revision: 'rev-old', sourceFingerprint: 'fp1' },
    iconBaseline: { present: true, revision: 'rev-old', sourceFingerprint: 'fp1' } } });
  await ctx.outbox.openDraft({ draftId: cid, target: draftTarget(), connection: conn, rawPreview: png });
  await ctx.outbox.compressAsset({ draftId: cid, kind: 'preview', dataUrl: 'data:image/webp;base64,CCCC', bytes: 4 });
  await ctx.outbox.submitDraft({ draftId: cid, form: {}, connection: conn });
  await ctx.outbox.flush(conn);
  const rec = await ctx.outbox.record(cid);
  assert.equal(rec.receipt.duplicate, true);
  assert.equal(rec.preview.state, 'skipped', '不覆盖已有图片');
  assert.equal(ctx.calls.filter(c => String(c.path).includes('/v3/captures/')).length, 0, '未尝试上传');
  assert.equal(rec.phase, 'complete', '文字照常完成，不因缺附件许可暂停');
  assert.ok((await ctx.store.load()).blobs[rec.preview.blobId], 'Blob 保留供用户处理');
});

test('用户明确取消素材才删除 Blob；不删除已确认的文字', async () => {
  const ctx = context();
  await ctx.outbox.openDraft({ draftId: cid, target: draftTarget(), connection: conn, rawPreview: png });
  await ctx.outbox.compressAsset({ draftId: cid, kind: 'preview', dataUrl: 'data:image/webp;base64,CCCC', bytes: 4 });
  await ctx.outbox.submitDraft({ draftId: cid, form: {}, connection: conn });
  await ctx.outbox.cancelAsset(cid, 'preview');
  const rec = await ctx.outbox.record(cid);
  assert.equal(rec.preview.state, 'cancelled');
  assert.equal(rec.preview.blobId, null);
  assert.equal(Object.keys((await ctx.store.load()).blobs).length, 0);
});
