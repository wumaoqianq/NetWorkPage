import { useCallback, useEffect, useState } from 'react';
import { ArrowCounterClockwise } from '@phosphor-icons/react';
import { App } from './App.jsx';
import { api } from './api.js';
import { AuthPage } from './components/AuthPage.jsx';
import { PublicShare } from './components/PublicShare.jsx';
import './auth.css';

const demo = new URLSearchParams(location.search).get('demo') === '1';
export function Root() {
  const parameters = new URLSearchParams(location.search);
  const share = parameters.get('share');
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      const response = await api.request('/api/auth/session');
      api.setCsrfToken(response.csrfToken); setSession(response);
    } catch (failure) { setError(failure.message); }
  }, []);
  useEffect(() => {
    if (demo || share) return;
    load();
    const expired = () => { setSession(current => current ? { ...current, user: null } : null); load(); };
    window.addEventListener('workspace:auth-expired', expired);
    return () => window.removeEventListener('workspace:auth-expired', expired);
  }, [load, share]);
  function authenticated(user) {
    if (!user) { load(); return; }
    const kept = new URLSearchParams();
    for (const key of ['site', 'settings']) if (parameters.get(key)) kept.set(key, parameters.get(key));
    history.replaceState({}, '', `${location.pathname}${kept.size ? `?${kept}` : ''}`);
    setSession(current => ({ ...current, setupRequired: false, user }));
  }
  if (share) return <PublicShare token={share} />;
  if (demo) return <App demo user={{ name: '林知夏', email: 'demo@example.com', isAdmin: false }} />;
  if (error || !session) return <main className="connection-state"><img className="brand-mark" src="/assets/workspace-mark.svg" alt="" /><h1>{error ? '暂时无法连接工作台' : '正在打开你的工作台'}</h1><p>{error || '正在检查会话和服务状态…'}</p>{error && <><button className="primary-button" onClick={load}><ArrowCounterClockwise size={18} />重新连接</button><a className="text-button" href="/?demo=1">查看独立演示</a></>}</main>;
  if (!session.user) return <AuthPage session={session} register={parameters.get('register') === '1'} invite={parameters.get('invite') || parameters.get('token')} recovery={parameters.get('recover')} onAuthenticated={authenticated} onRetry={load} />;
  return <App key={session.user.id} user={session.user} onLogout={async () => { await api.request('/api/auth/logout', { method: 'POST', body: {} }); await load(); }} />;
}
