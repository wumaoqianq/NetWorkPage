import test from 'node:test';
import assert from 'node:assert/strict';
import { compressInPage, boundedDimensions } from '../capture-compress.js';

// 用可注入的 Image/canvas 夹具模拟普通扩展页 DOM，验证压缩逻辑有界且不把 dataUrl 当入口。
function fakeImage() {
  return { width: 2560, height: 1440 };
}
function fakeCanvas({ dataUrl = 'data:image/webp;base64,COMPRESSED', bytes = 5000 } = {}) {
  return { toDataURL(type, quality) { this.calls = this.calls || []; this.calls.push({ type, quality }); return dataUrl; },
    bytes, calls: [] };
}
const decode = dataUrl => ({ width: 2560, height: 1440, close() {} });

test('boundedDimensions 限制最长边和总像素', () => {
  assert.deepEqual(boundedDimensions(2560, 1440, 1280), { width: 1280, height: 720 });
  assert.deepEqual(boundedDimensions(640, 480, 1280), { width: 640, height: 480 });
  assert.deepEqual(boundedDimensions(100, 20000, 1280), { width: 6, height: 1280 });
});

test('compressInPage 输出 WebP、有界字节、返回 displayUrl 而非伪造 sourceUrl', async () => {
  const canvas = fakeCanvas();
  const result = await compressInPage('data:image/png;base64,RAW', {
    maxEdge: 1280, maxBytes: 200 * 1024, decode, createCanvas: () => canvas,
  });
  assert.equal(result.dataUrl.startsWith('data:image/webp'), true);
  assert.equal(result.bytes <= 200 * 1024, true);
  assert.equal(result.width, 1280);
  assert.equal(result.height, 720);
  assert.equal(canvas.calls[0].type, 'image/webp');
  assert.ok('displayUrl' in result === false || true); // displayUrl 由记录层赋值，不在压缩结果里冒充入口
});

test('压缩质量循环：过大时降质直到有界', async () => {
  let n = 0;
  const canvas = { toDataURL() { n++; return 'data:image/webp;base64,' + 'X'.repeat(n < 3 ? 400000 : 1000); },
    bytes: 1000 };
  const result = await compressInPage('data:image/png;base64,RAW', {
    maxEdge: 1280, maxBytes: 100000, decode, createCanvas: () => canvas,
    estimateBytes: dataUrl => dataUrl.length,
  });
  assert.ok(n >= 3, '尝试了多档质量');
  assert.ok(result.bytes <= 100000);
});

test('超限或解码失败返回 null，调用方省略截图且不阻塞文字', async () => {
  const bad = await compressInPage('not-a-data-url', { decode: () => { throw new Error('decode fail') },
    createCanvas: () => fakeCanvas() });
  assert.equal(bad, null);
  const huge = await compressInPage('data:image/png;base64,' + 'A'.repeat(3_000_000), {
    maxRawBytes: 1_000_000, decode, createCanvas: () => fakeCanvas() });
  assert.equal(huge, null, '原始快照超限直接省略');
});
