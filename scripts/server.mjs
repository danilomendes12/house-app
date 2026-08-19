#!/usr/bin/env node
/**
 * Drives the production VM from here.
 *
 *   pnpm server init      # once, against a freshly created and empty VM
 *   pnpm server           # every day: the image the CI built, migrations, health check
 *   pnpm server status    # what is up there right now
 *   pnpm server logs [svc]
 *   pnpm server ssh       # a shell, already in deploy/
 *
 * Named `server` and not `deploy` because `pnpm deploy` is a pnpm builtin (it deploys a
 * workspace package) and would shadow the script entirely — the kind of collision that
 * costs an afternoon the first time it happens.
 *
 * **The VM is a container host, not a build machine** (Fase 13, docs/HOSTING.md §1.1). It
 * has docker, the files in `deploy/`, its own `.env` and the volumes. It does not have git,
 * Node, pnpm or this repository: the app image is built by the CI and pulled from GHCR, the
 * migrations are pushed from here through an SSH tunnel, and the deploy files are copied up
 * with rsync. That is what makes 1 GB of RAM enough — the build needs ~1150 MiB and the
 * runtime 305 MiB.
 *
 * This script knows how to *reach* the VM. What order things come up in is
 * `lib/bringup.mjs`, the same module `pnpm dev` uses, with a different runner: the sequence
 * has one implementation, and copying it in here would be the mistake this file exists to
 * avoid.
 *
 * Configuration is in deploy/.env, read only by these scripts and only on this machine —
 * see deploy/.env.example. What has to happen by hand before `init` is docs/DEPLOY.md.
 */

import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { bringUp, remoteRunner } from './lib/bringup.mjs';
import { ensureDocker, fail, ok, repoRoot, run, sleep, step, warn } from './lib/proc.mjs';
import {
  createRemoteCompose,
  inDeployDir,
  readDeployConfig,
  readRemoteEnv,
  scpUp,
  ssh,
  sshCapture,
  sshOrFail,
  syncDeployFiles,
} from './lib/remote.mjs';

const [command = 'update', ...args] = process.argv.slice(2);

/**
 * The image the CI publishes and the VM pulls.
 *
 * Written out in three places by necessity — here, in `.github/workflows/ci.yml` and in
 * `deploy/docker-compose.server.yml` — because none of the three can import from the
 * others. The package is **public**: that is the whole reason the VM needs no registry
 * credential.
 */
const image = 'ghcr.io/danilomendes12/my-financial-app/web';

/** Docker and the timezone, and nothing else. Everything else this VM needs is a container. */
const installRuntime = `
if [ "$(id -u)" -ne 0 ]; then SUDO=sudo; else SUDO=; fi

if ! command -v docker >/dev/null 2>&1; then
  echo "  instalando docker + compose v2…"
  $SUDO apt-get update -qq
  $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \\
    docker.io docker-compose-v2 ca-certificates curl rsync
  $SUDO systemctl enable --now docker
else
  echo "  docker já instalado"
fi

if [ "$(id -u)" -ne 0 ] && ! id -nG "$USER" | tr ' ' '\\n' | grep -qx docker; then
  $SUDO usermod -aG docker "$USER"
  echo "  $USER adicionado ao grupo docker"
fi

$SUDO timedatectl set-timezone America/Sao_Paulo
echo "  fuso: $(timedatectl show -p Timezone --value)"
`;

/**
 * 2 GB of swap.
 *
 * The plan has 1 GB of RAM and the five containers measured 305 MiB idle (docs/HOSTING.md
 * §1.2), so this is not what makes the app fit — it is the margin for the moments that are
 * not idle: a pg_restore, a Postgres autovacuum on a busy table, an apt upgrade during a
 * deploy. On a 30 GB disk it costs nothing.
 */
const createSwap = `
if [ "$(id -u)" -ne 0 ]; then SUDO=sudo; else SUDO=; fi

if [ -f /swapfile ]; then
  echo "  /swapfile já existe ($(swapon --show=NAME,SIZE --noheadings | tr '\\n' ' '))"
else
  $SUDO fallocate -l 2G /swapfile || $SUDO dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  $SUDO chmod 600 /swapfile
  $SUDO mkswap /swapfile >/dev/null
  $SUDO swapon /swapfile
  if ! grep -q '^/swapfile' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null
  fi
  echo "  swapfile de 2 GB criado e ativo"
fi
`;

/**
 * The systemd timer that takes the nightly dump. Rendered on the VM rather than shipped with
 * the paths baked in, because DEPLOY_PATH and DEPLOY_USER are configuration.
 */
