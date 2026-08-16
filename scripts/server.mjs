#!/usr/bin/env node
/**
 * Drives the production VM from here.
 *
 *   pnpm server init      # once, against a freshly created and empty VM
 *   pnpm server           # every day: new code, pending migrations, rebuild, health check
 *   pnpm server status    # what is up there right now
 *   pnpm server logs [svc]
 *   pnpm server ssh       # a shell, already in the repository
 *   pnpm server run <cmd> # a pnpm script up there: db:invite, db:password, stack types…
 *
 * Named `server` and not `deploy` because `pnpm deploy` is a pnpm builtin (it deploys a
 * workspace package) and would shadow the script entirely — the kind of collision that
 * costs an afternoon the first time it happens.
 *
 * This script knows how to reach the VM and nothing else. What to *do* once there is
 * `scripts/stack.mjs`, the same one `pnpm dev` runs: same order, same idempotence, same
 * two phases. The only difference is which compose files it layers, and the VM's own
 * deploy/.env answers that (DEPLOY_TARGET=server).
 *
 * Configuration is in deploy/.env, read only by these scripts and only on this machine —
 * see deploy/.env.example. The tutorial for everything that has to happen in the Oracle
 * console before `init` is docs/DEPLOY.md.
 */

import { fail, ok, run, step, warn } from './lib/proc.mjs';
import { inRepo, readDeployConfig, ssh, sshCapture, sshOrFail } from './lib/remote.mjs';

const [command = 'update', ...args] = process.argv.slice(2);

/** Node 22 from NodeSource: Ubuntu 24.04 ships 18, and `process.loadEnvFile` needs 20.12+. */
const installRuntime = `
if ! command -v docker >/dev/null 2>&1; then
  echo "  instalando docker + compose v2…"
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \\
    docker.io docker-compose-v2 git ca-certificates curl
  sudo systemctl enable --now docker
else
  echo "  docker já instalado"
fi

if ! id -nG "$USER" | tr ' ' '\\n' | grep -qx docker; then
  sudo usermod -aG docker "$USER"
  echo "  $USER adicionado ao grupo docker"
fi

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "  instalando Node 22…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs
else
  echo "  node $(node -v) já instalado"
fi

sudo corepack enable
sudo timedatectl set-timezone America/Sao_Paulo
`;

/**
 * The Oracle Ubuntu image drops everything but 22 in iptables, *below* the Security List.
 * Opening 80/443 in the console is necessary and not sufficient: the packet arrives at the
 * VM and dies there, and the symptom is a connection that hangs rather than one refused —
 * which reads exactly like a DNS problem.
 *
 * Inserted at the top of INPUT so it lands ahead of the image's catch-all REJECT, and
 * saved so it survives the reboot. `-C` first, so a second run changes nothing.
 */
const openFirewall = `
if ! dpkg -s iptables-persistent >/dev/null 2>&1; then
  echo iptables-persistent iptables-persistent/autosave_v4 boolean false | sudo debconf-set-selections
  echo iptables-persistent iptables-persistent/autosave_v6 boolean false | sudo debconf-set-selections
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq iptables-persistent
fi

for port in 80 443; do
  if sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
    echo "  porta $port já liberada no iptables"
  else
    sudo iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
    echo "  porta $port liberada no iptables"
  fi
done
sudo netfilter-persistent save >/dev/null
`;

const fetchCode = (config) => `
sudo mkdir -p ${config.path}
sudo chown "$USER":"$USER" ${config.path}

if [ -d ${config.path}/.git ]; then
  cd ${config.path}
  git fetch --quiet origin
  git checkout --quiet ${config.branch}
  git reset --hard --quiet origin/${config.branch}
else
  git clone --quiet --branch ${config.branch} ${config.repo} ${config.path}
  cd ${config.path}
fi
echo "  $(git log -1 --format='%h %s')"
`;

const installDeps = (config) =>
  inRepo(config, 'pnpm install --frozen-lockfile --reporter=append-only');

/**
 * The systemd timer that takes the nightly dump. Rendered here rather than shipped with the
 * paths baked in, because DEPLOY_PATH and DEPLOY_USER are configuration.
 */
const installBackupTimer = (config) => `
cd ${config.path}
sed -e "s|__DEPLOY_PATH__|${config.path}|g" -e "s|__DEPLOY_USER__|${config.user}|g" \\
  deploy/systemd/financas-backup.service | sudo tee /etc/systemd/system/financas-backup.service >/dev/null
sudo cp deploy/systemd/financas-backup.timer /etc/systemd/system/financas-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now financas-backup.timer
echo "  próximo backup: $(systemctl show financas-backup.timer -p NextElapseUSecRealtime --value)"
`;

/** A compose command in deploy/ up there, with both files and every profile in play. */
const composeOnServer = (config, command) =>
  `cd ${config.path}/deploy && docker compose -f docker-compose.yml -f docker-compose.server.yml ` +
  `--profile web --profile studio ${command}`;

/** `pnpm stack up` on the VM. Server mode is read from its own deploy/.env, not passed in. */
const bringStackUp = (config, ownerEmail) =>
  inRepo(config, `${ownerEmail ? `OWNER_EMAIL=${ownerEmail} ` : ''}node scripts/stack.mjs up`);

