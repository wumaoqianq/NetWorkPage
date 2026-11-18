import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCategoryChips, displayAddress, filterSites, getDefaultEndpoint, getIcon, normalizeImportedSites, replaceSite, sortSites, validateSiteInput } from '../src/model.js';

const fixtures = [
  { id: 'image', name: 'TinyPNG', purpose: '压缩图片', notes: '透明背景先预览', tags: ['批量处理'], category: '图片与视频', pinned: true, endpoints: [{ url: 'https://tinypng.com' }] },
  { id: 'server', name: '资源系统', purpose: '管理部署', notes: '', tags: ['自部署'], category: '开发工具', kind: 'selfhosted', endpoints: [{ url: 'http://localhost:3000' }] },
  { id: 'archive', name: '旧版工具', purpose: '压缩图片', archived: true, tags: [], endpoints: [{ url: 'https://example.org' }] },
];

test('默认访问入口按服务端选择而不是数组顺序打开', () => {
  const site = { defaultEndpointId: 'cloud', endpoints: [{ id: 'local', url: 'http://localhost:3000' }, { id: 'cloud', url: 'https://example.com' }] };
  assert.equal(getDefaultEndpoint(site).id, 'cloud');
  assert.equal(getDefaultEndpoint({ ...site, defaultEndpointId: 'removed' }).id, 'local');
});

test('首页展示全部有效收藏并按置顶、最近收藏和稳定 ID 排序', () => {
  const sites = [
    { id: 'b', name: '普通旧收藏', createdAt: '2026-01-01T00:00:00Z', pinned: false, tags: [], endpoints: [] },
    { id: 'a', name: '普通新收藏', createdAt: '2026-01-03T00:00:00Z', pinned: false, tags: [], endpoints: [] },
    { id: 'c', name: '置顶旧收藏', createdAt: '2026-01-02T00:00:00Z', pinned: true, tags: [], endpoints: [] },
    { id: 'd', name: '主动稍后整理', createdAt: '2026-01-04T00:00:00Z', inbox: true, pinned: false, tags: [], endpoints: [] },
  ];
  assert.deepEqual(filterSites(sites, { view: 'home' }).map(site => site.id), ['c', 'd', 'a', 'b']);
  assert.deepEqual(filterSites(sites, { view: 'home', query: '收藏' }).map(site => site.id), ['c', 'a', 'b']);
});

test('按个人用途和备注找到忘记名称的网站', () => {
  assert.equal(filterSites(fixtures, { query: '透明背景' })[0]?.id, 'image');
  assert.equal(filterSites(fixtures, { query: '批量处理' })[0]?.id, 'image');
});
test('搜索大小写归一化且多个词都需要匹配', () => {
  assert.equal(filterSites(fixtures, { query: 'TINY 图片' }).length, 1);
  assert.equal(filterSites(fixtures, { query: 'TINY 部署' }).length, 0);
});
test('搜索不能绕过分类与部署视图筛选', () => {
  assert.equal(filterSites(fixtures, { query: '图片', category: '开发工具' }).length, 0);
  assert.deepEqual(filterSites(fixtures, { view: 'deployments' }).map(x => x.id), ['server']);
});
test('归档不会出现在普通检索但可在归档中找到', () => {
  assert.equal(filterSites(fixtures, { query: '旧版' }).length, 0);
  assert.equal(filterSites(fixtures, { view: 'archive' })[0]?.id, 'archive');
});
test('拒绝可执行协议但允许本机 http 地址', () => {
  assert.match(validateSiteInput({ name: '测试', url: 'javascript:alert(1)' }), /http/);
  assert.equal(validateSiteInput({ name: '本机', url: 'http://localhost:3000' }), '');
});
test('整批导入含危险地址时拒绝，不返回部分成功数据', () => {
  assert.throws(() => normalizeImportedSites([{ name: '正常', url: 'https://example.com' }, { name: '危险', url: 'data:text/html,x' }]), /网址/);
});
test('导入忽略用户提供的 id 并保留有用的用途', () => {
  const result = normalizeImportedSites([{ id: 'forged', name: '测试', url: 'https://example.com', purpose: '用途' }]);
  assert.notEqual(result[0]?.id, 'forged');
  assert.equal(result[0]?.purpose, '用途');
});
test('编辑网站不修改原始数组和其他条目', () => {
  const result = replaceSite(fixtures, { ...fixtures[0], name: '新名称' });
  assert.equal(result[0].name, '新名称');
  assert.equal(fixtures[0].name, 'TinyPNG');
  assert.equal(result[1], fixtures[1]);
});

