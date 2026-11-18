const clip = (value, limit) => Array.from(String(value || '')).slice(0, limit).join('');
function walk(tree, visit) {
  const stack = (Array.isArray(tree) ? tree : []).map(node => ({ node, path: [], selected: false, depth: 0 })).reverse();
  let visited = 0;
  while (stack.length) {
    const entry = stack.pop();
    if (++visited > 50000 || entry.depth > 64) throw new Error('收藏层级或数量过大，请选择较小的文件夹');
    const next = visit(entry);
    if (!entry.node?.url && Array.isArray(entry.node?.children)) {
      const path = entry.node.title ? [...entry.path, clip(entry.node.title, 100)] : entry.path;
      for (const node of [...entry.node.children].reverse()) stack.push({ node, path, selected: next, depth: entry.depth + 1 });
    }
  }
}
export function bookmarkFolders(tree) {
  const folders = [{ id: 'all', label: '全部收藏' }];
  walk(tree, ({ node, path }) => {
    if (!node.url && node.title && folders.length < 2000) folders.push({ id: node.id, label: [...path, node.title].join(' / ') });
    return false;
  });
  return folders;
}
/** 本机预览只保留书签字段；不改原树，不读取历史、Cookie 或页面内容。 */
export function collectBookmarks(tree, folderId = 'all') {
  const items = [], urls = new Set();
  let skipped = 0, duplicates = 0, found = folderId === 'all', bytes = 0;
  walk(tree, ({ node, path, selected }) => {
    const include = selected || folderId === 'all' || node.id === folderId;
    if (node.id === folderId) found = true;
    if (!include || !node.url) return include;
    let url;
    try {
      url = new URL(node.url);
      if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.href.length > 2048) throw new Error();
    } catch { skipped++; return include; }
    if (urls.has(url.href)) { duplicates++; return include; }
    urls.add(url.href);
    const item = { title: clip(node.title || url.hostname, 100), url: url.href, folder: clip(path.join(' / '), 2000) };
    bytes += new TextEncoder().encode(JSON.stringify(item)).length;
    if (items.length >= 10000 || bytes > 4 * 1024 * 1024) throw new Error('收藏较多，请从上方选择一个文件夹分批导入，无需找数据文件');
    items.push(item);
    return include;
  });
  if (!found) throw new Error('所选收藏文件夹已不存在，请重新读取');
  return { items, skipped, duplicates };
}
