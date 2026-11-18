import { useEffect, useState } from 'react';
import { Copy, EnvelopeSimple } from '@phosphor-icons/react';
import { api } from '../api.js';

export function AdminSettings({ user, notify }) {
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState('');
  const [issued, setIssued] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(null);
  async function load() { try { setUsers((await api.request('/api/auth/users')).users); } catch (failure) { setError(failure.message); } }
  useEffect(() => { load(); }, []);
  async function action(callback) {
    setBusy(true); setError('');
    try { await callback(); } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <>{error && <p role="alert" className="form-error">{error}</p>}<section className="detail-section"><h3>邀请新用户</h3><p className="muted small-text">邀请只允许创建新账号，不会共享你的收藏和账号说明。绑定邮箱可减少链接被他人误用。</p><form className="inline-form" onSubmit={event => { event.preventDefault(); action(async () => { setIssued({ ...(await api.request('/api/auth/invites', { method: 'POST', body: { email } })), type: 'invite' }); }); }}><input type="email" value={email} onChange={e => setEmail(e.target.value)} aria-label="邀请邮箱" placeholder="绑定邮箱（可选）" maxLength={254} /><button className="primary-button" disabled={busy} type="submit"><EnvelopeSimple size={17} />生成邀请</button></form></section>
    {issued && <div className="issued-link"><strong>{issued.type === 'invite' ? '一次性邀请链接' : '一次性账号恢复链接'}</strong><p className="small-text muted">有效至 {new Date(issued.expiresAt).toLocaleString('zh-CN')}。请通过可信渠道交给对应用户。</p><code>{issued.url}</code><button className="secondary-button" onClick={() => navigator.clipboard.writeText(issued.url).then(() => notify('已复制一次性链接')).catch(() => setError('复制受限，请手工复制链接'))}><Copy size={17} />复制链接</button></div>}
    <section className="detail-section"><div className="section-heading"><h3>账号管理</h3><button className="text-button" onClick={load}>刷新</button></div><p className="muted small-text">仅管理账号状态，不提供查看其他人私人网站库的入口。</p><div className="device-list">{users.map(item => <div className="admin-user" key={item.id}><div><strong>{item.name}</strong><p>{item.email}</p><small>{item.isAdmin ? '管理员' : '普通用户'} · {item.isActive ? '正常' : '已停用'}</small></div>{item.id !== user.id && <div className="admin-actions"><button className="text-button" disabled={busy} onClick={() => action(async () => setIssued({ ...(await api.request(`/api/auth/users/${item.id}/recovery`, { method: 'POST', body: {} })), type: 'recovery' }))}>生成恢复链接</button>{confirming === item.id ? <><button className="text-button" onClick={() => setConfirming(null)}>取消</button><button className={item.isActive ? 'danger-button' : 'secondary-button'} disabled={busy} onClick={() => action(async () => { await api.request(`/api/auth/users/${item.id}`, { method: 'PATCH', body: { isActive: !item.isActive } }); setConfirming(null); await load(); })}>确认{item.isActive ? '停用' : '启用'}</button></> : <button className="text-button" disabled={busy} onClick={() => setConfirming(item.id)}>{item.isActive ? '停用账号' : '重新启用'}</button>}</div>}</div>)}</div></section>
  </>;
}
