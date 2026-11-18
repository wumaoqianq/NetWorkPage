import { useRef, useState } from 'react';
import { ArrowClockwise, ArrowSquareOut, Check, Copy, Eye, EyeSlash, GlobeHemisphereWest, Info, Laptop, LockKey, PencilSimple, PushPin, UploadSimple } from '@phosphor-icons/react';
import { Dialog } from './Dialog.jsx';
import { SiteIcon } from './SiteIcon.jsx';
import { SiteOperations } from './SiteOperations.jsx';
import { ScreenshotViewer } from './ScreenshotViewer.jsx';
import { canRefreshSiteIcon, getDefaultEndpoint, getIcon, iconJobState } from '../model.js';

function Account({ account, notify, site, onOpen }) {
  const [shown, setShown] = useState(false);
  return <div className="account-note"><div className="account-heading"><strong>{account.label || '常用账号'}</strong><span className="tag">{account.method || '邮箱密码'}</span></div>
    {account.username && <div className="account-username"><code>{shown ? account.username : account.username.slice(0, 2) + '••••••'}</code><button className="icon-button" aria-label={shown ? '隐藏账号' : '显示账号'} onClick={() => setShown(!shown)}>{shown ? <EyeSlash size={18} /> : <Eye size={18} />}</button><button className="icon-button" aria-label="复制账号" onClick={() => navigator.clipboard.writeText(account.username).then(() => notify('已复制账号')).catch(() => notify('浏览器未允许复制，请展开账号后手动复制'))}><Copy size={17} /></button></div>}
    {account.endpointId && <p>关联入口：{site.endpoints.find(entry => entry.id === account.endpointId)?.label || '网站通用'}</p>}
    {account.notes && <p>{account.notes}</p>}
    {account.loginUrl && <button className="text-button" onClick={() => { const entry = site.endpoints.find(item => item.id === account.endpointId) || getDefaultEndpoint(site); onOpen(site, { ...entry, label: '账号登录页', url: account.loginUrl }); }}><ArrowSquareOut size={16} />打开登录页</button>}
  </div>;
}

