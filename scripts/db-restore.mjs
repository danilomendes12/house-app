#!/usr/bin/env node
/**
 * Loads a dump back into the database — the other half of `pnpm db:dump`, and the only
 * reason that one exists.
 *
 *   pnpm db:restore --latest                    # the newest dump in deploy/backups/
 *   pnpm db:restore deploy/backups/daily-….dump
 *   pnpm db:restore --remote <arquivo local>    # send this dump up and restore it there
 *   pnpm db:restore --remote --latest           # restore the VM's own newest dump, up there
 *
 * What it does, and why in this order:
 *
 *   1. reads the archive's contents, before touching anything — a dump that will not
 *      restore should be discovered while the database is still fine;
 *   2. takes a safety dump of what is about to be destroyed;
 *   3. stops auth, rest and web, so GoTrue cannot write a session into a schema that is
 *      being replaced and PostgREST cannot serve from a cache of a schema that is gone;
 *   4. drops public, auth and supabase_migrations;
 *   5. restores in a single transaction — a failure leaves nothing half-loaded;
 *   6. brings the stack back and counts the rows out loud.
 *
 * Three traps this handles, all of which fail *quietly* if ignored:
 *
 *   * `provision_user` fires on insert into auth.users and creates a household. Restoring
 *     users on top of an installation already provisioned by `db:owner` would leave two.
 *     Step 4 is the answer: there is nothing left to insert over, and a full pg_restore
 *     loads table data before it creates triggers, so nothing is attached while the rows
 *     land. This is why the restore replaces the installation instead of merging into it.
 *   * The destination signs sessions with a different JWT_SECRET, so every active session
 *     dies here. Expected — sign in again. The bcrypt hashes in auth.users are not signed
 *     by anything, so the *passwords* come across unchanged.
 *   * The roles (anon, authenticated, service_role, authenticator, supabase_auth_admin) and
 *     the extensions are not in the dump: they belong to the supabase/postgres image and to
 *     GoTrue. They must already exist, which they do on any stack that has booted once —
 *     so restore into a booted stack, never into a bare Postgres.
 */

import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { adminRole, dropSchemas, pipeInto, pipeIntoCapturing, summarize } from './lib/db.mjs';
import {
  allProfiles,
  backupDir,
  createCompose,
  ensureDocker,
  fail,
  isServerInstall,
  ok,
  readInstallEnv,
  repoRoot,
  run,
  shellQuote,
  step,
  warn,
} from './lib/proc.mjs';
import {
  createRemoteCompose,
  inDeployDir,
  readDeployConfig,
  ssh,
  sshCapture,
} from './lib/remote.mjs';

/** All or nothing: a failure halfway would leave a database that looks restored and is not. */
const restoreCommand = [
  'pg_restore',
  '-U',
  adminRole,
  '-d',
  'postgres',
  '--single-transaction',
  '--exit-on-error',
];

function parseArgs(argv) {
  const options = { file: null, latest: false, remote: false, yes: false };

  for (const arg of argv) {
    if (arg === '--latest') options.latest = true;
    else if (arg === '--remote') options.remote = true;
    else if (arg === '--yes' || arg === '-y') options.yes = true;
    else if (arg.startsWith('-')) fail(`Opção desconhecida: ${arg}`);
    else options.file = arg;
  }

  if (!options.file && !options.latest) {
    fail('Diga qual dump restaurar: `pnpm db:restore <arquivo>` ou `pnpm db:restore --latest`.');
  }
  return options;
}

