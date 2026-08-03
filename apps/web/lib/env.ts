/**
 * Environment access.
 *
 * `NEXT_PUBLIC_*` vars are referenced literally so Next can inline them at build time.
 * Server-only secrets live in {@link serverEnv} and must never be imported from a
 * client component — read them in Route Handlers, Server Actions or Server Components.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to apps/web/.env.local and fill it in.`,
    );
  }
  return value;
}

export const publicEnv = {
  supabaseUrl: required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: required(
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  ),
};

export const serverEnv = {
  /** The single e-mail allowed to sign in. Also enforced in the database (see migrations). */
  get ownerEmail(): string {
    return required('OWNER_EMAIL', process.env.OWNER_EMAIL);
  },
  get supabaseServiceRoleKey(): string {
    return required('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY);
  },
};
