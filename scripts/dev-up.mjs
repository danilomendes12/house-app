#!/usr/bin/env node
/**
 * Boots the whole local stack for smoke testing, in order:
 * Docker → Supabase → apps/web/.env.local → owner user → Next dev server.
 *
 * Every step is idempotent, so re-running it after a crash is safe.
 *
 *   pnpm dev:local
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ENV_FILE = resolve(process.cwd(), 'apps/web/.env.local');
const APP_URL = 'http://localhost:3000';

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function step(message) {
  console.log(`\x1b[36m▸\x1b[0m ${message}`);
}

function fail(message) {
  console.error(`\x1b[31m✗\x1b[0m ${message}`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

async function ensureDocker() {
  if (run('docker', ['info']).status === 0) return;

  if (process.platform !== 'darwin') {
    fail('Docker is not running. Start it and try again.');
  }

  step('Docker is down — starting Docker Desktop…');
  run('open', ['-a', 'Docker']);

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(3000);
    if (run('docker', ['info']).status === 0) return;
  }
  fail('Docker did not come up in 90s. Start Docker Desktop manually and try again.');
}

function ensureSupabase() {
  if (run('pnpm', ['exec', 'supabase', 'status']).status === 0) {
    step('Supabase already running.');
    return;
  }

  step('Starting Supabase (first run downloads images, be patient)…');
  const started = run('pnpm', ['exec', 'supabase', 'start'], { stdio: 'inherit' });
  if (started.status !== 0) fail('supabase start failed.');
}

/** Local credentials printed by the CLI, as a plain object. */
function supabaseEnv() {
  const result = run('pnpm', ['exec', 'supabase', 'status', '-o', 'env']);
  if (result.status !== 0) fail('Could not read the local Supabase credentials.');

  return Object.fromEntries(
    result.stdout
      .split('\n')
      .map((line) => line.match(/^([A-Z0-9_]+)="(.*)"$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value]),
  );
}

function ensureEnvFile(credentials) {
  if (existsSync(ENV_FILE)) return;

  const ownerEmail = process.env.OWNER_EMAIL;
  if (!ownerEmail) {
    fail(
      'apps/web/.env.local does not exist. Re-run with the e-mail you want to sign in with:\n' +
        '  OWNER_EMAIL=voce@exemplo.com pnpm dev:local',
    );
  }

  step('Writing apps/web/.env.local with the local Supabase credentials…');
  writeFileSync(
    ENV_FILE,
    [
      '# Local development (supabase start). Not committed.',
      `NEXT_PUBLIC_SUPABASE_URL=${credentials.API_URL}`,
      `NEXT_PUBLIC_SUPABASE_ANON_KEY=${credentials.ANON_KEY}`,
      `SUPABASE_SERVICE_ROLE_KEY=${credentials.SERVICE_ROLE_KEY}`,
      '',
      '# Change this to the e-mail you want to sign in with.',
      `OWNER_EMAIL=${ownerEmail}`,
      '',
    ].join('\n'),
  );
}

/**
 * Refuses to run against anything but the local stack: this script provisions users and
 * is meant for smoke tests, so it must never touch a hosted project by accident.
 */
function assertLocalTarget() {
  process.loadEnvFile(ENV_FILE);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url)) {
    fail(
      `apps/web/.env.local points at ${url || '(empty)'}, not the local stack.\n` +
        'Point it back at http://127.0.0.1:54321 before running smoke tests.',
    );
  }
}

function ensureOwner() {
  step('Provisioning the owner user…');
  const result = run('node', ['scripts/create-owner.mjs'], { stdio: 'inherit' });
  if (result.status !== 0) fail('Could not provision the owner user.');
}

function startDevServer(credentials) {
  console.log(
    [
      '',
      '\x1b[32m✓ stack up\x1b[0m',
      `  app     ${APP_URL}`,
      `  e-mails ${credentials.MAILPIT_URL}   (o magic link cai aqui)`,
      `  studio  ${credentials.STUDIO_URL}`,
      '',
      '  Ctrl+C encerra o Next. O Supabase segue de pé — use `pnpm exec supabase stop`.',
      '',
    ].join('\n'),
  );

  const dev = spawn('pnpm', ['--filter', '@finance/web', 'dev'], { stdio: 'inherit' });
  dev.on('exit', (code) => process.exit(code ?? 0));
}

await ensureDocker();
ensureSupabase();
const credentials = supabaseEnv();
ensureEnvFile(credentials);
assertLocalTarget();
ensureOwner();
startDevServer(credentials);
