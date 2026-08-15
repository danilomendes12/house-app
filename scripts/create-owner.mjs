#!/usr/bin/env node
/**
 * Provisions the owner of the household: allowlists OWNER_EMAIL and creates the auth user
 * with a password. Idempotent — safe to re-run after `supabase db reset`.
 *
 * The password comes from OWNER_PASSWORD when set; otherwise a strong one is generated and
 * printed once. An existing user keeps the password it already has (`pnpm db:password`
 * is the way to change it).
 *
 * Reads apps/web/.env.local by default; env vars already set take precedence.
 *
 *   pnpm db:owner
 */

import { createUser, readConfig } from './lib/admin.mjs';

const config = readConfig({ requireOwner: true });
const email = config.ownerEmail;

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
