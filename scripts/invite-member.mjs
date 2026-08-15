#!/usr/bin/env node
/**
 * Invites a second person into the owner's household (SPEC §6.3): allowlists the e-mail
 * *already pointing at that household* and creates the auth user.
 *
 * The household on the allowlist row is the whole point — `provision_user` reads it on
 * insert into auth.users, and without it the new user would land in a household of their
 * own and see an empty app.
 *
 * Idempotent — safe to re-run. Reads apps/web/.env.local by default; env vars already set
 * take precedence.
 *
 *   pnpm db:invite namorada@exemplo.com
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve(process.cwd(), 'apps/web/.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
const email = process.argv[2]?.trim().toLowerCase();

if (!url || !serviceRoleKey || !ownerEmail) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or OWNER_EMAIL.\n' +
      'Set them in apps/web/.env.local (see .env.example).',
  );
  process.exit(1);
}

if (!email || !email.includes('@')) {
  console.error('Usage: pnpm db:invite <email>');
  process.exit(1);
}

const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  'Content-Type': 'application/json',
};

async function get(path) {
  const response = await fetch(`${url}${path}`, { headers });
  if (!response.ok) {
    throw new Error(`GET ${path} failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

/** The owner's household — the one the invited e-mail joins. */
async function ownerHouseholdId() {
  const { users } = await get(`/auth/v1/admin/users?per_page=200`);
  const owner = users.find((user) => user.email?.toLowerCase() === ownerEmail);
  if (!owner) {
    throw new Error(`owner ${ownerEmail} has no auth user yet — run pnpm db:owner first`);
  }

  const rows = await get(
    `/rest/v1/household_members?select=household_id&user_id=eq.${owner.id}&limit=1`,
  );
  if (rows.length === 0) {
    throw new Error(`owner ${ownerEmail} belongs to no household — re-run pnpm db:owner`);
  }

  return rows[0].household_id;
}

async function allowlistEmail(householdId) {
  const response = await fetch(`${url}/rest/v1/allowed_emails`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ email, note: 'household member', household_id: householdId }),
  });
  if (!response.ok) {
    throw new Error(`allowlist failed (${response.status}): ${await response.text()}`);
  }
  console.log(`allowlisted ${email} into household ${householdId}`);
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

const householdId = await ownerHouseholdId();
await allowlistEmail(householdId);
await createUser();
console.log('done — the invited person can request a magic link at /login');
