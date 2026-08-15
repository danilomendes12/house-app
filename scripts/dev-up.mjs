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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
  if (existsSync(ENV_FILE)) {
    migrateEnvFile();
    return;
  }

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
      `SUPABASE_URL=${credentials.API_URL}`,
      `SUPABASE_ANON_KEY=${credentials.ANON_KEY}`,
      `SUPABASE_SERVICE_ROLE_KEY=${credentials.SERVICE_ROLE_KEY}`,
      '',
      '# Change this to the e-mail you want to sign in with.',
      `OWNER_EMAIL=${ownerEmail}`,
      '',
    ].join('\n'),
  );
}

/**
 * Renames the pre-Fase 9 keys in an existing .env.local. The vars stopped being
 * `NEXT_PUBLIC_*` when the browser stopped talking to Supabase; without this the app on an
 * older checkout would just fail to boot with "Missing environment variable SUPABASE_URL".
 */
function migrateEnvFile() {
  const current = readFileSync(ENV_FILE, 'utf8');
  if (!current.includes('NEXT_PUBLIC_SUPABASE_')) return;

  step('Renaming NEXT_PUBLIC_SUPABASE_* to SUPABASE_* in apps/web/.env.local…');
  writeFileSync(ENV_FILE, current.replaceAll(/^NEXT_PUBLIC_(SUPABASE_)/gm, '$1'));
}

/**
 * Refuses to run against anything but the local stack: this script provisions users and
 * is meant for smoke tests, so it must never touch a hosted project by accident.
 */
function assertLocalTarget() {
  process.loadEnvFile(ENV_FILE);
  const url = process.env.SUPABASE_URL ?? '';
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

function banner(credentials, lastLine) {
  console.log(
    [
      '',
      '\x1b[32m✓ stack up\x1b[0m',
      `  app     ${APP_URL}`,
      `  studio  ${credentials.STUDIO_URL}`,
      `  login   ${process.env.OWNER_EMAIL ?? '(OWNER_EMAIL)'} + senha (pnpm db:password <email>)`,
      '',
      `  ${lastLine}`,
      '',
    ].join('\n'),
  );
}

/** PID holding port 3000, if any. */
function portHolder() {
  if (process.platform === 'win32') return null;
  const result = run('lsof', ['-ti', 'tcp:3000']);
  return result.stdout.trim().split('\n').filter(Boolean)[0] ?? null;
}

/** Whether something is already serving the app on port 3000. */
async function appAlreadyServing() {
  try {
    await fetch(`${APP_URL}/login`, { redirect: 'manual', signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

async function startDevServer(credentials) {
  // Starting a second dev server would silently land on port 3001 and then die, so
  // reuse whatever is already there instead.
  if (await appAlreadyServing()) {
    banner(credentials, `Next já estava rodando (PID ${portHolder() ?? '?'}) — nada a fazer.`);
    return;
  }

  const holder = portHolder();
  if (holder) {
    fail(`A porta 3000 está ocupada pelo PID ${holder} e não responde HTTP. Rode: kill ${holder}`);
  }

  banner(credentials, 'Ctrl+C encerra o Next. O Supabase segue de pé — `pnpm exec supabase stop`.');

  const dev = spawn('pnpm', ['--filter', '@finance/web', 'dev'], { stdio: 'inherit' });
  dev.on('exit', (code) => process.exit(code ?? 0));
}

await ensureDocker();
ensureSupabase();
const credentials = supabaseEnv();
ensureEnvFile(credentials);
assertLocalTarget();
ensureOwner();
await startDevServer(credentials);
