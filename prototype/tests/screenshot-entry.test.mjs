import test from 'node:test';
import assert from 'node:assert/strict';
import { canViewScreenshot, screenshotEntryLabel } from '../src/model.js';
import { initialScreenshotResource, screenshotResourceKey, screenshotResourceReducer } from '../src/screenshot-resource.js';

const fullUrl = '/api/sites/site-1/preview/image?size=full&rev=r1';
const viewable = (revision = 'r1') => ({ id: 'site-1', presentation: { preview: { present: true, revision, fullUrl } } });

// 卡片/详情入口：只有 present 且 fullUrl 非空时才是能真正加载到的截图。
test('canViewScreenshot: present + 合法 fullUrl 才是真实入口', () => {
  assert.equal(canViewScreenshot(viewable()), true);
});

test('canViewScreenshot: present 但 fullUrl 缺失/空/非字符串都是伪入口', () => {
  assert.equal(canViewScreenshot({ presentation: { preview: { present: true } } }), false);
  assert.equal(canViewScreenshot({ presentation: { preview: { present: true, fullUrl: '' } } }), false);
  assert.equal(canViewScreenshot({ presentation: { preview: { present: true, fullUrl: '   ' } } }), false);
  assert.equal(canViewScreenshot({ presentation: { preview: { present: true, fullUrl: null } } }), false);
  assert.equal(canViewScreenshot({ presentation: { preview: { present: true, fullUrl: 42 } } }), false);
});

test('canViewScreenshot: present:false、presentation 缺失都不可查看', () => {
  assert.equal(canViewScreenshot({ presentation: { preview: { present: false, fullUrl } } }), false);
  assert.equal(canViewScreenshot({ presentation: { preview: { fullUrl } } }), false);
  assert.equal(canViewScreenshot({ presentation: {} }), false);
  assert.equal(canViewScreenshot({}), false);
});

test('canViewScreenshot: site 为 null/undefined 不抛错直接返回 false', () => {
  assert.equal(canViewScreenshot(null), false);
  assert.equal(canViewScreenshot(undefined), false);
});

test('screenshotEntryLabel 与入口判定一致', () => {
  assert.equal(screenshotEntryLabel(viewable()), '查看截图');
  assert.equal(screenshotEntryLabel({ presentation: { preview: { present: true, fullUrl: '' } } }), '暂无截图');
  assert.equal(screenshotEntryLabel({ presentation: { preview: { present: false, fullUrl } } }), '暂无截图');
  assert.equal(screenshotEntryLabel({}), '暂无截图');
  assert.equal(screenshotEntryLabel(null), '暂无截图');
});

// 「重新打开工作台后也能看图」：同一份服务端 DTO 重开后资源 key 稳定，不会触发无谓重载；
// revision / siteId 变化才让 key 变化，从而正确重新加载新截图或另一张网站截图。
test('重新打开工作台拿到同一 DTO 时资源 key 稳定相等', () => {
  const preview = { present: true, revision: 'r1', fullUrl };
  const firstOpen = screenshotResourceKey('site-1', preview);
  const reopened = screenshotResourceKey('site-1', { ...preview }); // 模拟重开后新构造的同值 DTO
  assert.equal(firstOpen, reopened);
  assert.equal(firstOpen, screenshotResourceKey('site-1', preview));
});

test('revision 或 siteId 变化时 key 变化，会重新加载', () => {
  const base = { present: true, revision: 'r1', fullUrl };
  const original = screenshotResourceKey('site-1', base);
  assert.notEqual(screenshotResourceKey('site-1', { ...base, revision: 'r2' }), original);
  assert.notEqual(screenshotResourceKey('site-2', base), original);
});

// screenshot-resource.test.mjs 已覆盖 revision/error/success 恢复与 start 重置；
// 这里只补缺失的：zoom 夹取、以及 success/error/empty 对 objectUrl 的处理。
test('reducer: zoom 被夹在 0.5..2', () => {
  const started = screenshotResourceReducer(initialScreenshotResource, { type: 'start', requestId: 7 });
  assert.equal(screenshotResourceReducer(started, { type: 'zoom', requestId: 7, zoom: 5 }).zoom, 2);
  assert.equal(screenshotResourceReducer(started, { type: 'zoom', requestId: 7, zoom: 0.1 }).zoom, 0.5);
  assert.equal(screenshotResourceReducer(started, { type: 'zoom', requestId: 7, zoom: 1.25 }).zoom, 1.25);
});

test('reducer: success 后 ready 且写入 objectUrl；error/empty 后清空 objectUrl', () => {
  const started = screenshotResourceReducer(initialScreenshotResource, { type: 'start', requestId: 7 });
  const ok = screenshotResourceReducer(started, { type: 'success', requestId: 7, objectUrl: 'blob:shot' });
  assert.equal(ok.status, 'ready');
  assert.equal(ok.objectUrl, 'blob:shot');
  assert.equal(ok.error, '');
  const errored = screenshotResourceReducer(ok, { type: 'error', requestId: 7, error: 'decode' });
  assert.equal(errored.status, 'error');
  assert.equal(errored.objectUrl, '');
  const emptied = screenshotResourceReducer(ok, { type: 'empty', requestId: 7 });
  assert.equal(emptied.status, 'empty');
  assert.equal(emptied.objectUrl, '');
});
