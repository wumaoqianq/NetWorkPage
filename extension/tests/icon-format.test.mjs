import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIconCandidates, buildSingleFrameIco, createByteBudget, ICON_LIMITS, parseIco, readImageSize, selectIcoFrame, sniffImageType } from '../icon-format.js';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
  0, 0, 0, 64, 0, 0, 0, 64, 8, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const fakePng = size => Uint8Array.from([...PNG, ...new Uint8Array(Math.max(0, size - PNG.length))]);

function buildIco(frames) {
  const header = 6 + frames.length * 16;
  const parts = frames.flatMap(frame => [frame.bytes]);
  const total = header + parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  output[2] = 1; output[4] = frames.length;
  const view = new DataView(output.buffer);
  let offset = header;
  frames.forEach((frame, index) => {
    const base = 6 + index * 16;
    output[base] = frame.width >= 256 ? 0 : frame.width;
    output[base + 1] = frame.height >= 256 ? 0 : frame.height;
    view.setUint16(base + 4, 1, true);
    view.setUint16(base + 6, 32, true);
    view.setUint32(base + 8, frame.bytes.length, true);
    view.setUint32(base + 12, offset, true);
    output.set(frame.bytes, offset);
    offset += frame.bytes.length;
  });
  return output;
}

test('按魔数识别栅格类型并拒绝 SVG/HTML', () => {
  assert.equal(sniffImageType(PNG), 'png');
  assert.equal(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'jpeg');
  assert.equal(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">')), 'unsafe-text');
  used();
});
function used() {
  const ico = buildIco([{ width: 32, height: 32, bytes: fakePng(20) }]);
  assert.equal(sniffImageType(ico), 'ico');
}

test('解析多帧 ICO 并选择接近 128 的合适帧而不是最大帧', () => {
  const ico = buildIco([
    { width: 256, height: 256, bytes: fakePng(300) },
    { width: 48, height: 48, bytes: fakePng(60) },
    { width: 128, height: 128, bytes: fakePng(120) },
    { width: 32, height: 32, bytes: fakePng(30) },
  ]);
  const { frames } = parseIco(ico);
  assert.equal(frames.length, 4);
  const selected = selectIcoFrame(frames);
  assert.equal(selected.width, 128);
  const single = buildSingleFrameIco(ico, selected);
  assert.equal(sniffImageType(single), 'ico');
  assert.equal(single.length, 22 + selected.size);
  assert.equal(parseIco(single).frames.length, 1);
  assert.equal(parseIco(single).frames[0].isPng, true);
});

test('没有 ≤128 帧时选最小的大帧；越界帧拒绝', () => {
  const onlyLarge = buildIco([{ width: 256, height: 256, bytes: fakePng(200) }, { width: 180, height: 180, bytes: fakePng(120) }]);
  assert.equal(selectIcoFrame(parseIco(onlyLarge).frames).width, 180);
  const broken = buildIco([{ width: 32, height: 32, bytes: fakePng(20) }]);
  new DataView(broken.buffer).setUint32(6 + 8, 100000, true);
  assert.throws(() => parseIco(broken), /越界/);
  assert.throws(() => selectIcoFrame([]), /没有可用帧/);
});

test('尺寸读取用于解码前 2MP 预算；未知格式返回 null', () => {
  assert.deepEqual(readImageSize(PNG), { width: 64, height: 64 });
  const huge = new Uint8Array(PNG);
  const view = new DataView(huge.buffer);
  view.setUint32(16, 4000, false); view.setUint32(20, 4000, false);
  assert.deepEqual(readImageSize(huge), { width: 4000, height: 4000 });
  assert.equal(readImageSize(new Uint8Array(8)), null);
});

test('相对路径、sizes 与声明格式被规范化，重复候选去重', () => {
  const candidates = buildIconCandidates({
    pageUrl: 'https://example.com/app/index.html?x=1',
    favIconUrl: 'https://example.com/favicon.ico',
    iconLinks: [
      { href: '/icons/icon-32.png', rel: 'icon', sizes: '32x32', type: 'image/png' },
      { href: 'icons/icon-64.png', rel: 'icon', sizes: '64x64', type: 'image/png' },
      { href: 'https://example.com/icons/icon-64.png', rel: 'shortcut icon', sizes: '64x64' },
    ],
    maybeDefaults: false,
  });
  const urls = candidates.map(candidate => candidate.url);
  assert.equal(urls[0], 'https://example.com/app/icons/icon-64.png');
  assert.ok(urls.includes('https://example.com/icons/icon-32.png'));
  assert.ok(urls.includes('https://example.com/icons/icon-64.png'));
  assert.ok(urls.includes('https://example.com/favicon.ico'));
  assert.equal(new Set(urls).size, urls.length);
});

test('公共 CDN 候选保留并标记跨域；优先当前浅色主题而不是深色图', () => {
  const candidates = buildIconCandidates({
    pageUrl: 'https://www.qianwen.com/',
    favIconUrl: 'https://www.qianwen.com/favicon.ico',
    iconLinks: [
      { href: 'https://img.alicdn.com/imgextra/i1/O1CN01qianwenDark.png', rel: 'shortcut icon', media: '(prefers-color-scheme: dark)', sizes: '64x64', type: 'image/png' },
      { href: 'https://img.alicdn.com/imgextra/i1/O1CN01qianwenLight.png', rel: 'shortcut icon', media: '(prefers-color-scheme: light)', sizes: '64x64', type: 'image/png' },
    ],
  });
  const light = candidates.find(candidate => candidate.theme === 'light');
  const dark = candidates.find(candidate => candidate.theme === 'dark');
  assert.ok(light && dark);
  assert.equal(light.crossOrigin, true);
  assert.equal(dark.crossOrigin, true);
  assert.ok(candidates.indexOf(light) < candidates.indexOf(dark));
  assert.ok(candidates.every(candidate => !candidate.url.includes(' ')));
});

test('SVG 与 PNG 并存时优先可用 PNG；SVG 不参与抓取但保留诊断', () => {
  const candidates = buildIconCandidates({
    pageUrl: 'https://chatgpt.com/',
    favIconUrl: 'https://chatgpt.com/favicon.ico',
    iconLinks: [
      { href: '/favicon.svg', rel: 'icon', type: 'image/svg+xml' },
      { href: '/favicon-48.png', rel: 'icon', sizes: '48x48', type: 'image/png' },
      { href: '/apple-touch-icon-180x180.png', rel: 'apple-touch-icon', sizes: '180x180' },
    ],
    maybeDefaults: false,
  });
  assert.equal(candidates[0].format, 'png');
  assert.equal(candidates[0].url, 'https://chatgpt.com/favicon-48.png');
  assert.ok(candidates.some(candidate => candidate.format === 'svg'));
  assert.ok(candidates.filter(candidate => candidate.format === 'svg').every(candidate => candidate.rank < candidates[0].rank));
});

test('只有 SVG 可用时不会被当成栅格成功候选', () => {
  const candidates = buildIconCandidates({ pageUrl: 'https://svg-only.example/', iconLinks: [
    { href: '/logo.svg', rel: 'icon', type: 'image/svg+xml' },
  ], maybeDefaults: false });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].format, 'svg');
  assert.equal(candidates[0].rank < 10, true);
});

