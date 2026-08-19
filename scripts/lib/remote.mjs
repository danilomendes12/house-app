/**
 * Reaching the VM.
 *
 * Since Fase 13 the VM is a container host and nothing else: docker, the files in `deploy/`,
 * its own `.env` and the volumes. No git, no Node, no pnpm, no repository. Everything that
 * used to run "inside the repo up there" runs *here* now, against the VM's loopback ports
 * through an SSH tunnel — which is also why none of this needs a second copy of the
 * production secrets: they are read from the VM's own `deploy/.env`, over SSH, and kept in
 * memory for the length of one command.
 *
 * Every remote command is a bash script fed to `ssh` over **stdin**, never assembled into
 * a quoted argument. Quoting a shell script into a shell command is where deploy scripts go
 * to die: one path with a space, or one `$` that expands on the wrong side, and the failure
 * is silent. `bash -euo pipefail -s` reads the whole thing and aborts on the first error.
 *
 * The one exception is `createRemoteCompose`, which has to leave stdin free for the dump
 * flowing through it. It passes the command as an argument and quotes each piece with
 * `shellQuote` instead.
 */

import { spawn } from 'node:child_process';
import { createServer, connect } from 'node:net';

import { deployDir, fail, parseEnv, readInstallEnv, run, shellQuote, sleep } from './proc.mjs';

/**
 * How to reach the server. All read from deploy/.env — the one env file — by the scripts
 * only: the app never learns any of this, and neither does docker compose.
 *
 * DOMAIN is the exception that is read twice: here, to seed the VM's own env file at
 * bootstrap, and there, by the compose override that hands it to Caddy.
 *
 * There is no DEPLOY_REPO any more. The VM has no repository to point at: what lands there
 * is the handful of files in `deploy/` (`syncDeployFiles`) and an image pulled from GHCR.
 */
export function readDeployConfig({ require: required = ['DEPLOY_HOST'] } = {}) {
  const env = { ...readInstallEnv(), ...process.env };

  const config = {
    host: env.DEPLOY_HOST,
    // The GCP VM has no root login: the user is the one the `ssh-keys` metadata created
    // (docs/DEPLOY.md, Parte 1.1), and it has passwordless sudo. Every remote script that
    // needs root prefixes with $SUDO when `id -u` is not 0.
    user: env.DEPLOY_USER || 'financas',
    path: env.DEPLOY_PATH || '/opt/financas',
    key: env.DEPLOY_SSH_KEY,
    domain: env.DOMAIN,
  };

  const byName = { DEPLOY_HOST: config.host, DOMAIN: config.domain };
  const missing = required.filter((name) => !byName[name]);

  if (missing.length > 0) {
    fail(
      [
        `Faltando em deploy/.env: ${missing.join(', ')}`,
        '',
        'Estas variáveis são lidas só pelos scripts, e só nesta máquina. Acrescente ao seu',
        'deploy/.env (veja deploy/.env.example):',
        '',
        '  DEPLOY_HOST=<ip público da VM>',
        '  DEPLOY_USER=financas',
        '  DOMAIN=momolados.com.br',
        '',
        'O passo a passo de como chegar até aqui está em docs/DEPLOY.md.',
      ].join('\n'),
    );
  }

  config.target = `${config.user}@${config.host}`;
  config.sshOptions = config.key ? ['-i', config.key] : [];
  return config;
}

/**
 * Runs a bash script on the VM. Output goes straight to your terminal; a non-zero exit is
 * the caller's to handle, because "the pull failed" and "the healthcheck failed" do not
 * deserve the same message.
 */
export function ssh(config, script, options = {}) {
  return run('ssh', [...config.sshOptions, config.target, 'bash -euo pipefail -s'], {
    input: script,
    stdio: ['pipe', 'inherit', 'inherit'],
    ...options,
  });
}

/** Same, but hands back stdout instead of printing it. */
export function sshCapture(config, script) {
  return ssh(config, script, { stdio: ['pipe', 'pipe', 'pipe'] });
}

/** Runs it, or stops with `message`. */
export function sshOrFail(config, script, message) {
  const result = ssh(config, script);
  if (result.status !== 0) fail(message);
  return result;
}

/**
 * A command that runs *in `deploy/` on the VM*, with that installation's env loaded.
 *
 * That directory is the whole of the VM's side of this project: the two compose files, the
 * Caddyfile, the role-password init, `backup.sh`, the systemd unit templates and the
 * volumes' worth of backups. Nothing here shells out to node, pnpm or corepack — none of
 * them exist up there.
 */
export function inDeployDir(config, command) {
  return [
    `cd ${config.path}/deploy`,
    // docker compose reads this file by itself; sourcing it is for the plain shell lines
    // that need POSTGRES_PORT or WEB_IMAGE_TAG in scope.
    'set -a; [ -f .env ] && . ./.env; set +a',
    command,
  ].join('\n');
}

/**
 * The VM's own `deploy/.env`, parsed, in memory, for the length of one command.
 *
 * This is how the production secrets stay off this laptop: `supabase db push`, `db:invite`
 * and the rest need the production password and service-role key, and they get them by
 * reading the file that is already up there — never by keeping a second copy here. Never
 * written to disk, never printed.
 */
export function readRemoteEnv(config) {
  const result = sshCapture(config, `cat ${config.path}/deploy/.env`);
  if (result.status !== 0) {
    fail(
      `Não consegui ler ${config.path}/deploy/.env na VM.\n` +
        'Se a VM ainda está vazia, o comando é `pnpm server init --owner <email>`.',
    );
  }
  return parseEnv(result.stdout);
}

