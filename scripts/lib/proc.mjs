/**
 * The plumbing every operational CLI here shares: where the repository is, how to talk to
 * docker compose, and how to say "this step" and "this failed" in one voice.
 *
 * It exists because `stack.mjs` is no longer the only script that drives the stack —
 * `db-backup.mjs`, `db-restore.mjs` and `server.mjs` drive it too, and three copies of
 * `runCompose` would be three places for the compose file list to drift.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
export const deployDir = resolve(repoRoot, 'deploy');
export const envFile = resolve(deployDir, '.env');
export const migrationsDir = resolve(repoRoot, 'supabase/migrations');

export function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

export function step(message) {
  console.log(`\x1b[36m▸\x1b[0m ${message}`);
}

export function ok(message) {
  console.log(`\x1b[32m✓\x1b[0m ${message}`);
}

export function warn(message) {
  console.log(`\x1b[33m!\x1b[0m ${message}`);
}

export function fail(message) {
  console.error(`\x1b[31m✗\x1b[0m ${message}`);
  process.exit(1);
}

export function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

/** The `KEY=value` pairs of an env file, without touching process.env. */
export function readEnvFile(path) {
  const entries = readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map(([, key, value]) => [key, value.trim()]);
  return Object.fromEntries(entries);
}

/** deploy/.env if it exists, `{}` before the first run. Never throws. */
export function readInstallEnv() {
  return existsSync(envFile) ? readEnvFile(envFile) : {};
}

/**
 * Whether this checkout *is* the server, told by its own env file.
 *
 * Written once by `gen-secrets.mjs --server` when the VM is bootstrapped, and read from
 * there instead of from a flag: you SSH into the VM and type `pnpm stack up` or
 * `pnpm stack logs` under pressure, and having to remember `--server` every time is how
 * the wrong compose file gets used at the worst moment.
 */
export function isServerInstall(env = readInstallEnv()) {
  return env.DEPLOY_TARGET === 'server';
}

/**
 * `docker compose` in deploy/, with the server override layered on when this checkout is
 * the server. The override is the whole difference between the two installations: 80/443
 * published, DOMAIN required, and the app talking to Caddy by service name.
 */
export function createCompose(isServer) {
  const files = isServer ? ['-f', 'docker-compose.yml', '-f', 'docker-compose.server.yml'] : [];
  return (args, options = {}) =>
    run('docker', ['compose', ...files, ...args], {
      cwd: deployDir,
      stdio: 'inherit',
      ...options,
    });
}

/** Every profile the stack knows, for the commands that should see all of it. */
export const allProfiles = ['--profile', 'web', '--profile', 'studio'];

/**
 * Whether something is *listening* on the port. `-sTCP:LISTEN` is what makes this true:
 * without it lsof also reports the TIME_WAIT sockets a recent request left behind, and the
 * stack would refuse to start over a port nothing actually holds.
 *
 * A bare Ubuntu VM ships no lsof, and a missing tool is not a busy port — compose still
 * refuses loudly on a real clash, so answering "free" here loses nothing.
 */
export function isListening(port) {
  const result = run('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN']);
  if (result.error) return false;
  return (result.stdout ?? '').trim().length > 0;
}

export async function ensureDocker() {
  if (run('docker', ['info']).status === 0) return;

  if (process.platform !== 'darwin') {
    fail('Docker is not running. Start it and try again: sudo systemctl start docker');
  }

  step('Docker is down — starting Docker Desktop…');
  run('open', ['-a', 'Docker']);

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(3000);
    if (run('docker', ['info']).status === 0) return;
  }
  fail('Docker did not come up in 90s. Start Docker Desktop manually and try again.');
}

/**
 * Where dumps live. Same path on both machines — `deploy/backups/` inside the checkout —
 * so the restore instructions read the same whether you are on the laptop or on the VM.
 * BACKUP_DIR overrides it when the boot volume is not where you want them.
 */
export function backupDir(env = readInstallEnv()) {
  const configured = process.env.BACKUP_DIR || env.BACKUP_DIR;
  return configured ? resolve(repoRoot, configured) : resolve(deployDir, 'backups');
}

/** The migration versions this checkout carries, oldest first (`20260803120000_x.sql`). */
export function migrationVersions() {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => name.split('_')[0])
    .sort();
}
