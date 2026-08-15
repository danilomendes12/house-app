#!/usr/bin/env node
/**
 * The one way to run this project.
 *
 *   pnpm dev                # the everyday command: stack up, then Next with hot reload
 *   pnpm stack up           # only the stack (Postgres + GoTrue + PostgREST + Caddy)
 *   pnpm stack down         # stop it (the data stays in the named volume)
 *   pnpm stack reset        # stop it and destroy the database
 *   pnpm stack studio       # database UI on http://127.0.0.1:54323
 *   pnpm stack prod         # run the app's production build in Docker instead of `next dev`
 *   pnpm stack logs [svc]   # follow the logs
 *   pnpm stack types        # regenerate apps/web/lib/supabase/database.types.ts
 *
 * `up` is idempotent from any state — a re-run after a crash resumes where it stopped, and
 * it is the same sequence a server would follow: secrets → db + auth → migrations → the
 * rest → owner user. The database survives in a named volume.
 *
 * Only the services run in Docker. Next runs on the host, on purpose: a bind mount on
 * macOS makes hot reload noticeably slower, and the app is the one piece that has no
 * business being pinned to an image while you are writing it. `pnpm stack prod` is how you
 * check that the image that will ship still boots.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const deployDir = resolve(repoRoot, 'deploy');
const envFile = resolve(deployDir, '.env');
const dbVolume = 'financas_db-data';
const typesFile = resolve(repoRoot, 'apps/web/lib/supabase/database.types.ts');
// Pre-Fase 10 leftover: env used to be duplicated here. Next still reads it if it exists,
// which would silently point the app at a stack that no longer runs.
const staleWebEnv = resolve(repoRoot, 'apps/web/.env.local');

const [command = 'dev', ...args] = process.argv.slice(2);

const webPort = process.env.WEB_PORT ?? '3000';
const apiPort = process.env.SUPABASE_API_PORT ?? '8000';
const dbPort = process.env.POSTGRES_PORT ?? '5432';
const studioPort = process.env.STUDIO_PORT ?? '54323';

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function runCompose(args, options = {}) {
  return run('docker', ['compose', ...args], { cwd: deployDir, stdio: 'inherit', ...options });
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

/** The `KEY=value` pairs of an env file, without touching process.env. */
function readEnvFile(path) {
  const entries = readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map(([, key, value]) => [key, value.trim()]);
  return Object.fromEntries(entries);
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

/**
 * deploy/.env, generated on the first run and never again — it is the only env file in the
 * repository, and regenerating it would orphan the database it configures. It holds
 * secrets and ports, nothing else: who the owner is lives in the database.
 */
function ensureEnv() {
  if (existsSync(envFile)) return readEnvFile(envFile);

  step('Generating deploy/.env…');
  const generated = run('node', [resolve(repoRoot, 'scripts/gen-secrets.mjs'), envFile]);
  if (generated.status !== 0) fail(generated.stderr || 'gen-secrets.mjs failed.');

  return readEnvFile(envFile);
}

/** Whether the Postgres volume already exists — i.e. this is not a first boot. */
function databaseExists() {
  return run('docker', ['volume', 'inspect', dbVolume]).status === 0;
}

/** Ports already published by this stack's own containers — a re-run reuses them. */
function ownPublishedPorts() {
  const result = run('docker', ['compose', 'ps', '--format', 'json'], { cwd: deployDir });
  if (result.status !== 0) return new Set();

  const ports = new Set();
  for (const line of result.stdout.trim().split('\n').filter(Boolean)) {
    try {
      for (const publisher of JSON.parse(line).Publishers ?? []) {
        if (publisher.PublishedPort) ports.add(String(publisher.PublishedPort));
      }
    } catch {
      // A line compose did not mean as JSON; nothing to learn from it.
    }
  }
  return ports;
}

/**
 * Whether something is *listening* on the port. `-sTCP:LISTEN` is what makes this true:
 * without it lsof also reports the TIME_WAIT sockets a recent request left behind, and the
 * stack would refuse to start over a port nothing actually holds.
 */
function isListening(port) {
  return run('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN']).stdout.trim().length > 0;
}

/**
 * The two ports compose publishes on loopback, so a local Postgres collides. Compose would
 * say "address already in use" three layers deep; this says which and how. Only foreign
 * holders count — on a re-run the stack is itself the one holding them.
 */
