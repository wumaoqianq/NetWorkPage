/**
 * 在目标页面的隔离世界中执行：用页面自己的同源权限获取候选图标并栅格化。
 * 不读取 Cookie（credentials omit），不扩大常驻权限，只返回 ≤32KiB WebP data URL。
 * 该函数会被 chrome.scripting.executeScript 序列化，必须自包含。
 */
export async function captureIconInPage(candidates) {
  const MAX_BYTES = 1024 * 1024;
  const MAX_PIXELS = 2000000;
  const OUTPUT = 128;
  const LIMIT = 32 * 1024;
  const list = Array.isArray(candidates) ? candidates.slice(0, 4) : [];
  for (const raw of list) {
    let url;
    try { url = new URL(String(raw), location.href); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== location.origin) continue;
    try {
      const response = await fetch(url.href, { credentials: 'omit', cache: 'no-store', redirect: 'error',
        signal: AbortSignal.timeout(4000) });
      if (!response.ok) continue;
      const buffer = await response.arrayBuffer();
      if (!buffer.byteLength || buffer.byteLength > MAX_BYTES) continue;
      const bitmap = await createImageBitmap(new Blob([buffer]));
      if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > MAX_PIXELS) { bitmap.close?.(); continue; }
      const scale = Math.min(1, OUTPUT / bitmap.width, OUTPUT / bitmap.height);
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, width, height);
      bitmap.close?.();
      for (const quality of [0.9, 0.82, 0.72, 0.62, 0.52]) {
        const dataUrl = canvas.toDataURL('image/webp', quality);
        const bytes = Math.ceil((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4);
        if (bytes <= LIMIT) return { dataUrl, sourceUrl: url.href, width, height, bytes };
      }
    } catch { /* 尝试下一个候选 */ }
  }
  throw new Error('页面内没有可用的同源栅格图标');
}
