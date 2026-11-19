import { useEffect, useState } from 'react';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { api } from '../api.js';
import { isSafeUrl } from '../model.js';
import { SiteIcon } from './SiteIcon.jsx';

export function PublicShare({ token }) {
  const [share, setShare] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.request(`/api/enhancements/public/shares/${encodeURIComponent(token)}`).then(setShare).catch(failure => setError(failure.message)); }, [token]);
  return <main className="public-share"><header><a href="/" className="auth-brand"><img className="brand-mark" src="/assets/workspace-mark.svg" alt="" />网站工作台</a><span>限时分享</span></header>{error ? <section className="empty-state"><h1>分享暂时无法访问</h1><p>{error}</p><a className="text-button" href="/">返回工作台</a></section> : !share ? <p className="workspace-loading">正在读取分享…</p> : <><div className="share-heading"><h1>{share.title}</h1><p>这是持有链接可查看的资料快照，有效至 {new Date(share.expiresAt).toLocaleString('zh-CN')}。</p></div><div className="public-share-grid">{share.sites.map((site, index) => <article className="shared-site" key={site.id || index}><div className="detail-brand"><SiteIcon site={site} /><div><h2>{site.name}</h2><p>{site.purpose}</p></div></div><div className="tags">{(site.tags || []).map(tag => <span key={tag}>{tag}</span>)}</div><div className="shared-endpoints">{(site.endpoints || []).filter(entry => isSafeUrl(entry.url)).map((entry, i) => <a key={entry.id || i} href={entry.url} target="_blank" rel="noopener noreferrer"><span>{entry.label || '访问入口'}<small>{entry.scope} · {entry.url}</small></span><ArrowSquareOut size={20} /></a>)}</div>{site.accounts?.length > 0 && <div className="shared-accounts"><strong>发布者明确分享的账号说明</strong>{site.accounts.map((account, i) => <p key={i}>{account.label} · {account.username} · {account.method}<small>{account.notes}</small></p>)}</div>}</article>)}</div><p className="small-text muted">本机和局域网地址仅在对应设备或网络中可用。分享页不包含任何第三方网站密码。</p></>}</main>;
}