function assertPortsFree() {
  if (process.platform === 'win32') return;

  const own = ownPublishedPorts();
  const taken = [
    [apiPort, 'a API do Supabase', 'SUPABASE_API_PORT'],
    [dbPort, 'o Postgres', 'POSTGRES_PORT'],
  ].filter(([port]) => !own.has(port) && isListening(port));

  if (taken.length === 0) return;

  fail(
    [
      'Portas ocupadas:',
      ...taken.map(
        ([port, what, variable]) =>
          `  ${port} (${what}) — libere a porta ou rode com ${variable}=<outra> pnpm dev`,
      ),
      '',
      'Se for a stack antiga da Supabase CLI, encerre com: pnpm exec supabase stop',
    ].join('\n'),
  );
}

const dbUrl = (env) =>
  `postgresql://postgres:${encodeURIComponent(env.POSTGRES_PASSWORD)}@127.0.0.1:${dbPort}/postgres?sslmode=disable`;

/**
 * The Supabase CLI stays the only owner of the schema (CLAUDE.md), so the migrations are
 * pushed from here over the loopback port instead of by some second runner inside compose.
 *
 * `sslmode=disable`: the Postgres in compose speaks no TLS, and the connection never leaves
 * the machine. The seed only runs on a fresh database — re-applying it on every boot would
 * duplicate rows the moment seed.sql stops being comments.
 */
function pushMigrations(env, fresh) {
  step(fresh ? 'Applying migrations and seed…' : 'Applying new migrations…');

  const args = ['exec', 'supabase', 'db', 'push', '--db-url', dbUrl(env), '--yes'];
  if (fresh) args.push('--include-seed');

  const pushed = run('pnpm', args, { cwd: repoRoot, stdio: 'inherit' });
  if (pushed.status !== 0) fail('supabase db push failed.');
}

