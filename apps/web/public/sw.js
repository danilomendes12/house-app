/**
 * Service worker — hand-written, deliberately minimal (SPEC §5.3).
 *
 * Its job is installability plus a civil offline screen, *not* offline data. Every page in
 * this app is server-rendered from the signed-in user's rows, so caching HTML would mean
 * serving stale balances — or, after a sign-out, another session's numbers. So:
 *
 *   * build assets (`/_next/static/*`, `/icons/*`) are content-hashed and immutable
 *     → cache-first, safe to keep forever;
 *   * navigations → network-only, falling back to the static offline page;
 *   * everything else (Server Actions, Supabase, auth callbacks, non-GET) → untouched.
 *
 * Bump CACHE_VERSION to evict the old cache on the next activation.
 */

const CACHE_VERSION = 'v1';
const ASSET_CACHE = `finance-assets-${CACHE_VERSION}`;
const SHELL_CACHE = `finance-shell-${CACHE_VERSION}`;
const OFFLINE_URL = '/offline.html';

const PRECACHED = [OFFLINE_URL, '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHED))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== ASSET_CACHE && key !== SHELL_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** Content-hashed by the build, so a cache hit can never be stale. */
function isImmutableAsset(url) {
  return url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            // Opaque or failed responses are not worth keeping.
            if (response.ok) {
              const copy = response.clone();
              caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL).then((hit) => hit ?? Response.error())),
    );
  }
});
