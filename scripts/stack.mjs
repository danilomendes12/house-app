#!/usr/bin/env node
/**
 * The one way to run this project — here and on the server.
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
 * it is the same sequence a server follows: secrets → db + auth → migrations → the rest →
 * owner user. The database survives in a named volume.
 *
 * Only the services run in Docker *here*. Next runs on the host, on purpose: a bind mount
 * on macOS makes hot reload noticeably slower, and the app is the one piece that has no
 * business being pinned to an image while you are writing it. `pnpm stack prod` is how you
 * check that the image that will ship still boots.
 *
 * On the VM this same script is what runs (`pnpm server` drives it over SSH), and `up`
 * gains three things — all of them read from the installation's own deploy/.env, so there
 * is no flag to remember at 2am:
 *
 *   * the docker-compose.server.yml override, which publishes 80/443 and requires DOMAIN;
 *   * the `web` container as a first-class service, built and waited on like the rest;
 *   * a dump before applying migrations, and only when there are migrations to apply.
 */

import { spawn } from 'node:child_process';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { psqlQuery } from './lib/db.mjs';
import {
  allProfiles,
  createCompose,
  ensureDocker,
  envFile,
  fail,
  isListening,
  isServerInstall,
  migrationVersions,
  readEnvFile,
  repoRoot,
  run,
  step,
} from './lib/proc.mjs';

const typesFile = resolve(repoRoot, 'apps/web/lib/supabase/database.types.ts');
// Pre-Fase 10 leftover: env used to be duplicated here. Next still reads it if it exists,
// which would silently point the app at a stack that no longer runs.
const staleWebEnv = resolve(repoRoot, 'apps/web/.env.local');

const [command = 'dev', ...args] = process.argv.slice(2);

const webPort = process.env.WEB_PORT ?? '3000';
const apiPort = process.env.SUPABASE_API_PORT ?? '8000';
const dbPort = process.env.POSTGRES_PORT ?? '5432';
const studioPort = process.env.STUDIO_PORT ?? '54323';

// Whether this checkout *is* the server. Re-read after ensureEnv, because on a brand new VM
// the file that answers this is written moments before the first compose call.
let server = existsSync(envFile) && isServerInstall(readEnvFile(envFile));
const runCompose = (composeArgs, options) => createCompose(server)(composeArgs, options);

/**
 * deploy/.env, generated on the first run and never again — it is the only env file in the
 * repository, and regenerating it would orphan the database it configures. It holds
 * secrets and ports, nothing else: who the owner is lives in the database.
 */
function ensureEnv() {
  if (!existsSync(envFile)) {
    step('Generating deploy/.env…');
    const generated = run('node', [resolve(repoRoot, 'scripts/gen-secrets.mjs'), envFile]);
    if (generated.status !== 0) fail(generated.stderr || 'gen-secrets.mjs failed.');
  }

  const env = readEnvFile(envFile);
  server = isServerInstall(env);
  return env;
}

/** Whether the Postgres volume already exists — i.e. this is not a first boot. */
function databaseExists() {
  return run('docker', ['volume', 'inspect', 'financas_db-data']).status === 0;
}

