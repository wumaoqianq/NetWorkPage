export const CARD_PRESETS = { compact: 220, standard: 260, wide: 320 };

export function normalizeCardPreference(value) {
  const numeric = Number(value?.target);
  const target = Number.isFinite(numeric) ? Math.max(200, Math.min(340, Math.round(numeric / 20) * 20)) : CARD_PRESETS.standard;
  return { schemaVersion: 1, target };
}

export const cardPreferenceKey = (origin, userId, demo = false) =>
  `workspace-card-preferences-v1:${origin}:${demo ? 'demo' : `user:${userId}`}`;

export const cardGap = target => target <= CARD_PRESETS.compact ? 12 : 16;
export const presetName = target => Object.entries(CARD_PRESETS).find(([, width]) => width === target)?.[0] || 'custom';