export function SiteDetail({ site, demo = false, onClose, onEdit, onOpen, onPatch, notify, onRefresh, onRefreshIcon, onRefetchIcon, onUploadIcon }) {
  const [tab, setTab] = useState('details');
  const [iconBusy, setIconBusy] = useState(false);
  const fileInput = useRef(null);
  const icon = getIcon(site);
  const iconJob = iconJobState(site);
  const defaultEntry = getDefaultEndpoint(site);
  const source = { manual: '手动', page_meta: '页面描述', server_meta: '服务器元信息', none: '无' }[site.descriptionSource || 'none'];
  return <Dialog title="网站详情" onClose={onClose} drawer>
    <div className="drawer-content"><ScreenshotViewer site={site} inline onRefreshMetadata={onRefresh} /><div className="detail-brand"><SiteIcon site={site} /><div><h3>{site.name}</h3><p>{new URL(defaultEntry.url).host}</p></div><button className={`icon-button pin-toggle ${site.pinned ? 'selected' : ''}`} aria-label={site.pinned ? '取消置顶' : '置顶网站'} onClick={() => onPatch(site.id, { pinned: !site.pinned })}><PushPin size={21} weight={site.pinned ? 'fill' : 'regular'} /></button></div>
      <div className="detail-tabs"><button className={tab === 'details' ? 'selected' : ''} onClick={() => setTab('details')}>网站资料</button><button className={tab === 'accounts' ? 'selected' : ''} onClick={() => setTab('accounts')}>账号说明 <span>{site.accounts?.length || 0}</span></button>{!demo && <button className={tab === 'operations' ? 'selected' : ''} onClick={() => setTab('operations')}>状态与提醒</button>}</div>
      {tab === 'details' ? <>
        <section className="detail-section"><div className="section-heading"><h4>简介</h4><button className="text-button" onClick={() => onEdit(site)}>编辑</button></div><p>{site.description || '暂无简介。简介描述网站是什么，不会自动复制“我的用途”。'}</p><small className="muted">来源：{source}{site.descriptionUpdatedAt ? ` · 更新于 ${new Date(site.descriptionUpdatedAt).toLocaleString('zh-CN')}` : ''}</small></section>
        <section className="detail-section"><h4>我的用途</h4><p>{site.purpose || '还没有用途说明，编辑资料补充一下。'}</p></section>
        <section className="detail-section"><h4>我的备注</h4><p className="preserve-lines">{site.notes || '还没有备注。把使用经验留在这里，下次更容易想起来。'}</p></section>
        <section className="detail-section"><h4>分类与标签</h4><div className="tags">{site.category && <span>{site.category}</span>}{site.tags.map(tag => <span key={tag}>{tag}</span>)}</div></section>
        <section className="detail-section"><div className="section-heading"><h4>网站图标</h4>{iconJob.fetching && <small className="muted" role="status">图标获取中</small>}{icon.present && <small className="muted">私有同源读取</small>}</div><div className="icon-maintenance"><SiteIcon site={site} small /><div><p>{icon.present ? '当前使用已保存的网站图标；更新图标不会改动截图、备注和分类。' : iconJob.fetching ? '缺图，工作台正在后台从该网站公开图标补齐，稍后自动完成，不影响这次收藏。' : canRefreshSiteIcon(site) ? '尚未获取图标。可以尝试重新获取；失败会保留字母回退，不影响文字资料。' : '这是本机或局域网入口，服务端无法代为访问。请打开该网站，用浏览器扩展更新图标，或在下方上传本地 PNG/WebP 图标。'}</p>{onRefreshIcon && canRefreshSiteIcon(site) && <button type="button" className="secondary-button" disabled={iconBusy} onClick={async () => { setIconBusy(true); try { await onRefreshIcon(site); } finally { setIconBusy(false); } }}><ArrowClockwise size={16} />{iconBusy ? '正在获取…' : icon.present ? '重新获取图标' : '更新网站图标'}</button>}</div></div>
          {!demo && !icon.present && <div className="icon-recovery"><details><summary>服务器无法访问该网站？例外恢复</summary><p className="muted small-text">普通收藏不需要手工补图。仅当服务器公网抓取失败（如本机 DNS 受阻）时：重新排队让工作台稍后重试，或上传一张本地 PNG/WebP 图标。不会改动截图、备注和分类。</p><div className="icon-recovery-actions">
            {onRefetchIcon && <button type="button" className="secondary-button" onClick={() => onRefetchIcon(site)}><ArrowClockwise size={15} />重新排队补图</button>}
            {onUploadIcon && <><input ref={fileInput} type="file" accept="image/png,image/webp" hidden onChange={async event => { const file = event.target.files?.[0]; if (file) await onUploadIcon(site, file); event.target.value = ''; }} /><button type="button" className="secondary-button" onClick={() => fileInput.current?.click()}><UploadSimple size={15} />上传本地 PNG/WebP 图标</button></>}
          </div></details></div>}
        </section>
        <section className="detail-section"><div className="section-heading"><h4>访问入口</h4><span>{site.endpoints.length} 个入口</span></div><p className="privacy-hint">完整地址可能包含 query 或 hash 秘密，复制和分享前请检查。</p><div className="endpoint-list">{site.endpoints.map((entry, index) => <div className="endpoint" key={entry.id || index}><span className="endpoint-icon">{entry.scope === '本机' ? <Laptop size={22} /> : <GlobeHemisphereWest size={22} />}</span><div><strong>{entry.label}{entry.id === defaultEntry.id && <span className="default-tag">默认</span>}</strong><p>{entry.url}</p><small>{entry.scope}{entry.scope === '本机' ? ' · 仅运行服务的当前设备可用' : entry.scope === '局域网' ? ' · 需连接对应网络' : ''}</small></div><button className="icon-button" aria-label={`复制${entry.label}完整地址`} onClick={() => navigator.clipboard.writeText(entry.url).then(() => notify('已复制完整地址')).catch(() => notify('复制失败，请展开地址后手动选择复制'))}><Copy size={18} /></button><button className="icon-button green-text" aria-label={`打开${entry.label}`} onClick={() => onOpen(site, entry)}><ArrowSquareOut size={22} /></button></div>)}</div></section>
        {site.inbox && <button className="secondary-button full-width" onClick={() => { onPatch(site.id, { inbox: false }, '已完成整理，仍可在全部网站中找到'); }}><Check size={18} />标记为已整理</button>}
      </> : tab === 'accounts' ? <><div className="info-banner"><LockKey size={20} /><p>在这里确认账号和登录方式。打开网站后，由你的独立密码管理器填充密码。</p></div>{site.accounts?.length ? site.accounts.map((a, i) => <Account key={i} account={a} notify={notify} site={site} onOpen={onOpen} />) : <div className="empty-account"><Info size={28} /><p>还没有账号说明</p><button className="text-button" onClick={() => onEdit(site)}>添加账号说明</button></div>}<p className="muted small-text">{demo ? '当前展示为演示资料。' : '账号说明默认仅你可见。'}请勿在此填写密码或恢复码。</p></> : <SiteOperations site={site} notify={notify} onRefresh={onRefresh} />}
    </div>
    <footer className="drawer-footer"><button className="secondary-button" onClick={() => onEdit(site)}><PencilSimple size={18} />编辑资料</button><button className="primary-button" onClick={() => onOpen(site, defaultEntry)}><ArrowSquareOut size={19} />{site.endpoints.length > 1 ? '打开默认入口' : '打开网站'}</button></footer>
  </Dialog>;
}