/** Ports already published by this stack's own containers — a re-run reuses them. */
function ownPublishedPorts() {
  const result = runCompose(['ps', '--format', 'json'], { stdio: ['ignore', 'pipe', 'pipe'] });
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
 * The migrations this checkout carries that the database has not seen.
 *
 * `null` when the ledger cannot be read at all, which on a fresh volume means "all of
 * them" and is handled by the caller as such. Used for one decision only: whether a deploy
 * is about to change the schema, and therefore whether it owes the database a dump first.
 */
function pendingMigrations() {
  const applied = psqlQuery(
    runCompose,
    'select version from supabase_migrations.schema_migrations',
  );
  if (applied === null) return null;
  const seen = new Set(applied.split('\n').filter(Boolean));
  return migrationVersions().filter((version) => !seen.has(version));
}

/**
 * A migration applied over real data with no dump behind it is the failure this whole phase
 * exists to prevent. Only on the server, and only when something is actually pending — so
 * two deploys in a row without a new commit leave no trace, which is what makes `pnpm
 * server` safe to run twice.
 */
function backupBeforeMigrations() {
  const pending = pendingMigrations();
  if (!pending || pending.length === 0) return;

  step(`${pending.length} migration(s) pendente(s) — dump antes de aplicar…`);
  const dumped = run(
    'node',
    [resolve(repoRoot, 'scripts/db-backup.mjs'), '--label', 'pre-deploy', '--keep', '7'],
    { cwd: repoRoot, stdio: 'inherit' },
  );
  if (dumped.status !== 0) fail('Não consegui tirar o dump antes da migration — parando aqui.');
}

/**
 * The Supabase CLI stays the only owner of the schema (CLAUDE.md), so the migrations are
 * pushed from here over the loopback port instead of by some second runner inside compose.
 *
 * `sslmode=disable`: the Postgres in compose speaks no TLS, and the connection never leaves
 * the machine — on the VM this port is published on 127.0.0.1 only, which is also how
 * remote migrations reach it, through an SSH tunnel. The seed only runs on a fresh database
 * — re-applying it on every boot would duplicate rows the moment seed.sql stops being
 * comments.
 */
function pushMigrations(env, fresh) {
  step(fresh ? 'Applying migrations and seed…' : 'Applying new migrations…');

  const pushArgs = ['exec', 'supabase', 'db', 'push', '--db-url', dbUrl(env), '--yes'];
  if (fresh) pushArgs.push('--include-seed');

  const pushed = run('pnpm', pushArgs, { cwd: repoRoot, stdio: 'inherit' });
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

  if (server && !fresh) backupBeforeMigrations();
  pushMigrations(env, fresh);

  // On the server the app is one of the services: built from the commit that is checked out
  // there and waited on like everything else, so a deploy that ships a broken image fails
  // here instead of in the browser.
  step(server ? 'Building the app and starting rest, caddy and web…' : 'Starting rest and caddy…');
  const rest = server
    ? ['--profile', 'web', 'up', '-d', '--wait', '--build']
    : ['up', '-d', '--wait'];
  if (runCompose(rest).status !== 0) {
    fail('The stack did not come up healthy. Check: pnpm stack logs');
  }

  await ensureOwner(env);
  return env;
}

async function banner(env, lastLine) {
  const domain = readEnvFile(envFile).DOMAIN;
  console.log(
    [
      '',
      '\x1b[32m✓ stack up\x1b[0m',
      `  app     ${server && domain ? `https://${domain}` : `http://localhost:${webPort}`}`,
      `  login   ${await ownerEmail(env)} + senha (pnpm db:password <email> gera outra)`,
      ...(server ? [] : ['  studio  pnpm stack studio']),
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
  if (server) {
    fail(
      'Esta instalação é o servidor (DEPLOY_TARGET=server em deploy/.env).\n' +
        'Aqui o app roda em container, não com hot reload: use `pnpm stack up`.',
    );
  }

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
      await banner(
        env,
        server
          ? 'Tudo em container. `pnpm server logs` daqui, `pnpm stack logs` aí dentro.'
          : 'Rode `pnpm dev` para subir o Next com hot reload.',
      );
      return;
    }

    case 'down':
      await ensureDocker();
      step('Stopping the stack (the data stays)…');
      runCompose([...allProfiles, 'down']);
      return;

    case 'reset':
      await ensureDocker();
      step('Stopping the stack and destroying the database…');
      runCompose([...allProfiles, 'down', '-v']);
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
      if (runCompose(['--profile', 'web', 'up', '-d', '--wait', '--build']).status !== 0) {
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
      runCompose([...allProfiles, 'logs', '-f', ...args]);
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
          '',
          '  pnpm server             # o mesmo, na VM (docs/DEPLOY.md)',
        ].join('\n'),
      );
  }
}

await main();
