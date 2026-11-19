import { ArrowRight, PuzzlePiece, CheckCircle } from '@phosphor-icons/react';

export function DirectBrowserImport({ onConnect }) {
  return <section className="detail-section direct-browser-import">
    <span className="direct-import-label"><PuzzlePiece size={16} />推荐方式 · 不用找文件</span>
    <h3>从当前浏览器一键导入收藏</h3>
    <p className="muted">支持 Chrome、Edge 和 ego(lite)。由扩展直接读取你选择的收藏文件夹，不需要导出，也不用知道数据存在哪里。</p>
    <ol className="direct-import-steps"><li><span>1</span><div><strong>首次连接扩展</strong><small>只需安装一次，用本站配对码连接自己的账号。</small></div></li><li><span>2</span><div><strong>点击「导入浏览器收藏」</strong><small>打开浏览器工具栏的工作台扩展，按提示授权读取。</small></div></li><li><span>3</span><div><strong>预览并确认</strong><small>可选全部或某个文件夹；重复跳过，较多收藏自动分批。</small></div></li></ol>
    <button className="primary-button" type="button" onClick={onConnect}><PuzzlePiece size={18} />连接或更新浏览器扩展<ArrowRight size={17} /></button>
    <p className="small-text muted"><CheckCircle size={14} />已经连接？打开浏览器工具栏的工作台扩展，点击「从当前浏览器一键导入」。</p>
    <p className="small-text muted">只在你点击授权时读取书签，不修改原收藏，不读取密码或历史。在不同浏览器使用时，分别连接一次即可。</p>
  </section>;
}
