import { useEffect, useState } from 'react';

/** 仅用于响应式取值的视口宽度；ResizeObserver 负责更精细的卡片网格测量。 */
export function useViewport() {
  const [viewport, setViewport] = useState(() => ({ width: globalThis.innerWidth || 0, height: globalThis.innerHeight || 0 }));
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setViewport({ width: window.innerWidth, height: window.innerHeight }));
    };
    update();
    window.addEventListener('resize', update);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', update); };
  }, []);
  return viewport;
}
