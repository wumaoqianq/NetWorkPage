import { readPageMetadata } from './page-data.js';
import {
  buildIconCandidates, buildSingleFrameIco, createByteBudget, isRasterType, ICON_LIMITS,
  parseIco, readImageSize, selectIcoFrame, sniffImageType,
} from './icon-format.js';

// 源文件读取预算与最终保存预算分离：源文件最多 1MiB/候选累计 2MiB/最多 4 次抓取/总墙钟 5 秒，
// 解码像素最多 2,000,000，最终仍重编码为 ≤128×128、≤32KiB 的 WebP。
const LIMITS = ICON_LIMITS;

function dataUrlBytes(url) {
  const match = /^data:image\/([a-z0-9.+-]+);base64,(.+)$/i.exec(url);
  if (!match) throw new Error('不支持的 data 图标格式');
  const binary = atob(match[2].replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  if (bytes.length > LIMITS.sourceBytes) throw new Error('图标源文件超过 1MiB 上限');
  return bytes;
}

/** 流式读取：一超过单文件或累计预算立刻取消，不先无界下载再判断。 */
async function readWithinBudget(response, budget, deadline) {
  if (response.body && response.body.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    try {
      while (true) {
        if (Date.now() > deadline) throw new Error('图标读取超过 5 秒预算');
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (received > budget.perFile) throw new Error('图标源文件超过 1MiB 上限');
        if (budget.used + received > LIMITS.totalBytes) throw new Error('图标候选累计超过 2MiB 上限');
        chunks.push(value);
      }
    } catch (error) { reader.cancel().catch(() => {}); throw error; }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    budget.reserve(bytes.length);
    return bytes;
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > budget.perFile) throw new Error('图标源文件超过 1MiB 上限');
  if (budget.used + buffer.byteLength > LIMITS.totalBytes) throw new Error('图标候选累计超过 2MiB 上限');
  budget.reserve(buffer.byteLength);
  return new Uint8Array(buffer);
}

async function fetchCandidate(candidate, budget, deadline) {
  if (candidate.url.startsWith('data:')) return dataUrlBytes(candidate.url);
  const remaining = Math.max(300, Math.min(4000, deadline - Date.now()));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remaining);
  try {
    const response = await fetch(candidate.url, { credentials: 'omit', redirect: 'error', signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`图标请求返回 ${response.status}`);
    return await readWithinBudget(response, budget, deadline);
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('图标请求超时');
    throw error;
  } finally { clearTimeout(timer); }
}

async function decodeBlob(blob) {
  try { return await createImageBitmap(blob); }
  catch {
    // 部分浏览器 createImageBitmap 对 ICO 支持不稳定：回退到 Image 解码后再转位图。
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      await (image.decode ? image.decode() : new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; }));
      return await createImageBitmap(image);
    } finally { URL.revokeObjectURL(url); }
  }
}

function decodeIconBytes(bytes) {
  const type = sniffImageType(bytes);
  if (type === 'unsafe-text') throw new Error('已拒绝 SVG 或 HTML 图标');
  if (!isRasterType(type)) throw new Error('图标格式不受支持');
  let frame = null;
  let payload = bytes;
  let size = readImageSize(bytes, type);
  if (type === 'ico') {
    const { frames } = parseIco(bytes);
    frame = selectIcoFrame(frames, LIMITS.outputPixels);
    size = { width: frame.width, height: frame.height };
    // 重建的单帧 ICO 同时兼容 PNG 帧与 BMP(DIB) 帧，交给 Chromium 原生解码。
    payload = buildSingleFrameIco(bytes, frame);
  }
  if (size && size.width * size.height > LIMITS.pixels) throw new Error('图标像素超过 2,000,000 上限');
  const mime = type === 'ico' ? 'image/x-icon' : type === 'jpeg' ? 'image/jpeg' : `image/${type}`;
  return { blob: new Blob([payload], { type: mime }), type, frame, size };
}

