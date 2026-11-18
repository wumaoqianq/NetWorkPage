/** 布局偏好（侧栏、排序、视图）与卡片尺寸偏好分开保存，互不覆盖。 */
export const LAYOUT_SCHEMA_VERSION = 1;
export const SORT_OPTIONS = [
  { id: 'pinned', label: '置顶优先' },
  { id: 'recent', label: '最近收藏' },
  { id: 'name', label: '名称' },
];
const MODES = ['grid', 'list'];
const SIDEBAR_PREFERENCES = ['expanded', 'collapsed'];

export function normalizeLayoutPreference(value) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    sidebar: SIDEBAR_PREFERENCES.includes(raw.sidebar) ? raw.sidebar : null,
    sort: SORT_OPTIONS.some(option => option.id === raw.sort) ? raw.sort : 'pinned',
    mode: MODES.includes(raw.mode) ? raw.mode : 'grid',
  };
}

export const layoutPreferenceKey = (origin, userId, demo = false) =>
  `workspace-layout-preferences-v1:${origin}:${demo ? 'demo' : `user:${userId}`}`;