/** A free TCP port on this machine, asked of the kernel rather than guessed. */
function freeLocalPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Whether the tunnel's local end is accepting connections yet. */
function accepts(port) {
  return new Promise((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' });
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });
}

/**
 * Runs `fn(localPort)` with an SSH tunnel open to `remotePort` on the VM, and closes it
 * whatever happens.
 *
 * This is what replaces having Node on the VM. Postgres (5432) and the Supabase API (8000)
 * are published on the VM's loopback and nowhere else — that has always been true, and it
 * stays true: the tunnel is a client of loopback, not a hole in it.
 *
 * The local end is a port the kernel picked, never a fixed one: 5432 and 8000 are exactly
 * the ports the *local* stack holds, and a deploy that quietly pushed the production
 * migrations into the laptop's database would be the worst possible bug in this file.
 */
export async function withTunnel(config, remotePort, fn) {
  const localPort = await freeLocalPort();

  const child = spawn(
    'ssh',
    [
      ...config.sshOptions,
      '-N',
      // Without this ssh stays up after a failed forward, and the connect below succeeds
      // against nothing at all.
      '-o',
      'ExitOnForwardFailure=yes',
      '-L',
      `${localPort}:127.0.0.1:${remotePort}`,
      config.target,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );

  let exited = false;
  child.on('exit', () => (exited = true));

  try {
    let ready = false;
    for (let attempt = 0; attempt < 50 && !exited && !ready; attempt += 1) {
      await sleep(200);
      ready = await accepts(localPort);
    }
    if (!ready) fail(`Não consegui abrir o túnel SSH até a porta ${remotePort} da VM.`);
    return await fn(localPort);
  } finally {
    child.kill();
  }
}

/**
 * `docker compose` in `deploy/` on the VM, in the two shapes lib/db.mjs asks for: run it,
 * or describe it so the caller can stream through it.
 *
 * Both compose files, always: the VM *is* the server installation, and there is no local
 * `deploy/.env` up there to consult about it (DEPLOY_TARGET still marks it, and compose
 * still reads it — this just does not depend on that to pick its own arguments).
 */
export function createRemoteCompose(config) {
  const remoteCommand = (args) =>
    `cd ${config.path}/deploy && docker compose -f docker-compose.yml -f docker-compose.server.yml ` +
    args.map(shellQuote).join(' ');

  const compose = (args, options = {}) =>
    run('ssh', [...config.sshOptions, config.target, remoteCommand(args)], {
      stdio: 'inherit',
      ...options,
    });

  compose.spawn = (args) => ({
    command: 'ssh',
    args: [...config.sshOptions, config.target, remoteCommand(args)],
    options: {},
  });

  return compose;
}

/** The files the VM needs, and the only ones. This is what replaced `git clone`. */
const deployedFiles = [
  'docker-compose.yml',
  'docker-compose.server.yml',
  'Caddyfile',
  'init/zz-role-passwords.sql',
  'backup.sh',
  'systemd/financas-backup.service',
  'systemd/financas-backup.timer',
];

/**
 * Copies `deploy/` up. Idempotent, and cheap enough to run on every deploy — these files
 * change between versions like any other source, and a compose file one release behind is
 * a container started with the wrong image or the wrong port.
 *
 * rsync when it exists (it skips what did not change), scp otherwise — a freshly installed
 * Ubuntu has scp and may not have rsync, and this runs before anything is installed.
 */
export function syncDeployFiles(config) {
  const remoteDir = `${config.path}/deploy`;
  // sudo to create, chown to own: DEPLOY_PATH lives under /opt, which belongs to root, and
  // the deploy user is not root anywhere the VM is a cloud image (GCP opens no root login).
  // The chown is what lets the rsync below — which runs as the user, not through sudo —
  // write there at all, and it is idempotent.
  const prepared = ssh(
    config,
    [
      'if [ "$(id -u)" -ne 0 ]; then SUDO=sudo; else SUDO=; fi',
      `$SUDO mkdir -p ${remoteDir}/init ${remoteDir}/systemd ${remoteDir}/backups`,
      `$SUDO chown -R "$(id -un):$(id -gn)" ${config.path}`,
    ].join(' && '),
  );
  if (prepared.status !== 0) fail(`Não consegui criar ${remoteDir} na VM.`);

  const sshCommand = ['ssh', ...config.sshOptions].join(' ');
  const hasRsync = run('rsync', ['--version']).status === 0;

  if (hasRsync) {
    // -R keeps init/ and systemd/ where they belong instead of flattening everything.
    const copied = run(
      'rsync',
      ['-az', '-R', '-e', sshCommand, ...deployedFiles, `${config.target}:${remoteDir}/`],
      { cwd: deployDir, stdio: 'inherit' },
    );
    if (copied.status !== 0) fail('rsync dos arquivos de deploy falhou.');
  } else {
    for (const file of deployedFiles) {
      const copied = run(
        'scp',
        [...config.sshOptions, file, `${config.target}:${remoteDir}/${file}`],
        { cwd: deployDir, stdio: 'inherit' },
      );
      if (copied.status !== 0) fail(`Não consegui enviar ${file}.`);
    }
  }

  // The nightly dump is the one file that is executed rather than read, and rsync/scp are
  // not always asked to preserve that.
  ssh(config, `chmod +x ${remoteDir}/backup.sh`);
}

/** Copies a local file to the VM. */
export function scpUp(config, localPath, remotePath) {
  return run('scp', [...config.sshOptions, localPath, `${config.target}:${remotePath}`], {
    stdio: 'inherit',
  });
}

/** Copies a file from the VM down to here. */
export function scpDown(config, remotePath, localPath) {
  return run('scp', [...config.sshOptions, `${config.target}:${remotePath}`, localPath], {
    stdio: 'inherit',
  });
}
