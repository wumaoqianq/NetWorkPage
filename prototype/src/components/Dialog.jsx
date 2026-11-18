import { useEffect, useId, useRef } from 'react';
import { X } from '@phosphor-icons/react';
import { modalManager } from '../dialogStack.js';

/** 统一管理模态框焦点和 Escape，关闭后将焦点交还触发控件。 */
export function Dialog({ title, onClose, drawer = false, children, wide = false }) {
  const panel = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const currentPanel = panel.current;
    const release = modalManager.enter(currentPanel);
    currentPanel?.focus();
    function keydown(event) {
      if (!modalManager.isTop(currentPanel)) return;
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const focusables = [...panel.current.querySelectorAll('button, a[href], input, textarea, select, [tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
      const first = focusables[0], last = focusables.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener('keydown', keydown);
    return () => { release(); document.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus(); };
  }, [onClose]);
  return <div className={`dialog-backdrop ${drawer ? 'drawer-backdrop' : ''}`} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`dialog ${drawer ? 'drawer' : ''} ${wide ? 'wide-dialog' : ''}`}>
      <header className="dialog-header"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" onClick={onClose} aria-label="关闭"><X size={22} /></button></header>
      {children}
    </section>
  </div>;
}