test('简介参与完整资料检索且不会替代用途', () => {
  const site = { ...fixtures[0], description: '在线批量压缩服务', purpose: '工作素材' };
  assert.equal(filterSites([site], { query: '在线 批量' }).length, 1);
  assert.equal(site.purpose, '工作素材');
});
test('卡片地址隐藏 query 和 hash 但保留主机与路径', () => {
  assert.equal(displayAddress('https://example.com/tools/image?token=secret#private'), 'example.com/tools/image');
  assert.equal(displayAddress('https://example.com/tools?token=secret').includes('secret'), false);
});
test('导入分别保留简介、用途和首页地址', () => {
  const [site] = normalizeImportedSites([{ name: '测试', url: 'https://example.com/tool', description: '网站服务',
    purpose: '我的原因', homepageUrl: 'https://example.com/' }]);
  assert.equal(site.description, '网站服务');
  assert.equal(site.purpose, '我的原因');
  assert.equal(site.homepageUrl, 'https://example.com/');
});

test('工具栏分类与侧栏同源，使用真实分类且最多显示五个入口', () => {
  const sites = [
    { id: 'a', name: 'A', category: '开发工具', tags: [], endpoints: [] },
    { id: 'b', name: 'B', category: '开发工具', tags: [], endpoints: [] },
    { id: 'c', name: 'C', category: 'AI', tags: [], endpoints: [] },
    { id: 'd', name: 'D', category: '设计', tags: [], endpoints: [] },
    { id: 'e', name: 'E', category: '办公协作', tags: [], endpoints: [] },
    { id: 'f', name: 'F', category: '图片与视频', tags: [], endpoints: [] },
  ];
  const { chips, overflow } = buildCategoryChips(sites, { categories: ['开发工具', '图片与视频', '办公协作', 'AI', '设计'] });
  assert.deepEqual(chips.map(chip => chip.label), ['全部', '开发工具', '图片与视频', '办公协作', 'AI']);
  assert.deepEqual(overflow.map(chip => chip.label), ['设计']);
  assert.equal(chips[0].count, 6);
  assert.equal(chips[1].count, 2);
});

test('分类筛选使用真实分类名而不是写死的用途映射', () => {
  assert.deepEqual(filterSites(fixtures, { chip: '开发工具' }).map(site => site.id), ['server']);
  assert.equal(filterSites(fixtures, { chip: '效率工具' }).length, 0);
});

test('排序支持置顶优先、最近收藏和名称，且不修改原数组', () => {
  const sites = [
    { id: 'b', name: 'Beta', createdAt: '2026-01-01T00:00:00Z', pinned: false, tags: [], endpoints: [] },
    { id: 'a', name: 'Alpha', createdAt: '2026-01-03T00:00:00Z', pinned: true, tags: [], endpoints: [] },
    { id: 'c', name: 'Gamma', createdAt: '2026-01-02T00:00:00Z', pinned: false, tags: [], endpoints: [] },
  ];
  assert.deepEqual(sortSites(sites, 'pinned').map(site => site.id), ['a', 'c', 'b']);
  assert.deepEqual(sortSites(sites, 'recent').map(site => site.id), ['a', 'c', 'b']);
  assert.deepEqual(sortSites(sites, 'name').map(site => site.id), ['a', 'b', 'c']);
  assert.deepEqual(sites.map(site => site.id), ['b', 'a', 'c']);
});

test('图标状态从 presentation 读取，不把缺失图标当成有图', () => {
  assert.deepEqual(getIcon({ presentation: { icon: { present: true, url: '/icon' } } }), { present: true, url: '/icon' });
  assert.equal(getIcon({}).present, false);
});