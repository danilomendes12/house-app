#!/usr/bin/env node
/**
 * Bootstraps the installation: allowlists an e-mail and creates the auth user for it.
 *
 * This exists because the household is closed — signups are off in GoTrue and the
 * `enforce_email_allowlist` trigger rejects any insert into auth.users for an e-mail that
 * is not on the list. There is no self-service path, by design, so the very first e-mail
 * has to be named from outside. That is all this script is: the one thing the system
 * cannot decide for itself.
 *
 * Creating the user is what creates the household — `provision_user` fires on insert into
 * auth.users, not on first sign-in. From then on the database knows who the owner is, and
 * nothing needs to keep the e-mail around.
 *
 * The password comes from OWNER_PASSWORD when set; otherwise a strong one is generated and
 * printed once. Idempotent: an existing user keeps the password it already has
 * (`pnpm db:password` is the way to change it).
 *
 *   pnpm db:owner voce@exemplo.com
 */

import { createUser, readConfig } from './lib/admin.mjs';

const config = readConfig();
// The env var is a fallback so `pnpm dev` can pass it through on a fresh install; it is
// not read from any config file.
const email = (process.argv[2] ?? process.env.OWNER_EMAIL)?.trim().toLowerCase();

if (!email || !email.includes('@')) {
  console.error('Usage: pnpm db:owner <email>');
  process.exit(1);
}

async function allowlistEmail() {
  const response = await fetch(`${config.url}/rest/v1/allowed_emails`, {
    method: 'POST',
    headers: { ...config.headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ email, note: 'owner' }),
  });
  if (!response.ok) {
    throw new Error(`allowlist failed (${response.status}): ${await response.text()}`);
  }
  console.log(`allowlisted ${email}`);
}

await allowlistEmail();
await createUser(config, email, { passwordFromEnv: process.env.OWNER_PASSWORD });
console.log('done — sign in with e-mail and password at /login');
