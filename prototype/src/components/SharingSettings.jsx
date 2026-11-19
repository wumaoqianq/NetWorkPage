import { useEffect, useState } from 'react';
import { Copy, ShareNetwork } from '@phosphor-icons/react';
import { api } from '../api.js';

export function SharingSettings({ workspace }) {
  const [shares, setShares] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [target, setTarget] = useState('');
  const [days, setDays] = useState(7);
  const [accounts, setAccounts] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [issued, setIssued] = useState(null);
  const [revoke, setRevoke] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    try { const [shared, alerts] = await Promise.all([api.request('/api/enhancements/shares'), api.request('/api/enhancements/notifications')]); setShares(shared.shares); setNotifications(alerts.notifications); }
    catch (failure) { setError(failure.message); }
  }
  useEffect(() => { load(); }, []);
  async function action(callback) {
    setError(''); setBusy(true);
    try { await callback(); } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  function submit(event) {
    event.preventDefault();
    action(async () => {
      const [kind, id] = target.split(':');
      const response = await api.request('/api/enhancements/shares', { method: 'POST', body: { [kind === 'collection' ? 'collectionId' : 'siteId']: id, expiresInDays: Number(days), includeAccounts: accounts, confirmAccounts: confirmed } });
      setIssued(response); await load();
    });
  }
  return <>{error && <p className="form-error" role="alert">{error}</p>}<section className="detail-section"><h3>站内通知</h3><p className="muted small-text">提醒与巡检由服务器定时任务处理，不会自动向外发送邮件。</p>{!notifications.length && <p className="muted small-text">暂时没有通知。</p>}{notifications.map(item => <div className={`notification ${item.read ? 'is-read' : ''}`} key={item.id}><div><strong>{item.description}</strong><small>{new Date(item.createdAt).toLocaleString('zh-CN')}</small></div>{!item.read && <button className="text-button" onClick={() => action(async () => { await api.request(`/api/enhancements/notifications/${item.id}`, { method: 'PATCH', body: { read: true } }); await load(); })}>标为已读</button>}</div>)}</section>
    <section className="detail-section"><h3>明确选择要分享的内容</h3><p className="muted small-text">默认只分享名称、用途、标签和访问入口。个人备注不会分享；账号说明需要另行确认。分享链接有有效期，随时可以撤销。</p><form onSubmit={submit}><label className="field">分享对象<select required value={target} onChange={e => setTarget(e.target.value)}><option value="">请选择网站或工作集</option><optgroup label="网站">{workspace.sites.filter(site => !site.deleted && !site.archived).map(site => <option key={site.id} value={`site:${site.id}`}>{site.name}</option>)}</optgroup><optgroup label="工作集">{workspace.collections.map(group => <option key={group.id} value={`collection:${group.id}`}>{group.name}</option>)}</optgroup></select></label><label className="field">有效天数<input type="number" min="1" max="30" required value={days} onChange={e => setDays(e.target.value)} /></label><label className="checkbox-line"><input type="checkbox" checked={accounts} onChange={e => { setAccounts(e.target.checked); setConfirmed(false); }} />同时包含账号说明（用户名、登录方式与登录备注）</label>{accounts && <div className="sensitive-confirm"><p>持有链接的人将可以读取这些账号资料。请确认接收者与内容均合适。</p><label className="checkbox-line"><input type="checkbox" required checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />我确认分享所选对象的账号说明</label></div>}<div className="settings-actions"><button className="primary-button" disabled={busy || (accounts && !confirmed)} type="submit"><ShareNetwork size={18} />生成限时分享链接</button></div></form></section>
    {issued && <div className="issued-link"><strong>分享链接已生成</strong><code>{issued.url}</code><button className="secondary-button" onClick={() => navigator.clipboard.writeText(issued.url).then(() => workspace.setToast('已复制分享链接')).catch(() => setError('复制受限，请手工复制'))}><Copy size={17} />复制链接</button></div>}
    <section className="detail-section"><h3>已创建的分享</h3>{!shares.length && <p className="muted small-text">还没有分享。</p>}{shares.map(item => <div className="device-item" key={item.id}><div><strong>{item.title}</strong><p>{item.revokedAt ? '已撤销' : `有效至 ${new Date(item.expiresAt).toLocaleString('zh-CN')}`}{item.includeAccounts ? ' · 含账号说明' : ''}</p></div>{!item.revokedAt && (revoke === item.id ? <><button className="text-button" onClick={() => setRevoke(null)}>取消</button><button disabled={busy} className="danger-button" onClick={() => action(async () => { await api.request(`/api/enhancements/shares/${item.id}`, { method: 'DELETE' }); setRevoke(null); await load(); })}>确认撤销</button></> : <button className="text-button" onClick={() => setRevoke(item.id)}>撤销分享</button>)}</div>)}</section>
  </>;
}
