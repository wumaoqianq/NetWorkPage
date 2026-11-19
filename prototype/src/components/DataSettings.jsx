import { useRef, useState } from 'react';
import { ArrowClockwise, CheckCircle, DownloadSimple, UploadSimple } from '@phosphor-icons/react';
import { api } from '../api.js';
import { initialSites } from '../data.js';
import { prepareBookmarkFile } from '../bookmark-import.js';
import { BrowserImportPanel } from './BrowserImportPanel.jsx';
import { DirectBrowserImport } from './DirectBrowserImport.jsx';
import { canRefreshSiteIcon, getIcon } from '../model.js';

export function DataSettings({ workspace, onConnectExtension }) {
  const input = useRef(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [repairResult, setRepairResult] = useState(null);
  async function browserFile(file, source, browserName) {
    setError(''); setPreview(null); setBusy(true);
    try {
      const payload = await prepareBookmarkFile(file, source);
      const result = await api.request('/api/imports/preview', { method: 'POST', body: payload });
      setPreview({ ...result, browserName, fileName: file.name });
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function exportData() {
    setError(''); setBusy(true);
    try {
      const response = await api.request('/api/exports', { raw: true });
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = '我的网站工作台.json'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      workspace.setToast('已导出当前账号的完整资料，请妥善保存');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function readFile(event) {
    const file = event.target.files[0]; event.target.value = '';
    if (!file) return;
    setError(''); setPreview(null); setBusy(true);
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('单次请选择小于 2MB 的文件，可分批导入');
      const content = (await file.text()).replace(/^\uFEFF/, '');
      setPreview(await api.request('/api/imports/preview', { method: 'POST', body: { content, format: 'json' } }));
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function commit(id) {
    setBusy(true); setError('');
    try {
      const result = await api.request(`/api/imports/${id}/commit`, { method: 'POST', body: {} });
      await workspace.refresh(); setPreview(null);
      workspace.setToast(`已导入 ${result.imported ?? 0} 个网站，跳过 ${(result.skipped ?? 0) + (preview?.duplicates ?? 0)} 条重复资料`);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function examples() {
    setError(''); setBusy(true);
    try {
      const sites = initialSites.slice(0, 6).map(site => ({ ...site, accounts: [], collections: [], notes: site.kind === 'selfhosted' ? '示例入口，请编辑成自己的访问地址。' : site.notes }));
      setPreview(await api.request('/api/imports/preview', { method: 'POST', body: { content: { version: 1, sites }, format: 'json' } }));
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  const missingIcons = workspace.sites.filter(site => !getIcon(site).present && canRefreshSiteIcon(site));
  async function repairIcons() {
    setRepairing(true); setRepairResult(null);
    try { setRepairResult(await workspace.repairMissingIcons(6)); }
    finally { setRepairing(false); }
  }
  return <><DirectBrowserImport onConnect={onConnectExtension} />
    <section className="detail-section"><h3>资料维护</h3>
      <p className="muted">自动获取失败的网站图标可以单独刷新。只处理当前缺图的公网站点，已有截图、备注和分类不会改变；私网或需要登录的站点请在浏览器扩展中打开该网站后更新。</p>
      <div className="settings-actions"><button type="button" className="secondary-button" disabled={repairing || missingIcons.length === 0} onClick={repairIcons}><ArrowClockwise size={17} />{repairing ? '正在串行修复…' : `修复缺失图标（${missingIcons.length}）`}</button></div>
      {missingIcons.length === 0 && <p className="muted small-text">当前没有需要修复的公网图标。</p>}
      {repairResult && <p className="small-text" role="status">本次检查 {repairResult.missing ?? 0} 个缺图站点，更新 {repairResult.updated ?? 0} 个{repairResult.failed?.length ? `，失败 ${repairResult.failed.length} 个（${repairResult.failed.slice(0, 3).map(item => item.name).join('、')}）` : ''}{repairResult.skippedPrivate ? `，跳过 ${repairResult.skippedPrivate} 个非公网站点` : ''}。失败的图标会保留字母回退，不会影响文字资料。</p>}
    </section><details className="fallback-file-import"><summary>备用方式：导入已经导出的书签文件</summary><BrowserImportPanel busy={busy} onFile={browserFile} onSourceChange={() => { setPreview(null); setError(''); }} /></details>
    {error && <p className="form-error" role="alert">{error}</p>}
    {preview && <section className="import-confirm"><div className="import-preview"><CheckCircle size={22} /><div><strong>预览：{preview.count} 条可新增资料</strong>{preview.browserName && <p>{preview.browserName} · {preview.fileName}</p>}<p>{preview.duplicates || 0} 条重复 · {preview.skippedUnsupported || 0} 条不支持；未确认前不会保存。</p></div></div><ul className="import-names">{(preview.preview || []).slice(0, 8).map((item, i) => <li key={i}><span className="import-site-name">{item.name}{item.notes?.startsWith('导入文件夹：') && <small>{item.notes}</small>}</span><span>{item.url || item.endpoints?.[0]?.url}</span></li>)}</ul>{(preview.warnings || []).map((message, i) => <p className="muted small-text" key={i}>{message}</p>)}{preview.browserName && !preview.count && <p className="muted">没有可新增的书签，可以取消后选择另一份文件。</p>}<div className="settings-actions"><button className="secondary-button" disabled={busy} onClick={() => setPreview(null)}>取消预览</button><button className="primary-button" disabled={busy || Boolean(preview.browserName && !preview.count)} onClick={() => commit(preview.id)}>{busy ? '正在处理…' : '确认导入'}</button></div></section>}
    <section className="detail-section"><h3>本站备份与导出</h3><p className="muted">恢复本站 JSON 备份，或导出当前账号的完整资料。先预览、确认后写入，重复网址跳过。</p><p className="small-text muted">完整导出包含个人备注和账号说明，不包含平台登录凭据、设备密钥或第三方密码。</p><div className="settings-actions"><button className="secondary-button" disabled={busy} onClick={exportData}><DownloadSimple size={18} />导出完整 JSON</button><button className="secondary-button" disabled={busy} onClick={() => input.current?.click()}><UploadSimple size={18} />导入本站 JSON</button><input hidden ref={input} type="file" accept=".json,application/json" onChange={readFile} /></div></section>
    <section className="detail-section"><h3>从空白开始，或者参考示例</h3><p className="muted">新账号默认是空库。你可以先导入几条示例了解组织方式，确认后再保存。</p><button className="text-button" disabled={busy} onClick={examples}>预览 6 个示例网站</button></section>
  </>;
}