const installBackupTimer = (config) => `
if [ "$(id -u)" -ne 0 ]; then SUDO=sudo; else SUDO=; fi
cd ${config.path}/deploy

sed -e "s|__DEPLOY_PATH__|${config.path}|g" -e "s|__DEPLOY_USER__|${config.user}|g" \\
  systemd/financas-backup.service | $SUDO tee /etc/systemd/system/financas-backup.service >/dev/null
$SUDO cp systemd/financas-backup.timer /etc/systemd/system/financas-backup.timer
$SUDO systemctl daemon-reload
$SUDO systemctl enable --now financas-backup.timer
echo "  próximo backup: $(systemctl show financas-backup.timer -p NextElapseUSecRealtime --value)"
`;

/** Compose on the VM with every profile in play — for the commands that should see it all. */
const composeOnServer = (config, subcommand) =>
  inDeployDir(
    config,
    'docker compose -f docker-compose.yml -f docker-compose.server.yml ' +
      `--profile web --profile studio ${subcommand}`,
  );

function ownerFrom(argv) {
  const flag = argv.indexOf('--owner');
  return (flag >= 0 ? argv[flag + 1] : process.env.OWNER_EMAIL)?.trim().toLowerCase();
}

/**
 * Which image this deploy is for: the short SHA of what is checked out here, or `--tag`.
 *
 * The tag is the commit, not `latest`, and that is the point — the thing that runs in
 * production is identifiable, and rolling back is `pnpm server --tag sha-<older>`.
 */
function resolveTag(argv) {
  const flag = argv.indexOf('--tag');
  if (flag >= 0 && argv[flag + 1]) return argv[flag + 1];

  const head = run('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: repoRoot });
  if (head.status !== 0) fail('Não consegui ler o HEAD do git para descobrir a tag da imagem.');
  return `sha-${head.stdout.trim()}`;
}

/**
 * Whether the CI has already published this tag.
 *
 * A read of a public registry — no credential, and the only thing docker is needed for on
 * this machine during a deploy. The VM does the pulling.
 */
function imagePublished(tag) {
  return (
    run('docker', ['manifest', 'inspect', `${image}:${tag}`], {
      stdio: ['ignore', 'ignore', 'ignore'],
    }).status === 0
  );
}

/**
 * No commit becomes an image without passing the CI, so a deploy of a tag that does not
 * exist is a deploy of a commit that is red or unpushed. Failing here is the whole design:
 * the alternative — quietly bringing the old tag back up — is a deploy that reports success
 * and changes nothing.
 */
async function assertImagePublished(tag, { wait }) {
  if (imagePublished(tag)) {
    ok(`imagem ${tag} publicada`);
    return;
  }

  if (wait) {
    step(`Esperando o CI publicar ${tag} (até 20 min)…`);
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await sleep(20000);
      if (imagePublished(tag)) {
        ok(`imagem ${tag} publicada`);
        return;
      }
    }
  }

  fail(
    [
      `A imagem ${image}:${tag} não existe no GHCR.`,
      '',
      'Na ordem em que costuma ser:',
      '  1. o commit ainda não foi para o `main` — o CI só constrói o que está lá;',
      '  2. o CI ainda está rodando — `pnpm server --wait` espera por ele;',
      '  3. o CI falhou — nenhum commit vermelho vira imagem, e é de propósito;',
      '  4. o package do GHCR ainda está privado — torne-o público (docs/DEPLOY.md, Parte 1).',
    ].join('\n'),
  );
}

/** Records the tag the VM's compose will resolve. The only thing this deploy writes there. */
function writeImageTag(config, tag) {
  const script = inDeployDir(
    config,
    [
      `if grep -q '^WEB_IMAGE_TAG=' .env; then`,
      `  sed -i 's|^WEB_IMAGE_TAG=.*|WEB_IMAGE_TAG=${tag}|' .env`,
      'else',
      `  printf '\\n# A tag da imagem publicada pelo CI. Escrita por pnpm server.\\nWEB_IMAGE_TAG=%s\\n' '${tag}' >> .env`,
      'fi',
    ].join('\n'),
  );
  sshOrFail(config, script, 'Não consegui gravar WEB_IMAGE_TAG no .env da VM.');
}

/** `docker compose ps --format json` is an array in newer compose and one object per line in older. */
function parseComposePs(stdout) {
  const text = stdout.trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
}

/** Every container up and, where it declares a healthcheck, healthy. */
function assertHealthy(config) {
  const result = sshCapture(config, composeOnServer(config, 'ps --format json'));
  if (result.status !== 0) fail('Não consegui ler o estado dos containers na VM.');

  const services = parseComposePs(result.stdout);
  if (services.length === 0) fail('Nenhum container de pé na VM.');

  const sick = services.filter(
    (service) => service.State !== 'running' || (service.Health && service.Health !== 'healthy'),
  );

  for (const service of services) {
    const label = service.Health ? `${service.State}/${service.Health}` : service.State;
    console.log(`    ${service.Service.padEnd(8)} ${label}`);
  }

  if (sick.length > 0) {
    fail(
      `Não ficou saudável: ${sick.map((s) => s.Service).join(', ')}\n` +
        `  pnpm server logs ${sick[0].Service}`,
    );
  }
}

