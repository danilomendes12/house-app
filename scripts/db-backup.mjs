#!/usr/bin/env node
/**
 * Dumps the database. One script, three jobs:
 *
 *   pnpm db:dump                          # the stack you are pointed at, into deploy/backups/
 *   pnpm db:dump --label daily --keep 7   # what the systemd timer runs on the VM
 *   pnpm db:dump --remote                 # dump on the VM and bring a copy back here
 *
 * They are the same job on purpose. The dump that migrates your laptop's real data to the
 * new server, the one taken before every migration, and the nightly one all have to be
 * restorable by the same `pnpm db:restore` — a backup format that only one of the three
 * produces is a backup you find out about during the restore.
 *
 * Options:
 *   --label <name>   groups dumps and scopes the pruning (default: manual)
 *   --keep <n>       keep the n newest dumps *of this label*; older ones are deleted
 *   --out <file>     write here instead of deploy/backups/<label>-<timestamp>.dump
 *   --remote         run on the VM over SSH
 *   --no-download    with --remote, leave the dump there instead of copying it here
 */

import { createReadStream, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { dumpTo, pipeIntoCapturing } from './lib/db.mjs';
import {
  backupDir,
  createCompose,
  ensureDocker,
  fail,
  isServerInstall,
  ok,
  readInstallEnv,
  step,
} from './lib/proc.mjs';
import { inRepo, readDeployConfig, scpDown, sshCapture } from './lib/remote.mjs';

function parseArgs(argv) {
  const options = { label: 'manual', keep: null, out: null, remote: false, download: true };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--remote') options.remote = true;
    else if (arg === '--no-download') options.download = false;
    else if (arg === '--label') options.label = argv[(index += 1)];
    else if (arg === '--keep') options.keep = Number(argv[(index += 1)]);
    else if (arg === '--out') options.out = argv[(index += 1)];
    else fail(`Opção desconhecida: ${arg}`);
  }

  if (!options.label || !/^[a-z0-9-]+$/.test(options.label)) {
    fail('--label aceita apenas letras minúsculas, números e hífen.');
  }
  if (options.keep !== null && (!Number.isInteger(options.keep) || options.keep < 1)) {
    fail('--keep espera um inteiro >= 1.');
  }
  return options;
}

/** `2026-08-15_031200` — sorts chronologically as plain text, which is what the pruning uses. */
function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

function dumpsWithLabel(directory, label) {
  return readdirSync(directory)
    .filter((name) => name.startsWith(`${label}-`) && name.endsWith('.dump'))
    .sort();
}

/**
 * Keeps the n newest dumps *of this label*.
 *
 * Per label, not per directory: the nightly dumps and the ones taken before a migration
 * share a folder, and a single global count would let a busy deploy afternoon evict every
 * night of history.
 */
function prune(directory, label, keep) {
  const files = dumpsWithLabel(directory, label);
  const doomed = files.slice(0, Math.max(0, files.length - keep));
  for (const name of doomed) rmSync(resolve(directory, name));
  if (doomed.length > 0) {
    step(`Removidos ${doomed.length} dump(s) antigos de "${label}" (mantendo ${keep}).`);
  }
}

/**
 * Reads the archive's table of contents.
 *
 * Cheap, and it is the difference between a backup and a file. A dump truncated by a full
 * disk or a container killed mid-write still looks fine in `ls`; pg_restore --list is what
 * notices, now, instead of during the restore you needed it for.
 */
async function verify(isServer, path) {
  const { code, stdout } = await pipeIntoCapturing(
    isServer,
    ['pg_restore', '--list'],
    createReadStream(path),
  );
  if (code !== 0) {
    rmSync(path, { force: true });
    fail(`O dump saiu ilegível e foi descartado: ${path}`);
  }
  return stdout.split('\n').filter((line) => line && !line.startsWith(';')).length;
}

function humanSize(path) {
  const bytes = statSync(path).size;
  return bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function dumpHere(options) {
  await ensureDocker();
  const env = readInstallEnv();
  const isServer = isServerInstall(env);
  const compose = createCompose(isServer);

  if (compose(['ps', '-q', 'db'], { stdio: ['ignore', 'pipe', 'pipe'] }).stdout.trim() === '') {
    fail('O container `db` não está de pé — suba a stack antes (pnpm stack up).');
  }

  const directory = options.out ? null : backupDir(env);
  if (directory) mkdirSync(directory, { recursive: true });

  const target = options.out
    ? resolve(process.cwd(), options.out)
    : resolve(directory, `${options.label}-${timestamp()}.dump`);

  // Written under a partial name and renamed at the end: a dump interrupted halfway never
  // gets a name that `--latest` would pick up.
  const partial = `${target}.partial`;
  step(`Dump de public + auth + supabase_migrations → ${basename(target)}`);

  const code = await dumpTo(isServer, partial);
  if (code !== 0) {
    rmSync(partial, { force: true });
    fail('pg_dump falhou.');
  }
  renameSync(partial, target);

  const objects = await verify(isServer, target);
  ok(`${basename(target)} — ${humanSize(target)}, ${objects} objetos`);

  if (directory && options.keep) prune(directory, options.label, options.keep);

  // Machine-readable last line: --remote greps it to know what to copy down.
  console.log(`wrote ${target}`);
  return target;
}

async function dumpOnServer(options) {
  const config = readDeployConfig();
  const flags = ['--label', options.label];
  if (options.keep) flags.push('--keep', String(options.keep));

  step(`Dump na VM (${config.host})…`);
  const result = sshCapture(
    config,
    inRepo(config, `node scripts/db-backup.mjs ${flags.join(' ')}`),
  );
  process.stdout.write(result.stdout ?? '');
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? '');
    fail('O dump na VM falhou.');
  }

  const remotePath = (result.stdout.match(/^wrote (.+)$/m) ?? [])[1];
  if (!remotePath) fail('A VM não disse onde gravou o dump.');

  if (!options.download) return remotePath;

  const directory = backupDir();
  mkdirSync(directory, { recursive: true });
  const localPath = resolve(directory, basename(remotePath));

  step(`Trazendo uma cópia para ${basename(localPath)}…`);
  if (scpDown(config, remotePath, localPath).status !== 0) {
    fail('Não consegui copiar o dump da VM.');
  }
  ok(`cópia local em ${localPath}`);
  return localPath;
}

const options = parseArgs(process.argv.slice(2));
await (options.remote ? dumpOnServer(options) : dumpHere(options));
