// 普通扩展页 DOM/canvas 中压缩：原始快照有界、转换成功即清除、超限省略。
// decode/createCanvas 可注入，便于 Node 回归；运行期用浏览器 Image/canvas。
export function boundedDimensions(width, height, maxEdge = 1280) {
  const scale = Math.min(1, maxEdge / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function defaultDecode(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('截图解码失败'));
    image.src = dataUrl;
  });
}
function defaultCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  return canvas;
}

/**
 * 把 PNG 原始快照在页面内转成有界 WebP dataUrl。返回 { dataUrl, bytes, width, height } 或 null（超限/失败）。
 * 不产生也不修改 sourceUrl：入口地址由记录层单独保存，绝不把 dataUrl 当网站地址。
 */
export async function compressInPage(dataUrl, options = {}) {
  const { maxEdge = 1280, maxBytes = 200 * 1024, maxRawBytes = 700_000,
    decode = defaultDecode, createCanvas = defaultCanvas,
    estimateBytes = value => Math.floor((String(value).length - (String(value).indexOf(',') + 1)) * 3 / 4),
    now = Date.now } = options;
  if (!dataUrl || String(dataUrl).length > maxRawBytes) return null; // 超限直接省略，不无界保存高分辨率
  if (String(dataUrl).startsWith('data:') === false) return null;
  let image;
  try { image = await decode(dataUrl); }
  catch { return null; }
  const { width, height } = boundedDimensions(image.width, image.height, maxEdge);
  let canvas;
  try {
    canvas = createCanvas(width, height);
    const context = canvas.getContext ? canvas.getContext('2d') : { drawImage() {} };
    context.drawImage(image, 0, 0, width, height);
    for (const quality of [0.82, 0.72, 0.62, 0.52, 0.42]) {
      const out = canvas.toDataURL('image/webp', quality);
      const bytes = estimateBytes(out);
      if (bytes <= maxBytes) {
        return { dataUrl: out, bytes, width, height, compressedAt: now() };
      }
    }
    // 最小质量仍超限：省略截图而不是保存超界快照。
    return null;
  } catch { return null; }
  finally { if (image && typeof image.close === 'function') image.close(); }
}

export function dataUrlToBlob(dataUrl) {
  const [head, payload] = String(dataUrl).split(',', 2);
  const mime = (head.match(/^data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const binary = atob(payload || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
