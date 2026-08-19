#!/usr/bin/env node
/**
 * Resets someone's password. This is the whole "forgot my password" story: the app has no
 * recovery flow on purpose (it would need SMTP back, which Fase 9 removed), so whoever has
 * access to the server resets it here.
 *
 * With NEW_PASSWORD set, uses it; otherwise generates a strong one and prints it once.
 * Passing the password as an argument is deliberately not supported — it would land in the
 * shell history.
 *
 *   pnpm db:password namorada@exemplo.com
 *   pnpm db:password --remote namorada@exemplo.com   # against the VM, over an SSH tunnel
 *   NEW_PASSWORD='...' pnpm db:password namorada@exemplo.com
 */

import {
  announcePassword,
  findUser,
  firstArgument,
  generatePassword,
  withAdminConfig,
} from './lib/admin.mjs';

const argv = process.argv.slice(2);
const email = firstArgument(argv)?.trim().toLowerCase();

if (!email || !email.includes('@')) {
  console.error('Usage: pnpm db:password [--remote] <email>');
  process.exit(1);
}

await withAdminConfig(argv, async (config) => {
  const user = await findUser(config, email);
  if (!user) {
    console.error(`no auth user for ${email} — run pnpm db:owner or pnpm db:invite first`);
    process.exit(1);
  }

  const fromEnv = process.env.NEW_PASSWORD;
  const password = fromEnv || generatePassword();

  const response = await fetch(`${config.url}/auth/v1/admin/users/${user.id}`, {
    method: 'PUT',
    headers: config.headers,
    body: JSON.stringify({ password }),
  });

  if (!response.ok) {
    const body = await response.text();
    // A password below `minimum_password_length` is the expected mistake here, and it
    // deserves the server's own sentence instead of a stack trace.
    const detail = body.match(/"msg":"([^"]+)"/)?.[1] ?? body;
    console.error(`password reset failed (${response.status}): ${detail}`);
    process.exit(1);
  }

  console.log(`password updated for ${email}`);
  if (!fromEnv) announcePassword(email, password);
});
