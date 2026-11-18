import { Archive, CaretRight, FolderSimple, House, Stack, Tag, Tray, Trash, SquaresFour, X } from '@phosphor-icons/react';

const navigation = [ ['home', '我的工作台', House], ['all', '全部网站', SquaresFour], ['deployments', '我的部署', Stack], ['inbox', '收件箱', Tray], ['collections', '工作集', FolderSimple] ];

export function Sidebar({ view, category, categories = [], counts = {}, user, demo, collapsed = false, drawerOpen = false, onNavigate, inboxCount, onClose, onSettings }) {
  const item = (key, label, Icon, extra = {}) => <button key={key} type="button" title={label} aria-label={extra.ariaLabel || label} onClick={() => onNavigate(key)} className={`nav-item ${view === key && !category ? 'active' : ''}`} aria-current={view === key && !category ? 'page' : undefined}>
    <Icon size={20} weight={view === key && !category ? 'fill' : 'regular'} /><span>{label}</span>{extra.count > 0 && <span className="count-badge" aria-label={`${extra.count} 条`}>{extra.count}</span>}
  </button>;
  return <>
    {drawerOpen && <button type="button" className="sidebar-backdrop" aria-label="关闭导航" onClick={onClose} />}
    <aside className={`sidebar ${collapsed ? 'rail' : ''} ${drawerOpen ? 'expanded' : ''}`} aria-label="主导航">
      <a className="brand" href="#" title="网站工作台" onClick={event => { event.preventDefault(); onNavigate('home'); }}><img className="brand-mark" src="/assets/workspace-mark.svg" alt="" /><span>网站工作台</span></a>
      <button type="button" className="icon-button mobile-close" onClick={onClose} aria-label="关闭导航"><X /></button>
      <nav className="main-navigation" aria-label="主要导航">{navigation.map(([key, label, Icon]) => item(key, label, Icon, { count: key === 'inbox' ? inboxCount : 0 }))}</nav>
      <div className="nav-divider" />
      <p className="nav-label">网站分类</p>
      <nav className="sidebar-categories" aria-label="网站分类">{categories.map(name => <button key={name} type="button" title={name} aria-label={`${name}（${counts[name] || 0} 条）`} onClick={() => onNavigate('all', name)} className={`nav-item ${category === name ? 'active' : ''}`} aria-current={category === name ? 'page' : undefined}>
        <Tag size={18} /><span>{name}</span>{counts[name] > 0 && <span className="count-badge">{counts[name]}</span>}
      </button>)}</nav>
      <div className="secondary-nav">{item('archive', '归档网站', Archive)}{item('trash', '回收站', Trash)}</div>
      <button type="button" className="profile" onClick={onSettings} title={user?.name || user?.email || '我的账号'} aria-label="账号与设置">
        <img src="/assets/avatar.png" alt="" /><span><strong>{user?.name || user?.email || '我的账号'}</strong><small>我的空间 {demo && <span className="demo-label">演示</span>}</small></span><CaretRight size={17} />
      </button>
    </aside>
  </>;
}
