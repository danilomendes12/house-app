/**
 * Shared plumbing for the provisioning CLIs (`db:owner`, `db:invite`, `db:password`).
 *
 * They all talk to the same two APIs with the service role key: GoTrue's admin endpoints
 * (`/auth/v1/admin/users`) and PostgREST (`/rest/v1/...`).
 */

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Reads apps/web/.env.local, if present. Env vars already set take precedence. */
export function loadLocalEnv() {
  const envFile = resolve(process.cwd(), 'apps/web/.env.local');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

/**
 * Supabase endpoint and credentials. Both are server-only: `SUPABASE_URL` points at the
 * internal API in production, so these scripts run on the VM or through a tunnel.
 */
export function readConfig({ requireOwner = false } = {}) {
  loadLocalEnv();

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();

  if (!url || !serviceRoleKey || (requireOwner && !ownerEmail)) {
    console.error(
      'Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or OWNER_EMAIL.\n' +
        'Set them in apps/web/.env.local (see .env.example).',
    );
    process.exit(1);
  }

  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };

  return { url, headers, ownerEmail };
}

export async function apiGet({ url, headers }, path) {
  const response = await fetch(`${url}${path}`, { headers });
  if (!response.ok) {
    throw new Error(`GET ${path} failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

/** The auth user with this e-mail, or `undefined`. */
export async function findUser(config, email) {
  const { users } = await apiGet(config, '/auth/v1/admin/users?per_page=200');
  return users.find((user) => user.email?.toLowerCase() === email);
}

/**
 * A password strong enough to be the only door: there is no recovery flow by design
 * (Fase 9), so this is generated, never typed. ~128 bits of entropy.
 */
export function generatePassword() {
  return randomBytes(18).toString('base64url');
}

/**
 * Prints a generated password once, loudly. It is not stored anywhere else — GoTrue keeps
 * only the hash — so losing it means running `pnpm db:password <email>` again.
 */
export function announcePassword(email, password) {
  console.log(
    [
      '',
      `\x1b[33m▸ senha de ${email}\x1b[0m`,
      `  \x1b[1m${password}\x1b[0m`,
      '  Guarde agora: ela não será mostrada de novo.',
      '  Para trocar: pnpm db:password <email>',
      '',
    ].join('\n'),
  );
}

/**
 * Creates the auth user with a password, if it does not exist yet.
 *
 * Idempotent on purpose, and deliberately *not* a password reset: re-running after
 * `supabase db reset` must not silently change the password of a user who already has one.
 * Returns whether it created anything.
 */
export async function createUser(config, email, { passwordFromEnv }) {
  const password = passwordFromEnv || generatePassword();

  const response = await fetch(`${config.url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: config.headers,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });

  if (response.ok) {
    console.log(`created auth user ${email}`);
    if (!passwordFromEnv) announcePassword(email, password);
    return true;
  }

  const body = await response.text();
  if (response.status === 422 && body.includes('already been registered')) {
    console.log(`auth user ${email} already exists — password kept as is`);
    return false;
  }
  throw new Error(`user creation failed (${response.status}): ${body}`);
}