/** The last check, and the only one from the outside: HTTPS, through the real name. */
async function assertPubliclyServed(config) {
  const url = `https://${config.domain}/login`;
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if (response.status >= 500) fail(`${url} respondeu ${response.status}.`);
    ok(`${url} respondeu ${response.status}`);
  } catch (error) {
    fail(
      [
        `Não consegui abrir ${url}: ${error.message}`,
        '',
        'Na ordem em que costuma quebrar:',
        `  1. DNS — o A de ${config.domain} aponta para o IP da VM? (dig +short ${config.domain})`,
        '  2. Cloudflare — o registro tem que estar em "DNS only" (nuvem cinza). Proxy ligado',
        "     intercepta o desafio do Let's Encrypt e o Caddy nunca emite o certificado.",
        '  3. O certificado — `pnpm server logs caddy` mostra o que o ACME respondeu.',
        '  4. Firewall — a VPC da GCP bloqueia tudo por padrão; 80 e 443 saem pela regra',
        '     financas-allow-web, e ela vale só para a VM com a tag `financas`',
        '     (gcloud compute firewall-rules list; docs/DEPLOY.md, Parte 1).',
      ].join('\n'),
    );
  }
}

/**
 * The production secrets, generated **here** and moved up in one step.
 *
 * Generated freshly rather than copied from this machine's deploy/.env — production secrets
 * must not be the ones that have been sitting on a laptop — and the temporary file is
 * deleted whatever happens, because the one place they are allowed to live is the VM.
 * Everything that needs them later reads them back over SSH (`readRemoteEnv`).
 */
function seedRemoteEnv(config) {
  const exists = ssh(config, `test -f ${config.path}/deploy/.env`);
  if (exists.status === 0) {
    console.log('  deploy/.env já existe na VM — mantido');
    return;
  }

  const scratch = resolve(tmpdir(), `financas-env-${randomBytes(8).toString('hex')}`);

  // Nothing in here calls fail(): process.exit skips `finally`, and the one file on this
  // machine that ever holds the production secrets must be deleted on every path out.
  let problem = null;
  try {
    const generated = run(
      'node',
      [resolve(repoRoot, 'scripts/gen-secrets.mjs'), '--server', scratch],
      { env: { ...process.env, DOMAIN: config.domain } },
    );
    if (generated.status !== 0) problem = generated.stderr || 'gen-secrets.mjs falhou.';
    else if (scpUp(config, scratch, `${config.path}/deploy/.env`).status !== 0) {
      problem = 'Não consegui enviar o deploy/.env para a VM.';
    }
  } finally {
    rmSync(scratch, { force: true });
  }

  if (problem) fail(problem);
  sshOrFail(
    config,
    `chmod 600 ${config.path}/deploy/.env`,
    'Não consegui ajustar as permissões do deploy/.env na VM.',
  );
}

/** Pulls the app image. Never `--build`: there is nothing to build with up there. */
function pullApp(config) {
  const compose = createRemoteCompose(config);
  step('Puxando a imagem do app do GHCR…');
  if (compose(['--profile', 'web', 'pull', 'web']).status !== 0) {
    fail(
      'O `docker compose pull web` falhou na VM.\n' +
        'Se a resposta foi 401/denied, o package do GHCR ainda está privado — torne-o\n' +
        'público (docs/DEPLOY.md, Parte 1, item 5).',
    );
  }
}

/** Old images pile up on a 30 GB disk, one per deploy, and nothing else removes them. */
function pruneImages(config) {
  ssh(config, 'docker image prune -f | tail -1');
}

