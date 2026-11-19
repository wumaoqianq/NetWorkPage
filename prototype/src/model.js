const clean = value => String(value ?? '').trim();
const short = (value, limit = 2000) => clean(value).slice(0, limit);

/** 排序只在展示层进行：置顶优先为默认值，不改写服务端顺序或数据。 */
export function sortSites(sites, sort = 'pinned') {
  const list = [...sites];
  if (sort === 'recent') {
    return list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
      || String(a.id).localeCompare(String(b.id)));
  }
  if (sort === 'name') {
    return list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN')
      || String(a.id).localeCompare(String(b.id)));
  }
  return list.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
    || String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || String(a.id).localeCompare(String(b.id)));
}

/** 主工具栏分类与侧栏同源：全部 + 当前视图中有真实收藏的分类，超出部分进入“更多分类”。 */
export function buildCategoryChips(sites, { categories = [], view = 'home', max = 5 } = {}) {
  const scoped = filterSites(sites, { view });
  const counts = new Map();
  for (const site of scoped) counts.set(site.category || '未分类', (counts.get(site.category || '未分类') || 0) + 1);
  const named = categories.map(name => ({ label: name, count: counts.get(name) || 0 }));
  for (const [label, count] of counts) if (!categories.includes(label)) named.push({ label, count });
  const populated = named.filter(item => item.count > 0);
  const visible = populated.slice(0, Math.max(0, max - 1));
  const overflow = populated.slice(visible.length);
  return { chips: [{ label: '全部', count: scoped.length }, ...visible], overflow };
}

/** 关键词检索先限制当前视图，再匹配用户实际记得的用途、备注与标签。 */
export function filterSites(sites, options = {}) {
  const { query = '', category = '', view = 'all', chip = '全部', collection = '', sort = 'pinned' } = options;
  const words = clean(query).toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const filtered = sites.filter(site => {
    if (view === 'trash' ? !site.deleted : site.deleted) return false;
    if (view !== 'trash' && (view === 'archive' ? !site.archived : site.archived)) return false;
    if (view === 'deployments' && site.kind !== 'selfhosted') return false;
    if (view === 'inbox' && !site.inbox) return false;
    if (category && site.category !== category) return false;
    if (chip && chip !== '全部' && (site.category || '未分类') !== chip) return false;
    if (collection && !(site.collections ?? []).includes(collection)) return false;
    const haystack = [site.name, site.description, site.purpose, site.notes, ...(site.aliases ?? []), ...(site.tags ?? []), ...(site.endpoints ?? []).map(e => e.url)].join(' ').toLocaleLowerCase();
    return words.every(word => haystack.includes(word));
  });
  return sortSites(filtered, sort);
}

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/;
/** 服务端图标刷新只处理公网 http(s) endpoint；本机/局域网必须走浏览器扩展。 */
export function canRefreshSiteIcon(site) {
  try {
    const entry = getDefaultEndpoint(site);
    const host = new URL(entry.url).hostname;
    return entry.scope === '公网' && !PRIVATE_HOST.test(host) && !host.endsWith('.local');
  } catch { return false; }
}

/** 服务端公开图标 Job 的展示状态：只在「仍缺图且 Job 排队中」时显示「图标获取中」，不假报已有图标。 */
export function iconJobState(site) {
  const present = site?.presentation?.icon?.present === true;
  const job = site?.iconJob;
  const fetching = !present && job?.queued === true && ['pending', 'leased'].includes(job.phase);
  return { fetching, label: fetching ? '图标获取中' : '', present };
}

export function isSafeUrl(value) {
  try {
    const url = new URL(clean(value));
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

export function validateSiteInput({ name, url, endpoints, homepageUrl }) {
  if (!clean(name)) return '请填写网站名称';
  const addresses = endpoints ?? [{ url }];
  if (!addresses.length || addresses.some(e => !isSafeUrl(e.url))) return '请填写有效的 http 或 https 网址，且不要包含用户名或密码';
  if (homepageUrl && !isSafeUrl(homepageUrl)) return '首页地址必须是有效的 http 或 https 网址';
  return '';
}

export const replaceSite = (sites, site) => sites.map(item => item.id === site.id ? site : item);
export const getDefaultEndpoint = site => site.endpoints.find(entry => entry.id === site.defaultEndpointId) || site.endpoints[0];

/** 先校验整批数据再返回，调用方只有拿到完整结果后才更新原型状态。 */
export function normalizeImportedSites(input) {
  const entries = Array.isArray(input) ? input : input?.sites;
  if (!Array.isArray(entries) || entries.length > 500) throw new Error('请选择包含 sites 数组的 JSON 文件，最多 500 条');
  return entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`第 ${index + 1} 条资料格式不正确`);
    const endpoints = (Array.isArray(entry.endpoints) ? entry.endpoints : [{ url: entry.url }]).map((e, i) => ({
      id: crypto.randomUUID(), label: short(e?.label || (i ? '其他入口' : '默认入口'), 40),
      url: short(e?.url, 2000), scope: ['公网', '局域网', '本机', '需 VPN'].includes(e?.scope) ? e.scope : '公网',
    }));
    const error = validateSiteInput({ name: entry.name, endpoints });
    if (error) throw new Error(`第 ${index + 1} 条：${error}`);
    return {
      id: crypto.randomUUID(), name: short(entry.name, 100), purpose: short(entry.purpose, 1000),
      description: short(entry.description, 500), homepageUrl: short(entry.homepageUrl, 2048),
      notes: short(entry.notes), tags: Array.isArray(entry.tags) ? entry.tags.slice(0, 8).map(t => short(t, 30)) : [],
      category: short(entry.category, 100) || '未分类',
      kind: entry.kind === 'selfhosted' ? 'selfhosted' : 'external', endpoints,
      pinned: false, inbox: true, archived: false, deleted: false, accounts: [], collections: [], icon: 'generic',
    };
  });
}

export function displayAddress(value, limit = 52) {
  try {
    const url = new URL(value);
    const visible = `${url.host}${url.pathname}` || url.host;
    if (visible.length <= limit) return visible;
    const tail = visible.slice(-18);
    return `${visible.slice(0, Math.max(url.host.length + 2, limit - 19))}…${tail}`;
  } catch { return clean(value); }
}
export const getPreview = site => site.presentation?.preview || { present: false };
export const getIcon = site => site.presentation?.icon || { present: false };

/** 卡片按钮与详情统一判定：只有 present 且 fullUrl 是非空字符串时才是真实可加载的截图入口，避免“点了却加载不到”的伪入口。 */
export function canViewScreenshot(site) {
  const preview = site?.presentation?.preview;
  return preview?.present === true
    && typeof preview.fullUrl === 'string'
    && preview.fullUrl.trim().length > 0;
}
export function screenshotEntryLabel(site) {
  return canViewScreenshot(site) ? '查看截图' : '暂无截图';
}
