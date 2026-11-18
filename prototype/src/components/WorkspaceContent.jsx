import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, CaretRight, FolderSimple, MagnifyingGlass, Plus, PuzzlePiece } from '@phosphor-icons/react';
import { SiteCard } from './SiteCard.jsx';
import { SiteIcon } from './SiteIcon.jsx';
import { cardGap } from '../card-preferences.js';
import { recentItems } from '../layout.js';
import { useCardGrid } from '../useCardGrid.js';

export function WorkspaceContent({ sites, visible, recent, collections = [], view, query, chip, category = '', collection, mode, cardTarget = 260, onSelectCollection, onDetails, onOpen, onEdit, onPatch, onRemove, onClear, onAdd, onGuide, onRemovePreview, onViewScreenshot, onRefreshIcon }) {
  const [gridElement, setGridElement] = useState(null);
  const gridRef = useCallback(node => setGridElement(node), []);
  const grid = useCardGrid({ element: gridElement, target: cardTarget, mode });
  const [limit, setLimit] = useState(40);
  useEffect(() => setLimit(40), [query, view, chip, category, collection, mode]);
  const recentShown = view === 'home' && !query && !collection ? recentItems(recent, sites) : [];
  if (view === 'collections' && !collection && !query && chip === '全部') return <section className={`collection-grid ${mode === 'list' ? 'list-collections' : ''}`}>{collections.map(group => {
    const members = sites.filter(s => !s.deleted && !s.archived && s.collections?.includes(group.id));
    return <button type="button" className="collection-card" key={group.id} onClick={() => onSelectCollection(group.id)}><span className="collection-folder"><FolderSimple size={26} weight="duotone" /></span><h2>{group.name}</h2><p>{group.description}</p><div className="collection-footer"><span>{members.length} 个网站</span><ArrowRight size={19} /></div></button>;
  })}</section>;
  const title = query ? '搜索结果' : collection ? collections.find(c => c.id === collection)?.name : { home: '全部收藏', inbox: '稍后整理', deployments: '我的服务', archive: '已归档', trash: '已删除' }[view] || '网站库';
  const filteredEmpty = !query && Boolean(chip !== '全部' || collection || category);
  const heading = view === 'home' && !query ? null : <div className="section-heading library-heading"><h2>{title}</h2><span>{query ? `${visible.length} 个结果` : `${visible.length} 个网站`}</span></div>;
  const gridStyle = mode === 'list' ? undefined : { '--card-target': `${cardTarget}px`, gap: `${cardGap(cardTarget)}px`,
    gridTemplateColumns: grid.ready ? `repeat(${grid.columns}, minmax(0, 1fr))` : undefined };
  return <>
    <section className="sites-section">{heading}
      {visible.length ? <><div ref={gridRef} className={`site-grid ${mode === 'list' ? 'list-view' : ''}`} style={gridStyle}>{visible.slice(0, limit).map((site, index) => <SiteCard key={site.id} site={site} mode={mode} lazy={index >= 8} onDetails={onDetails} onOpen={onOpen} onEdit={onEdit} onPatch={onPatch} onRemove={onRemove} onGuide={onGuide} onRemovePreview={onRemovePreview} onViewScreenshot={onViewScreenshot} onRefreshIcon={onRefreshIcon} />)}</div>
        {limit < visible.length && <div className="load-more"><button type="button" className="secondary-button" onClick={() => setLimit(current => current + 40)}>加载更多（剩余 {visible.length - limit} 个）</button><small>搜索始终覆盖已载入的完整资料，分批只限制卡片和图片请求。</small></div>}</> : <div className="empty-state empty-results"><MagnifyingGlass size={32} /><h3>{query ? <>没有找到「<strong>{query}</strong>」</> : filteredEmpty ? '当前筛选下没有网站' : '这里还没有网站'}</h3><p>{query || filteredEmpty ? '试试名称、简介、备注、标签或地址；也可以清空当前分类筛选。' : '先收藏一个网站，再为它补一句用途。'}</p><div className="empty-actions"><button type="button" className="secondary-button" onClick={query || filteredEmpty ? onClear : onAdd}>{query || filteredEmpty ? '清空搜索与筛选' : <><Plus size={17} />收藏网站</>}</button>{!query && !filteredEmpty && <button type="button" className="text-button" onClick={onGuide}><PuzzlePiece size={17} />安装扩展，浏览时一键收藏</button>}</div></div>}
    </section>
    {recentShown.length > 0 && <section className="recent-section"><div className="section-heading"><h2>最近打开</h2><span>从工作台访问</span></div><div className="recent-grid">{recentShown.map(site => <button type="button" className="recent-item" key={site.id} onClick={() => onOpen(site)}><SiteIcon site={site} small /><span className="recent-copy"><strong>{site.name}</strong><small>{site.notes || site.description || site.purpose || '已收藏'}</small></span><CaretRight size={16} /></button>)}</div></section>}
  </>;
}
