import { captureUrl, cleanDescription } from './queue.js';

export async function readPageMetadata(tabId) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId, allFrames: false }, func: () => {
    const meta = selector => document.querySelector(selector)?.getAttribute('content') || '';
    return { title: document.title || '', description: meta('meta[name="description"]')
      || meta('meta[property="og:description"]') || meta('meta[name="og:description"]'),
      icons: [...document.querySelectorAll('link[rel]')].filter(link => /(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/i.test(link.rel))
        .map(link => link.href).filter(Boolean).slice(0, 6),
      iconLinks: [...document.querySelectorAll('link[rel]')].filter(link => /(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/i.test(link.rel))
        .map(link => ({ href: link.href, rel: link.rel, sizes: link.getAttribute('sizes') || '',
          type: link.getAttribute('type') || '', media: link.getAttribute('media') || '' }))
        .filter(link => link.href).slice(0, 10),
      theme: matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' };
  } });
  return { title: String(result?.result?.title || '').trim().slice(0, 100),
    description: cleanDescription(result?.result?.description),
    icons: (result?.result?.icons || []).filter(value => typeof value === 'string').slice(0, 6),
    iconLinks: (result?.result?.iconLinks || []).filter(value => value && typeof value.href === 'string').slice(0, 10),
    theme: result?.result?.theme === 'dark' ? 'dark' : 'light' };
}

const identity = connection => `${connection?.server || 'unconnected'}|${connection?.user?.id || 'unknown'}`;
const draftKey = (connection, url) => `${identity(connection)}|${captureUrl(url)}`;

export async function saveDraft(connection, url, form) {
  const stored = await chrome.storage.local.get('workspaceDrafts');
  const now = Date.now();
  const drafts = Object.fromEntries(Object.entries(stored.workspaceDrafts || {})
    .filter(([, draft]) => now - draft.savedAt < 86400000));
  drafts[draftKey(connection, url)] = { form: { ...form, attachment: undefined }, savedAt: now };
  await chrome.storage.local.set({ workspaceDrafts: drafts });
}

export async function loadDraft(connection, url) {
  const stored = await chrome.storage.local.get('workspaceDrafts');
  const draft = (stored.workspaceDrafts || {})[draftKey(connection, url)];
  return draft && Date.now() - draft.savedAt < 86400000 ? draft.form : null;
}

export async function createContinuation(connection, homepageUrl, form) {
  const continuation = { id: crypto.randomUUID(), server: connection?.server || '', userId: String(connection?.user?.id || ''),
    homepageUrl: captureUrl(homepageUrl), form: { ...form, attachment: undefined }, createdAt: Date.now() };
  await chrome.storage.local.set({ workspaceContinuation: continuation });
  return continuation;
}

export async function loadContinuation(connection, tabUrl) {
  const { workspaceContinuation: value } = await chrome.storage.local.get('workspaceContinuation');
  if (!value || Date.now() - value.createdAt > 1800000 || value.server !== (connection?.server || '')
      || value.userId !== String(connection?.user?.id || '')) return null;
  try { if (captureUrl(tabUrl) !== captureUrl(value.homepageUrl)) return null; }
  catch { return null; }
  await chrome.storage.local.remove('workspaceContinuation');
  return value.form;
}

export async function clearDraft(connection, url) {
  const stored = await chrome.storage.local.get('workspaceDrafts');
  const drafts = stored.workspaceDrafts || {};
  delete drafts[draftKey(connection, url)];
  await chrome.storage.local.set({ workspaceDrafts: drafts });
}
