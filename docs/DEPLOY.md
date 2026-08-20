# Hospedagem — Google Compute Engine (e2-micro Always Free)

Onde este app roda em produção, como colocá-lo lá e como operá-lo depois. A escolha da GCP
saiu de um estudo de preço contra a AWS que não vive mais no repositório; o que sobrou dele
está resumido em [O que **não** existe aqui](#o-que-não-existe-aqui-e-é-de-propósito) e nas
notas de custo abaixo. Aqui é o procedimento.

**Resumo:** uma VM `e2-micro` (2 vCPU compartilhados, 1 GB, 30 GB de disco standard) em
**`us-east1`** (South Carolina), Ubuntu 24.04, rodando a mesma stack `docker compose` de
`deploy/` que roda na sua máquina. A imagem do app **não é construída lá**: o GitHub Actions
constrói a cada push em `main` e publica no GHCR, e a VM só faz `pull` — é isso que faz 1 GB
de RAM bastar, já que o build precisa de ~1150 MiB e o runtime de 305 MiB. Caddy termina o
TLS em `momolados.com.br` (comprado no registro.br) com certificado do Let's Encrypt, e o app
responde sob o prefixo **`/financial`** — `https://momolados.com.br/financial`. Como isso se
configura, e por que não é só uma linha de proxy, está no [§1.3](#13-a-url-base-momoladoscombrfinancial).

**Custo: ~R$ 20/mês**, e ele é inteiramente o **IPv4 público** (US$ 0,005/h). A VM e os 30 GB
de disco estão no *Always Free* da Google, que não expira; o egress fica na franquia de
200 GiB/mês do **Standard Tier** de rede, que é o tier em que esta instalação foi criada de
propósito. Se a fatura vier diferente disso, algo saiu do free tier — comece por
`gcloud compute instances describe financas --zone us-east1-b` e confira `machineType`,
o tipo do disco e o `networkTier`.

A VM tem docker, os arquivos de `deploy/`, o `.env` dela e os volumes. **Não tem git, Node,
pnpm nem este repositório** — tudo que precisa do repo roda da sua máquina, por SSH e por
túnel contra as portas de loopback de lá.

- [Parte 1 — o que só você pode fazer](#parte-1--o-que-só-você-pode-fazer) (uma vez, antes de qualquer script)
- [Parte 2 — o deploy inicial](#parte-2--o-deploy-inicial) (um comando)
- [Parte 3 — acesso à produção](#parte-3--acesso-à-produção) (URL, senha, PWA, convidar a segunda pessoa)
- [Parte 4 — operação](#parte-4--operação) (deploy do dia a dia, migrations, backup, restore)

---

## Parte 1 — o que só você pode fazer

A infraestrutura da GCP **já está criada** (§1.1, com os comandos, para quando precisar
refazer). O que sobra para você são **três** itens — e, hoje, só o primeiro tem trabalho: o
DNS é o que bloqueia o certificado, e nada sobe sem ele.

1. **Apontar o DNS.** O domínio é `momolados.com.br`, registrado no **registro.br**, e há
   dois caminhos — escolha um:

   **(a) DNS no próprio registro.br** (mais simples, é o recomendado aqui): painel do
   registro.br → o domínio → **DNS** → *Editar zona* → registro **`A`** com nome **vazio**
   (ou `@`) → **`35.211.95.169`**. Salve e espere a zona publicar (minutos).

   **(b) Delegar para a Cloudflare:** crie a zona lá, troque os servidores DNS no registro.br
   pelos dois que a Cloudflare der, e crie o `A` → `35.211.95.169` em **DNS only** (nuvem
   **cinza**). ⚠️ Com o proxy (nuvem laranja) ligado, a Cloudflare intercepta o desafio do
   Let's Encrypt na porta 80 e o Caddy **nunca** emite o certificado. A delegação de
   nameservers do registro.br leva algumas horas.

   Nos dois casos, o teste é o mesmo: `dig +short momolados.com.br` tem que devolver
   `35.211.95.169`, e nenhum outro endereço.
2. **Publicar o commit.** `git push origin main` — o CI constrói a imagem e publica no GHCR.
   Sem imagem não há deploy, e é de propósito: nenhum commit vermelho vira produção.
3. **Conferir que o package do GHCR é público** — normalmente não há nada a fazer: como este
   repositório é público, o package `web` herdou a visibilidade dele no primeiro build
   (verificado em 2026-08-19). É isso que dispensa credencial de registry na VM. Se algum dia
   o `pull` lá responder **401**, é aqui: GitHub → **Packages** → `web` → *Package settings* →
   *Change visibility* → **Public**.

### 1.1 O que já foi provisionado, e como refazer

Tudo abaixo já existe no projeto **`financial-app-506021`**. Os comandos estão aqui para
reconstruir a VM do zero (ou entender o que cada peça faz), não para rodar de novo agora.

```bash
gcloud services enable compute.googleapis.com

# O IP fixo, reservado antes da VM: IP efêmero muda a cada parada da máquina e o A da
# Cloudflare passa a apontar para o nada. Standard Tier é o que dá 200 GiB/mês de egress
# grátis — o Premium (default) cobra US$ 0,19/GiB para a América do Sul, sem faixa grátis.
gcloud compute addresses create financas-ip --region us-east1 --network-tier STANDARD

# As duas únicas portas abertas para a internet. A 22 já vem liberada pela regra
# default-allow-ssh da rede default; 443/udp é o HTTP/3, que o Caddy publica.
gcloud compute firewall-rules create financas-allow-web \
  --network default --direction INGRESS --action allow \
  --rules tcp:80,tcp:443,udp:443 --source-ranges 0.0.0.0/0 --target-tags financas

# A VM. e2-micro + 30 GB de disco *standard* (pd-standard, não balanced) é exatamente o
# recorte do Always Free; qualquer coisa maior sai dele e passa a ser cobrada.
printf 'financas:%s\n' "$(cat ~/.ssh/id_ed25519.pub)" > /tmp/ssh-keys.txt
gcloud compute instances create financas --zone us-east1-b \
  --machine-type e2-micro \
  --image-family ubuntu-2404-lts-amd64 --image-project ubuntu-os-cloud \
  --boot-disk-size 30GB --boot-disk-type pd-standard \
  --network-tier STANDARD --address financas-ip --tags financas \
  --metadata-from-file ssh-keys=/tmp/ssh-keys.txt --metadata enable-oslogin=FALSE
```

**Por que a chave SSH vai por metadata e não por `gcloud compute ssh`.** Os scripts deste
repositório falam `ssh` puro (`scripts/lib/remote.mjs`), então a VM precisa aceitar a sua
chave padrão num usuário previsível. A metadata `ssh-keys` cria o usuário **`financas`** com
sudo sem senha, e `enable-oslogin=FALSE` garante que é essa chave que vale — com OS Login
ligado, o usuário vira derivado do e-mail e o `ssh financas@…` não entra.

### 1.2 O `deploy/.env` desta máquina

Já preenchido; está aqui para você reconhecer se precisar mexer:

```bash
DOMAIN=momolados.com.br
DEPLOY_HOST=35.211.95.169
DEPLOY_USER=financas
# DEPLOY_SSH_KEY=~/.ssh/sua_chave   # só se não for a chave padrão
```

Confirme o SSH antes de qualquer comando — `ssh financas@35.211.95.169` tem que entrar. Saia
(`exit`); daqui em diante é script.

### 1.3 A URL base: `momolados.com.br/financial`

> **Aplicado em 2026-08-19.** A tabela abaixo é o que mudou, e continua valendo como mapa: é
> a lista de todo lugar onde o prefixo está escrito à mão. A raiz do domínio redireciona
> (308) para `/financial`.

**O que "URL base" quer dizer aqui.** Servir o app num subcaminho não é rotear `/financial/*`
para o container e pronto: o Next gera URLs absolutas para tudo que ele mesmo serve
(`/_next/static/…`, os `href` dos links, os endpoints das Server Actions). Se o proxy remove o
prefixo e o app não sabe dele, a primeira página carrega e todo o resto responde 404, porque o
navegador pede `/_next/...` e o Caddy não conhece essa rota. Por isso a configuração tem duas
metades que **têm que concordar**: o Next constrói sabendo do prefixo, e o Caddy encaminha
**sem** removê-lo.

**A pegadinha que decide o resto:** `basePath` é **build-time** — a
[documentação do Next](https://nextjs.org/docs/app/api-reference/config/next-config-js/basePath)
diz que o valor é *"inlined in the client-side bundles"* e não muda sem rebuild. Ou seja: o
prefixo fica **assado na imagem**, ao contrário de todo o resto da configuração deste projeto,
que é lida em runtime (CLAUDE.md, convenção 5). Consequência prática: mudar `/financial` de
lugar é um commit + um build do CI + um deploy, não uma variável no `.env`.

#### O que muda, arquivo por arquivo

| # | Arquivo | Mudança |
| - | --- | --- |
| 1 | [`apps/web/next.config.ts`](../apps/web/next.config.ts) | `basePath: '/financial'`. É esta linha que faz o Next emitir `/financial/_next/...` e prefixar todo `next/link` e todo `redirect()` sozinho. |
| 2 | [`deploy/Caddyfile`](../deploy/Caddyfile) | No bloco `{$DOMAIN:localhost}`, trocar o `reverse_proxy web:3000` solto por um `handle /financial*` (ver abaixo). **`handle`, não `handle_path`** — o bloco `:8000` usa `handle_path` porque GoTrue e PostgREST servem na raiz e o prefixo precisa sumir; aqui é o oposto: o Next *espera* receber `/financial/...`. |
| 3 | [`apps/web/public/manifest.webmanifest`](../apps/web/public/manifest.webmanifest) | `start_url`, `scope`, `id`, cada `icons[].src` e o `shortcuts[].url` viram `/financial/...`. Sem isso a PWA instala apontando para a raiz e abre numa tela em branco. |
| 4 | [`apps/web/app/layout.tsx`](../apps/web/app/layout.tsx) | `manifest: '/financial/manifest.webmanifest'` e o `apple` icon idem. O basePath **não** prefixa referências absolutas escritas à mão — a doc do Next diz isso explicitamente para imagens do `public/`. |
| 5 | [`apps/web/components/service-worker.tsx`](../apps/web/components/service-worker.tsx) | `register('/financial/sw.js')`. O escopo de um service worker é o diretório dele, então em `/financial/sw.js` ele controla exatamente `/financial/*` — que é o que se quer. |
| 6 | [`apps/web/public/sw.js`](../apps/web/public/sw.js) | `OFFLINE_URL`, o `PRECACHED` e os prefixos que ele casa (`/_next/static`, `/icons/`) ganham `/financial`. |
| 7 | [`deploy/docker-compose.server.yml`](../deploy/docker-compose.server.yml) | `GOTRUE_SITE_URL: https://${DOMAIN}/financial`. Nada constrói link por e-mail hoje (não há SMTP nem recuperação de senha, por decisão), mas deixar a raiz ali é uma mentira esperando a primeira feature que ler isso. |
| 8 | [`scripts/server.mjs`](../scripts/server.mjs) | A checagem final (`assertPubliclyServed`) pede `https://<domínio>/login`; passa a pedir `https://<domínio>/financial/login`. Sem isso o deploy "falha" num app que está no ar. |
| 9 | [`apps/web/proxy.ts`](../apps/web/proxy.ts) / [`lib/supabase/proxy.ts`](../apps/web/lib/supabase/proxy.ts) | **Conferir, não mudar às cegas.** O gate de sessão compara `request.nextUrl.pathname` com `/login` e redireciona clonando a URL. O Next tira o basePath do `pathname` e o repõe ao serializar, então isso *deve* continuar valendo — mas é o único ponto que depende de comportamento implícito, e é o primeiro a testar depois da mudança: entrar deslogado em `/financial/transactions` tem que cair em `/financial/login`, não em `/login`. |
| 10 | [`Dockerfile`](../Dockerfile) | O `HEALTHCHECK` pede `/financial/login`. Foi o item que passou batido na primeira vez: o `wget --spider` num `/login` seco recebe 404, sai 1, e o container fica `unhealthy` com o Next no ar — `docker compose up --wait` derruba o deploy com "container financas-web-1 is unhealthy" sem nada estar quebrado. Como `basePath` está assado na mesma imagem, o healthcheck dela tem que conhecer o prefixo. |

O bloco do Caddy fica assim:

```caddyfile
{$DOMAIN:localhost} {
	# handle, não handle_path: o prefixo faz parte do que o Next espera receber.
	handle /financial* {
		reverse_proxy web:3000
	}

	# A raiz não é do app. Mandar para ele é mais gentil que um 404 — e continua sendo
	# uma porta só: nada aqui roteia para `auth` ou `rest`.
	handle {
		redir https://{host}/financial{uri} 308
	}
}
```

#### O que foi verificado, e como repetir

Duas coisas desta lista não são opinião — foram medidas contra o servidor de dev com o
`basePath` já ligado, e é assim que se confere de novo:

```bash
curl -s http://127.0.0.1:3000/financial/login | grep -oE '(href|src)="[^"]*"' | sort -u
```

- **O que o Next prefixa sozinho:** todo `/_next/static/...`, os `href` de `next/link` e os
  `redirect()`. Confirmado: `GET /financial/transactions` deslogado responde **307 para
  `/financial/login`**, não para `/login` — que era a única dúvida real da tabela (item 9).
- **O que ele não prefixa:** as URLs escritas à mão em `metadata`. Antes da correção o HTML
  saía com `href="/manifest.webmanifest"` e `href="/icons/icon-192.png"` — ou seja, 404 —
  enquanto os arquivos passaram a ser servidos em `/financial/...`. Item 4 da tabela.
- **Um vizinho que apareceu no teste:** `sw.js` e `offline.html` não estavam na lista de
  exclusões do gate de sessão em [`apps/web/proxy.ts`](../apps/web/proxy.ts) e respondiam
  **307 para o login** quando pedidos sem sessão — que é exatamente como o navegador os pede.
  Isso já era verdade antes do subcaminho; foi corrigido junto, porque é o que faz o service
  worker instalar e a tela de offline existir.

#### Como testar antes de subir

O `pnpm dev` roda o Next no host, então o prefixo aparece lá também — a URL local vira
`http://127.0.0.1:3000/financial`. É de propósito: o mesmo prefixo nos dois lugares é o que
faz "funciona local" continuar significando alguma coisa. Para ver o conjunto real
(Caddy + imagem + prefixo), `pnpm stack prod`.

Roteiro mínimo depois de aplicar: abrir `/financial` deslogado (tem que ir para
`/financial/login`), entrar, navegar entre as seis abas, recarregar com F5 numa aba interna
(pega link errado de asset), e no iPhone reinstalar a PWA — a instalada hoje aponta para a
raiz e **não** se corrige sozinha.

#### A alternativa mais barata, se você quiser considerar

Um **subdomínio** (`financas.momolados.com.br`) custa **zero linha de código**: é um `A` a mais
no registro.br e o `DOMAIN` do `.env`. Todo o trabalho acima existe só porque a escolha foi
subcaminho. Vale a pena se `momolados.com.br` for hospedar outras coisas na raiz; se for só o
app, o subdomínio entrega o mesmo resultado sem assar caminho nenhum na imagem.

---

## Parte 2 — o deploy inicial

Na **sua máquina**, no repositório, com a Parte 1 feita:

```bash
git push origin main                 # o CI constrói e publica a imagem deste commit
pnpm server init --owner voce@exemplo.com
```

O `init` faz, em ordem, e para no primeiro erro:

1. confere que a imagem `sha-<commit>` **existe no GHCR** — sem imagem não há deploy
   (`--wait` espera o CI terminar);
2. instala Docker + compose v2 e ajusta o fuso para `America/Sao_Paulo`;
3. cria um **swapfile de 2 GB** — 1 GB de RAM com Postgres e mais quatro containers pede
   margem;
4. envia os arquivos de `deploy/` (compose, Caddyfile, `init/`, `backup.sh`, as units do
   systemd);
5. **gera os segredos de produção aqui**, envia como `deploy/.env` da VM e apaga a cópia
   local. Eles são novos: os segredos de produção não podem ser os que estão num laptop;
6. instala o timer de backup diário;
7. puxa a imagem do GHCR e sobe a stack na ordem obrigatória — `db` → `auth` saudável →
   migrations (por túnel SSH, daqui) → `rest`, `caddy` e `web` — e provisiona o dono;
8. confere que todo container está saudável e que `https://momolados.com.br/financial/login` responde.

**A senha do dono é impressa uma única vez, no passo 7.** Anote na hora. Se perder,
`pnpm db:password --remote voce@exemplo.com` gera outra.

O primeiro certificado leva alguns segundos; se o passo 8 falhar, ele lista o que costuma
estar errado, na ordem. `pnpm server logs caddy` mostra o que o ACME respondeu.

### Levar os dados que já existem na sua máquina

O `init` deixa uma produção vazia, com o dono provisionado. Se você já usa o app localmente
— e usa —, os dados reais vão junto assim:

```bash
pnpm db:dump                                   # salva o banco local em deploy/backups/
pnpm db:restore --remote deploy/backups/manual-<data>.dump
```

O restore **substitui** a produção inteira, inclusive as contas: depois dele você entra com
o mesmo e-mail e a **mesma senha que usa localmente**, não a que o `init` imprimiu. O
household criado pelo `db:owner` na VM é descartado junto — é por isso que não sobra
household duplicado. Detalhes em [Backup e restore](#backup-e-restore).

---

## Parte 3 — acesso à produção

### Qual URL eu abro

**https://momolados.com.br/financial** — a mesma no desktop e no iPhone. Não existe outra: `127.0.0.1:3000`
é a sua máquina, e a API do Supabase não tem endereço público em lugar nenhum.

### Instalar a PWA no iPhone

1. Abra `https://momolados.com.br/financial` no **Safari** (não no Chrome — só o Safari instala PWA no iOS).
2. Faça login.
3. Botão de compartilhar (o quadrado com a seta) → **Adicionar à Tela de Início**.
4. Confirme o nome ("Finanças") → **Adicionar**.

O ícone entra na tela inicial e abre em tela cheia, sem barra do Safari. É isto que o HTTPS
compra: sem _secure context_ o `public/sw.js` não registra e o "Adicionar à Tela de Início"
vira só um atalho de navegador.

Atalho útil: segure o ícone → **Nova despesa** cai direto no formulário.

### De onde vêm meu e-mail e minha senha

O e-mail é o que você passou em `--owner`. A senha foi **gerada e impressa uma única vez**
pelo `pnpm db:owner`, que o `init` chamou por dentro.

Os três scripts de provisionamento aceitam `--remote`, e é assim que se fala com a produção
daqui:

```bash
pnpm db:owner    --remote voce@exemplo.com     # idempotente: não troca a senha de quem já existe
pnpm db:invite   --remote esposa@exemplo.com   # a segunda pessoa da casa
pnpm db:password --remote esposa@exemplo.com   # redefine a senha
```

Com `--remote` eles abrem um **túnel SSH** até a porta 8000 da VM e usam a chave de service
role **de lá**, lida do `deploy/.env` da VM no momento do comando e mantida em memória. Não
existe uma segunda cópia dos segredos de produção nesta máquina, e a API do Supabase
continua sem porta pública.

O `db:invite` funciona na hora, sem a pessoa precisar entrar antes: o household existe desde
o `db:owner`, porque o trigger `provision_user` dispara no **insert** em `auth.users` e não
no primeiro login. O script põe o e-mail na allowlist já apontando para o household
existente — é isso que faz os dois verem os mesmos dados em vez de cada um cair numa casa
própria.

**Trocar senha e recuperar senha não existem na UI, por decisão.** Não há tela de
"esqueci minha senha" e não deve haver: um fluxo de recuperação por e-mail traria o SMTP de
volta, que é exatamente a dependência que a Fase 9 removeu.

---

## Parte 4 — operação

### O deploy de todo dia

```bash
git push origin main      # o CI constrói e publica ghcr.io/.../web:sha-<commit>
pnpm server               # a VM puxa essa tag e sobe
```

O `pnpm server` resolve a tag pelo `HEAD` daqui, **confere que ela existe no GHCR**,
sincroniza os arquivos de `deploy/`, grava `WEB_IMAGE_TAG` no `.env` da VM, dá `pull`, tira
um dump **se houver migration pendente**, aplica as migrations por túnel, sobe sem derrubar
o banco, espera todos os healthchecks, confere o HTTPS de fora e poda as imagens antigas.
Falha alto em qualquer um desses passos.

**O deploy depende do CI ter publicado a imagem.** Se o commit ainda não subiu, se o CI ainda
está rodando ou se ele falhou, não há tag para subir e o comando para dizendo isso — nunca
sobe uma versão antiga em silêncio. `pnpm server --wait` espera o CI (até 20 min).

É idempotente: rodar duas vezes sem commit novo não faz nada — nem sequer um dump a mais,
porque o dump é condicionado a haver migration pendente, não à execução do deploy.

```bash
pnpm server --wait               # espera o CI publicar a imagem do HEAD
pnpm server --tag sha-abc1234    # sobe uma tag específica — é assim que se faz rollback
pnpm server status               # imagem no ar, saúde dos containers, backups, próximo timer
pnpm server logs [svc]           # db, auth, rest, caddy, web
pnpm server ssh                  # um shell, já no /opt/financas/deploy
```

Não existe `pnpm server run <script>`: não há pnpm na VM. O equivalente é a flag `--remote`
dos scripts daqui (`pnpm db:invite --remote`, `pnpm db:dump --remote`, …).

### Migrations remotas

A rotina normal **não precisa de nada especial**: você commita a migration, dá push, roda
`pnpm server`, e o `supabase db push` acontece **daqui**, contra o Postgres da VM por um
túnel SSH até `127.0.0.1:5432` de lá. A porta continua publicada só em loopback na VM, e a
CLI continua sendo a única dona do schema — ela só passou a rodar sempre nesta máquina.

Depois de criar migration nova, o de sempre: `pnpm dev` aplica localmente e
`pnpm stack types` regenera os tipos (o typecheck quebra sem isso). O `pnpm server` leva as
duas coisas para produção.

Quando você quiser apontar a CLI para o banco de produção à mão — inspecionar, gerar tipos
de lá —, é o mesmo túnel, aberto por você:

```bash
ssh -N -L 55432:127.0.0.1:5432 financas@35.211.95.169   # deixe rodando num terminal

# no outro, com a senha do deploy/.env da VM (pnpm server ssh; cat .env)
pnpm exec supabase db push --db-url \
  "postgresql://postgres:<POSTGRES_PASSWORD>@127.0.0.1:55432/postgres?sslmode=disable"
```

`sslmode=disable` é honesto aqui: o Postgres do compose não fala TLS, e quem cifra é o SSH.

### Backup e restore

Um dump por noite na VM, às 03:20 (horário de São Paulo), por um timer do systemd que roda
`deploy/backup.sh` — shell puro, porque não há Node lá. Retenção: **7 diários**. O mesmo
diretório guarda os dumps `pre-deploy` (antes de cada migration, 7) e `pre-restore` (antes de
cada restore, 3) — a poda é por rótulo, então uma tarde movimentada de deploys não come o
histórico das noites.

**O formato é um só.** O dump noturno, o de antes da migration e o `pnpm db:dump` daqui usam
as mesmas flags de `pg_dump` (`--format=custom`, `public` + `auth` + `supabase_migrations`),
e por isso todos são restauráveis pelo mesmo `pnpm db:restore`.

```bash
pnpm server status            # quando foi o último, quando é o próximo
pnpm db:dump                  # dump do banco local em deploy/backups/
pnpm db:dump --remote         # dump da VM, transmitido direto para um arquivo aqui
```

O `--remote` **transmite**: o `pg_dump` roda dentro do container `db` da VM e a saída vem
pela conexão SSH para o arquivo local. Não fica arquivo intermediário lá, e não há `scp`
depois. Trazer uma cópia para o seu Mac de vez em quando é o que transforma isto em backup
de verdade — os dumps da VM moram no mesmo disco do banco.

Restaurar:

```bash
pnpm db:restore --latest                  # o mais novo daqui, no banco local
pnpm db:restore --remote <arquivo local>  # sobe este dump e restaura na VM
pnpm db:restore --remote --latest         # o dump mais novo da VM, restaurado lá (rollback)
```

Ele pede confirmação (`--yes` pula), tira um dump de segurança do que está prestes a
destruir, e conta as linhas em voz alta no final.

#### O que o restore faz, e por que assim

O dump carrega três schemas: `public` (os dados), `auth` (as contas do GoTrue) e
`supabase_migrations` (o histórico da CLI). Não carrega os roles nem as extensões — esses
vêm da imagem `supabase/postgres` e do próprio GoTrue, e por isso o restore exige uma stack
que já subiu ao menos uma vez, nunca um Postgres pelado.

O restore **substitui** a instalação: derruba `auth`, `rest` e `web`, apaga os três schemas e
carrega o dump numa transação só. É a decisão que resolve a armadilha do `provision_user` —
o trigger dispara no `insert` em `auth.users` e cria household, então trazer usuários por
cima de um banco já provisionado por `db:owner` deixaria dois. Apagando antes não há nada
para inserir por cima; e, de quebra, um `pg_restore` completo carrega os dados **antes** de
recriar os triggers, então nada está ligado no momento em que as linhas entram.

Três consequências que valem saber:

- **As sessões ativas morrem** quando o dump vem de outra instalação: o `JWT_SECRET` de lá é
  outro. É esperado — é só entrar de novo.
- **As senhas atravessam.** O hash bcrypt em `auth.users.encrypted_password` não é assinado
  por nada; ele vem no dump e continua valendo.
- **`external_id` e `external_ref` vêm junto**, porque o dump é completo. São eles que fazem
  o import de CSV e o da posição da XP serem idempotentes; um restore que os
  perdesse duplicaria tudo no import seguinte, em silêncio.

### Atualizar o sistema da VM

```bash
pnpm server ssh
sudo apt update && sudo apt upgrade -y
sudo reboot     # quando pedir; a stack volta sozinha (restart: unless-stopped)
```

Vale de vez em quando. O `Persistent=true` do timer garante que o backup da noite em que a
VM estava desligada acontece no boot seguinte, em vez de ser pulado.

### A VM pelo lado da Google

```bash
gcloud compute instances list                                   # está de pé?
gcloud compute instances stop  financas --zone us-east1-b       # para de rodar; o IP fica
gcloud compute instances start financas --zone us-east1-b       # volta com o mesmo IP
gcloud compute instances get-serial-port-output financas --zone us-east1-b | tail -40
gcloud compute disks snapshot financas --zone us-east1-b \
  --snapshot-names financas-$(date +%Y%m%d)                     # cobrado à parte, ~US$ 0,03/GB
```

Três coisas que valem saber sobre esta hospedagem em particular:

- **Parar a VM não zera a conta.** O IPv4 reservado é cobrado com a máquina parada (é a
  tarifa `IdleAddress`, o mesmo US$ 0,005/h). O jeito de parar de pagar é liberar o IP —
  e aí o DNS quebra. Parar a VM só economiza o que já era grátis.
- **A Google não tem teto de gasto, só alerta.** Vale criar um orçamento em
  *Billing → Budgets & alerts* com alerta em, digamos, US$ 10/mês: qualquer coisa acima
  disso significa que algo saiu do free tier (disco `balanced` em vez de `standard`, uma
  segunda VM, network tier Premium).
- **O disco grátis é HDD** (`pd-standard`). Para um banco de 11 MB que cabe em page cache
  isso não aparece em runtime; aparece num `docker pull` e num `apt upgrade`, que são
  visivelmente mais lentos que num SSD. É o preço do free tier, e é aceito.

---

## O que **não** existe aqui, e é de propósito

- **Build na VM.** Ela tem 1 GB de RAM e o `next build` precisa de ~1150 MiB (medido),
  contra 305 MiB do runtime. Quem constrói é o CI; a VM puxa a imagem. Consequência
  aceita: o deploy deixou de ser autossuficiente — ele depende do CI ter terminado.
- **Deploy automático.** O CI publica a imagem; quem faz o deploy é você, com `pnpm server`.
  Para duas pessoas isso é uma feature: o deploy acontece quando você está olhando.
- **Studio em produção.** Ele está atrás de um profile e não sobe na VM. Um painel de
  administração do banco exposto é o oposto do que esta stack quer. Para olhar dados lá,
  túnel SSH até a 5432 e `psql`.
- **Qualquer porta pública além de 80 e 443.** Postgres, a API do Supabase e o app ficam em
  `127.0.0.1` dentro da VM, e é por túnel que se chega neles.
- **Segundo ambiente (staging).** Não há.
