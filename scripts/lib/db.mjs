/**
 * Talking to Postgres from the outside of the app: which schemas make up a backup, which
 * role does the work, and how a dump is loaded back without waking the triggers.
 *
 * Everything runs *inside* the `db` container, over its unix socket. Two reasons, both
 * load-bearing: the client tools then always match the server version (17.6 here — a dump
 * taken by an older pg_dump is a dump you cannot restore), and port 5432 stays unpublished
 * to anything but loopback.
 *
 * Every function here takes a `compose` — `createCompose` for the stack on this machine,
 * `createRemoteCompose` for the VM's, over SSH. Same commands, same flags, either side:
 * that is what keeps the nightly dump, the pre-migration dump and `pnpm db:dump` a single
 * format, which is the only kind of backup worth having.
 */

import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

/**
 * The three schemas that *are* this installation.
 *
 *   public               the app's data — and `external_id` / `external_ref` with it, which
 *                        is what keeps a CSV re-import idempotent (SPEC §7). A partial dump
 *                        that dropped those columns would duplicate every transaction on
 *                        the next import, silently.
 *   auth                 GoTrue's own tables, including auth.users. Carrying it means the
 *                        bcrypt hashes come along, so the passwords survive a restore even
 *                        though the destination signs sessions with a different JWT_SECRET.
 *   supabase_migrations  the CLI's ledger. Without it `supabase db push` would try to
 *                        replay every migration over a schema that already has them.
 *
 * Deliberately absent: `extensions`, `vault` and the rest of what the supabase/postgres
 * image creates on first boot. They come from the image, not from us, and they already
 * exist wherever this dump is going.
 */
export const backedUpSchemas = ['public', 'auth', 'supabase_migrations'];

/**
 * The role that dumps and restores.
 *
 * `postgres` is *not* a superuser in the supabase/postgres image — `supabase_admin` is, and
 * it is the owner of the `auth` schema. Restoring as `postgres` fails on hundreds of
 * objects it may not touch. It has no password set (init/zz-role-passwords.sql covers only
 * the three roles that log in over TCP), which is exactly why this all happens over the
 * container's local socket.
 */
export const adminRole = 'supabase_admin';

const schemaFlags = backedUpSchemas.flatMap((schema) => [`--schema=${schema}`]);

/**
 * The one pg_dump command line in this repository.
 *
 * `deploy/backup.sh` — the nightly dump, which runs on a VM with no Node on it — repeats
 * these flags by hand, because a shell script cannot import this file. If they ever change
 * here, they change there in the same commit: a dump only one of the two produces is a
 * backup you find out about during the restore.
 */
export const dumpCommand = [
  'pg_dump',
  '-U',
  adminRole,
  '-d',
  'postgres',
  // Custom format: compressed, and restorable with --single-transaction so a failed
  // restore leaves nothing half-loaded.
  '--format=custom',
  ...schemaFlags,
];

/** Runs a command in the db container, streaming its stdout into `destination`. */
export async function dumpTo(compose, destination) {
  const file = createWriteStream(destination);
  const { command, args, options } = compose.spawn(['exec', '-T', 'db', ...dumpCommand]);
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'inherit'] });

  // Both listeners registered *before* the pipe starts. `once` only hears events that fire
  // after it is called, and on a small database the file can close before the await is
  // reached — the process then hangs on a 'close' that already happened.
  const exited = once(child, 'close');
  const flushed = once(file, 'close');
  child.stdout.pipe(file);

  const [code] = await exited;
  await flushed;
  return code;
}

/** Feeds a file into a command inside the db container. Returns its exit code. */
export async function pipeInto(compose, command, source) {
  const spec = compose.spawn(['exec', '-T', 'db', ...command]);
  const child = spawn(spec.command, spec.args, {
    ...spec.options,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  const exited = once(child, 'close');
  source.pipe(child.stdin);
  const [code] = await exited;
  return code;
}

/** Same, but capturing stdout — for the archive's table of contents. */
export async function pipeIntoCapturing(compose, command, source) {
  const spec = compose.spawn(['exec', '-T', 'db', ...command]);
  const child = spawn(spec.command, spec.args, {
    ...spec.options,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));

  const exited = once(child, 'close');
  source.pipe(child.stdin);
  const [code] = await exited;
  return { code, stdout, stderr };
}

/**
 * One `psql -tAc` as the admin role. `null` when the query fails, which for our purposes
 * means "the database is not there yet" rather than an error worth stopping for.
 */
export function psqlQuery(compose, sql) {
  const result = compose(
    ['exec', '-T', 'db', 'psql', '-U', adminRole, '-d', 'postgres', '-tAc', sql],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

/**
 * Empties the installation so a dump can be loaded into it.
 *
 * This is what keeps `provision_user` from firing during a restore. Two things stop it,
 * and both matter: the schemas go away first, so nothing survives to be inserted *over*;
 * and a full pg_restore loads table data before it creates triggers, so the rows land in
 * auth.users while no trigger is attached. Restoring users on top of a database already
 * provisioned by `db:owner` is the scenario that would create a second household — this
 * function is why that cannot happen.
 *
 * The roles (anon, authenticated, service_role, authenticator, supabase_auth_admin) are
 * *not* dropped: they belong to the image, live outside these schemas, and the dump's
 * grants refer to them by name.
 */
export function dropSchemas(compose) {
  const sql = backedUpSchemas.map((schema) => `drop schema if exists ${schema} cascade;`).join(' ');
  return compose(
    [
      'exec',
      '-T',
      'db',
      'psql',
      '-U',
      adminRole,
      '-d',
      'postgres',
      '--single-transaction',
      '-c',
      sql,
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
}

/** How many rows the installation holds, for the line printed after a restore. */
export function summarize(compose) {
  const sql = `select
      (select count(*) from auth.users),
      (select count(*) from public.households),
      (select count(*) from public.transactions),
      (select count(*) from public.assets)`;
  const row = psqlQuery(compose, sql);
  if (!row) return null;
  const [users, households, transactions, assets] = row.split('|');
  return { users, households, transactions, assets };
}
