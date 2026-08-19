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
      // Written out, not derived: basePath does not touch strings like this one, and the
      // worker's scope is its own directory — at /financial/sw.js it controls /financial/*,
      // which is exactly the app (docs/DEPLOY.md §1.3).
      navigator.serviceWorker.register('/financial/sw.js').catch((error: unknown) => {
        console.error('[pwa] service worker registration failed', error);
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