async function init() {
  const config = readDeployConfig({ require: ['DEPLOY_HOST', 'DOMAIN'] });
  const owner = ownerFrom(args);

  if (!owner) {
    fail(
      'Diga com qual e-mail você vai entrar — é a única coisa que uma instalação fechada\n' +
        'não decide sozinha (SPEC §12):\n\n  pnpm server init --owner voce@exemplo.com',
    );
  }

  console.log(`\nInstalando em ${config.target}:${config.path} — domínio ${config.domain}\n`);

  const tag = resolveTag(args);
  // Only to read the registry: the image is pulled by the VM, not here.
  await ensureDocker();
  step(`Conferindo a imagem ${tag} no GHCR…`);
  await assertImagePublished(tag, { wait: args.includes('--wait') });

  step('Docker e fuso horário…');
  sshOrFail(config, installRuntime, 'Não consegui preparar a VM.');

  step('Swapfile de 2 GB…');
  sshOrFail(config, createSwap, 'Não consegui criar o swapfile.');

  step('Enviando os arquivos do deploy…');
  syncDeployFiles(config);

  step('Gerando os segredos de produção e enviando…');
  seedRemoteEnv(config);
  writeImageTag(config, tag);

  step('Instalando o timer de backup diário…');
  sshOrFail(config, installBackupTimer(config), 'Não consegui instalar o timer de backup.');

  pullApp(config);

  step('Subindo a stack (db → auth → migrations → rest/caddy/web) e provisionando o dono…');
  await bringUp(remoteRunner(config, readRemoteEnv(config)), { owner });

  step('Conferindo os containers…');
  assertHealthy(config);

  step('Conferindo o HTTPS (o primeiro certificado leva alguns segundos)…');
  await assertPubliclyServed(config);

  console.log(
    [
      '',
      '\x1b[32m✓ produção no ar\x1b[0m',
      `  app     https://${config.domain}`,
      `  imagem  ${image}:${tag}`,
      `  login   ${owner} + a senha impressa acima (ela não será mostrada de novo)`,
      '',
      '  Próximos passos:',
      '    pnpm db:invite --remote <email>   # a segunda pessoa da casa',
      '    pnpm db:dump && pnpm db:restore --remote <arquivo>   # levar os dados daqui para lá',
      '',
      '  Daqui em diante o comando é `pnpm server`, sem argumento.',
      '',
    ].join('\n'),
  );
}

async function update() {
  const config = readDeployConfig({ require: ['DEPLOY_HOST', 'DOMAIN'] });
  const tag = resolveTag(args);

  console.log(`\nAtualizando ${config.target}:${config.path} para ${tag}\n`);

  // Only to read the registry: the image is pulled by the VM, not here.
  await ensureDocker();
  step('Conferindo a imagem no GHCR…');
  await assertImagePublished(tag, { wait: args.includes('--wait') });

  step('Sincronizando os arquivos do deploy…');
  syncDeployFiles(config);
  writeImageTag(config, tag);

  pullApp(config);

  // bringUp takes the dump before applying migrations, and only when there *are* pending
  // migrations — which is what makes a second run in a row a no-op instead of a pile of
  // identical dumps.
  step('Migrations pendentes e subida…');
  await bringUp(remoteRunner(config, readRemoteEnv(config)));

  step('Conferindo os containers…');
  assertHealthy(config);

  step('Conferindo o HTTPS…');
  await assertPubliclyServed(config);

  step('Limpando imagens antigas…');
  pruneImages(config);

  console.log(`\n\x1b[32m✓ atualizado\x1b[0m  https://${config.domain}  (${tag})\n`);
}

function status() {
  const config = readDeployConfig();
  console.log(`\n${config.target}:${config.path}\n`);
  ssh(config, inDeployDir(config, 'echo "  imagem  ${WEB_IMAGE_TAG:-(não gravada)}"'));
  console.log('');
  assertHealthy(config);
  ssh(
    config,
    inDeployDir(
      config,
      'echo ""; echo "  backups:"; ls -lht backups 2>/dev/null | head -6 || echo "  nenhum ainda"; ' +
        'echo ""; systemctl list-timers financas-backup.timer --no-pager | head -3',
    ),
  );
}

/** An interactive ssh: a TTY, so logs stream and Ctrl+C lands where you expect. */
function interactive(config, command) {
  const result = run('ssh', ['-t', ...config.sshOptions, config.target, command], {
    stdio: 'inherit',
  });
  process.exit(result.status ?? 0);
}

function logs() {
  const config = readDeployConfig();
  interactive(config, composeOnServer(config, `logs -f --tail 200 ${args.join(' ')}`));
}

function shell() {
  const config = readDeployConfig();
  interactive(config, `cd ${config.path}/deploy && exec bash -l`);
}

switch (command) {
  case 'init':
    await init();
    break;
  case 'update':
    await update();
    break;
  case 'status':
    status();
    break;
  case 'logs':
    logs();
    break;
  case 'ssh':
    shell();
    break;
  default:
    warn(`Comando desconhecido: ${command}`);
    fail(
      [
        '',
        '  pnpm server init --owner <email>   # uma vez, numa VM vazia',
        '  pnpm server                        # o comando de todo dia (= update)',
        '  pnpm server --wait                 # o mesmo, esperando o CI publicar a imagem',
        '  pnpm server --tag sha-abc1234      # sobe uma tag específica (rollback)',
        '  pnpm server status|logs|ssh',
        '',
        '  Um script do package.json contra a produção é `--remote`:',
        '    pnpm db:invite --remote <email>, pnpm db:password --remote <email>',
        '',
        '  docs/DEPLOY.md tem o passo a passo.',
      ].join('\n'),
    );
}
