import { useState } from 'react';
import { PuzzlePiece, X } from '@phosphor-icons/react';

export function ExtensionInstallNotice({ visible, presence, onGuide }) {
  const [dismissed, setDismissed] = useState(false);
  if (!visible || dismissed || presence.status !== 'not-detected') return null;
  return <aside className="extension-install-notice" aria-label="浏览器扩展安装提示">
    <PuzzlePiece size={23} aria-hidden="true" />
    <div><strong>当前浏览器未检测到网站工作台扩展</strong><p>安装后可在浏览时一键收藏。若已装旧版，请在原目录更新并重新加载后刷新本页。</p></div>
    <button type="button" className="secondary-button" onClick={onGuide}>下载扩展与安装指引</button>
    <button type="button" className="icon-button" aria-label="关闭扩展安装提示" onClick={() => setDismissed(true)}><X size={17} /></button>
  </aside>;
}
