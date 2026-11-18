// service worker 原生 OffscreenCanvas 压缩：把原始 PNG 快照转成有界 WebP dataUrl。
// 不是模拟 Image/document，不需要弹窗保持存活；弹窗关闭后后台也能把已落盘的截图续传。
// decode/createCanvas/encode 可注入，便于 Node 回归验证。
import { boundedDimensions } from './capture-compress.js';

const estimateBytes = dataUrl => Math.floor((String(dataUrl).length - (String(dataUrl).indexOf(',') + 1)) * 3 / 4);

function dataUrlToBlob(dataUrl) {
  const [head, payload] = String(dataUrl).split(',', 2);
  const mime = (head.match(/^data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const binary = atob(payload || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${blob.type || 'image/webp'};base64,${btoa(binary)}`;
}

export async function compressInWorker(dataUrl, options = {}) {
  const { maxEdge = 1280, maxBytes = 200 * 1024, maxRawBytes = 8 * 1024 * 1024,
    decode, createCanvas, encode } = options;
  if (!dataUrl || !String(dataUrl).startsWith('data:image') || String(dataUrl).length > maxRawBytes) return null;
  const toBitmap = decode || (async value => createImageBitmap(dataUrlToBlob(value)));
  const canvasFor = createCanvas || ((w, h) => new OffscreenCanvas(w, h));
  const toDataUrl = encode || (async canvas => {
    for (const quality of [0.82, 0.72, 0.62, 0.52, 0.42]) {
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality });
      if (blob.size <= maxBytes) return { dataUrl: await blobToDataUrl(blob), bytes: blob.size };
    }
    return null;
  });
  let bitmap;
  try { bitmap = await toBitmap(dataUrl); } catch { return null; }
  if (!bitmap || !bitmap.width || !bitmap.height) { bitmap?.close?.(); return null; }
  const { width, height } = boundedDimensions(bitmap.width, bitmap.height, maxEdge);
  let canvas;
  try {
    canvas = canvasFor(width, height);
    const context = canvas.getContext ? canvas.getContext('2d') : null;
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    const result = await toDataUrl(canvas);
    if (!result?.dataUrl || estimateBytes(result.dataUrl) > maxBytes) return null;
    return { dataUrl: result.dataUrl, bytes: result.bytes || estimateBytes(result.dataUrl), width, height };
  } catch { return null; }
  finally { if (bitmap && typeof bitmap.close === 'function') bitmap.close(); }
}
