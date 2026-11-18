const KEY = 'workspacePreferences';
const identity = connection => `${connection?.server || ''}|${connection?.user?.id || ''}`;
const defaults = { autoPreview: true, rememberCategory: false, lastCategory: '', noticeSeen: false };

export async function loadPreferences(connection) {
  const stored = await chrome.storage.local.get(KEY);
  return { ...defaults, ...(stored[KEY]?.[identity(connection)] || {}) };
}

export async function savePreferences(connection, changes) {
  const stored = await chrome.storage.local.get(KEY);
  const key = identity(connection);
  const value = { ...defaults, ...(stored[KEY]?.[key] || {}), ...changes };
  await chrome.storage.local.set({ [KEY]: { ...(stored[KEY] || {}), [key]: value } });
  return value;
}
