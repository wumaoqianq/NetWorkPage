/**
 * 工作台布局的纯计算：内容轨道、卡片网格列数与侧栏形态。
 * 目标宽度是期望值而不是卡死像素：完整行均分可用宽度，最后一行保持同样列宽。
 */
export const SIDEBAR_FULL = 232;
export const SIDEBAR_RAIL = 72;
export const CARD_WIDTH_MIN = 200;
export const CARD_WIDTH_MAX = 340;

export function contentPadding(viewportWidth) {
  if (!Number.isFinite(viewportWidth) || viewportWidth < 768) return 16;
  return viewportWidth >= 1600 ? 28 : 24;
}

/**
 * 以可用宽 W、间距 g、目标宽 t 计算列数：
 * 取 (W+g)/(t+g) 的向下/向上取整为候选，实际宽 = (W-(n-1)g)/n，
 * 选择实际宽落在 200–340px 且最接近 t 的候选；距离相同时选较宽（列数更少）。
 */
export function computeCardGrid({ availableWidth, target = 260, gap = 16 }) {
  const width = Number(availableWidth);
  const targetWidth = Number.isFinite(Number(target)) ? Number(target) : 260;
  const spacing = Number.isFinite(Number(gap)) ? Number(gap) : 16;
  if (!Number.isFinite(width) || width <= 0) {
    return { columns: 1, cardWidth: Math.min(CARD_WIDTH_MAX, Math.max(CARD_WIDTH_MIN, targetWidth)), gap: spacing };
  }
  const estimate = (width + spacing) / (targetWidth + spacing);
  const counts = new Set();
  for (const base of [Math.floor(estimate), Math.ceil(estimate)]) {
    counts.add(Math.min(40, Math.max(1, base)));
  }
  const candidates = [];
  for (const columns of counts) {
    const cardWidth = (width - (columns - 1) * spacing) / columns;
    if (cardWidth >= CARD_WIDTH_MIN - 0.5 && cardWidth <= CARD_WIDTH_MAX + 0.5) {
      candidates.push({ columns, cardWidth });
    }
  }
  if (!candidates.length) {
    // 没有合法候选：窄屏单列按实际宽度，超宽时单列最多 340px，避免一张卡横跨整页。
    const cardWidth = Math.min(width, CARD_WIDTH_MAX);
    return { columns: 1, cardWidth, gap: spacing };
  }
  candidates.sort((left, right) => Math.abs(left.cardWidth - targetWidth) - Math.abs(right.cardWidth - targetWidth)
    || right.cardWidth - left.cardWidth || left.columns - right.columns);
  return { ...candidates[0], gap: spacing };
}

/** 侧栏：<768 抽屉；768–1099 默认图标栏；≥1100 默认展开。用户选择只在桌面生效。 */
export function resolveSidebarLayout({ viewportWidth, preference = null }) {
  const width = Number(viewportWidth) || 0;
  if (width < 768) return { mode: 'drawer', collapsed: true, persisted: false };
  const collapsed = width < 1100 ? preference !== 'expanded' : preference === 'collapsed';
  return { mode: collapsed ? 'rail' : 'full', collapsed, persisted: true };
}

/** 侧栏折叠宽度与主区偏移量；顶部栏、标题、搜索、工具栏、网格和页脚共用这个偏移和同一内边距。 */
export function mainAreaOffset({ mode }) {
  if (mode === 'drawer') return 0;
  return mode === 'rail' ? SIDEBAR_RAIL : SIDEBAR_FULL;
}

/** 只有真实访问记录才显示最近打开；同一条资料不重复展示。 */
export function recentItems(recent, sites) {
  const seen = new Set();
  return (recent || []).map(id => sites.find(site => site.id === id && !site.deleted && !site.archived)).filter(Boolean)
    .filter(site => { if (seen.has(site.id)) return false; seen.add(site.id); return true; }).slice(0, 2);
}
