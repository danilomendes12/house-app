'use client';

import { useEffect } from 'react';

/**
 * Registers `public/sw.js` once the page is interactive.
 *
 * Registration is deferred to `load` so the worker never competes with the first render
 * for bandwidth, and it is skipped in development — a cached service worker across
 * `next dev` rebuilds is a debugging trap, and installability is a production concern.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
        console.error('[pwa] service worker registration failed', error);
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
