import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { PostgrestError } from '@supabase/supabase-js';
import { createClient, getUser } from '@/lib/supabase/server';

/**
 * Supabase client plus the two ids every write needs (SPEC §6.3):
 *
 *   * `householdId` — who *owns* the row. RLS checks `household_id =
 *     current_household_id()`, so rows must carry it explicitly, exactly as `user_id`
 *     used to be carried.
 *   * `userId` — who *entered* it. Attribution only; it grants no access.
 *
 * Redirects to the login page when there is no session. Route handlers that must answer
 * with a status code instead of a redirect should call `getUser()` directly.
 */
export async function authedClient() {
  const user = await getUser();
  if (!user) redirect('/login');

  return { supabase: await createClient(), userId: user.id, householdId: await householdId() };
}

/**
 * The caller's household. Memoized per render like `getUser()` — every write in a page
 * would otherwise repeat the same single-row lookup.
 *
 * A session without a membership cannot see or write anything (every policy compares
 * against a null household), so this is a broken provisioning state rather than an empty
 * result: fail loudly instead of rendering an account that looks mysteriously empty.
 */
const householdId = cache(async (): Promise<string> => {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('household_members')
    .select('household_id')
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`[db] household lookup failed: ${error.message}`, { cause: error });
  if (!data) throw new Error('[db] signed-in user belongs to no household — run pnpm db:invite');

  return data.household_id;
});

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
