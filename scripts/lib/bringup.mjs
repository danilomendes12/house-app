/**
 * The order the stack comes up in — written once, run in two places.
 *
 *   db + auth healthy → dump, if a migration is pending → migrations → rest, caddy, web
 *   → the API answering → the owner user.
 *
 * None of that is preference. GoTrue owns `auth.users` and creates it in its own migrations,
 * and our first migration puts a trigger on that table, so pushing before `auth` is healthy
 * fails. The dump comes before the migration because a migration applied over real data with
 * nothing behind it is the failure the whole deploy story exists to prevent — and it happens
 * *only* when something is actually pending, which is what makes two deploys in a row leave
 * no trace.
 *
 * Until Fase 13 this lived in `stack.mjs`, which ran here for `pnpm dev` and on the VM for
 * `pnpm server`. The VM no longer has Node — it is a container host with the compose files
 * and nothing else — so the script cannot run *there* any more. The order did not move: it
 * moved *here*, and the two callers differ only in the runner they pass.
 *
 * A runner answers where each primitive lands:
 *
 *   compose(args)     docker compose, here or on the VM over SSH
 *   isFresh()         whether the Postgres volume is about to be created
 *   dump(label, keep) how this installation takes a backup, or null where it owes none
 *   withDb(fn)        hands `fn` a Postgres URL: loopback here, an SSH tunnel for the VM
 *   withApi(fn)       the same for the Supabase API, with that installation's own keys
 *
 * The Supabase CLI and the provisioning scripts stay right here in both cases. They are
 * tools, and tools run on the machine you are typing on.
 */

import { resolve } from 'node:path';

import { psqlQuery } from './db.mjs';
import {
  createCompose,
  fail,
  migrationVersions,
  ports,
  repoRoot,
  run,
  sleep,
  step,
} from './proc.mjs';
import { createRemoteCompose, inDeployDir, ssh, sshCapture, withTunnel } from './remote.mjs';

/**
 * The migrations this checkout carries that the database has not seen.
 *
 * `null` when the ledger cannot be read at all, which on a fresh volume means "all of
 * them" and is handled by the caller as such. Used for one decision only: whether a deploy
 * is about to change the schema, and therefore whether it owes the database a dump first.
 */
export function pendingMigrations(compose) {
  const applied = psqlQuery(compose, 'select version from supabase_migrations.schema_migrations');
  if (applied === null) return null;
  const seen = new Set(applied.split('\n').filter(Boolean));
  return migrationVersions().filter((version) => !seen.has(version));
}

function backupBeforeMigrations(runner) {
  const pending = pendingMigrations(runner.compose);
  if (!pending || pending.length === 0) return;

  step(`${pending.length} migration(s) pendente(s) — dump antes de aplicar…`);
  if (runner.dump('pre-deploy', 7) !== 0) {
    fail('Não consegui tirar o dump antes da migration — parando aqui.');
  }
}

/**
 * The Supabase CLI stays the only owner of the schema (CLAUDE.md), and it runs from this
 * checkout in both cases — against 127.0.0.1 for the local stack, and against the near end
 * of an SSH tunnel for the VM's.
 *
 * `sslmode=disable` is honest either way: the Postgres in compose speaks no TLS, and the
 * connection never travels unprotected — locally it does not leave the machine, and
 * remotely SSH is the encryption. The seed only runs on a fresh database; re-applying it on
 * every boot would duplicate rows the moment seed.sql stops being comments.
 */
async function pushMigrations(runner, fresh) {
  step(fresh ? 'Aplicando migrations e seed…' : 'Aplicando as migrations novas…');

  await runner.withDb((dbUrl) => {
    const args = ['exec', 'supabase', 'db', 'push', '--db-url', dbUrl, '--yes'];
    if (fresh) args.push('--include-seed');

    const pushed = run('pnpm', args, { cwd: repoRoot, stdio: 'inherit' });
    if (pushed.status !== 0) fail('supabase db push falhou.');
  });
}

