import { useRef, useState } from 'react';
import { ArrowSquareOut, UploadSimple } from '@phosphor-icons/react';
import { browserSources } from '../bookmark-import.js';

export function BrowserImportPanel({ busy, onFile, onSourceChange }) {
  const [source, setSource] = useState('chrome');
  const input = useRef(null);
  const selected = browserSources.find(item => item.id === source);
  return <section className="detail-section browser-import-panel">
    <h3>从浏览器导入收藏</h3>
    <p className="muted">把已经收藏的网站搬进自己的空间。先选来源，再上传导出的书签文件。</p>
    <div className="browser-source-grid" role="group" aria-label="选择书签来源浏览器">{browserSources.map(item => <button type="button" key={item.id} disabled={busy} aria-pressed={source === item.id} className={source === item.id ? 'selected' : ''} onClick={() => { setSource(item.id); onSourceChange(); }}><span className={`browser-initial browser-${item.id}`} aria-hidden="true">{item.initial}</span><strong>{item.name}</strong></button>)}</div>
    <div className="browser-export-guide"><strong>从 {selected.name} 导出</strong><ol>{selected.steps.map(step => <li key={step}>{step}</li>)}<li>点击下方按钮选择文件，查看预览后再确认导入。</li></ol>{selected.help && <a className="text-button" href={selected.help} target="_blank" rel="noopener noreferrer">查看官方说明 <ArrowSquareOut size={14} /></a>}</div>
    <div className="settings-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => input.current?.click()}><UploadSimple size={18} />{busy ? '正在处理…' : `选择 ${selected.short} 书签文件`}</button><span className="small-text muted">HTML / Bookmarks JSON · 每次最多 500 条 / 2MiB</span></div>
    <input ref={input} type="file" hidden aria-label="选择浏览器书签文件" onChange={event => { const file = event.target.files[0]; event.target.value = ''; if (file) onFile(file, source, selected.name); }} />
    <p className="small-text muted browser-import-note">网页不能直接读取电脑上其他浏览器的收藏。只需导出书签；不需要密码、Cookies 或完整浏览器备份。文件夹路径会保留在备注中，新增网站进入收件箱。</p>
  </section>;
}
