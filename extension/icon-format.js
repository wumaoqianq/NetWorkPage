/**
 * 图标候选发现与常见栅格格式的纯函数。
 * 候选可以来自公共 CDN（页面声明的跨域 URL）：客户端只读取同源可授权候选，
 * 跨域候选留给受控服务端兜底；任何 URL 都不代表允许任意抓取。
 */
export const ICON_LIMITS = Object.freeze({
  sourceBytes: 1024 * 1024,
  totalBytes: 2 * 1024 * 1024,
  candidates: 4,
  discoveredCandidates: 8,
  wallClockMs: 5000,
  pixels: 2_000_000,
  outputPixels: 128,
  outputBytes: 32 * 1024,
});

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const startsWith = (bytes, signature) => signature.every((value, index) => bytes[index] === value);
const ascii = (bytes, start, length) => String.fromCharCode(...bytes.slice(start, start + length));

/** 按魔数判断真实类型，上传/解码不信任 Content-Type。 */
export function sniffImageType(bytes) {
  if (!bytes || bytes.length < 4) return 'unknown';
  if (startsWith(bytes, PNG_SIGNATURE)) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (ascii(bytes, 0, 3) === 'GIF') return 'gif';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp';
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) return 'ico';
  const head = ascii(bytes, 0, Math.min(256, bytes.length)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || head.startsWith('<?xml') || head.startsWith('<!doctype') || head.startsWith('<html')) return 'unsafe-text';
  return 'unknown';
}

function readUint16(bytes, offset) { return bytes[offset] | (bytes[offset + 1] << 8); }
function readUint32(bytes, offset) { return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0; }
function readUint32BE(bytes, offset) { return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0; }

/** 解析 ICO 目录：只暴露尺寸/格式/偏移，做边界校验，防止越界帧。 */
export function parseIco(bytes) {
  if (sniffImageType(bytes) !== 'ico') throw new Error('不是 ICO 文件');
  const count = readUint16(bytes, 4);
  if (!count || count > 64) throw new Error('ICO 帧数量不受支持');
  if (bytes.length < 6 + count * 16) throw new Error('ICO 目录不完整');
  const frames = [];
  for (let index = 0; index < count; index++) {
    const base = 6 + index * 16;
    const width = bytes[base] || 256;
    const height = bytes[base + 1] || 256;
    const bitCount = readUint16(bytes, base + 6);
    const size = readUint32(bytes, base + 8);
    const offset = readUint32(bytes, base + 12);
    if (!size || offset < 6 + count * 16 || offset + size > bytes.length) throw new Error('ICO 帧数据越界');
    const frameBytes = bytes.slice(offset, offset + size);
    const isPng = startsWith(frameBytes, PNG_SIGNATURE);
    frames.push({ width, height, bitCount, size, offset, isPng, entry: bytes.slice(base, base + 16) });
  }
  return { frames };
}

/**
 * 选帧：优先 ≤128 且最接近 128 的较大帧（如 128/64/48/32），
 * 没有 ≤128 时取最小的 >128 帧再缩放；重复尺寸按字节大小取更完整的一帧。
 */
export function selectIcoFrame(frames, preferred = 128) {
  if (!frames?.length) throw new Error('ICO 没有可用帧');
  const sizeOf = frame => Math.min(frame.width, frame.height);
  const usable = frames.filter(frame => sizeOf(frame) >= 16);
  if (!usable.length) throw new Error('ICO 帧尺寸过小');
  const notLarger = usable.filter(frame => sizeOf(frame) <= preferred).sort((left, right) => sizeOf(right) - sizeOf(left) || right.size - left.size);
  if (notLarger.length) return notLarger[0];
  return [...usable].sort((left, right) => sizeOf(left) - sizeOf(right) || right.size - left.size)[0];
}

