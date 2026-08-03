#!/usr/bin/env node
/**
 * Provisions the single user of the system: allowlists OWNER_EMAIL and creates the
 * auth user. Idempotent — safe to re-run after `supabase db reset`.
 *
 * Reads apps/web/.env.local by default; env vars already set take precedence.
 *
 *   pnpm db:owner
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve(process.cwd(), 'apps/web/.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.OWNER_EMAIL?.trim().toLowerCase();

if (!url || !serviceRoleKey || !email) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or OWNER_EMAIL.\n' +
      'Set them in apps/web/.env.local (see .env.example).',
  );
  process.exit(1);
}

const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  'Content-Type': 'application/json',
};

async function allowlistEmail() {
  const response = await fetch(`${url}/rest/v1/allowed_emails`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ email, note: 'owner' }),
  });
  if (!response.ok) {
    throw new Error(`allowlist failed (${response.status}): ${await response.text()}`);
  }
  console.log(`allowlisted ${email}`);
}

async function createUser() {
  const response = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, email_confirm: true }),
  });

  if (response.ok) {
    console.log(`created auth user ${email}`);
    return;
  }

  const body = await response.text();
  if (response.status === 422 && body.includes('already been registered')) {
    console.log(`auth user ${email} already exists`);
    return;
  }
  throw new Error(`user creation failed (${response.status}): ${body}`);
}

await allowlistEmail();
await createUser();
console.log('done — request a magic link at /login');
