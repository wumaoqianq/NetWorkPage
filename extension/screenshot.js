import { captureUrl } from './queue.js';

export async function captureVisible(tab) {
  if (!tab?.id || tab.incognito) throw new Error('隐身模式或无效标签页不支持截图。');
  const target = { windowId: tab.windowId, tabId: tab.id, url: captureUrl(tab.url) };
  const [before] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  if (!before || before.id !== target.tabId || captureUrl(before.url || '') !== target.url) {
    throw new Error('标签页或地址已变化，请重新截图。');
  }
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const [after] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  if (!after || after.id !== target.tabId || captureUrl(after.url || '') !== target.url) {
    throw new Error('截图期间标签页已切换或导航，结果已丢弃。');
  }
  const response = await fetch(dataUrl);
  return { blob: await response.blob(), ...target, capturedAt: new Date().toISOString() };
}

export async function deriveImage(blob, offset = 0.5) {
  const bitmap = await createImageBitmap(blob);
  try {
    const ratio = 16 / 9;
    let width = bitmap.width;
    let height = Math.min(bitmap.height, Math.round(width / ratio));
    if (bitmap.width / bitmap.height > ratio) {
      height = bitmap.height;
      width = Math.round(height * ratio);
    }
    const left = Math.round((bitmap.width - width) / 2);
    const top = Math.round((bitmap.height - height) * Math.max(0, Math.min(1, offset)));
    const scale = Math.min(1, 960 / width, 540 / height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext('2d', { alpha: false }).drawImage(bitmap, left, top, width, height,
      0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.72, 0.62, 0.52, 0.42]) {
      const output = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
      if (output && output.size <= 200 * 1024) return { blob: output, url: canvas.toDataURL('image/webp', 0.7) };
    }
    throw new Error('截图无法压缩到 200KiB，请隐藏复杂内容后重试。');
  } finally { bitmap.close(); }
}

export function homepageMatch(tabUrl, homepageUrl) {
  try { return captureUrl(tabUrl) === captureUrl(homepageUrl); }
  catch { return false; }
}
