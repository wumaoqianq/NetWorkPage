import { useRef, useState } from 'react';
import { ArrowCounterClockwise, ArrowRight, CheckCircle, DownloadSimple, Info, PuzzlePiece, UploadSimple } from '@phosphor-icons/react';
import { Dialog } from './Dialog.jsx';
import { normalizeImportedSites } from '../model.js';

export function SettingsDialog({ sites, onClose, onReset, onImport, notify }) {
  const input = useRef(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [resetting, setResetting] = useState(false);
  const [step, setStep] = useState(0);
  function exportData() {
    const file = new Blob([JSON.stringify({ version: 1, demo: true, sites }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(file);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = '网站工作台-演示收藏.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('已导出演示资料，文件中可能包含你添加的账号说明');
  }
  async function readFile(event) {
    setError(''); setPreview(null);
    try {
      const file = event.target.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) throw new Error('请选择小于 2MB 的 JSON 文件');
      const entries = normalizeImportedSites(JSON.parse(await file.text()));
      setPreview(entries);
    } catch (failure) { setError(failure instanceof SyntaxError ? '文件不是有效的 JSON，请检查后重试' : failure.message); }
    event.target.value = '';
  }
  const extensionSteps = [ ['浏览到需要的网站', '在浏览器中打开网页，然后点击扩展的收藏按钮。'], ['补一句用途', '网址和标题自动带入，你只需记下“以后因为什么来找它”。'], ['收藏到自己的空间', '保存后留在原页面，回到工作台即可检索。这是流程预览，实际扩展将随后开发。'] ];
  return <Dialog title="设置与原型说明" onClose={onClose} wide><div className="settings-content">
    <div className="info-banner"><Info size={22} /><div><strong>当前为可交互原型</strong><p>所有资料仅在本次页面内演示，刷新后恢复初始内容。正式版本将接入独立账号、云端保存和浏览器扩展。请勿输入真实密码或敏感资料。</p></div></div>
    <section className="detail-section"><h3>收藏资料</h3><p className="muted">导入网站名称、用途、标签和入口；重复地址跳过。演示导入不恢复账号说明。</p><div className="settings-actions"><button className="secondary-button" onClick={exportData}><DownloadSimple size={19} />导出 JSON</button><button className="secondary-button" onClick={() => input.current?.click()}><UploadSimple size={19} />导入 JSON</button><input ref={input} type="file" accept=".json,application/json" onChange={readFile} hidden /></div>{error && <p role="alert" className="form-error">{error}</p>}{preview && <div className="import-preview"><CheckCircle size={22} /><div><strong>已检查 {preview.length} 条网站资料</strong><p>{preview.slice(0, 3).map(s => s.name).join('、')}{preview.length > 3 ? '…' : ''}</p></div><button className="primary-button" onClick={() => { onImport(preview); setPreview(null); }}>确认导入</button></div>}</section>
    <section className="detail-section"><h3><PuzzlePiece size={21} />浏览器快速收藏</h3><p className="muted">先体验收藏流程，实际浏览器扩展尚未接入。</p><div className="extension-demo"><span className="step-number">{step + 1}</span><div><strong>{extensionSteps[step][0]}</strong><p>{extensionSteps[step][1]}</p></div><button className="icon-button" aria-label="下一步收藏流程" onClick={() => setStep((step + 1) % 3)}><ArrowRight size={22} /></button></div><div className="step-progress">{extensionSteps.map((_, i) => <button key={i} className={i === step ? 'selected' : ''} aria-label={`收藏流程第${i + 1}步`} onClick={() => setStep(i)} />)}</div></section>
    <section className="detail-section"><h3>演示数据</h3><p className="muted">重置会清除本次添加和编辑的内容，恢复最初的示例。</p>{resetting ? <div className="reset-confirm"><span>确定恢复初始资料吗？</span><button className="secondary-button" onClick={() => setResetting(false)}>取消</button><button className="danger-button" onClick={() => { onReset(); setResetting(false); }}>确认重置</button></div> : <button className="secondary-button" onClick={() => setResetting(true)}><ArrowCounterClockwise size={18} />恢复初始示例</button>}</section>
  </div></Dialog>;
}
