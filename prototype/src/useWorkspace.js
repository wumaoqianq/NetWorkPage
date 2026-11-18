import { useCallback, useEffect, useRef, useState } from 'react';
import { initialSites, categories as initialCategories, collections as initialCollections } from './data.js';
import { replaceSite } from './model.js';
import { api } from './api.js';
import { loadWorkspace } from './workspace-loader.js';

/** 后台轮询先检查轻量版本；编辑草稿独立保存，不被无变更刷新覆盖。 */
export function useWorkspace({ demo = false } = {}) {
  const [sites, setSites] = useState(() => demo ? structuredClone(initialSites) : []);
  const [recent, setRecent] = useState(demo ? ['notion', 'github'] : []);
  const [categories, setCategories] = useState(demo ? initialCategories : []);
  const [collections, setCollections] = useState(demo ? initialCollections : []);
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(!demo);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSynced, setLastSynced] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(0);
  const revision = useRef('');
  const refreshingRef = useRef(false);
  const refresh = useCallback(async ({ background = false } = {}) => {
    if (demo || refreshingRef.current) return;
    refreshingRef.current = true;
    if (!background) { setLoading(true); setError(''); } else { setRefreshing(true); }
    try {
      const data = await loadWorkspace(api);
      revision.current = data.revision || '';
      setSites(data.sites); setRecent(data.recent || []); setCategories(data.categories || []); setCollections(data.collections || []);
      setLastSynced(new Date());
    } catch (failure) {
      if (!background) { setError(failure.message); throw failure; }
    } finally { if (!background) setLoading(false); setRefreshing(false); refreshingRef.current = false; }
  }, [demo]);
  useEffect(() => { refresh().catch(() => {}); }, [refresh]);
  useEffect(() => {
    if (demo) return undefined;
    const check = async () => {
      if (document.visibilityState === 'hidden' || refreshingRef.current) return;
      try {
        const data = await api.request('/api/workspace/revision');
        if (data.revision && data.revision !== revision.current) await refresh({ background: true });
      } catch { /* 下一次可见或轮询继续检查，不打断当前编辑。 */ }
    };
    const timer = setInterval(check, 30000);
    const onVisible = () => check();
    const onFocus = () => check();
    const onOnline = () => check();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onFocus); window.removeEventListener('online', onOnline); };
  }, [demo, refresh]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  async function save(site) {
    const existing = sites.find(s => s.id === site.id);
    setPending(current => current + 1);
    try {
      const saved = demo ? site : await api.request(existing ? `/api/sites/${site.id}` : '/api/sites', { method: existing ? 'PATCH' : 'POST', body: site });
      setSites(current => current.some(s => s.id === saved.id) ? replaceSite(current, saved) : [saved, ...current]);
      setToast(demo ? '已保存到本次演示' : existing ? '修改已保存' : `已收藏到${saved.category ? `「${saved.category}」` : '网站库 · 未分类'}`);
      return saved;
    } catch (failure) { if (failure.status === 409) refresh({ background: true }).catch(() => {}); throw failure; }
    finally { setPending(current => current - 1); }
  }
  async function patch(id, changes, message) {
    const site = sites.find(s => s.id === id);
    if (!site) return false;
    try { await save({ ...site, ...changes }); if (message) setToast(message); return true; }
    catch (failure) { setToast(`${failure.message} 输入未丢失，请核对后重试。`); return false; }
  }
  async function remove(id) {
    setPending(current => current + 1);
    try {
      if (!demo) await api.request(`/api/sites/${id}`, { method: 'DELETE', body: { version: sites.find(s => s.id === id)?.version } });
      setSites(current => current.filter(s => s.id !== id)); setToast('已永久删除'); return true;
    } catch (failure) { setToast(failure.message); return false; }
    finally { setPending(current => current - 1); }
  }
  async function removePreview(site) {
    if (demo) { setToast('演示资料没有私有截图'); return false; }
    setPending(current => current + 1);
    try {
      const result = await api.request(`/api/sites/${site.id}/preview`, { method: 'DELETE', body: { version: site.version } });
      setSites(current => current.map(item => item.id === site.id ? { ...item, version: result.siteVersion,
        presentation: { ...item.presentation, preview: { present: false } } } : item));
      setToast('已移除截图，网站资料保留'); return true;
    } catch (failure) { setToast(failure.message); if (failure.status === 409) refresh({ background: true }).catch(() => {}); return false; }
    finally { setPending(current => current - 1); }
  }
  /** 只更新网站图标：不动截图、备注和分类；失败保留原图并给出可重试原因。 */
  async function refreshIcon(site) {
    if (demo) { setToast('演示资料不请求外网图标'); return false; }
    setPending(current => current + 1);
    try {
      const result = await api.request(`/api/sites/${site.id}/icon/refresh`, { method: 'POST', body: { version: site.version } });
      const icon = result.icon || result;
      const revision = icon.revision || result.revision;
      setSites(current => current.map(item => item.id === site.id ? {
        ...item, version: result.siteVersion ?? item.version,
        presentation: { ...item.presentation, icon: revision ? { present: true, revision, url: `/api/sites/${site.id}/icon?rev=${revision}` } : item.presentation?.icon },
      } : item));
      setToast(`已更新「${site.name}」的网站图标${icon.sourceHost ? `（${icon.sourceHost}）` : ''}`);
      return true;
    } catch (failure) {
      if (failure.status === 409) refresh({ background: true }).catch(() => {});
      setToast(`${failure.message}${failure.code === 'icon_refresh_private' ? '：请在该网站页面打开扩展并选择“更新网站图标”。' : ''}`);
      return false;
    } finally { setPending(current => current - 1); }
  }
  /** 用户显式触发的有限量批量修复：只处理缺图资料，不是常驻后台任务。 */
  async function repairMissingIcons(limit = 6) {
    if (demo) { setToast('演示资料不请求外网图标'); return null; }
    setPending(current => current + 1);
    try {
      const result = await api.request('/api/sites/icons/refresh-missing', { method: 'POST', body: { limit } });
      await refresh({ background: true }).catch(() => {});
      const failed = result.failed?.length || 0;
      setToast(`图标修复：更新 ${result.updated || 0} 个${failed ? `，${failed} 个失败` : ''}${result.missing > result.updated + failed ? `，其余 ${result.missing - result.updated - failed} 个需在扩展中处理` : ''}`);
      return result;
    } catch (failure) { setToast(failure.message); return null; }
    finally { setPending(current => current - 1); }
  }
  /** 例外恢复：把终态缺图 Job 重新排队，由服务端后台补齐；不覆盖已有图标、不阻塞页面。 */
  async function refetchIcon(site) {
    if (demo) { setToast('演示资料不请求外网图标'); return false; }
    setPending(current => current + 1);
    try {
      await api.request(`/api/sites/${site.id}/icon/refetch`, { method: 'POST', body: { version: site.version } });
      await refresh({ background: true }).catch(() => {});
      setToast(`已为「${site.name}」重新排队补图，稍后自动完成`);
      return true;
    } catch (failure) { setToast(failure.message); return false; }
    finally { setPending(current => current - 1); }
  }
  /** 例外恢复：高级本地 PNG/WebP 上传，服务端真实解码后替换图标；不改截图/备注/分类。 */
  async function uploadLocalIcon(site, file) {
    if (demo) { setToast('演示资料不上传本地图标'); return false; }
    if (!file || !['image/png', 'image/webp'].includes(file.type)) { setToast('请选择 PNG 或 WebP 图片'); return false; }
    if (file.size > 200 * 1024) { setToast('图标不能超过 200KiB'); return false; }
    setPending(current => current + 1);
    try {
      const form = new FormData();
      form.append('version', String(site.version));
      form.append('file', file, file.name || 'icon.png');
      const result = await api.request(`/api/sites/${site.id}/icon/upload`, { method: 'POST', form });
      await refresh({ background: true }).catch(() => {});
      setToast(`已更新「${site.name}」的网站图标`);
      return result;
    } catch (failure) { setToast(failure.message); return false; }
    finally { setPending(current => current - 1); }
  }
  function reset() {
    if (!demo) return;
    setSites(structuredClone(initialSites));
    setRecent(['notion', 'github']);
    setToast('已恢复初始示例数据');
  }
  function visit(site, endpoint) {
    setRecent(current => [site.id, ...current.filter(id => id !== site.id)].slice(0, 6));
    window.open(endpoint.url, '_blank', 'noopener,noreferrer');
    if (!demo) api.request('/api/visits', { method: 'POST', body: { siteId: site.id, endpointId: endpoint.id } }).catch(() => setToast('网站已打开，访问记录暂未保存'));
  }
  function importSites(items) {
    if (!demo) throw new Error('请使用导入预览，确认后再写入数据库');
    const urls = new Set(sites.flatMap(s => s.endpoints.map(e => e.url)));
    const added = items.filter(s => !urls.has(s.endpoints[0].url) && Boolean(urls.add(s.endpoints[0].url)));
    setSites(current => [...added, ...current]);
    setToast(`已导入 ${added.length} 个网站，重复地址已跳过`);
  }
  async function completeInbox() {
    const count = sites.filter(site => site.inbox && !site.deleted && !site.archived).length;
    setPending(current => current + 1);
    try {
      if (!demo) await api.request('/api/inbox/complete', { method: 'POST', body: { count } });
      setSites(current => current.map(site => site.inbox ? { ...site, inbox: false } : site));
      setToast(`已完成 ${count} 条收件箱资料，分类和备注均未改变`); return true;
    } catch (failure) { setToast(`${failure.message} 请刷新数量后重试。`); return false; }
    finally { setPending(current => current - 1); }
  }
  return { sites, recent, categories, collections, toast, setToast, save, patch, remove, removePreview, refreshIcon, repairMissingIcons, refetchIcon, uploadLocalIcon, reset, visit, importSites, completeInbox, loading, refreshing, lastSynced, error, pending, refresh };
}
