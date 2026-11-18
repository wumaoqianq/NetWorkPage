import { useEffect, useState } from 'react';
import { Archive, Clock, GlobeHemisphereWest } from '@phosphor-icons/react';
import { api } from '../api.js';

export function SiteOperations({ site, notify, onRefresh }) {
  const [metadata, setMetadata] = useState(null);
  const [archives, setArchives] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [monitor, setMonitor] = useState({ enabled: false, intervalHours: 24 });
  const [endpointId, setEndpointId] = useState(site.defaultEndpointId || site.endpoints[0].id);
  const [dueAt, setDueAt] = useState('');
  const [advance, setAdvance] = useState(7);
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const base = `/api/enhancements/sites/${site.id}`;
  const selectedEndpoint = site.endpoints.find(entry => entry.id === endpointId);
  async function load() {
    try {
      const [meta, archiveData, monitorData, reminderData] = await Promise.all([api.request(`${base}/metadata`), api.request(`${base}/archives`), api.request(`${base}/monitor`), api.request('/api/enhancements/reminders')]);
      setMetadata(meta.metadata); setArchives(archiveData.archives); setMonitor(monitorData);
      setReminders(reminderData.reminders.filter(item => item.siteId === site.id));
    } catch (failure) { setError(failure.message); }
  }
  useEffect(() => { load(); }, [site.id]);
  async function action(callback) {
    setBusy(true); setError('');
    try { await callback(); } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function check(archive) {
    const result = await api.request(`${base}/metadata`, { method: 'POST', body: { endpointId, archive } });
    setMetadata(result.metadata);
    if (archive) setArchives((await api.request(`${base}/archives`)).archives);
    notify(archive ? '已请求检查和安全文本存档' : '已请求服务器检查入口');
  }
  return <div className="site-operations">{error && <p className="form-error" role="alert">{error}</p>}
    <section className="detail-section"><h4>服务器视角的公开入口检查</h4><p className="small-text muted">只检查公网 HTTP/HTTPS 入口。本机与局域网不能由云端直接检测；检查失败也不代表你的浏览器无法访问。</p><label className="field">选择入口<select value={endpointId} onChange={e => setEndpointId(e.target.value)}>{site.endpoints.map(entry => <option key={entry.id} value={entry.id}>{entry.label} · {entry.scope}</option>)}</select></label><div className="settings-actions"><button className="secondary-button" disabled={busy || selectedEndpoint?.scope !== '公网'} onClick={() => action(() => check(false))}><GlobeHemisphereWest size={17} />{busy ? '正在处理…' : '检查并获取简介'}</button><button className="secondary-button" disabled={busy || selectedEndpoint?.scope !== '公网'} onClick={() => action(() => check(true))}><Archive size={17} />保存文本快照</button></div>
      {metadata && <div className={`metadata-result state-${metadata.status}`}><strong>{({ available: '服务器访问成功', http_error: '服务器收到 HTTP 错误', unsupported: '此入口不支持云端检查', error: '服务器检查未完成' })[metadata.status] || '已检查'}</strong><p>{metadata.title || metadata.error || metadata.description}</p><small>检查来源：服务器 · {new Date(metadata.checkedAt).toLocaleString('zh-CN')}{metadata.httpStatus ? ` · HTTP ${metadata.httpStatus}` : ''}</small>{metadata.description && <><p>{metadata.description}</p><button className="text-button" disabled={busy} onClick={() => action(async () => { await api.request(`${base}/metadata`, { method: 'PATCH', body: { version: site.version, adoptDescription: true } }); await onRefresh(); notify('已采用预览中的服务器简介'); })}>使用此简介</button></>}</div>}
    </section>
    <section className="detail-section"><h4>定时监控</h4><p className="muted small-text">默认关闭。开启后由服务器限量串行巡检，结果只用于本账号。</p><div className="monitor-controls"><label className="field">间隔（小时）<input type="number" min="6" max="720" value={monitor.intervalHours} onChange={e => setMonitor({ ...monitor, intervalHours: Number(e.target.value) })} /></label><button disabled={busy || selectedEndpoint?.scope !== '公网'} className="secondary-button" onClick={() => action(async () => { const result = await api.request(`${base}/monitor`, { method: 'PUT', body: { enabled: !monitor.enabled, intervalHours: monitor.intervalHours, endpointId } }); setMonitor(result); notify(result.enabled ? '已开启定时监控' : '已关闭监控'); })}>{monitor.enabled ? '关闭监控' : '开启监控'}</button></div><p className="muted small-text">{monitor.enabled ? `已开启，下次计划：${monitor.nextCheckAt ? new Date(monitor.nextCheckAt).toLocaleString('zh-CN') : '等待后台处理'}` : '当前未开启'}</p></section>
    <section className="detail-section"><h4>续费或使用提醒</h4><form onSubmit={event => { event.preventDefault(); action(async () => { await api.request('/api/enhancements/reminders', { method: 'POST', body: { siteId: site.id, dueAt: new Date(`${dueAt}T12:00:00`).toISOString(), advanceDays: Number(advance), description } }); setDescription(''); await load(); notify('提醒已保存，到期后在站内通知'); }); }}><label className="field">提醒事项<input value={description} maxLength={200} required placeholder="例如：域名续费、检查订阅" onChange={e => setDescription(e.target.value)} /></label><div className="form-columns"><label className="field">到期日期<input type="date" required value={dueAt} onChange={e => setDueAt(e.target.value)} /></label><label className="field">提前天数<input type="number" min="0" max="365" value={advance} onChange={e => setAdvance(e.target.value)} required /></label></div><button className="secondary-button" type="submit" disabled={busy}><Clock size={17} />添加站内提醒</button></form><div className="reminder-list">{reminders.map(item => <div key={item.id}><span>{item.description}<small>{new Date(item.dueAt).toLocaleDateString('zh-CN')} · 提前 {item.advanceDays} 天</small></span><button className="text-button" disabled={busy} onClick={() => action(async () => { await api.request(`/api/enhancements/reminders/${item.id}`, { method: 'DELETE' }); await load(); })}>移除提醒</button></div>)}</div></section>
    <section className="detail-section"><h4>安全文本存档</h4><p className="muted small-text">保存提取后的纯文本，不执行原网页脚本；每站只保留最近少量快照。</p>{!archives.length && <p className="muted small-text">还没有文本快照。</p>}{archives.map(item => <div className="archive-entry" key={item.id}><button onClick={() => setExpanded(expanded === item.id ? null : item.id)}><strong>{item.title || site.name}</strong><small>{new Date(item.checkedAt).toLocaleString('zh-CN')}</small></button>{expanded === item.id && <pre>{item.text}</pre>}</div>)}</section>
  </div>;
}
