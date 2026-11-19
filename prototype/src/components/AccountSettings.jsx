import { useState } from 'react';
import { SignOut } from '@phosphor-icons/react';
import { api } from '../api.js';

export function AccountSettings({ user, onLogout }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function change(event) {
    event.preventDefault(); setError('');
    if (password !== confirmation) { setError('两次输入的新密码不一致'); return; }
    setBusy(true);
    try { await api.request('/api/auth/password', { method: 'POST', body: { currentPassword, password } }); location.assign('/'); }
    catch (failure) { setError(failure.message); setBusy(false); }
  }
  return <><section className="detail-section"><h3>{user.name || '我的账号'}</h3><p>{user.email}</p><p className="small-text muted">{user.isAdmin ? '管理员' : '普通用户'} · 网站资料和其他用户相互独立。</p><button className="secondary-button" disabled={busy} onClick={async () => { setBusy(true); try { await onLogout(); } catch (failure) { setError(failure.message); setBusy(false); } }}><SignOut size={18} />退出登录</button></section>
    <form onSubmit={change} className="detail-section"><h3>修改平台登录密码</h3><p className="small-text muted">修改后所有旧会话和扩展设备凭证失效，需要重新登录和配对。此处修改的是本站密码。</p>{error && <p className="form-error" role="alert">{error}</p>}<label className="field">当前密码<input type="password" autoComplete="current-password" required value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} maxLength={128} /></label><label className="field">新密码<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} /></label><label className="field">确认新密码<input type="password" autoComplete="new-password" required value={confirmation} onChange={e => setConfirmation(e.target.value)} maxLength={128} /></label><p className="muted small-text">至少 12 位，包含大写、小写、数字、符号中的至少三类。</p><button className="primary-button" disabled={busy} type="submit">{busy ? '正在更新…' : '更新并重新登录'}</button></form>
  </>;
}
