import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowSquareOut, CheckCircle, GearSix, List, MagnifyingGlass, Plus, SidebarSimple, SquaresFour, X } from '@phosphor-icons/react';
import { viewMeta } from './data.js';
import { buildCategoryChips, filterSites, getDefaultEndpoint } from './model.js';
import { resolveSidebarLayout } from './layout.js';
import { SORT_OPTIONS } from './layout-preferences.js';
import { useWorkspace } from './useWorkspace.js';
import { useViewport } from './useViewport.js';
import { useLayoutPreferences } from './useLayoutPreferences.js';
import { Sidebar } from './components/Sidebar.jsx';
import { SiteDetail } from './components/SiteDetail.jsx';
import { SiteForm } from './components/SiteForm.jsx';
import { SettingsDialog } from './components/SettingsDialog.jsx';
import { WorkspaceContent } from './components/WorkspaceContent.jsx';
import { Dialog } from './components/Dialog.jsx';
import { ScreenshotViewer } from './components/ScreenshotViewer.jsx';
import { DisplaySettings } from './components/DisplaySettings.jsx';
import { useCardPreferences } from './useCardPreferences.js';
import { modalManager } from './dialogStack.js';
import { useExtensionPresence } from './useExtensionPresence.js';
import { ExtensionInstallNotice } from './components/ExtensionInstallNotice.jsx';

const formatDay = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' });
};

