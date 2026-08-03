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
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
