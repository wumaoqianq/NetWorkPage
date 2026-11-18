import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ArrowClockwise, Minus, Plus } from '@phosphor-icons/react';
import { Dialog } from './Dialog.jsx';
import { displayAddress, getPreview } from '../model.js';
import { initialScreenshotResource, screenshotResourceKey, screenshotResourceReducer } from '../screenshot-resource.js';

function errorMessage(error) {
  if (error === 'unauthorized') return '登录状态已失效，请重新登录后读取截图。';
  if (error === 'not_found') return '截图暂不可用，文件可能已移除或资源版本已变化。可重试或读取最新信息。';
  if (error === 'decode') return '截图文件损坏或格式不受支持。可重试，或使用扩展更新截图。';
  return '截图加载失败，请检查网络后重试。';
}

export function ScreenshotViewer({ site, onClose, onRefreshMetadata, onGuide, inline = false }) {
  const preview = getPreview(site);
  const key = screenshotResourceKey(site.id, preview);
  const [state, dispatch] = useReducer(screenshotResourceReducer, initialScreenshotResource);
  const [fit, setFit] = useState(true);
  const [naturalWidth, setNaturalWidth] = useState(0);
  const stateRef = useRef(state), keyRef = useRef(''), requestRef = useRef(0), abortRef = useRef(null), urlRef = useRef('');
  stateRef.current = state;
  const kind = preview.pageKind === 'home' ? '用户确认的首页' : '当前页预览';

  const load = useCallback(async () => {
    abortRef.current?.abort();
    if (!preview.present) { dispatch({ type: 'empty', requestId: ++requestRef.current }); return; }
    const requestId = ++requestRef.current;
    const controller = new AbortController(); abortRef.current = controller;
    dispatch({ type: 'start', requestId }); setFit(true); setNaturalWidth(0);
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    try {
      const response = await fetch(preview.fullUrl, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (response.status === 401 || response.status === 403) throw new Error('unauthorized');
      if (response.status === 404) throw new Error('not_found');
      if (!response.ok) throw new Error('network');
      if (!/^image\/(webp|png|jpeg)$/.test(response.headers.get('content-type') || '')) throw new Error('decode');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => { setNaturalWidth(image.naturalWidth); resolve(); };
        image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('decode')); };
        image.src = objectUrl;
        if (controller.signal.aborted) { URL.revokeObjectURL(objectUrl); reject(new Error('aborted')); }
      });
      if (requestId !== requestRef.current) { URL.revokeObjectURL(objectUrl); return; }
      urlRef.current = objectUrl;
      dispatch({ type: 'success', requestId, objectUrl });
    } catch (error) {
      if (requestId !== requestRef.current || error.message === 'aborted' || error.name === 'AbortError') return;
      dispatch({ type: 'error', requestId, error: error.message });
    }
  }, [preview.fullUrl, preview.present]);
  useEffect(() => {
    if (keyRef.current === key) return;
    keyRef.current = key;
    if (stateRef.current.status === 'ready') dispatch({ type: 'revision', requestId: ++requestRef.current });
    else void load();
  }, [key, load]);
  useEffect(() => () => {
    abortRef.current?.abort(); requestRef.current++;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);
  async function refreshMetadata() {
    if (onRefreshMetadata) await onRefreshMetadata({ background: true });
    await load();
  }
  const image = state.status === 'ready' && <img className={fit ? 'viewer-image fit' : 'viewer-image'}
    style={fit ? undefined : { width: naturalWidth ? `${Math.round(naturalWidth * state.zoom)}px` : 'auto' }}
    src={state.objectUrl} alt={`${site.name}的${kind}，拍摄于${new Date(preview.capturedAt).toLocaleString('zh-CN')}`} />;
  const content = <section className={`screenshot-viewer ${inline ? 'inline-viewer' : ''}`}>
    {!inline && <p className="viewer-subtitle">{kind} · {new Date(preview.capturedAt).toLocaleString('zh-CN')}</p>}
    <details className="viewer-source"><summary>截图来源与说明</summary><p>{kind}，拍摄于 {new Date(preview.capturedAt).toLocaleString('zh-CN')}。</p><p>{displayAddress(preview.sourceUrl || '', 120)}</p><small>截图仅用于识别，放大不增加原图清晰度，也不证明网站当前状态。</small></details>
    {state.offerUpdate && <div className="viewer-update" role="status">有新截图，当前画面暂未改变。<button className="secondary-button" onClick={load}>刷新查看</button></div>}
    <div className={`viewer-canvas ${state.status === 'error' || state.status === 'empty' ? 'viewer-empty' : ''}`}>
      {state.status === 'loading' && <div className="viewer-loading" role="status"><span className="viewer-skeleton" /><p>正在通过工作台鉴权加载截图…</p></div>}
      {state.status === 'empty' && <div className="viewer-message"><h3>暂无截图</h3><p>服务端尚未保存这张页面预览。自动采集可能失败、被关闭或仍在扩展本地等待上传。</p>{onGuide && <button className="secondary-button" onClick={onGuide}>用扩展更新素材</button>}</div>}
      {state.status === 'error' && <div className="viewer-message" role="alert"><h3>截图暂不可用</h3><p>{errorMessage(state.error)}</p><div className="viewer-error-actions"><button className="primary-button" onClick={load}><ArrowClockwise size={17} />重试</button>{onRefreshMetadata && <button className="secondary-button" onClick={refreshMetadata}>读取最新信息</button>}{state.error === 'unauthorized' && <button className="secondary-button" onClick={() => location.reload()}>重新登录</button>}{onGuide && <button className="text-button" onClick={onGuide}>用扩展更新</button>}</div></div>}
      {image}
    </div>
    {state.status === 'ready' && <footer className="viewer-toolbar"><div><button className={fit ? 'selected' : ''} onClick={() => setFit(true)}>适应窗口</button><button className={!fit && state.zoom === 1 ? 'selected' : ''} onClick={() => { setFit(false); dispatch({ type: 'zoom', requestId: state.requestId, zoom: 1 }); }}>100% 原尺寸</button></div><div><button aria-label="缩小" disabled={state.zoom <= 0.5} onClick={() => { setFit(false); dispatch({ type: 'zoom', requestId: state.requestId, zoom: state.zoom - 0.25 }); }}><Minus size={17} /></button><span>{Math.round(state.zoom * 100)}%</span><button aria-label="放大" disabled={state.zoom >= 2} onClick={() => { setFit(false); dispatch({ type: 'zoom', requestId: state.requestId, zoom: state.zoom + 0.25 }); }}><Plus size={17} /></button><button onClick={() => { setFit(true); dispatch({ type: 'zoom', requestId: state.requestId, zoom: 1 }); }}>重置</button></div></footer>}
  </section>;
  if (inline) return content;
  return <Dialog title={`${site.name} · 页面截图`} onClose={onClose} wide>{content}</Dialog>;
}
