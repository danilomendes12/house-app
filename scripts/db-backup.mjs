#!/usr/bin/env node
/**
 * Dumps the database. One script, three jobs:
 *
 *   pnpm db:dump                          # the stack on this machine, into deploy/backups/
 *   pnpm db:dump --label daily --keep 7   # the shape the nightly dump has (see below)
 *   pnpm db:dump --remote                 # dump the VM's database, straight into a file here
 *
 * They are the same job on purpose. The dump that migrates your laptop's real data to the
 * new server, the one taken before every migration, and the nightly one all have to be
 * restorable by the same `pnpm db:restore` — a backup format that only one of the three
 * produces is a backup you find out about during the restore. The flags live in one place,
 * `dumpCommand` in lib/db.mjs; `deploy/backup.sh`, which is what the VM's systemd timer
 * runs because there is no Node up there, repeats them and says so.
 *
 * `--remote` streams: `pg_dump` runs inside the VM's `db` container and its stdout comes
 * down the SSH connection into the local file. No intermediate file on the VM, nothing to
 * copy afterwards, and nothing left behind if it fails halfway.
 *
 * Options:
 *   --label <name>   groups dumps and scopes the pruning (default: manual)
 *   --keep <n>       keep the n newest dumps *of this label*; older ones are deleted
 *   --out <file>     write here instead of deploy/backups/<label>-<timestamp>.dump
 *   --remote         dump the VM's database instead of this machine's
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
import { createRemoteCompose, readDeployConfig } from './lib/remote.mjs';

function parseArgs(argv) {
  const options = { label: 'manual', keep: null, out: null, remote: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--remote') options.remote = true;
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
 * notices, now, instead of during the restore you needed it for. Read by the same container
 * that wrote it — for `--remote` that means the file goes back up the SSH connection, which
 * for a dump measured in hundreds of kB is a rounding error and checks the bytes that
 * actually landed here.
 */
async function verify(compose, path) {
  const { code, stdout } = await pipeIntoCapturing(
    compose,
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

/** Which stack to dump, and what to say about it. */
async function target(options) {
  if (options.remote) {
    const config = readDeployConfig();
    return { compose: createRemoteCompose(config), where: `na VM (${config.host})` };
  }
  await ensureDocker();
  return { compose: createCompose(isServerInstall(readInstallEnv())), where: 'aqui' };
}

async function dump(options) {
  const { compose, where } = await target(options);

  if (compose(['ps', '-q', 'db'], { stdio: ['ignore', 'pipe', 'pipe'] }).stdout.trim() === '') {
    fail(`O container \`db\` não está de pé ${where} — suba a stack antes.`);
  }

  // Always written here: a dump that stays on the same disk as the database it came from is
  // not a backup, and this is the command that fixes that for the VM.
  const directory = options.out ? null : backupDir();
  if (directory) mkdirSync(directory, { recursive: true });

  const file = options.out
    ? resolve(process.cwd(), options.out)
    : resolve(directory, `${options.label}-${timestamp()}.dump`);

  // Written under a partial name and renamed at the end: a dump interrupted halfway never
  // gets a name that `--latest` would pick up.
  const partial = `${file}.partial`;
  step(`Dump de public + auth + supabase_migrations ${where} → ${basename(file)}`);

  const code = await dumpTo(compose, partial);
  if (code !== 0) {
    rmSync(partial, { force: true });
    fail('pg_dump falhou.');
  }
  renameSync(partial, file);

  const objects = await verify(compose, file);
  ok(`${basename(file)} — ${humanSize(file)}, ${objects} objetos`);

  if (directory && options.keep) prune(directory, options.label, options.keep);

  // Machine-readable last line, for anything that wants to know what was written.
  console.log(`wrote ${file}`);
  return file;
}

await dump(parseArgs(process.argv.slice(2)));
