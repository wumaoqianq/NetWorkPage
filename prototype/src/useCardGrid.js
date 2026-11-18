import { useLayoutEffect, useState } from 'react';
import { computeCardGrid } from './layout.js';
import { cardGap } from './card-preferences.js';

/** 读取网格真实可用宽度，按目标卡宽算列数；侧栏折叠、窗口缩放和档位变化都会重新计算。 */
export function useCardGrid({ element, target, mode }) {
  const [layout, setLayout] = useState(() => ({ columns: 1, cardWidth: target, gap: cardGap(target), ready: false }));
  useLayoutEffect(() => {
    if (mode === 'list' || !element) return undefined;

    if (!element) return undefined;
    let frame = 0;
    const measure = () => {
      const availableWidth = element.getBoundingClientRect().width;
      setLayout({ ...computeCardGrid({ availableWidth, target, gap: cardGap(target) }), ready: true });
    };
    measure();
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(element);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [element, target, mode]);
  return layout;
}

