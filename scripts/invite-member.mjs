#!/usr/bin/env node
/**
 * Invites a second person into the household (SPEC §6.3): allowlists the e-mail *already
 * pointing at that household* and creates the auth user with a password.
 *
 * The household on the allowlist row is the whole point — `provision_user` reads it when
 * the user is inserted, and without it the new person would land in a household of their
 * own and see an empty app.
 *
 * Which household that is comes from the database (`soleHouseholdId`), not from an owner
 * e-mail kept in a config file. With more than one household it refuses to guess; pass
 * HOUSEHOLD_ID to say which.
 *
 * The password comes from MEMBER_PASSWORD when set; otherwise a strong one is generated
 * and printed once. Idempotent — safe to re-run; an existing user keeps its password.
 *
 *   pnpm db:invite namorada@exemplo.com
 */

import { createUser, readConfig, soleHouseholdId } from './lib/admin.mjs';

const config = readConfig();
const email = process.argv[2]?.trim().toLowerCase();

if (!email || !email.includes('@')) {
  console.error('Usage: pnpm db:invite <email>');
  process.exit(1);
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

const householdId = process.env.HOUSEHOLD_ID ?? (await soleHouseholdId(config));
await allowlistEmail(householdId);
await createUser(config, email, { passwordFromEnv: process.env.MEMBER_PASSWORD });
console.log('done — the invited person signs in with e-mail and password at /login');