/** 把选中的帧重建为单帧 ICO，交给 Chromium 原生解码，避免手写 BMP/PNG 转换。 */
export function buildSingleFrameIco(bytes, frame) {
  const data = bytes.slice(frame.offset, frame.offset + frame.size);
  const output = new Uint8Array(6 + 16 + data.length);
  output[2] = 1;
  output[4] = 1;
  output.set(frame.entry, 6);
  const view = new DataView(output.buffer);
  view.setUint32(18, 22, true);
  output.set(data, 22);
  return output;
}

/** 读取常见格式的像素尺寸；未知格式返回 null，由调用方在解码后复核 2MP 上限。 */
export function readImageSize(bytes, type = sniffImageType(bytes)) {
  try {
    if (type === 'png' && bytes.length >= 24) return { width: readUint32BE(bytes, 16), height: readUint32BE(bytes, 20) };
    if (type === 'gif' && bytes.length >= 10) return { width: readUint16(bytes, 6), height: readUint16(bytes, 8) };
    if (type === 'bmp' && bytes.length >= 26) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)) };
    }
    if (type === 'webp' && bytes.length >= 30 && ascii(bytes, 12, 4) === 'VP8X') {
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { width, height };
    }
    if (type === 'jpeg') {
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) { offset++; continue; }
        const marker = bytes[offset + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { width: readUint16(bytes, offset + 7), height: readUint16(bytes, offset + 5) };
        }
        const length = readUint16(bytes, offset + 2);
        if (length < 2) break;
        offset += 2 + length;
      }
    }
  } catch { /* 尺寸未知时由解码后再校验 */ }
  return null;
}

