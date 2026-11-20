import { useEffect, useState } from 'react';
import { Copy, DownloadSimple, Link, Trash } from '@phosphor-icons/react';
import { api } from '../api.js';

const formatBytes = value => value ? `${(value / 1024).toFixed(1)} KiB` : '未知';
const downloadPath = '/downloads/website-workspace-extension.zip';

export function DevicesSettings({ notify, presence }) {
  const [devices, setDevices] = useState([]);
  const [release, setRelease] = useState(null);
  const [pairing, setPairing] = useState(null);
  const [error, setError] = useState('');
  const [releaseError, setReleaseError] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revoke, setRevoke] = useState(null);
  const [steps, setSteps] = useState(true);
  const [notes, setNotes] = useState(false);
  const [now, setNow] = useState(Date.now());
  const isEdge = navigator.userAgent.includes('Edg/');
  const managementUrl = isEdge ? 'edge://extensions' : 'chrome://extensions';
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!pairing) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pairing]);
  async function load() {
    setError(''); setReleaseError('');
    await Promise.allSettled([
      api.request('/api/extension/devices').then(data => setDevices(data.devices)).catch(failure => setError(failure.message)),
      api.request('/api/extension/release').then(setRelease).catch(failure => setReleaseError(failure.message)),
    ]);
  }
  async function downloadExtension() {
    setDownloading(true); setDownloadError('');
    try {
      const response = await fetch(downloadPath, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}），请稍后重试。`);
      const blob = await response.blob();
      if (blob.type !== 'application/zip' || !blob.size) throw new Error('站点没有返回有效的 ZIP 安装包，请稍后重试。');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = response.headers.get('Content-Disposition')?.match(/website-workspace-extension-\d+\.\d+\.\d+\.zip/)?.[0] || 'website-workspace-extension.zip';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      notify('安装包已交给浏览器下载。下载后请解压并加载扩展。');
    } catch (failure) { setDownloadError(failure.message || '下载失败，请重试。'); }
    finally { setDownloading(false); }
  }
  async function createCode() {
    setBusy(true); setError('');
    try { setPairing(await api.request('/api/extension/pairing-code', { method: 'POST', body: {} })); setNow(Date.now()); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function copy(value, label) {
    try { await navigator.clipboard.writeText(value); notify(`已复制${label}`); }
    catch { setError(`浏览器未允许复制，请手动选择${label}`); }
  }
  async function removeDevice(id) {
    setError(''); setBusy(true);
    try { await api.request(`/api/extension/devices/${id}`, { method: 'DELETE' }); setRevoke(null); await load(); notify('设备凭证已撤销，其未同步任务已暂停'); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  const remaining = pairing ? Math.max(0, Math.ceil((Date.parse(pairing.expiresAt) - now) / 1000)) : 0;
  return <div className="extension-center">
    <section className="extension-hero"><h3>选分类、写备注，其他交给软件</h3><p>新版扩展自动准备名称、简介、网站图标和当前页预览；素材失败不阻塞文字收藏。普通收藏直接入库并出现在首页。</p></section>
    <section className="detail-section release-card"><div className="section-heading"><div><h3>扩展安装包</h3><p className="muted">{release ? `版本 ${release.version} · ${new Date(release.releasedAt).toLocaleDateString('zh-CN')} · ${formatBytes(release.sizeBytes)}` : releaseError ? '暂时无法读取发行清单' : '正在读取发行清单…'}</p></div><button type="button" className="primary-button" disabled={downloading} onClick={downloadExtension}><DownloadSimple size={18} />{downloading ? '正在获取安装包…' : '下载扩展 ZIP'}</button></div>
      <p className="muted small-text" role="status">{presence?.status === 'installed' ? `已检测到当前浏览器的扩展 ${presence.version}。是否配对请在扩展弹窗查看。` : presence?.status === 'not-detected' ? '当前浏览器未检测到扩展；如果已安装，请重新加载扩展并刷新此页。' : presence?.status === 'checking' ? '正在检测当前浏览器…' : '当前浏览器或站点无法自动检测，可按下方步骤安装。'}</p>
      {presence && presence.status !== 'unavailable' && <button type="button" className="text-button" onClick={presence.recheck}>重新检测扩展</button>}
      {downloadError && <p className="form-error" role="alert">{downloadError} <a href={downloadPath}>打开直接下载链接</a></p>}
      <div className="release-facts"><span>支持：桌面 Chrome、Edge</span><span>最低浏览器：{release?.minBrowserVersion || '未知'}</span><span>协议：{release ? `${release.protocolRange.min}–${release.protocolRange.max}` : '未知'}</span><span>API：{release ? '兼容' : '待检查'}</span></div>
      <p className="muted small-text">其他 Chromium 浏览器可能兼容，尚未验收；Firefox / Safari 不在本期支持范围。ZIP 不含服务器配置、账号或令牌。</p>
      {release && <div className="hash-row"><code>SHA-256: {release.sha256}</code><button className="icon-button" aria-label="复制扩展包 SHA-256" onClick={() => copy(release.sha256, 'SHA-256')}><Copy size={18} /></button></div>}
      {releaseError && <p className="form-error" role="alert">发行清单读取失败，仍可直接下载安装包。 <button type="button" className="text-button" onClick={load}>重试发行信息</button></p>}
      <div className="settings-actions"><button className="text-button" onClick={() => setSteps(!steps)}>{steps ? '收起安装步骤' : '安装步骤'}</button><button className="text-button" disabled={!release} onClick={() => setNotes(!notes)}>查看本版变更</button></div>
      {notes && release && <p className="release-notes">{release.releaseNotes}</p>}
    </section>
    {steps && <section className="detail-section"><h3>手动安装与更新</h3><ol className="extension-setup-steps"><li>下载并解压到固定目录；下载目录不是安装目录，加载后请勿删除该目录。</li><li><span>复制 <code>{managementUrl}</code> <button className="text-button" onClick={() => copy(managementUrl, '扩展管理页地址')}>复制地址</button>，再手动粘贴到浏览器打开。</span></li><li>启用开发者模式，选择「加载已解压的扩展程序」，选中刚才的目录。</li><li>在工具栏固定「网站工作台」，打开扩展并进入设置。</li><li>在下方生成配对码，将服务器地址和配对码填入扩展完成连接。</li></ol><p className="muted small-text">更新时先等待或保留队列，备份旧目录后解压覆盖，在原扩展条目点击「重新加载」。不要先卸载；扩展 ID 变化会视作新安装。网页不能替你启用开发者模式或确认权限。</p></section>}
    <section className="detail-section"><h3>配对当前账号</h3><label className="field">服务器完整地址<div className="copy-field"><input readOnly value={location.origin} /><button className="icon-button" aria-label="复制服务器地址" onClick={() => copy(location.origin, '服务器地址')}><Copy size={18} /></button></div></label><button className="primary-button" disabled={busy} onClick={createCode}><Link size={18} />{busy ? '正在生成…' : '生成新配对码'}</button>
      {pairing && <div className="pairing-code"><span>一次性配对码 · {remaining > 0 ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} 后过期` : '已过期'}</span><strong>{pairing.code}</strong><button className="icon-button" aria-label="复制配对码" onClick={() => copy(pairing.code, '配对码')}><Copy size={19} /></button><small>有效至 {new Date(pairing.expiresAt).toLocaleString('zh-CN')}。刷新页面不会复显已生成密钥。</small></div>}
    </section>
    {error && <p className="form-error" role="alert">{error}</p>}
    <section className="detail-section"><div className="section-heading"><h3>已连接设备</h3><button className="text-button" onClick={load}>刷新列表</button></div>{!devices.length && <p className="muted">还没有连接的扩展设备；仅下载或配对码本身不表示已连接。</p>}<div className="device-list">{devices.map(device => <div className="device-item" key={device.id}><div><strong>{device.name}</strong><p>版本 {device.extensionVersion || '未知'} · 协议 {device.protocolVersion || 1} · 有效至 {new Date(device.expiresAt).toLocaleDateString('zh-CN')}</p><small>最近活动：{device.lastActiveAt ? new Date(device.lastActiveAt).toLocaleString('zh-CN') : '暂无记录'}</small></div>{revoke === device.id ? <div className="revoke-confirm"><p>撤销会暂停此设备的未同步任务，不会删除本地队列。确定撤销？</p><button className="text-button" onClick={() => setRevoke(null)}>取消</button><button className="danger-button" disabled={busy} onClick={() => removeDevice(device.id)}>{busy ? '正在撤销…' : '确认撤销'}</button></div> : <button className="icon-button danger-text" aria-label={`撤销${device.name}`} onClick={() => setRevoke(device.id)}><Trash size={18} /></button>}</div>)}</div></section>
    <details className="detail-section extension-help"><summary>故障帮助</summary><ul><li>下载失败：稍后重试并核对 SHA-256；找不到 manifest 时确认选中的是解压后的扩展目录。</li><li>企业策略可能禁止开发者模式，请联系设备管理员；不要绕过组织策略。</li><li>配对过期请生成新码；连错服务器时先核对上方完整 origin。</li><li>更新后由浏览器确认新增权限。卸载扩展会删除本地文字和图片队列。</li></ul></details>
  </div>;
}
