#!/usr/bin/env node
/**
 * Invites a second person into the owner's household (SPEC §6.3): allowlists the e-mail
 * *already pointing at that household* and creates the auth user with a password.
 *
 * The household on the allowlist row is the whole point — `provision_user` reads it on
 * insert into auth.users, and without it the new user would land in a household of their
 * own and see an empty app.
 *
 * The password comes from MEMBER_PASSWORD when set; otherwise a strong one is generated
 * and printed once. Idempotent — safe to re-run; an existing user keeps its password.
 *
 * Reads apps/web/.env.local by default; env vars already set take precedence.
 *
 *   pnpm db:invite namorada@exemplo.com
 */

import { apiGet, createUser, findUser, readConfig } from './lib/admin.mjs';

const config = readConfig({ requireOwner: true });
const email = process.argv[2]?.trim().toLowerCase();

if (!email || !email.includes('@')) {
  console.error('Usage: pnpm db:invite <email>');
  process.exit(1);
}

/** The owner's household — the one the invited e-mail joins. */
async function ownerHouseholdId() {
  const owner = await findUser(config, config.ownerEmail);
  if (!owner) {
    throw new Error(`owner ${config.ownerEmail} has no auth user yet — run pnpm db:owner first`);
  }

  const rows = await apiGet(
    config,
    `/rest/v1/household_members?select=household_id&user_id=eq.${owner.id}&limit=1`,
  );
  if (rows.length === 0) {
    throw new Error(`owner ${config.ownerEmail} belongs to no household — re-run pnpm db:owner`);
  }

  return rows[0].household_id;
}

async function allowlistEmail(householdId) {
  const response = await fetch(`${config.url}/rest/v1/allowed_emails`, {
    method: 'POST',
    headers: { ...config.headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ email, note: 'household member', household_id: householdId }),
  });
  if (!response.ok) {
    throw new Error(`allowlist failed (${response.status}): ${await response.text()}`);
  }
  console.log(`allowlisted ${email} into household ${householdId}`);
}

const householdId = await ownerHouseholdId();
await allowlistEmail(householdId);
await createUser(config, email, { passwordFromEnv: process.env.MEMBER_PASSWORD });
console.log('done — the invited person signs in with e-mail and password at /login');
