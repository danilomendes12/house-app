import 'server-only';

import { redirect } from 'next/navigation';
import type { PostgrestError } from '@supabase/supabase-js';
import { createClient, getUser } from '@/lib/supabase/server';

/**
 * Supabase client plus the current user id, which every write needs: RLS checks
 * `user_id = auth.uid()`, so rows must carry it explicitly.
 *
 * Redirects to the login page when there is no session. Route handlers that must answer
 * with a status code instead of a redirect should call `getUser()` directly.
 */
export async function authedClient() {
  const user = await getUser();
  if (!user) redirect('/login');

  return { supabase: await createClient(), userId: user.id };
}

/**
 * Unwraps a PostgREST result. A failed query here means a bug or an outage, not something
 * the UI can recover from — let it hit the error boundary.
 */
export function unwrap<T>({ data, error }: { data: T | null; error: PostgrestError | null }): T {
  if (error) throw new Error(`[db] ${error.message}`, { cause: error });
  if (data === null) throw new Error('[db] query returned no data');
  return data;
}

/** Postgres unique-violation, the one write error worth showing the user. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