/** One read through PostgREST with the service role. `null` when the API is not answering. */
export async function apiQuery({ url, serviceRoleKey }, path) {
  try {
    const response = await fetch(`${url}${path}`, {
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
      signal: AbortSignal.timeout(10000),
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/**
 * The first read through the API, retried until it answers.
 *
 * This is the readiness gate for `rest`, which cannot have a Docker healthcheck: the
 * linux/amd64 PostgREST image contains one executable and it is not a shell (see
 * deploy/docker-compose.yml). Waiting here is the better gate anyway — it goes caddy →
 * rest → db with a real key, over the same path the app uses, instead of opening a port
 * inside the container. What it waits out is PostgREST connecting and loading its schema
 * cache, a couple of seconds on this database.
 *
 * `null` after the deadline means the API never answered, which is the caller's failure.
 */
async function waitForApi(api, path, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const rows = await apiQuery(api, path);
    if (rows !== null) return rows;
    if (Date.now() >= deadline) return null;
    await sleep(2000);
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
async function ensureOwner(runner, owner) {
  await runner.withApi(async (api) => {
    step('Esperando a API responder…');
    const households = await waitForApi(api, '/rest/v1/households?select=id&limit=1');
    if (households === null) fail(`A API não respondeu. Veja: ${runner.logsHint}`);
    if (households.length > 0) return;

    const email = owner ?? process.env.OWNER_EMAIL?.trim().toLowerCase();
    if (!email) fail(runner.ownerHint);

    step('Provisionando o usuário dono…');
    const result = run('node', [resolve(repoRoot, 'scripts/create-owner.mjs'), email], {
      cwd: repoRoot,
      stdio: 'inherit',
      // Passed explicitly, not left to any deploy/.env: the file's SUPABASE_URL is only the
      // default for running these scripts by hand, and here the address is either a port
      // this run chose or the near end of a tunnel. Letting a file win sends the right key
      // to the wrong stack, and the symptom is a bare 401.
      env: {
        ...process.env,
        SUPABASE_URL: api.url,
        SUPABASE_SERVICE_ROLE_KEY: api.serviceRoleKey,
      },
    });
    if (result.status !== 0) fail('Não consegui provisionar o usuário dono.');
  });
}

/** db + auth → dump → migrations → the rest → owner. The whole install, in order. */
export async function bringUp(runner, { owner = null } = {}) {
  const fresh = runner.isFresh();

  step('Subindo db e auth…');
  if (runner.compose(['up', '-d', '--wait', 'db', 'auth']).status !== 0) {
    fail(`db/auth não ficaram saudáveis. Veja: ${runner.logsHint}`);
  }

  if (!fresh && runner.dump) backupBeforeMigrations(runner);
  await pushMigrations(runner, fresh);

  step(runner.withApp ? 'Subindo rest, caddy e web…' : 'Subindo rest e caddy…');
  const rest = runner.withApp
    ? ['--profile', 'web', 'up', '-d', '--wait', ...(runner.buildsApp ? ['--build'] : [])]
    : ['up', '-d', '--wait'];
  if (runner.compose(rest).status !== 0) {
    fail(`A stack não subiu saudável. Veja: ${runner.logsHint}`);
  }

  await ensureOwner(runner, owner);
}

/**
 * The stack on this machine.
 *
 * `server` is what the installation's own deploy/.env says (DEPLOY_TARGET). It is false on
 * a laptop, and the VM is no longer a checkout at all — so the branch that builds the app
 * image here is what `pnpm stack prod` exercises, not what production does. Production
 * pulls a tag the CI built (`remoteRunner`).
 */
export function localRunner(env, { server }) {
  const compose = createCompose(server);

  return {
    compose,
    isFresh: () => run('docker', ['volume', 'inspect', 'financas_db-data']).status !== 0,
    // A laptop owes its toy database no dump before a migration; a server does.
    dump: server
      ? (label, keep) =>
          run(
            'node',
            [resolve(repoRoot, 'scripts/db-backup.mjs'), '--label', label, '--keep', String(keep)],
            { cwd: repoRoot, stdio: 'inherit' },
          ).status
      : null,
    withApp: server,
    buildsApp: server,
    withDb: (fn) =>
      fn(
        `postgresql://postgres:${encodeURIComponent(env.POSTGRES_PASSWORD)}@127.0.0.1:${ports.db}/postgres?sslmode=disable`,
      ),
    withApi: (fn) =>
      fn({
        url: `http://127.0.0.1:${ports.api}`,
        serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      }),
    logsHint: 'pnpm stack logs',
    ownerHint:
      'Instalação nova: diga com qual e-mail você vai entrar.\n' +
      '  OWNER_EMAIL=voce@exemplo.com pnpm dev\n' +
      '\nSó desta vez — depois disso o dono está no banco e a variável não é mais lida.',
  };
}

/**
 * The stack on the VM, driven from here.
 *
 * `remoteEnv` is the VM's own deploy/.env, read over SSH by the caller and held in memory:
 * the production password and service-role key are used from there and never copied down.
 * The two `with*` functions are where the SSH tunnel opens and closes.
 */
export function remoteRunner(config, remoteEnv) {
  return {
    compose: createRemoteCompose(config),
    isFresh: () => sshCapture(config, 'docker volume inspect financas_db-data').status !== 0,
    // The same shell script the nightly timer runs, with the same pg_dump flags: one
    // format, whoever asks for it.
    dump: (label, keep) =>
      ssh(config, inDeployDir(config, `./backup.sh --label ${label} --keep ${keep}`)).status,
    withApp: true,
    buildsApp: false,
    withDb: (fn) =>
      withTunnel(config, Number(remoteEnv.POSTGRES_PORT ?? 5432), (port) =>
        fn(
          `postgresql://postgres:${encodeURIComponent(remoteEnv.POSTGRES_PASSWORD)}@127.0.0.1:${port}/postgres?sslmode=disable`,
        ),
      ),
    withApi: (fn) =>
      withTunnel(config, Number(remoteEnv.SUPABASE_API_PORT ?? 8000), (port) =>
        fn({
          url: `http://127.0.0.1:${port}`,
          serviceRoleKey: remoteEnv.SUPABASE_SERVICE_ROLE_KEY,
        }),
      ),
    logsHint: 'pnpm server logs',
    ownerHint:
      'Diga com qual e-mail você vai entrar — é a única coisa que uma instalação fechada\n' +
      'não decide sozinha (SPEC §12):\n\n  pnpm server init --owner voce@exemplo.com',
  };
}
