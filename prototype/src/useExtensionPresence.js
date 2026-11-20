import { useCallback, useEffect, useState } from 'react';

const channel = 'website-workspace:extension-presence:v1';

function canCheck() {
  const { protocol, hostname } = window.location;
  const hosted = protocol === 'https:' && ['wumaoqian.top', 'www.wumaoqian.top'].includes(hostname);
  const local = protocol === 'http:' && ['localhost', '127.0.0.1'].includes(hostname);
  return (hosted || local) && /(?:Chrome|Chromium|Edg)\//.test(navigator.userAgent) &&
    !/Mobile|Android|iPhone|iPad/.test(navigator.userAgent) && typeof window.crypto?.randomUUID === 'function';
}

export function useExtensionPresence(enabled) {
  const [presence, setPresence] = useState({ status: 'checking' });
  const [attempt, setAttempt] = useState(0);
  const recheck = useCallback(() => setAttempt(previous => previous + 1), []);
  useEffect(() => {
    if (!enabled || !canCheck()) { setPresence({ status: 'unavailable' }); return; }
    let nonce;
    let timers = [];
    const clear = () => { timers.forEach(clearTimeout); timers = []; };
    const origin = location.origin;
    const receive = event => {
      const message = event.data;
      if (event.source !== window || event.origin !== origin || message?.channel !== channel ||
          message.type !== 'present' || !nonce || message.nonce !== nonce ||
          typeof message.version !== 'string' || !/^\d{1,5}(?:\.\d{1,5}){1,3}$/.test(message.version)) return;
      clear();
      setPresence({ status: 'installed', version: message.version });
    };
    const probe = () => {
      clear();
      nonce = window.crypto.randomUUID();
      const send = () => window.postMessage({ channel, type: 'probe', nonce }, origin);
      send();
      timers.push(setTimeout(send, 250), setTimeout(send, 750),
        setTimeout(() => setPresence({ status: 'not-detected' }), 1500));
    };
    window.addEventListener('message', receive);
    window.addEventListener('focus', probe);
    probe();
    return () => {
      clear();
      window.removeEventListener('message', receive);
      window.removeEventListener('focus', probe);
    };
  }, [enabled, attempt]);
  return { ...presence, recheck };
}