export function App({ demo = false, user, onLogout }) {
  const workspace = useWorkspace({ demo });
  const extensionPresence = useExtensionPresence(!demo);
  const cardPreferences = useCardPreferences({ user, demo, onError: workspace.setToast });
  const layout = useLayoutPreferences({ user, demo, onError: workspace.setToast });
  const viewport = useViewport();
  const sidebar = resolveSidebarLayout({ viewportWidth: viewport.width, preference: layout.sidebar });
  const [view, setView] = useState('home');
  const [category, setCategory] = useState('');
  const [chip, setChip] = useState('全部');
  const [query, setQuery] = useState('');
  const [collection, setCollection] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailId, setDetailId] = useState(() => new URLSearchParams(location.search).get('site'));
  const [editor, setEditor] = useState(null);
  const [settings, setSettings] = useState(() => new URLSearchParams(location.search).get('settings') || false);
  const [pendingOpen, setPendingOpen] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [pendingPreview, setPendingPreview] = useState(null);
  const [pendingInbox, setPendingInbox] = useState(null);
  const [screenshotId, setScreenshotId] = useState(null);
  const search = useRef(null);
  const desktopSidebar = sidebar.mode !== 'drawer';
  const closeDetail = useCallback(() => {
    setDetailId(null);
    const parameters = new URLSearchParams(location.search); parameters.delete('site');
    history.replaceState({}, '', `${location.pathname}${parameters.size ? `?${parameters}` : ''}`);
  }, []);
  const closeEditor = useCallback(() => setEditor(null), []);
  const closeSettings = useCallback(() => {
    setSettings(false);
    const parameters = new URLSearchParams(location.search); parameters.delete('settings');
    history.replaceState({}, '', `${location.pathname}${parameters.size ? `?${parameters}` : ''}`);
  }, []);
  function showDetails(site) {
    setDetailId(site.id);
    const parameters = new URLSearchParams(location.search); parameters.set('site', site.id);
    history.replaceState({}, '', `${location.pathname}?${parameters}`);
  }
  const closeOpen = useCallback(() => setPendingOpen(null), []);
  const closeDelete = useCallback(() => setPendingDelete(null), []);
  const closePreview = useCallback(() => setPendingPreview(null), []);
  const closeInbox = useCallback(() => setPendingInbox(null), []);
  const closeScreenshot = useCallback(() => setScreenshotId(null), []);
  const guide = useCallback(() => { setDetailId(null); setScreenshotId(null); setSettings('devices'); }, []);
  useEffect(() => {
    const hotkey = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (!modalManager.hasOpen()) search.current?.focus();
      }
    };
    window.addEventListener('keydown', hotkey);
    return () => window.removeEventListener('keydown', hotkey);
  }, []);
  // 分类被重命名/删除后，清理失效的筛选状态，避免永久空结果。
  useEffect(() => {
    if (category && !workspace.categories.includes(category)) setCategory('');
    if (chip !== '全部' && !workspace.categories.includes(chip)) setChip('全部');
  }, [workspace.categories, category, chip]);
  // 移动端抽屉：Escape 关闭并把焦点交还导航按钮；不冒充模态弹层。
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const keydown = event => { if (event.key === 'Escape') { event.stopPropagation(); setDrawerOpen(false); } };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [drawerOpen]);
  function navigate(nextView, nextCategory = '') {
    setView(nextView); setCategory(nextCategory); setQuery(''); setChip('全部'); setCollection(''); setDrawerOpen(false);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  function toggleSidebar() {
    if (!desktopSidebar) setDrawerOpen(current => !current);
    else layout.setSidebar(sidebar.collapsed ? 'expanded' : 'collapsed');
  }
  function open(site, endpoint) {
    if (site.deleted) { setDetailId(site.id); return; }
    if (!endpoint && site.endpoints.length > 1) { setDetailId(site.id); return; }
    const entry = endpoint || getDefaultEndpoint(site);
    const hostname = new URL(entry.url).hostname;
    if (entry.scope !== '公网' || hostname.endsWith('.example.com') || hostname === 'example.com' || hostname === 'localhost' || /^(127\.|192\.168\.|10\.)/.test(hostname)) setPendingOpen({ site, entry });
    else workspace.visit(site, entry);
  }
  function edit(site) { setDetailId(null); setEditor(site); }
  const visible = useMemo(() => filterSites(workspace.sites, { view, query, category, chip, collection, sort: layout.sort }), [workspace.sites, view, query, category, chip, collection, layout.sort]);
  const categoryCounts = useMemo(() => {
    const counts = {};
    for (const site of filterSites(workspace.sites, { view: 'home' })) counts[site.category || '未分类'] = (counts[site.category || '未分类'] || 0) + 1;
    return counts;
  }, [workspace.sites]);
  const chipGroups = useMemo(() => buildCategoryChips(workspace.sites, { categories: workspace.categories, view }), [workspace.sites, workspace.categories, view]);
  const homeSites = useMemo(() => filterSites(workspace.sites, { view: 'home' }), [workspace.sites]);
  const latestUpdated = homeSites.reduce((latest, site) => site.updatedAt && String(site.updatedAt) > String(latest || '') ? site.updatedAt : latest, '');
  const selected = workspace.sites.find(site => site.id === detailId);
  const screenshotSite = workspace.sites.find(site => site.id === screenshotId);
  const meta = viewMeta[view];
  const title = category || (view === 'home' ? '我的工作台' : meta[0]);
  const subtitle = category ? `「${category}」中有 ${visible.length} 个网站` : view === 'home'
    ? `共 ${homeSites.length} 个网站${latestUpdated ? ` · 最近更新 ${formatDay(latestUpdated)}` : ''}`
    : `${meta[1]} · ${visible.length} 个网站`;
  const isCollectionOverview = view === 'collections' && !collection && !query && chip === '全部';
  const statusPending = workspace.loading || workspace.refreshing || workspace.pending > 0;
  const statusText = demo ? '交互原型 · 示例数据' : workspace.loading ? '正在载入…' : workspace.error ? '连接异常，可重试' : workspace.refreshing ? '正在同步最新资料…' : statusPending ? '正在保存…' : '私有网站库 · 已连接';
  return <div className={`app-shell ${sidebar.mode === 'rail' ? 'rail' : ''}`}>
    <Sidebar view={view} category={category} categories={workspace.categories} counts={categoryCounts} user={user} demo={demo} collapsed={sidebar.collapsed} drawerOpen={drawerOpen}
      onNavigate={navigate} inboxCount={workspace.sites.filter(s => s.inbox && !s.deleted && !s.archived).length} onClose={() => setDrawerOpen(false)} onSettings={() => setSettings('account')} />
    <div className="main-area">
      <header className="topbar">
        <div className="breadcrumb"><button type="button" className="icon-button mobile-menu" aria-label="展开导航" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}><List size={22} /></button>
          <button type="button" className="icon-button sidebar-toggle" aria-label={sidebar.collapsed ? '展开侧栏' : '折叠侧栏'} aria-expanded={!sidebar.collapsed} onClick={toggleSidebar}><SidebarSimple size={20} /></button>
          <span>我的空间</span><span className="breadcrumb-slash">/</span><strong>{category || meta[2]}</strong></div>
        <div className="topbar-actions"><button type="button" className="icon-button settings-trigger" onClick={() => setSettings(true)} aria-label="工作台设置"><GearSix size={21} /></button><button type="button" className="primary-button" onClick={() => setEditor({})}><Plus size={19} />收藏网站</button></div>
      </header>
      <main className="workspace">
        <div className="hero-copy"><h1>{title}</h1><p>{subtitle}</p></div>
        <ExtensionInstallNotice visible={!demo && view === 'home'} presence={extensionPresence} onGuide={guide} />
        <div className="search-field"><MagnifyingGlass size={21} /><input ref={search} value={query} onChange={event => { setQuery(event.target.value); if (event.target.value && chip !== '全部') setChip('全部'); }} onKeyDown={event => { if (event.key === 'Escape' && query && !modalManager.hasOpen()) { event.stopPropagation(); setQuery(''); } }} aria-label="搜索网站" placeholder="搜索名称、简介、备注或标签" />{query ? <button type="button" className="icon-button" aria-label="清空搜索" onClick={() => setQuery('')}><X size={19} /></button> : <kbd>Ctrl&nbsp; K</kbd>}</div>
        {!isCollectionOverview && <div className="filter-toolbar">
          <div className="filter-chips-wrap"><div className="filter-chips" role="group" aria-label="按分类筛选">
            {chipGroups.chips.map(item => { const selected = chip === item.label || (item.label !== '全部' && category === item.label); return <button type="button" key={item.label} aria-pressed={selected} className={selected ? 'selected' : ''} onClick={() => { setChip(item.label); setCategory(''); }}>{item.label}<span className="chip-count">{item.count}</span></button>; })}
          </div>
          {chipGroups.overflow.length > 0 && <details className="more-categories"><summary>更多分类<Chevron /></summary><div className="more-categories-menu" role="menu">{chipGroups.overflow.map(item => <button type="button" role="menuitem" key={item.label} onClick={event => { setChip(item.label); setCategory(''); event.currentTarget.closest('details')?.removeAttribute('open'); }}><span>{item.label}</span><small>{item.count}</small></button>)}</div></details>}
          </div>
          <div className="view-tools">
            <label className="sort-control">排序
              <select value={layout.sort} onChange={event => layout.setSort(event.target.value)} aria-label="排序方式">{SORT_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
            </label>
            <DisplaySettings preference={cardPreferences} layout={{ collapsed: sidebar.collapsed, setSidebar: layout.setSidebar }} desktop={desktopSidebar} />
            <div className="view-toggle" role="group" aria-label="展示方式"><button type="button" aria-label="卡片视图" aria-pressed={layout.mode === 'grid'} className={layout.mode === 'grid' ? 'selected' : ''} onClick={() => layout.setMode('grid')}><SquaresFour size={20} /></button><button type="button" aria-label="列表视图" aria-pressed={layout.mode === 'list'} className={layout.mode === 'list' ? 'selected' : ''} onClick={() => layout.setMode('list')}><List size={20} /></button></div>
          </div>
        </div>}
        {workspace.loading && !workspace.sites.length ? <div className="workspace-loading" role="status"><p>正在载入你的网站资料…</p><div className="skeleton-grid">{Array.from({ length: 6 }, (_, index) => <div className="skeleton-card" key={index} />)}</div></div>
          : workspace.error && !workspace.sites.length ? <div className="workspace-load-error" role="alert"><span>{workspace.error}</span><button type="button" className="secondary-button" onClick={() => workspace.refresh().catch(() => {})}>重试</button></div>
            : <WorkspaceContent sites={workspace.sites} visible={visible} recent={workspace.recent} collections={workspace.collections} view={view} query={query} chip={chip} category={category} collection={collection} mode={layout.mode} cardTarget={cardPreferences.target} onSelectCollection={setCollection} onDetails={showDetails} onOpen={open} onEdit={edit} onPatch={workspace.patch} onRemove={setPendingDelete} onClear={() => { setQuery(''); setChip('全部'); setCategory(''); setCollection(''); }} onAdd={() => setEditor({})} onGuide={guide} onRemovePreview={setPendingPreview} onViewScreenshot={site => setScreenshotId(site.id)} onRefreshIcon={workspace.refreshIcon} />}
        {view === 'inbox' && visible.length > 0 && <button type="button" className="secondary-button" disabled={workspace.pending > 0} onClick={() => setPendingInbox({ count: visible.length })}>{workspace.pending ? '正在处理…' : '将现有收件箱全部整理完成'}</button>}
        {view === 'collections' && !demo && <button type="button" className="text-button manage-collections" onClick={() => setSettings('organization')}><Plus size={16} />管理分类与工作集</button>}
        <footer className="workspace-footer"><span>只收藏值得留下的，也记下留下的理由。</span><button type="button" onClick={() => setSettings(true)}><span className={`workspace-status-dot ${workspace.error ? 'error' : statusPending ? 'pending' : ''}`} />{statusText}</button></footer>
      </main>
    </div>
    {selected && <SiteDetail site={selected} demo={demo} onClose={closeDetail} onEdit={edit} onOpen={open} onPatch={workspace.patch} notify={workspace.setToast} onRefresh={workspace.refresh} onRefreshIcon={workspace.refreshIcon} onRefetchIcon={workspace.refetchIcon} onUploadIcon={workspace.uploadLocalIcon} />}
    {screenshotSite && <ScreenshotViewer site={screenshotSite} onClose={closeScreenshot} onRefreshMetadata={workspace.refresh} onGuide={guide} />}
    {editor && <SiteForm site={editor.id ? editor : null} categories={workspace.categories} collections={workspace.collections} demo={demo} onClose={closeEditor} onSave={workspace.save} />}
    {settings && <SettingsDialog workspace={workspace} user={user} demo={demo} extensionPresence={extensionPresence} initialTab={typeof settings === 'string' ? settings : 'data'} onClose={closeSettings} onLogout={onLogout} />}
    {pendingOpen && <Dialog title="确认访问入口" onClose={closeOpen}><div className="confirm-body"><p>你即将打开 <strong>{pendingOpen.site.name}</strong> 的「{pendingOpen.entry.label}」。</p><code className="url-preview">{pendingOpen.entry.url}</code><p className="muted">{pendingOpen.entry.url.includes('example.com') ? '这是保留的示例地址，用于展示云端入口。你可以先编辑成自己的地址。' : `访问条件：${pendingOpen.entry.scope}。本机地址指向当前设备，局域网地址需要连接对应网络。`}</p></div><footer className="dialog-actions"><button type="button" className="secondary-button" onClick={closeOpen}>取消</button><button type="button" className="primary-button" onClick={() => { workspace.visit(pendingOpen.site, pendingOpen.entry); setPendingOpen(null); }}><ArrowSquareOut size={17} />继续打开</button></footer></Dialog>}
    {pendingDelete && <Dialog title="永久删除这个网站？" onClose={closeDelete}><div className="confirm-body"><p>「{pendingDelete.name}」的资料将永久删除，此操作无法撤销。</p></div><footer className="dialog-actions"><button type="button" className="secondary-button" onClick={closeDelete}>取消</button><button type="button" className="danger-button" onClick={async () => { if (await workspace.remove(pendingDelete.id)) setPendingDelete(null); }}>确认删除</button></footer></Dialog>}
    {pendingPreview && <Dialog title="移除这张截图？" onClose={closePreview}><div className="confirm-body"><p>只会移除「{pendingPreview.name}」的当前预览图，网站名称、地址、简介和备注都会保留。</p></div><footer className="dialog-actions"><button type="button" className="secondary-button" onClick={closePreview}>取消</button><button type="button" className="danger-button" onClick={async () => { if (await workspace.removePreview(pendingPreview)) setPendingPreview(null); }}>确认移除截图</button></footer></Dialog>}
    {pendingInbox && <Dialog title="整理全部收件箱？" onClose={closeInbox}><div className="confirm-body"><p>将把当前收件箱中的 {pendingInbox.count} 条资料标记为已整理。分类、备注和素材都不会改变。</p></div><footer className="dialog-actions"><button type="button" className="secondary-button" onClick={closeInbox}>取消</button><button type="button" className="primary-button" onClick={async () => { if (await workspace.completeInbox()) setPendingInbox(null); }}>全部标记为已整理</button></footer></Dialog>}
    {workspace.toast && <div className="toast" role="status"><CheckCircle size={20} weight="fill" />{workspace.toast}</div>}
  </div>;
}

function Chevron() {
  return <svg width="12" height="12" viewBox="0 0 256 256" aria-hidden="true"><path fill="currentColor" d="m213.66 101.66-80 80a8 8 0 0 1-11.32 0l-80-80A8 8 0 0 1 53.66 90.34L128 164.69l74.34-74.35a8 8 0 0 1 11.32 11.32Z" /></svg>;
}
