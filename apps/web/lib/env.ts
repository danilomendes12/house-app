/**
 * Environment access.
 *
 * Everything here is server-only and read through a getter, so it resolves at **runtime**,
 * not at build time: the same Docker image runs on any VM, configured only by its `.env`.
 * There is no `NEXT_PUBLIC_*` var left — the browser never talks to Supabase directly
 * (every read and write goes through a Server Component, Server Action or Route Handler),
 * which is also why the Supabase API needs no public port in the self-hosted stack.
 *
 * Never import this from a client component.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to apps/web/.env.local and fill it in.`,
    );
  }
  return value;
}

export const serverEnv = {
  /** Base URL of the Supabase API (GoTrue + PostgREST). Internal to the network in production. */
  get supabaseUrl(): string {
    return required('SUPABASE_URL', process.env.SUPABASE_URL);
  },
  /** Anon key. The client runs as the logged-in user, so RLS is what actually authorizes. */
  get supabaseAnonKey(): string {
    return required('SUPABASE_ANON_KEY', process.env.SUPABASE_ANON_KEY);
  },
  /** The e-mail of the household owner. Also enforced in the database (see migrations). */
  get ownerEmail(): string {
    return required('OWNER_EMAIL', process.env.OWNER_EMAIL);
  },
  get supabaseServiceRoleKey(): string {
    return required('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY);
  },
};