test('同源默认路径兜底，data 栅格接受而 data SVG 拒绝', () => {
  const defaults = buildIconCandidates({ pageUrl: 'https://example.com/app' });
  assert.deepEqual(defaults.slice(0, 2).map(candidate => candidate.url), ['https://example.com/favicon.ico', 'https://example.com/apple-touch-icon.png']);
  const dataPng = buildIconCandidates({ pageUrl: 'https://example.com/', favIconUrl: 'data:image/png;base64,AAAA', maybeDefaults: false });
  assert.equal(dataPng.length, 1);
  const dataSvg = buildIconCandidates({ pageUrl: 'https://example.com/', favIconUrl: 'data:image/svg+xml;base64,AAAA', maybeDefaults: false });
  assert.equal(dataSvg.length, 0);
  assert.deepEqual(buildIconCandidates({ pageUrl: 'chrome://settings' }), []);
});

test('流式预算：单文件与累计上限分别生效', () => {
  const budget = createByteBudget({ perFile: 100, total: 150 });
  budget.reserve(100);
  assert.equal(budget.used, 100);
  assert.throws(() => budget.reserve(60), /累计/);
  const fresh = createByteBudget({ perFile: 100, total: 200 });
  assert.throws(() => fresh.reserve(101), /单文件|1MiB|超过/);
});

test('候选数量有上限，未声明的第三方 URL 不会被凭空加入', () => {
  const links = Array.from({ length: 20 }, (_, index) => ({ href: `/icon-${index}.png`, rel: 'icon', sizes: '64x64' }));
  const candidates = buildIconCandidates({ pageUrl: 'https://example.com/', iconLinks: links, maybeDefaults: false });
  assert.equal(candidates.length, ICON_LIMITS.discoveredCandidates);
  const noArbitrary = buildIconCandidates({ pageUrl: 'https://example.com/', iconLinks: [], maybeDefaults: false });
  assert.equal(noArbitrary.length, 0);
});