function ownerFrom(argv) {
  const flag = argv.indexOf('--owner');
  return (flag >= 0 ? argv[flag + 1] : process.env.OWNER_EMAIL)?.trim().toLowerCase();
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
        '  1. DNS — o A/AAAA de ' +
          config.domain +
          ' aponta para o IP da VM? (dig +short ' +
          config.domain +
          ')',
        '  2. Cloudflare — o registro tem que estar em "DNS only" (nuvem cinza). Proxy ligado',
        "     intercepta o desafio do Let's Encrypt e o Caddy nunca emite o certificado.",
        '  3. Security List da Oracle — 80 e 443 abertas para 0.0.0.0/0.',
        '  4. iptables na VM — `pnpm server init` abre e persiste; confira com',
        '     `pnpm server ssh` e `sudo iptables -L INPUT -n --line-numbers`.',
        '  5. O certificado — `pnpm server logs caddy` mostra o que o ACME respondeu.',
      ].join('\n'),
    );
  }
}

async function init() {
  const config = readDeployConfig({ require: ['DEPLOY_HOST', 'DEPLOY_REPO', 'DOMAIN'] });
  const owner = ownerFrom(args);

  if (!owner) {
    fail(
      'Diga com qual e-mail você vai entrar — é a única coisa que uma instalação fechada\n' +
        'não decide sozinha (SPEC §12):\n\n  pnpm server init --owner voce@exemplo.com',
    );
  }

  console.log(`\nInstalando em ${config.target}:${config.path} — domínio ${config.domain}\n`);

  step('Docker, Node e fuso horário…');
  sshOrFail(config, installRuntime, 'Não consegui preparar a VM.');

  step('Abrindo 80 e 443 no iptables da VM…');
  sshOrFail(config, openFirewall, 'Não consegui ajustar o iptables.');

  step('Clonando o repositório…');
  sshOrFail(config, fetchCode(config), 'Não consegui clonar o repositório na VM.');

  step('Instalando dependências…');
  sshOrFail(config, installDeps(config), 'pnpm install falhou na VM.');

  // Generated *there*, never copied from here: the production secrets must not be the
  // development ones. gen-secrets refuses to overwrite, so a re-run keeps the database's own.
  step('Gerando os segredos de produção na VM…');
  sshOrFail(
    config,
    inRepo(
      config,
      `if [ -f deploy/.env ]; then echo "  deploy/.env já existe — mantido"; else ` +
        `DOMAIN=${config.domain} node scripts/gen-secrets.mjs --server; fi`,
    ),
    'Não consegui gerar deploy/.env na VM.',
  );

  step('Instalando o timer de backup diário…');
  sshOrFail(config, installBackupTimer(config), 'Não consegui instalar o timer de backup.');

  step('Subindo a stack (db → auth → migrations → rest/caddy/web) e provisionando o dono…');
  sshOrFail(config, bringStackUp(config, owner), 'A stack não subiu na VM.');

  step('Conferindo os containers…');
  assertHealthy(config);

  step('Conferindo o HTTPS (o primeiro certificado leva alguns segundos)…');
  await assertPubliclyServed(config);

  console.log(
    [
      '',
      '\x1b[32m✓ produção no ar\x1b[0m',
      `  app     https://${config.domain}`,
      `  login   ${owner} + a senha impressa acima (ela não será mostrada de novo)`,
      '',
      '  Próximos passos:',
      `    pnpm server run db:invite <email>   # a segunda pessoa da casa`,
      `    pnpm db:dump && pnpm db:restore --remote <arquivo>   # levar os dados daqui para lá`,
      '',
      '  Daqui em diante o comando é `pnpm server`, sem argumento.',
      '',
    ].join('\n'),
  );
}

async function update() {
  const config = readDeployConfig({ require: ['DEPLOY_HOST', 'DOMAIN'] });

  console.log(`\nAtualizando ${config.target}:${config.path}\n`);

  step('Buscando o código novo…');
  sshOrFail(config, fetchCode(config), 'git falhou na VM.');

  step('Instalando dependências…');
  sshOrFail(config, installDeps(config), 'pnpm install falhou na VM.');

  // stack.mjs takes the dump before applying migrations, and only when there *are* pending
  // migrations — which is what makes a second run in a row a no-op instead of a pile of
  // identical dumps.
  step('Migrations pendentes, build da imagem e subida…');
  sshOrFail(config, bringStackUp(config, null), 'A stack não subiu saudável na VM.');

  step('Conferindo os containers…');
  assertHealthy(config);

  step('Conferindo o HTTPS…');
  await assertPubliclyServed(config);

  console.log(`\n\x1b[32m✓ atualizado\x1b[0m  https://${config.domain}\n`);
}

function status() {
  const config = readDeployConfig();
  console.log(`\n${config.target}:${config.path}\n`);
  ssh(config, inRepo(config, "git log -1 --format='  commit %h %s (%cr)'"));
  console.log('');
  assertHealthy(config);
  ssh(
    config,
    inRepo(
      config,
      'echo ""; echo "  backups:"; ls -lht deploy/backups 2>/dev/null | head -6 || echo "  nenhum ainda"; ' +
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
  interactive(config, `cd ${config.path} && exec bash -l`);
}

/** `pnpm server run db:invite alguem@exemplo.com` — a pnpm script, in the repo, up there. */
function runRemote() {
  if (args.length === 0) {
    fail('Usage: pnpm server run <script> [args…]   (ex.: pnpm server run db:invite a@b.com)');
  }
  const config = readDeployConfig();
  interactive(config, `cd ${config.path} && pnpm ${args.join(' ')}`);
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
  case 'run':
    runRemote();
    break;
  default:
    warn(`Comando desconhecido: ${command}`);
    fail(
      [
        '',
        '  pnpm server init --owner <email>   # uma vez, numa VM vazia',
        '  pnpm server                        # o comando de todo dia (= update)',
        '  pnpm server status|logs|ssh',
        '  pnpm server run <script> [args…]',
        '',
        '  docs/DEPLOY.md tem o passo a passo do console da Oracle.',
      ].join('\n'),
    );
}
