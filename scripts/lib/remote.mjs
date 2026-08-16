/**
 * Reaching the VM.
 *
 * Every remote command is a bash script fed to `ssh` over **stdin**, never assembled into
 * a quoted argument. Quoting a shell script into a shell command is where deploy scripts go
 * to die: one path with a space, or one `$` that expands on the wrong side, and the failure
 * is silent. `bash -euo pipefail -s` reads the whole thing and aborts on the first error.
 */

import { fail, readInstallEnv, run } from './proc.mjs';

/**
 * How to reach the server. All read from deploy/.env — the one env file — by the scripts
 * only: the app never learns any of this, and neither does docker compose.
 *
 * DOMAIN is the exception that is read twice: here, to seed the VM's own env file at
 * bootstrap, and there, by the compose override that hands it to Caddy.
 */
export function readDeployConfig({ require: required = ['DEPLOY_HOST'] } = {}) {
  const env = { ...readInstallEnv(), ...process.env };

  const config = {
    host: env.DEPLOY_HOST,
    user: env.DEPLOY_USER || 'ubuntu',
    path: env.DEPLOY_PATH || '/opt/financas',
    repo: env.DEPLOY_REPO,
    branch: env.DEPLOY_BRANCH || 'main',
    key: env.DEPLOY_SSH_KEY,
    domain: env.DOMAIN,
  };

  const byName = {
    DEPLOY_HOST: config.host,
    DEPLOY_REPO: config.repo,
    DOMAIN: config.domain,
  };
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
        '  DEPLOY_REPO=git@github.com:voce/my-financial-app.git',
        '  DOMAIN=tinocot.com',
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
 * the caller's to handle, because "the git pull failed" and "the healthcheck failed" do
 * not deserve the same message.
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
 * A command that runs *inside the repository on the VM*, with the environment those
 * scripts expect.
 *
 * SUPABASE_URL is passed explicitly rather than left to deploy/.env, for the same reason
 * `stack.mjs` does it: SUPABASE_API_PORT is what actually decides where the API is
 * published, and the file's SUPABASE_URL is only the default for running things by hand.
 * Letting the file win sends the right key to the wrong stack, and the symptom is a bare
 * 401 with nothing else to go on.
 */
export function inRepo(config, command) {
  return [
    `cd ${config.path}`,
    'export COREPACK_ENABLE_DOWNLOAD_PROMPT=0',
    // Sourced first so SUPABASE_API_PORT is in scope, then overwritten: the port is what
    // decides where the API is actually published, and the file's own SUPABASE_URL is only
    // the default for running things by hand. Same precedence `stack.mjs` uses.
    'set -a; [ -f deploy/.env ] && . deploy/.env; set +a',
    'export SUPABASE_URL="http://127.0.0.1:${SUPABASE_API_PORT:-8000}"',
    command,
  ].join('\n');
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
