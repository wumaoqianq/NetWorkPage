(() => {
  const channel = 'website-workspace:extension-presence:v1';
  window.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== window || event.origin !== location.origin || message?.channel !== channel ||
        message.type !== 'probe' || typeof message.nonce !== 'string' || !/^[a-f0-9-]{36}$/.test(message.nonce)) return;
    try {
      const version = chrome.runtime.getManifest().version;
      window.postMessage({ channel, type: 'present', nonce: message.nonce, version }, location.origin);
    } catch { /* An old document can outlive an extension reload. */ }
  });
})();
