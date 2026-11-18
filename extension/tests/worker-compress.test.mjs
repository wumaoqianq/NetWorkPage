import test from 'node:test';
import assert from 'node:assert/strict';
import { compressInWorker } from '../worker-compress.js';

function fakeBitmap() { return { width: 2560, height: 1440, close() {} }; }
function fakeCanvas(out = 'data:image/webp;base64,OK', size = 5000) {
  return { getContext: () => ({ drawImage() {} }),
    convertToBlob: async () => ({ size, type: 'image/webp', arrayBuffer: async () => new ArrayBuffer(0) }),
    _out: out };
}
function fixture(overrides = {}) {
  const canvas = fakeCanvas();
  return compressInWorker('data:image/png;base64,RAW', {
    decode: async () => fakeBitmap(),
    createCanvas: () => canvas,
    encode: async () => ({ dataUrl: 'data:image/webp;base64,COMPRESSED', bytes: 5000 }),
    ...overrides,
  });
}

test('worker 压缩输出有界 WebP 与真实宽高（2560×1440 -> 1280×720）', async () => {
  const r = await fixture();
  assert.equal(r.dataUrl.startsWith('data:image/webp'), true);
  assert.equal(r.width, 1280);
  assert.equal(r.height, 720);
  assert.ok(r.bytes <= 200 * 1024);
});

test('非图片 / 超限 / 解码失败返回 null，不伪造也不抛错', async () => {
  assert.equal(await compressInWorker('not-a-data-url', { decode: async () => fakeBitmap(),
    createCanvas: () => fakeCanvas(), encode: async () => null }), null);
  assert.equal(await compressInWorker('data:image/png;base64,' + 'A'.repeat(9 * 1024 * 1024),
    { decode: async () => fakeBitmap(), createCanvas: () => fakeCanvas(), encode: async () => null }), null);
  assert.equal(await compressInWorker('data:image/png;base64,RAW',
    { decode: async () => { throw new Error('decode fail') }, createCanvas: () => fakeCanvas(),
      encode: async () => null }), null);
});

test('encode 返回 null（最小质量仍超限）时省略截图，不无界保存', async () => {
  assert.equal(await fixture({ encode: async () => null }), null);
});

test('带弹窗关闭场景：压缩结果可注入 compressPendingRaw（同一 store 事务边界）', async () => {
  // 真实链路在 popup-entry.test.mjs 覆盖；这里确认 worker 压缩接口契约稳定。
  const r = await fixture({ encode: async () => ({ dataUrl: 'data:image/webp;base64,SMALL', bytes: 300 }) });
  assert.equal(r.bytes, 300);
  assert.ok(r.dataUrl);
});
