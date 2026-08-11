import 'server-only';

import { cache } from 'react';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { publicEnv } from '@/lib/env';
import type { Database } from './database.types';

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * Runs as the logged-in user, so RLS applies — this is the default client to use.
 *
 * Memoized per request: the cookie jar it reads is request-scoped anyway, and every
 * caller within one render then shares a single instance.
 */
export const createClient = cache(async () => {
  const cookieStore = await cookies();

  return createServerClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies; the middleware refreshes the session instead.
        }
      },
    },
  });
});

/**
 * The authenticated user, or `null`. Verified against the auth server rather than
 * decoded from the cookie, so a revoked session cannot be replayed.
 *
 * That verification is a network round-trip. During a render Next already folds the
 * repeated calls into one by memoizing the identical `fetch`; memoizing here as well
 * means one client instance per render and keeps the behaviour if that ever changes.
 * Note the memoization is render-scoped: Server Actions do not get it, so code paths
 * that run there should reuse one client instead of calling `authedClient()` repeatedly.
 */
export const getUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
