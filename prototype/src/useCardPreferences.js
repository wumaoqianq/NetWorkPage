import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CARD_PRESETS, cardPreferenceKey, normalizeCardPreference, presetName } from './card-preferences.js';

export function useCardPreferences({ user, demo = false, onError = () => {} }) {
  const key = useMemo(() => cardPreferenceKey(location.origin, user?.id || 'unknown', demo), [user?.id, demo]);
  const [target, setTarget] = useState(() => {
    try { return normalizeCardPreference(JSON.parse(localStorage.getItem(key) || 'null')).target; }
    catch { return CARD_PRESETS.standard; }
  });
  const [saveError, setSaveError] = useState('');
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const save = useCallback(() => {
    try { localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, target })); setSaveError(''); }
    catch { setSaveError('本次已调整，浏览器未能保存偏好'); }
  }, [key, target]);
  useEffect(() => {
    const timer = setTimeout(save, 300);
    return () => clearTimeout(timer);
  }, [save]);
  useEffect(() => { if (saveError) errorRef.current(saveError); }, [saveError]);
  function setPreset(name) { setTarget(CARD_PRESETS[name] || CARD_PRESETS.standard); }
  return { target, preset: presetName(target), setTarget, setPreset, save, reset: () => setTarget(CARD_PRESETS.standard), saveError };
}