/** One read through PostgREST with the service role. `null` when the API is not answering. */
async function query(env, path) {
  try {
    const response = await fetch(`http://127.0.0.1:${apiPort}${path}`, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      signal: AbortSignal.timeout(5000),
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/**
 * Names the owner, but only on an installation that has none.
 *
 * The marker is the `households` row: `provision_user` creates it when the auth user is
 * inserted, so it exists from `db:owner` onwards. Once it does, the database knows who the
 * owner is and OWNER_EMAIL is never read again — which is the point. It is a bootstrap
 * argument for the one thing a closed household cannot decide for itself (signups are off
 * and the allowlist trigger rejects everyone else), not configuration of the app.
 */
async function ensureOwner(env) {
  const households = await query(env, '/rest/v1/households?select=id&limit=1');
  if (households === null) fail('The API did not answer. Check: pnpm stack logs rest caddy');
  if (households.length > 0) return;

  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!ownerEmail) {
    fail(
      'Instalação nova: diga com qual e-mail você vai entrar.\n' +
        '  OWNER_EMAIL=voce@exemplo.com pnpm dev\n' +
        '\nSó desta vez — depois disso o dono está no banco e a variável não é mais lida.',
    );
  }

  step('Provisioning the owner user…');
  const result = run('node', [resolve(repoRoot, 'scripts/create-owner.mjs'), ownerEmail], {
    cwd: repoRoot,
    stdio: 'inherit',
    // Passed explicitly, not left to deploy/.env: SUPABASE_API_PORT is what actually
    // decides where the API is published, and the file's SUPABASE_URL is only the default
    // for running these scripts by hand. Letting the file win sends the right key to the
    // wrong stack, and the symptom is a bare 401.
    env: webEnv(env),
  });
  if (result.status !== 0) fail('Could not provision the owner user.');
}

/** The owner's e-mail, for the banner. Written by `db:owner`, read from the database. */
async function ownerEmail(env) {
  const rows = await query(env, '/rest/v1/allowed_emails?select=email&note=eq.owner&limit=1');
  return rows?.[0]?.email ?? '(o e-mail do dono)';
}

/** Everything the Next server needs, straight from deploy/.env — no second file to drift. */
function webEnv(env) {
  return {
    ...process.env,
    SUPABASE_URL: `http://127.0.0.1:${apiPort}`,
    SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

function dropStaleWebEnv() {
  if (!existsSync(staleWebEnv)) return;
  step('Removing the leftover apps/web/.env.local (env now lives only in deploy/.env)…');
  unlinkSync(staleWebEnv);
}

/** Brings up db → migrations → the rest → owner. The whole install, in order. */
async function up() {
  await ensureDocker();
  const env = ensureEnv();
  dropStaleWebEnv();
  const fresh = !databaseExists();
  assertPortsFree();

  // GoTrue owns auth.users and creates it in its own migrations; our first migration puts a
  // trigger on that table. Pushing before auth is healthy fails — hence the two phases.
  step('Starting db and auth…');
  if (runCompose(['up', '-d', '--wait', 'db', 'auth']).status !== 0) {
    fail('db/auth did not become healthy. Check: pnpm stack logs db');
  }

  pushMigrations(env, fresh);

  step('Starting rest and caddy…');
  if (runCompose(['up', '-d', '--wait']).status !== 0) {
    fail('The stack did not come up healthy. Check: pnpm stack logs');
  }

  await ensureOwner(env);
  return env;
}

async function banner(env, lastLine) {
  console.log(
    [
      '',
      '\x1b[32m✓ stack up\x1b[0m',
      `  app     http://localhost:${webPort}`,
      `  login   ${await ownerEmail(env)} + senha (pnpm db:password <email> gera outra)`,
      `  studio  pnpm stack studio`,
      '',
      `  ${lastLine}`,
      '',
    ].join('\n'),
  );
}

/** Whether something is already serving the app on the web port. */
async function appAlreadyServing() {
  try {
    await fetch(`http://localhost:${webPort}/login`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(2000),
    });
    return true;
  } catch {
    return false;
  }
}

async function dev() {
  const env = await up();

  // Starting a second dev server would silently land on port 3001 and then die, so bail
  // out with something readable instead.
  if (await appAlreadyServing()) {
    await banner(env, `Next já estava rodando na porta ${webPort} — nada a fazer.`);
    return;
  }
  if (isListening(webPort)) {
    fail(`A porta ${webPort} está ocupada e não responde HTTP. Libere-a e rode de novo.`);
  }

  await banner(env, 'Ctrl+C encerra o Next. A stack segue de pé — `pnpm stack down` para parar.');

  const next = spawn('pnpm', ['--filter', '@finance/web', 'dev'], {
    stdio: 'inherit',
    env: webEnv(env),
  });
  next.on('exit', (code) => process.exit(code ?? 0));
}

async function main() {
  switch (command) {
    case 'dev':
      return dev();

    case 'up': {
      const env = await up();
      await banner(env, 'Rode `pnpm dev` para subir o Next com hot reload.');
      return;
    }

    case 'down':
      await ensureDocker();
      step('Stopping the stack (the data stays)…');
      runCompose(['--profile', 'prod', '--profile', 'studio', 'down']);
      return;

    case 'reset':
      await ensureDocker();
      step('Stopping the stack and destroying the database…');
      runCompose(['--profile', 'prod', '--profile', 'studio', 'down', '-v']);
      console.log('Rode `pnpm dev` para recriar tudo do zero.');
      return;

    case 'studio':
      await up();
      step('Starting Studio…');
      if (runCompose(['--profile', 'studio', 'up', '-d', '--wait']).status !== 0) {
        fail('Studio did not come up. Check: pnpm stack logs studio');
      }
      console.log(`\n\x1b[32m✓\x1b[0m studio  http://127.0.0.1:${studioPort}\n`);
      return;

    case 'prod': {
      const env = await up();
      if (isListening(webPort) && !ownPublishedPorts().has(webPort)) {
        fail(`A porta ${webPort} está ocupada — encerre o \`pnpm dev\` antes.`);
      }
      step('Building the app image and starting it…');
      if (runCompose(['--profile', 'prod', 'up', '-d', '--wait', '--build']).status !== 0) {
        fail('The app image did not come up healthy. Check: pnpm stack logs web');
      }
      await banner(
        env,
        'Build de produção, sem hot reload — `pnpm stack prod` de novo após mudar código.',
      );
      return;
    }

    case 'logs':
      await ensureDocker();
      runCompose(['--profile', 'prod', '--profile', 'studio', 'logs', '-f', ...args]);
      return;

    case 'types': {
      await ensureDocker();
      const env = ensureEnv();
      step('Regenerating apps/web/lib/supabase/database.types.ts…');
      const generated = run(
        'pnpm',
        [
          'exec',
          'supabase',
          'gen',
          'types',
          'typescript',
          '--db-url',
          dbUrl(env),
          '--schema',
          'public',
        ],
        { cwd: repoRoot },
      );
      if (generated.status !== 0) fail(generated.stderr || 'gen types failed.');
      writeFileSync(typesFile, generated.stdout);
      console.log(`wrote ${typesFile}`);
      return;
    }

    default:
      fail(
        [
          `Comando desconhecido: ${command}`,
          '',
          '  pnpm dev                # stack + Next com hot reload',
          '  pnpm stack up|down|reset',
          '  pnpm stack studio|prod|logs|types',
        ].join('\n'),
      );
  }
}

await main();
