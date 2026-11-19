import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal } from '@phosphor-icons/react';
import { CARD_PRESETS } from '../card-preferences.js';
import { modalManager } from '../dialogStack.js';

const labels = { compact: '紧凑', standard: '标准', wide: '宽松', custom: '自定义' };

/** 档位、微调、恢复默认与侧栏形态都收进“显示设置”，不再常驻主工具栏。 */
export function DisplaySettings({ preference, layout, desktop = true }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const trigger = useRef(null);
  const panel = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    panel.current?.querySelector('button')?.focus();
    const dismiss = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    const escape = event => {
      if (event.key !== 'Escape' || modalManager.hasOpen()) return;
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [open]);
  const { target, preset, setPreset, setTarget, save, reset } = preference;
  return <div className="display-settings" ref={root}>
    <button ref={trigger} type="button" className="display-settings-button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(current => !current)}>
      <SlidersHorizontal size={17} />显示设置
    </button>
    {open && <div className="display-settings-panel" role="dialog" aria-label="显示设置">
      <h3>卡片大小</h3>
      <div className="card-size-presets" aria-label="卡片尺寸档位">
        {Object.keys(CARD_PRESETS).map(name => <button key={name} type="button" aria-pressed={preset === name} className={preset === name ? 'selected' : ''} onClick={() => setPreset(name)}>{labels[name]}</button>)}
      </div>
      <label className="card-size-slider">目标宽度
        <input type="range" min="200" max="340" step="20" value={target}
          aria-valuetext={`${labels[preset]}，目标宽度 ${target} 像素`}
          onChange={event => setTarget(Number(event.target.value))} onPointerUp={save} onKeyUp={save} />
        <output>{target}px</output>
      </label>
      <div className="display-settings-row"><span>当前档位：{labels[preset]}</span><button type="button" className="text-button" onClick={reset}>恢复默认</button></div>
      <div className="display-settings-divider" />
      <div className="display-settings-row"><span>侧栏</span>
        <span className="sidebar-density-toggle" role="group" aria-label="侧栏形态">
          <button type="button" disabled={!desktop} className={desktop && !layout.collapsed ? 'selected' : ''} aria-pressed={desktop && !layout.collapsed} onClick={() => layout.setSidebar('expanded')}>展开</button>
          <button type="button" disabled={!desktop} className={desktop && layout.collapsed ? 'selected' : ''} aria-pressed={desktop && layout.collapsed} onClick={() => layout.setSidebar('collapsed')}>折叠</button>
        </span>
      </div>
      <p className="display-settings-hint">{desktop ? '改变立即预览；尺寸、排序和侧栏偏好按当前账号分别保存。' : '窄屏使用抽屉导航；卡片尺寸仍会按屏幕宽度自动计算列数。'}</p>
    </div>}
  </div>;
}
