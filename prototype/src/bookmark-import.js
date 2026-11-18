export const browserSources = [
  { id: 'chrome', name: 'Google Chrome', short: 'Chrome', initial: 'C', steps: ['打开 Chrome 的「书签和清单 → 书签管理器」（Ctrl / ⌘ + Shift + O）。', '在书签管理器右上角的「⋮」选择「导出书签」，保存为 HTML 文件。'], help: 'https://support.google.com/chrome/answer/96816?hl=zh-Hans' },
  { id: 'edge', name: 'Microsoft Edge', short: 'Edge', initial: 'E', steps: ['打开 Edge 的「收藏夹」，再打开收藏夹面板的「…」菜单。', '选择「导出收藏夹」，把文件保存到电脑。'], help: 'https://support.microsoft.com/zh-cn/edge/import-your-favorites-and-passwords-in-microsoft-edge' },
  { id: 'ego-lite', name: 'ego(lite)', short: 'ego(lite)', initial: 'e', steps: ['在 ego(lite) 的书签管理器中查看导出选项，或打开「设置 → 导出数据」。', '仅选择书签 HTML 或标准 Bookmarks JSON。如果得到完整备份，先在本机取出单独的书签文件。'], help: 'https://www.egolite.app/changelog' },
  { id: 'firefox', name: 'Firefox', short: 'Firefox', initial: 'F', steps: ['打开 Firefox 的书签管理窗口。', '在「导入和备份」中选择「导出书签到 HTML」，不要选择 JSON 压缩备份。'] },
  { id: 'safari', name: 'Safari', short: 'Safari', initial: 'S', steps: ['在 Mac 上打开 Safari 的书签导出菜单。', '导出单独的书签 HTML 文件；如版本提供浏览数据导出，仅取其中的书签文件。'] },
  { id: 'other', name: '其他浏览器', short: '其他浏览器', initial: '…', steps: ['在浏览器的书签或收藏夹管理页面找到「导出」。', '选择标准 HTML 书签文件；Chromium 浏览器也可选择原始 Bookmarks JSON。'] },
];

/** 只根据实际内容判格式，不把 ZIP/密码 CSV/完整 Profile 当作书签上传。 */
export async function prepareBookmarkFile(file, source) {
  if (!browserSources.some(item => item.id === source)) throw new Error('请选择浏览器来源');
  if (file.size > 2 * 1024 * 1024) throw new Error('单次请选择不超过 2MiB 的书签文件，可分批导入');
  if (/\.(zip|7z|rar|db|sqlite3?|csv)$/i.test(file.name)) throw new Error('请选择单独的书签 HTML 或 Bookmarks JSON，不要上传完整备份、密码或数据库');
  const content = (await file.text()).replace(/^\uFEFF/, '').trim();
  if (content.startsWith('<') && /<(?:dl\b|!doctype\s+NETSCAPE-Bookmark-file-1)/i.test(content)) {
    return { content, format: 'html', source };
  }
  try {
    const value = JSON.parse(content);
    if (value && typeof value.roots === 'object' && value.roots && !Array.isArray(value.roots)) {
      return { content: JSON.stringify({ roots: value.roots }), format: 'chromium', source };
    }
  } catch { /* 格式不匹配时统一提示，不上传未识别的个人资料。 */ }
  throw new Error('没有识别到浏览器书签，请选择 HTML 或含 roots 的 Bookmarks JSON；本站备份请使用「导入本站 JSON」');
}