async function toWebp(bitmap, frame) {
  try {
    if (!bitmap.width || !bitmap.height) throw new Error('图标解码尺寸无效');
    if (bitmap.width * bitmap.height > LIMITS.pixels) throw new Error('图标像素超过 2,000,000 上限');
    for (const maxSize of [LIMITS.outputPixels, 96, 64]) {
      const scale = Math.min(1, maxSize / bitmap.width, maxSize / bitmap.height);
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, width, height);
      for (const quality of [0.9, 0.82, 0.72, 0.62, 0.52]) {
        const output = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
        if (output && output.size <= LIMITS.outputBytes) return { blob: output, width, height, frame };
      }
    }
    throw new Error('图标无法压缩到 32KiB');
  } finally { bitmap.close?.(); }
}

function hostOf(url) { try { return new URL(url).host; } catch { return ''; } }

function iconFailure(diagnostics, message) {
  const error = new Error(message);
  error.code = diagnostics.code;
  error.diagnostics = diagnostics;
  return error;
}

export async function fetchSiteIcon(tab) {
  if (!tab?.url || !/^https?:/.test(tab.url) || tab.incognito) throw new Error('当前页面不支持图标采集');
  const metadata = await readPageMetadata(tab.id).catch(() => ({ icons: [], iconLinks: [] }));
  const candidates = buildIconCandidates({
    pageUrl: tab.url,
    favIconUrl: tab.favIconUrl || '',
    iconLinks: metadata.iconLinks || metadata.icons || [],
  });
  const diagnostics = {
    code: 'icon_unavailable',
    candidateCount: candidates.length,
    candidateHosts: [...new Set(candidates.map(candidate => hostOf(candidate.url)).filter(Boolean))].slice(0, 6),
    crossOriginHosts: [...new Set(candidates.filter(candidate => candidate.crossOrigin).map(candidate => hostOf(candidate.url)).filter(Boolean))].slice(0, 6),
    hasSvg: candidates.some(candidate => candidate.format === 'svg'),
    hasRaster: candidates.some(candidate => candidate.format !== 'svg' && candidate.format !== 'unsupported'),
    failures: [],
  };
  if (!candidates.length) {
    diagnostics.code = 'icon_no_candidates';
    throw iconFailure(diagnostics, '页面未提供图标候选');
  }
  const budget = createByteBudget();
  const deadline = Date.now() + LIMITS.wallClockMs;
  const page = new URL(tab.url);
  // 只抓取同源或 data: 候选；页面声明的跨域公共 CDN 留给受控服务端兜底，不在这里直接请求。
  const fetchable = candidates.filter(candidate => {
    if (candidate.crossOrigin) return false;
    if (candidate.url.startsWith('data:')) return true;
    try { return new URL(candidate.url).origin === page.origin; } catch { return false; }
  }).slice(0, LIMITS.candidates);
  const svgOnly = candidates.every(candidate => candidate.format === 'svg' || candidate.format === 'unsupported');
  for (const candidate of fetchable) {
    if (candidate.format === 'svg') continue;
    try {
      const bytes = await fetchCandidate(candidate, budget, deadline);
      const decoded = decodeIconBytes(bytes);
      const bitmap = await decodeBlob(decoded.blob);
      const output = await toWebp(bitmap, decoded.frame);
      return { blob: output.blob, sourceUrl: tab.url, candidateHost: hostOf(candidate.url), candidateSource: candidate.source,
        candidateTheme: candidate.theme, candidateType: decoded.type, candidateBytes: bytes.length, frame: output.frame,
        outputWidth: output.width, outputHeight: output.height, outputBytes: output.blob.size, diagnostics };
    } catch (error) {
      diagnostics.failures.push({ host: hostOf(candidate.url), message: String(error.message || '图标不可用').slice(0, 160) });
    }
  }
  if (svgOnly) {
    diagnostics.code = 'icon_svg_only';
    throw iconFailure(diagnostics, '该站仅提供 SVG 图标，暂不支持安全获取；可在工作台卡片菜单重试');
  }
  if (fetchable.length === 0 && diagnostics.crossOriginHosts.length > 0) {
    diagnostics.code = 'icon_cross_origin';
    throw iconFailure(diagnostics, `图标位于公共 CDN（${diagnostics.crossOriginHosts[0]}），将在收藏后由工作台安全兜底获取`);
  }
  diagnostics.code = fetchable.length ? 'icon_candidate_failed' : 'icon_no_candidates';
  const firstFailure = diagnostics.failures[0]?.message;
  throw iconFailure(diagnostics, `图标不可用：${firstFailure || '候选均未通过校验；可在工作台卡片菜单重试'}`);
}
