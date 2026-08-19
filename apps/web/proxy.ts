import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

/** Next 16 renamed the `middleware` file convention to `proxy`. */
export default async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Every path except static assets and image files — the session cookie must be
     * refreshed on any request that can render a page.
     *
     * `sw.js` and `offline.html` are excluded for a different reason than the rest: they are
     * the two files the browser fetches *without* a session — the service worker registers on
     * the login page, and the offline page is precached to be shown when there is no network.
     * Gated, both answered 307 to /login, which is a service worker that never installs and an
     * offline screen that is a redirect.
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|offline.html|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
