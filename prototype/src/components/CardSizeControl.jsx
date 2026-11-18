import { CARD_PRESETS } from '../card-preferences.js';

const labels = { compact: '紧凑', standard: '标准', wide: '宽松', custom: '自定义' };

export function CardSizeControl({ preference, disabled = false }) {
  const { target, preset, setTarget, setPreset, save, reset } = preference;
  return <div className="card-size-control">
    <span className="card-size-label">卡片大小</span>
    <div className="card-size-presets" aria-label="卡片尺寸档位">
      {Object.keys(CARD_PRESETS).map(name => <button key={name} disabled={disabled} aria-pressed={preset === name} className={preset === name ? 'selected' : ''} onClick={() => setPreset(name)}>{labels[name]}</button>)}
    </div>
    <label className="card-size-slider">目标宽度
      <input type="range" min="200" max="340" step="20" value={target} disabled={disabled}
        aria-valuetext={`${labels[preset]}，目标宽度 ${target} 像素`}
        onChange={event => setTarget(Number(event.target.value))} onPointerUp={save} onKeyUp={save} />
      <output>{target}px</output>
    </label>
    <button className="text-button" disabled={disabled} onClick={reset}>恢复默认</button>
    {disabled && <small>切换卡片视图后可调整</small>}
    <small className="single-column-hint">当前单列时，尺寸设置将用于较宽窗口</small>
  </div>;
}
