import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { layoutPreferenceKey, normalizeLayoutPreference } from './layout-preferences.js';

/** 侧栏/排序/视图偏好按 origin+账号隔离保存；与卡片尺寸偏好互不影响。 */
export function useLayoutPreferences({ user, demo = false, onError = () => {} }) {
  const key = useMemo(() => layoutPreferenceKey(location.origin, user?.id || 'unknown', demo), [user?.id, demo]);
  const [state, setState] = useState(() => {
    try { return normalizeLayoutPreference(JSON.parse(localStorage.getItem(key) || 'null')); }
    catch { return normalizeLayoutPreference(null); }
  });
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const save = useCallback(next => {
    try { localStorage.setItem(key, JSON.stringify(next)); }
    catch { errorRef.current('浏览器未能保存本次显示偏好'); }
  }, [key]);
  useEffect(() => {
    const timer = setTimeout(() => save(state), 250);
    return () => clearTimeout(timer);
  }, [state, save]);
  const update = useCallback(changes => setState(current => normalizeLayoutPreference({ ...current, ...changes })), []);
  return { ...state, setSidebar: sidebar => update({ sidebar }),
    setSort: sort => update({ sort }), setMode: mode => update({ mode }) };
}
