import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Archive, ArrowClockwise, ArrowCounterClockwise, ArrowSquareOut, Camera, CaretRight, Check, Copy, DotsThreeVertical, ImageSquare, PencilSimple, PushPin, Trash } from '@phosphor-icons/react';
import { SiteIcon } from './SiteIcon.jsx';
import { canRefreshSiteIcon, canViewScreenshot, displayAddress, getDefaultEndpoint, getIcon, getPreview, iconJobState, screenshotEntryLabel } from '../model.js';


export function SiteCard({ site, mode, lazy = true, onDetails, onOpen, onEdit, onPatch, onRemove, onGuide, onRemovePreview, onViewScreenshot, onRefreshIcon }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [iconPending, setIconPending] = useState(false);
  const menu = useRef(null);
  const menuTrigger = useRef(null);
  const card = useRef(null);
  const [tier, setTier] = useState('compact');
  const preview = getPreview(site);
  const icon = getIcon(site);
  const iconJob = iconJobState(site);
  const entry = getDefaultEndpoint(site);
  useLayoutEffect(() => {
    const element = card.current;
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      setTier(width >= 300 ? 'wide' : width >= 240 ? 'standard' : 'compact');
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const dismiss = event => { if (!menu.current?.contains(event.target)) setMenuOpen(false); };
    const escape = event => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      requestAnimationFrame(() => menuTrigger.current?.focus());
    };
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [menuOpen]);
  const act = action => { setMenuOpen(false); action(); };
  async function copyUrl() {
    setCopyError('');
    try {
      await navigator.clipboard.writeText(entry.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { setCopied(false); setCopyError('复制失败，请在详情中手动选择完整地址'); }
  }
  async function refreshIcon() {
    if (!onRefreshIcon || iconPending) return;
    setMenuOpen(false); setIconPending(true);
    try { await onRefreshIcon(site); } finally { setIconPending(false); }
  }
  const summary = site.notes ? `备注：${site.notes}` : site.description || '暂无简介';
  return <article ref={card} data-tier={tier} className={`site-card ${mode === 'list' ? 'list-card' : ''}`} data-site-id={site.id} data-created-at={site.createdAt || ''}><div className="card-shell">
    <div className="card-menu" ref={menu}>
      <button ref={menuTrigger} type="button" className="icon-button menu-trigger" aria-label={`管理${site.name}`} aria-expanded={menuOpen} aria-haspopup="menu" onClick={() => setMenuOpen(!menuOpen)}><DotsThreeVertical size={19} /></button>
      {menuOpen && <div className="dropdown-menu" role="menu">
        <button type="button" role="menuitem" onClick={() => act(() => onEdit(site))}><PencilSimple />编辑资料</button>
        {onRefreshIcon && canRefreshSiteIcon(site) && <button type="button" role="menuitem" disabled={iconPending} onClick={refreshIcon}><ArrowClockwise />{iconPending ? '正在更新图标…' : icon.present ? '重新获取网站图标' : '更新网站图标'}</button>}
        <button type="button" role="menuitem" onClick={() => act(() => onGuide(site))}><Camera />用扩展更新素材</button>
        {preview.present && <button type="button" role="menuitem" onClick={() => act(() => onRemovePreview(site))}><Trash />移除截图</button>}
        {!site.deleted && <button type="button" role="menuitem" onClick={() => act(() => onPatch(site.id, { pinned: !site.pinned }, site.pinned ? '已取消置顶' : '已置顶网站'))}><PushPin />{site.pinned ? '取消置顶' : '置顶网站'}</button>}
        {!site.deleted && <button type="button" role="menuitem" onClick={() => act(() => onPatch(site.id, { archived: !site.archived }, site.archived ? '已恢复到网站库' : '已归档，可在归档网站中找回'))}>{site.archived ? <ArrowCounterClockwise /> : <Archive />}{site.archived ? '取消归档' : '归档网站'}</button>}
        {site.deleted && <button type="button" role="menuitem" onClick={() => act(() => onPatch(site.id, { deleted: false, archived: false }, '已恢复网站'))}><ArrowCounterClockwise />恢复网站</button>}
        <button type="button" role="menuitem" className="danger-text" onClick={() => act(() => site.deleted ? onRemove(site) : onPatch(site.id, { deleted: true }, '已移入回收站'))}><Trash />{site.deleted ? '永久删除' : '移入回收站'}</button>
      </div>}
    </div>
    {site.pinned && <PushPin className="card-pin" size={14} weight="fill" role="img" aria-label="已置顶" />}
    <button type="button" className="card-logo" onClick={() => onDetails(site)} aria-label={`查看${site.name}详情`}><SiteIcon site={site} lazy={lazy} /></button>
    {iconJob.fetching && <span className="icon-job-flag" role="status">图标获取中</span>}
    <div className="card-heading"><button type="button" className="site-title" title={site.name} onClick={() => onDetails(site)}>{site.name}</button></div>
    <div className="site-address">
      <button type="button" onClick={() => onDetails(site)} aria-label={`查看${site.name}完整地址：${entry.url}`}><span className="address-host">{displayAddress(entry.url, 30)}</span></button>
      <button type="button" className="icon-button" aria-label={copied ? '已复制完整地址' : `复制${site.name}完整地址`} onClick={copyUrl}>{copied ? <Check size={14} weight="bold" /> : <Copy size={13} />}</button>
      <span className="copy-status">{copied ? '已复制' : ''}</span>
    </div>
    {copyError && <p className="card-copy-error" role="alert">{copyError}</p>}
    {tier !== 'compact' && <button type="button" className="site-description" onClick={() => onDetails(site)}>{site.notes && <em className="deck-summary-mark">备注</em>}{summary}</button>}
    <div className="card-tags"><span className="category-chip">{site.category || '未分类'}</span>{site.tags.slice(0, 2).map(tag => <span key={tag}>{tag}</span>)}{site.tags.length > 2 && <span className="card-tag-count">+{site.tags.length - 2}</span>}{site.endpoints.length > 1 && <button type="button" className="entry-shortcut" onClick={() => onDetails(site)}>{site.endpoints.length} 个入口<CaretRight size={11} /></button>}</div>
    <footer className="card-footer"><button type="button" className={`screenshot-button ${!canViewScreenshot(site) ? 'missing-screenshot' : ''}`} onClick={() => onViewScreenshot(site)} title={canViewScreenshot(site) ? '查看当前页面截图' : '还没有截图'}><ImageSquare size={15} />{screenshotEntryLabel(site)}</button><button type="button" className="open-site" onClick={() => onOpen(site)}><ArrowSquareOut size={15} /><span>{site.deleted ? '查看资料' : '打开'}</span></button></footer>
  </div></article>;
}