const safeUrl = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url : null; } catch { return null; } };
const RASTER_TYPES = new Set(['png', 'webp', 'jpeg', 'jpg', 'gif', 'ico', 'x-icon', 'vnd.microsoft.icon', 'bmp']);
const MIME_RASTER = /^image\/(png|webp|jpe?g|gif|x-icon|vnd\.microsoft\.icon|bmp)/i;
const RASTER_EXT = /\.(png|webp|jpe?g|gif|ico|bmp)(?:[?#]|$)/i;

function declaredFormat(link, url) {
  const type = String(link?.type || '').toLowerCase().split(';')[0].trim();
  const mime = type.replace('image/', '').replace('jpg', 'jpeg');
  if (type.includes('svg') || /\.svg(?:[?#]|$)/i.test(url)) return 'svg';
  if (RASTER_TYPES.has(mime)) return mime === 'jpg' ? 'jpeg' : mime;
  if (type && !MIME_RASTER.test(type)) return 'unsupported';
  const extension = (url.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
  if (extension === 'jpg') return 'jpeg';
  if (RASTER_TYPES.has(extension)) return extension;
  return 'unknown';
}

function themeOf(link) {
  const media = String(link?.media || '').toLowerCase();
  if (/prefers-color-scheme\s*:\s*dark/.test(media)) return 'dark';
  if (/prefers-color-scheme\s*:\s*light/.test(media)) return 'light';
  return null;
}

function sizesOf(link) {
  const raw = String(link?.sizes || '').toLowerCase();
  if (raw.includes('any')) return { any: true, value: 0 };
  const values = [...raw.matchAll(/(\d+)\s*x\s*(\d+)/g)].map(match => Math.min(Number(match[1]), Number(match[2]))).filter(Boolean);
  return { any: false, value: values.length ? Math.max(...values) : 0 };
}

const sizeRank = ({ any, value }) => {
  if (any) return 2;
  if (!value) return 1.5;
  if (value >= 48 && value <= 96) return 3;
  if (value === 128) return 3;
  if (value === 32) return 2;
  if (value === 180) return 1.8;
  if (value < 32) return 0.5;
  return value > 256 ? 1 : 1.5;
};
// 工作台是浅色背景：优先无 media 或 light 候选；dark 只在没有更好候选时使用。
const themeRank = theme => theme === 'dark' ? 0 : theme === 'light' ? 2.2 : 2;
const sourceRank = source => source === 'rel-icon' ? 2.4 : source === 'apple-touch-icon' ? 2 : source === 'tab-favicon' ? 1.4 : 0.8;
const formatRank = format => format === 'svg' ? 0 : format === 'unsupported' ? 0 : format === 'unknown' ? 2.5 : 4;

/**
 * 候选发现：tab favicon、rel icon、apple-touch-icon、相对路径、sizes、media 主题。
 * 页面明确声明的跨域公共 CDN 候选保留并标记 crossOrigin；客户端不会直接抓取，
 * 而是交给服务端按“已归属站点 + 页面声明”的受控兜底。
 */
export function buildIconCandidates({ pageUrl, favIconUrl = '', iconLinks = [], maybeDefaults = true, limit = ICON_LIMITS.discoveredCandidates } = {}) {
  const page = safeUrl(pageUrl);
  if (!page) return [];
  const origin = page.origin;
  const accepted = [];
  const seen = new Set();
  const push = (rawUrl, source, link = {}) => {
    if (!rawUrl || accepted.length >= limit) return;
    const text = String(rawUrl).trim();
    if (text.startsWith('data:')) {
      if (!/^data:image\/(png|webp|jpeg|gif|bmp|x-icon|vnd\.microsoft\.icon);base64,/i.test(text)) return;
      if (seen.has(text)) return;
      seen.add(text);
      accepted.push({ url: text, source, crossOrigin: false, format: 'unknown', theme: null, sizes: '未知尺寸', data: true });
      return;
    }
    let url;
    try { url = new URL(text, page.href); } catch { return; }
    if (!['http:', 'https:'].includes(url.protocol)) return;
    const absolute = url.href;
    if (seen.has(absolute)) return;
    seen.add(absolute);
    const format = declaredFormat(link, absolute);
    const sizes = sizesOf(link);
    const theme = themeOf(link);
    const crossOrigin = url.origin !== origin;
    accepted.push({ url: absolute, source, crossOrigin, format, theme,
      sizes: sizes.any ? 'any' : sizes.value ? `${sizes.value}x${sizes.value}` : '未知尺寸',
      sizeValue: sizes, rank: formatRank(format) * 10 + themeRank(theme) * 3 + sourceRank(source) + sizeRank(sizes) });
  };
  if (favIconUrl) push(favIconUrl, 'tab-favicon');
  const links = [...(iconLinks || [])].map(link => ({
    url: String(link.url || link.href || ''), rel: String(link.rel || '').toLowerCase(),
    type: link.type || '', sizes: link.sizes || '', media: link.media || '',
  })).filter(link => link.url && /(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/.test(link.rel));
  for (const link of links) {
    const source = link.rel.includes('apple') ? 'apple-touch-icon' : 'rel-icon';
    push(new URL(link.url, page.href).href, source, link);
  }
  if (maybeDefaults) {
    push(`${origin}/favicon.ico`, 'same-origin-default', { type: 'image/x-icon' });
    push(`${origin}/apple-touch-icon.png`, 'same-origin-default', { type: 'image/png' });
  }
  return accepted.sort((left, right) => right.rank - left.rank).slice(0, limit);
}

/** 流式预算：超过单文件或累计上限立即停止，不先无界下载再判断。 */
export function createByteBudget({ perFile = ICON_LIMITS.sourceBytes, total = ICON_LIMITS.totalBytes } = {}) {
  let used = 0;
  return {
    perFile,
    get used() { return used; },
    reserve(size) {
      if (size > perFile) throw new Error('图标源文件超过 1MiB 上限');
      if (used + size > total) throw new Error('图标候选累计超过 2MiB 上限');
      used += size;
    },
  };
}

export function isRasterType(type) { return ['png', 'jpeg', 'webp', 'gif', 'bmp', 'ico'].includes(type); }
