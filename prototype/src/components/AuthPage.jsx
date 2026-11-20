import { useState } from 'react';
import { ArrowRight, LockKey } from '@phosphor-icons/react';
import { api } from '../api.js';

function inviteToken(value) {
  const trimmed = value.trim();
  if (/^[\w-]{1,200}$/.test(trimmed)) return trimmed;
  try {
    const link = new URL(trimmed, location.origin);
    if (link.origin !== location.origin) return '';
    return link.searchParams.get('invite') || link.searchParams.get('token') || '';
  } catch { return ''; }
}

export function AuthPage({ session, register, invite, recovery, onAuthenticated, onRetry }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [inviteInput, setInviteInput] = useState('');
  const isSetup = session.setupRequired;
  const joining = !recovery && !isSetup && (register || Boolean(invite));
  const creating = isSetup || joining || Boolean(recovery);
  const title = recovery ? '设置新的登录密码' : isSetup ? '创建你的私人网站空间' : joining ? '注册网站工作台' : '欢迎回到你的工作台';
  async function submit(event) {
    event.preventDefault(); setError('');
    if (creating && password !== confirmation) { setError('两次输入的密码不一致'); return; }
    const token = joining ? (invite || inviteToken(inviteInput)) : '';
    if (joining && !token) { setError('请填写管理员提供的邀请码，或粘贴本站邀请链接。'); return; }
    setBusy(true);
    try {
      const endpoint = recovery ? 'recover' : isSetup ? 'setup' : joining ? 'register' : 'login';
      const body = recovery ? { token: recovery, password } : { email, password, ...(creating ? { name } : {}), ...(isSetup ? { setupToken } : {}), ...(joining ? { token } : {}) };
      const response = await api.request(`/api/auth/${endpoint}`, { method: 'POST', body });
      setPassword(''); setConfirmation('');
      if (recovery && !response.user) { location.assign('/'); return; }
      onAuthenticated(response.user);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <main className="auth-page"><div className="auth-brand"><img className="brand-mark" src="/assets/workspace-mark.svg" alt="" />网站工作台</div>
    <section className="auth-layout"><div className="auth-introduction"><span className="eyebrow">YOUR PERSONAL WEB WORKSPACE</span><h1>把网站留下，<br />也把用途记住。</h1><p>云端服务、本地项目、常用工具，<br />都收进你自己的空间。</p><div className="auth-benefits"><span>按用途找回</span><span>私有网站库</span><span>浏览器快速收藏</span></div><a className="text-button" href="/?demo=1">先看看交互演示 <ArrowRight size={17} /></a></div>
      <form className="auth-form" onSubmit={submit}><div className="auth-form-icon"><LockKey size={25} /></div><h2>{title}</h2><p>{recovery ? '恢复链接只能使用一次，修改后旧会话和设备凭证会失效。' : isSetup ? '首次使用，先创建管理员账号。其他用户可通过邀请加入。' : joining ? '通过管理员的邀请创建账号。每个账号都有独立的网站库。' : '登录后继续整理和访问自己的网站。'}</p>
        {error && <div className="form-error" role="alert">{error}</div>}
        {!recovery && <>{creating && <label className="field">显示名称<input value={name} onChange={e => setName(e.target.value)} maxLength={60} autoComplete="name" required /></label>}<label className="field">邮箱<input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required maxLength={254} /></label></>}
        {isSetup && session.setupTokenRequired && <label className="field">服务器初始化码<input value={setupToken} onChange={e => setSetupToken(e.target.value)} autoComplete="off" required /><small>由服务器维护者在部署时生成。</small></label>}
        {joining && !invite && <label className="field">邀请码或邀请链接<input value={inviteInput} onChange={e => setInviteInput(e.target.value)} autoComplete="off" required maxLength={500} /><small>没有邀请？请联系管理员。在工作台「设置 → 用户管理」生成邀请。</small></label>}
        <label className="field">{recovery ? '新密码' : '登录密码'}<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={creating ? 'new-password' : 'current-password'} minLength={creating ? 12 : undefined} maxLength={128} required />{creating && <small>至少 12 位，大写、小写、数字、符号至少包含三类。</small>}</label>
        {creating && <label className="field">确认密码<input type="password" value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="new-password" maxLength={128} required /></label>}
        <button className="primary-button full-width" disabled={busy} type="submit">{busy ? '正在验证…' : recovery ? '更新密码' : isSetup ? '创建并进入工作台' : joining ? '创建我的账号' : '登录工作台'}{!busy && <ArrowRight size={18} />}</button>
        {!creating && <div className="auth-switch"><span>还没有账号？</span><a className="text-button" href="/?register=1">注册账号</a></div>}
        {joining && <div className="auth-switch"><span>已有账号？</span><a className="text-button" href="/">返回登录</a></div>}
        <p className="auth-footnote">网站的账号说明与你的登录账号分开管理。第三方网站密码继续由独立密码管理器保存。</p>
        {!creating && <p className="auth-help">无法登录？请联系管理员生成一次性恢复链接。</p>}
        <button className="text-button auth-retry" type="button" onClick={onRetry}>重新检查服务状态</button>
      </form>
    </section><footer className="auth-page-footer">你的收藏，你的空间。</footer>
  </main>;
}
