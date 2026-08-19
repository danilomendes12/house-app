/**
 * Shared plumbing for the provisioning CLIs (`db:owner`, `db:invite`, `db:password`).
 *
 * They all talk to the same two APIs with the service role key: GoTrue's admin endpoints
 * (`/auth/v1/admin/users`) and PostgREST (`/rest/v1/...`).
 *
 * All three take `--remote`, which points them at the VM instead of this machine. There is
 * no second copy of the production keys here for that: the VM's own deploy/.env is read
 * over SSH, held in memory for the length of the command, and the API is reached through an
 * SSH tunnel — its port is published on the VM's loopback and nowhere else.
 */

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { readDeployConfig, readRemoteEnv, withTunnel } from './remote.mjs';

/**
 * Reads deploy/.env — the only env file in the repository. Variables already set in the
 * environment win, which is what lets these scripts point at another installation.
 */
export function loadLocalEnv() {
  const envFile = resolve(process.cwd(), 'deploy/.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

/** An endpoint plus the service-role key that opens it. */
function configFor(url, serviceRoleKey) {
  return {
    url,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
  };
}

/**
 * Supabase endpoint and credentials. All server-only: these scripts hold the service role
 * key, which is what lets them write `allowed_emails` and create users at all.
 */
export function readConfig() {
  loadLocalEnv();

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    console.error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n' +
        'They live in deploy/.env, written on the first `pnpm dev` (see deploy/.env.example).',
    );
    process.exit(1);
  }

  return configFor(url, serviceRoleKey);
}

/** The first thing on the command line that is not a flag — the e-mail, in all three. */
export function firstArgument(argv) {
  return argv.find((arg) => !arg.startsWith('--'));
}

/**
 * Runs `fn(config)` against this machine's stack, or against the VM's with `--remote`.
 *
 * The tunnel is opened for the length of `fn` and closed whatever happens, and the local
 * end is a port chosen at runtime — never 8000, which is exactly the port the local stack
 * holds. Provisioning a user in the wrong household is the kind of mistake that is quiet
 * for weeks.
 */
export async function withAdminConfig(argv, fn) {
  if (!argv.includes('--remote')) return fn(readConfig());

  const deploy = readDeployConfig();
  const remoteEnv = readRemoteEnv(deploy);

  return withTunnel(deploy, Number(remoteEnv.SUPABASE_API_PORT ?? 8000), (port) =>
    fn(configFor(`http://127.0.0.1:${port}`, remoteEnv.SUPABASE_SERVICE_ROLE_KEY)),
  );
}

/**
 * The household an invited person joins.
 *
 * Derived from the database rather than from an e-mail kept in a config file: after
 * `db:owner`, the installation *has* an owner, and the row in `households` is that fact.
 * `provision_user` fires on insert into auth.users, so it exists from that moment.
 *
 * Two or more households means the answer is genuinely ambiguous, and guessing is what
 * SPEC §12 rejected — so this stops and asks instead. Failing loudly is the difference
 * between "the household that happens to exist" and a silent leak between houses.
 */
export async function soleHouseholdId(config) {
  const rows = await apiGet(config, '/rest/v1/households?select=id&limit=2');

  if (rows.length === 0) {
    throw new Error('no household yet — run `pnpm db:owner <email>` first');
  }
  if (rows.length > 1) {
    throw new Error(
      'this installation has more than one household, so which one to join is ambiguous.\n' +
        'Pass it explicitly: HOUSEHOLD_ID=<uuid> pnpm db:invite <email>',
    );
  }
  return rows[0].id;
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