/** The newest dump in deploy/backups/, whatever its label. */
function newestDump() {
  const directory = backupDir();
  if (!existsSync(directory)) fail(`Não existe ${directory} — nenhum backup foi tirado ainda.`);

  const dumps = readdirSync(directory)
    .filter((name) => name.endsWith('.dump'))
    .map((name) => resolve(directory, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

  if (dumps.length === 0) fail(`Nenhum .dump em ${directory}.`);
  return dumps[0];
}

async function confirm(question) {
  if (!process.stdin.isTTY) {
    fail('Sem terminal interativo para confirmar. Repita com --yes se é isso mesmo que você quer.');
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [digite "sim"] `);
  rl.close();
  return answer.trim().toLowerCase() === 'sim';
}

/**
 * Where the dump's bytes are, and how to feed them to a command in the `db` container.
 *
 * Two shapes, because the two useful restores are genuinely different journeys: a file on
 * this machine goes *up* the SSH connection into pg_restore's stdin, and a file already on
 * the VM never leaves it — the redirection happens up there, in one command.
 */
function fileHere(path) {
  return {
    name: basename(path),
    feed: (target, command) => pipeInto(target.compose, command, createReadStream(path)),
    feedCapturing: (target, command) =>
      pipeIntoCapturing(target.compose, command, createReadStream(path)),
  };
}

function fileOnServer(config, path) {
  const remote = (command, capture) => {
    const script = inDeployDir(
      config,
      'docker compose -f docker-compose.yml -f docker-compose.server.yml exec -T db ' +
        `${command.map(shellQuote).join(' ')} < ${path}`,
    );
    return capture ? sshCapture(config, script) : ssh(config, script);
  };

  return {
    name: basename(path),
    feed: (_target, command) => remote(command, false).status,
    feedCapturing: (_target, command) => {
      const result = remote(command, true);
      return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
    },
  };
}

/** Which stack gets replaced, and how it takes its own safety dump before that happens. */
async function localTarget() {
  await ensureDocker();
  const isServer = isServerInstall(readInstallEnv());
  return {
    compose: createCompose(isServer),
    withApp: isServer,
    what: 'o banco local',
    // The safety net for the restore itself. Cheap, and the one moment you will wish you had
    // it is the moment you restored the wrong file.
    dump: (label, keep) =>
      run(
        'node',
        [resolve(repoRoot, 'scripts/db-backup.mjs'), '--label', label, '--keep', String(keep)],
        { cwd: repoRoot, stdio: 'inherit' },
      ).status,
  };
}

function remoteTarget(config) {
  return {
    compose: createRemoteCompose(config),
    withApp: true,
    what: `o banco de PRODUÇÃO em ${config.host}`,
    // The same shell script the nightly timer runs, with the same pg_dump flags — the VM
    // has no Node to run db-backup.mjs with.
    dump: (label, keep) =>
      ssh(config, inDeployDir(config, `./backup.sh --label ${label} --keep ${keep}`)).status,
  };
}

async function restore(target, source, options) {
  if (
    target.compose(['ps', '-q', 'db'], { stdio: ['ignore', 'pipe', 'pipe'] }).stdout.trim() === ''
  ) {
    fail(
      'O container `db` não está de pé. O restore precisa de uma stack que já bootou uma vez:\n' +
        'os roles e as extensões vêm da imagem, não do dump.',
    );
  }

  step(`Conferindo ${source.name}…`);
  const listing = await source.feedCapturing(target, ['pg_restore', '--list']);
  if (listing.code !== 0) fail(`${source.name} não é um dump legível — nada foi tocado.`);
  ok(
    `${listing.stdout.split('\n').filter((line) => line && !line.startsWith(';')).length} objetos`,
  );

  const before = summarize(target.compose);
  if (before) {
    warn(
      `${target.what} tem ${before.users} usuário(s), ${before.transactions} transações e ` +
        `${before.assets} ativos. O restore substitui tudo isso.`,
    );
  }

  if (!options.yes && !(await confirm(`Substituir ${target.what} por este dump?`))) {
    fail('Cancelado — nada foi alterado.');
  }

  if (before && Number(before.users) > 0) {
    step('Dump de segurança do estado atual, antes de destruí-lo…');
    if (target.dump('pre-restore', 3) !== 0) {
      fail('Não consegui tirar o dump de segurança — parando aqui.');
    }
  }

  // With the profile enabled either way, so this reads the same whether or not `web` runs
  // here — `docker compose stop web` on a disabled profile is an error, not a no-op.
  step('Parando auth, rest e web…');
  target.compose([...allProfiles, 'stop', 'auth', 'rest', 'web'], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  step('Apagando public, auth e supabase_migrations…');
  if (dropSchemas(target.compose).status !== 0) fail('Não consegui limpar o banco.');

  step('Restaurando…');
  if ((await source.feed(target, restoreCommand)) !== 0) {
    fail(
      'pg_restore falhou e desfez tudo — o banco está vazio.\n' +
        'O dump de segurança acima ainda é válido: `pnpm db:restore --latest` volta ao estado anterior.',
    );
  }

  step('Subindo a stack de novo…');
  const up = target.withApp ? ['--profile', 'web', 'up', '-d', '--wait'] : ['up', '-d', '--wait'];
  if (target.compose(up).status !== 0) fail('A stack não voltou saudável.');

  const after = summarize(target.compose);
  if (!after) fail('Restaurei, mas não consegui ler o banco de volta.');

  ok(
    `restaurado: ${after.users} usuário(s), ${after.households} household(s), ` +
      `${after.transactions} transações, ${after.assets} ativos`,
  );
  console.log(
    [
      '',
      '  As senhas continuam valendo: o hash bcrypt veio junto no dump, e nada o assina.',
      '  Se o dump veio de outra instalação, as sessões abertas morreram — o JWT_SECRET',
      '  daqui é outro. É só entrar de novo.',
      '',
    ].join('\n'),
  );
}

/** The VM's newest dump, resolved up there — the rollback case, with nothing to transfer. */
function newestDumpOnServer(config) {
  const result = sshCapture(
    config,
    inDeployDir(config, 'ls -1t backups/*.dump 2>/dev/null | head -1'),
  );
  const path = result.stdout.trim();
  if (result.status !== 0 || !path) fail('Nenhum .dump em deploy/backups/ na VM.');
  return path;
}

const options = parseArgs(process.argv.slice(2));

if (options.remote) {
  const config = readDeployConfig();
  // The local file is checked before anything else: no point starting a restore of a file
  // that is not there.
  const local = options.file ? resolve(process.cwd(), options.file) : null;
  if (local && !existsSync(local)) fail(`Não achei ${local}.`);

  const source = local ? fileHere(local) : fileOnServer(config, newestDumpOnServer(config));
  await restore(remoteTarget(config), source, options);
} else {
  const file = options.latest ? newestDump() : resolve(process.cwd(), options.file);
  if (!existsSync(file)) fail(`Não achei ${file}.`);
  await restore(await localTarget(), fileHere(file), options);
}
