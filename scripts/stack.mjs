#!/usr/bin/env node
/**
 * The one way to run this project on this machine.
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
 * it is the same sequence the server follows: secrets → db + auth → migrations → the rest →
 * owner user. The database survives in a named volume.
 *
 * Only the services run in Docker *here*. Next runs on the host, on purpose: a bind mount
 * on macOS makes hot reload noticeably slower, and the app is the one piece that has no
 * business being pinned to an image while you are writing it. `pnpm stack prod` is how you
 * check that the image that will ship still boots.
 *
 * The order `up` follows is not in this file: it is `lib/bringup.mjs`, and `pnpm server`
 * runs the very same sequence against the VM with a different runner. Until Fase 13 this
 * script ran on the VM too; now the VM has no Node, so what crossed over was the module
 * and not the script.
 */

import { spawn } from 'node:child_process';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { apiQuery, bringUp, localRunner } from './lib/bringup.mjs';
import {
  allProfiles,
  createCompose,
  ensureDocker,
  envFile,
  fail,
  isListening,
  isServerInstall,
  ports,
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

const { web: webPort, api: apiPort, db: dbPort, studio: studioPort } = ports;

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

/** The owner's e-mail, for the banner. Written by `db:owner`, read from the database. */
async function ownerEmail(env) {
  const rows = await apiQuery(
    { url: `http://127.0.0.1:${apiPort}`, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY },
    '/rest/v1/allowed_emails?select=email&note=eq.owner&limit=1',
  );
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

/** Brings up db → migrations → the rest → owner. The whole install, in order — in bringup.mjs. */
async function up() {
  await ensureDocker();
  const env = ensureEnv();
  dropStaleWebEnv();
  assertPortsFree();

  await bringUp(localRunner(env, { server }));
  return env;
}

async function banner(env, lastLine) {
  const domain = readEnvFile(envFile).DOMAIN;
  console.log(
    [
      '',
      '\x1b[32m✓ stack up\x1b[0m',
      `  app     ${server && domain ? `https://${domain}/financial` : `http://localhost:${webPort}/financial`}`,
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
    await fetch(`http://localhost:${webPort}/financial/login`, {
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
