import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCardGrid, contentPadding, mainAreaOffset, recentItems, resolveSidebarLayout } from '../src/layout.js';

test('标准档按可用宽度选最接近目标宽度的列数（规格示例）', () => {
  const sizes = [
    { viewport: 1440, width: 1160, columns: 4, cardWidth: 278 },
    { viewport: 1920, width: 1632, columns: 6, cardWidth: 258.67 },
    { viewport: 2560, width: 2272, columns: 8, cardWidth: 270 },
  ];
  for (const item of sizes) {
    const layout = computeCardGrid({ availableWidth: item.width, target: 260, gap: 16 });
    assert.equal(layout.columns, item.columns, `${item.viewport} 列数`);
    assert.ok(Math.abs(layout.cardWidth - item.cardWidth) < 0.1, `${item.viewport} 卡宽 ${layout.cardWidth}`);
    assert.ok(layout.cardWidth >= 200 && layout.cardWidth <= 340);
  }
});

test('完整行均分宽度，少数据不放大单卡，最后一行保持列宽由 CSS 网格自然实现', () => {
  const layout = computeCardGrid({ availableWidth: 1632, target: 260, gap: 16 });
  assert.equal(layout.columns, 6);
  const widthPerCard = (1632 - 5 * 16) / 6;
  assert.equal(layout.cardWidth, widthPerCard);
});

test('紧凑与宽松档不被媒体查询写死，随可用宽度变化', () => {
  const compact = computeCardGrid({ availableWidth: 1632, target: 220, gap: 12 });
  assert.ok(compact.columns >= 7);
  assert.ok(compact.cardWidth >= 200 && compact.cardWidth <= 340);
  const wide = computeCardGrid({ availableWidth: 2272, target: 320, gap: 16 });
  assert.ok(wide.cardWidth >= 300 && wide.cardWidth <= 340);
  const ultra = computeCardGrid({ availableWidth: 3152, target: 260, gap: 16 });
  assert.ok(ultra.columns >= 10, '超宽屏通过增加列数利用空间');
  assert.ok(ultra.cardWidth <= 340);
});

test('窄屏与无有效候选时按单列实际宽度处理', () => {
  const phone = computeCardGrid({ availableWidth: 328, target: 260, gap: 16 });
  assert.equal(phone.columns, 1);
  assert.equal(phone.cardWidth, 328);
  const tiny = computeCardGrid({ availableWidth: 160, target: 260, gap: 16 });
  assert.equal(tiny.columns, 1);
  assert.equal(tiny.cardWidth, 160);
  const zero = computeCardGrid({ availableWidth: 0, target: 260, gap: 16 });
  assert.equal(zero.columns, 1);
  assert.equal(zero.cardWidth, 260);
});

test('距离相同时选更宽卡（更少列），结果确定', () => {
  const layout = computeCardGrid({ availableWidth: 3152, target: 260, gap: 16 });
  assert.equal(layout.columns, 11);
  assert.ok(Math.abs(layout.cardWidth - 272) < 0.1);
});

test('内容内边距按规格分三档，侧栏偏移与形态一致', () => {
  assert.equal(contentPadding(360), 16);
  assert.equal(contentPadding(767), 16);
  assert.equal(contentPadding(768), 24);
  assert.equal(contentPadding(1599), 24);
  assert.equal(contentPadding(1600), 28);
  assert.equal(mainAreaOffset({ mode: 'full' }), 232);
  assert.equal(mainAreaOffset({ mode: 'rail' }), 72);
  assert.equal(mainAreaOffset({ mode: 'drawer' }), 0);
});

test('侧栏：移动端抽屉，中等宽度默认折叠，桌面默认展开且尊重用户偏好', () => {
  assert.deepEqual(resolveSidebarLayout({ viewportWidth: 500, preference: 'expanded' }), { mode: 'drawer', collapsed: true, persisted: false });
  assert.equal(resolveSidebarLayout({ viewportWidth: 900, preference: null }).mode, 'rail');
  assert.equal(resolveSidebarLayout({ viewportWidth: 900, preference: 'expanded' }).mode, 'full');
  assert.equal(resolveSidebarLayout({ viewportWidth: 1440, preference: null }).mode, 'full');
  assert.equal(resolveSidebarLayout({ viewportWidth: 1440, preference: 'collapsed' }).mode, 'rail');
});

test('最近打开只在有真实记录时返回，去重并隐藏已删除/归档', () => {
  const sites = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', archived: true }, { id: 'c', name: 'C' }];
  assert.deepEqual(recentItems([], sites), []);
  assert.deepEqual(recentItems(['a', 'a', 'b', 'missing', 'c'], sites).map(site => site.id), ['a', 'c']);
});
