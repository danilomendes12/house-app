# A stack

Postgres + GoTrue + PostgREST atrás do Caddy, em `docker compose`. **Isto é o Supabase** —
as mesmas peças que o produto hospedado roda, self-hosted, menos tudo que o app não usa.

Você não sobe nada daqui à mão: quem dirige é o `pnpm dev` na sua máquina e o `pnpm server`
na VM, os dois da raiz do repositório. Este documento existe para quando algo quebrar e você
precisar saber o que é cada container; o procedimento de hospedagem está em
[`docs/DEPLOY.md`](../docs/DEPLOY.md).

| Serviço  | Imagem                         | Publica             | Papel                                                                                       |
| -------- | ------------------------------ | ------------------- | ------------------------------------------------------------------------------------------- |
| `db`     | `supabase/postgres:17.6.1.156` | `5432` em loopback  | Postgres, schema `auth`, roles `anon`/`authenticated`/`service_role`                        |
| `auth`   | `supabase/gotrue:v2.194.0`     | —                   | **é o Supabase Auth**: guarda `auth.users`, valida a senha, emite o JWT                     |
| `rest`   | `postgrest/postgrest:v14.15`   | —                   | **é a API REST do Supabase**: é com ela que o `supabase-js` fala, e é onde a RLS é aplicada |
| `caddy`  | `caddy:2.10.2-alpine`          | `8000` em loopback  | dá uma origem única às duas acima                                                           |
| `studio` | `supabase/studio`              | `54323` em loopback | UI do banco. Profile `studio`, desligado por padrão                                         |
| `meta`   | `supabase/postgres-meta`       | —                   | como o Studio lê e escreve o schema. Profile `studio`                                       |
| `web`    | build local (`../Dockerfile`)  | `3000` em loopback  | o app. Profile `web` — desligado aqui, sempre ligado no servidor                            |

Aqui nenhuma porta sai de `127.0.0.1`, e nenhuma imagem é `latest`. No servidor a única
diferença são as portas **80 e 443** do Caddy.

## Os dois arquivos

| Arquivo                     | Quando                     | O que carrega                                                           |
| --------------------------- | -------------------------- | ----------------------------------------------------------------------- |
| `docker-compose.yml`        | sempre                     | tudo: imagens, wiring, segredos, healthchecks, ordem de subida          |
| `docker-compose.server.yml` | só na VM, layerizado sobre | 80/443 no Caddy, `DOMAIN` obrigatório, `GOTRUE_SITE_URL` real, `web` on |

Você não escolhe entre eles: o `deploy/.env` da instalação diz `DEPLOY_TARGET=server`, e os
scripts layerizam o segundo sozinhos. Uma flag a digitar seria uma flag a esquecer, e
esquecê-la significa operar o servidor com a configuração do laptop.

Manter essa diferença pequena é o ponto — se ela crescer, "funciona na minha máquina" para
de significar alguma coisa.

## Por que o Caddy existe

Dois motivos, um em cada bloco do `Caddyfile`.

**`:8000` — dar uma origem só à API.** O `supabase-js` é construído em torno de **uma** URL
base: ele chama `/auth/v1/token` e `/rest/v1/<tabela>` embaixo dela. Só que essas duas rotas
são dois containers diferentes. O Caddy é o que junta os dois — e é o que substitui o
**Kong**, o gateway oficial do Supabase. Kong existe para key-auth, CORS e rate limit de uma
API _pública_. Aqui a API não é pública: quem fala com ela é o servidor Next, o role `anon`
não tem grant nenhum (as migrations revogam tudo) e o PostgREST valida o JWT sozinho. Sobrou
roteamento de prefixo, que o Caddy faz em 12 linhas. **Este bloco é privado nas duas
instalações.**

**`{$DOMAIN}` — o app, com TLS.** `reverse_proxy web:3000`, com certificado do Let's Encrypt
obtido e renovado pelo próprio Caddy em 80/443. É o único endereço público do projeto. Sem
ele não há _secure context_, sem _secure context_ o `public/sw.js` não registra, e o iPhone
não instala a PWA — que é o caso de uso nº 1. Aqui `DOMAIN` não existe e o bloco cai em
`localhost`, para o qual o Caddy usa a CA interna e não fala com ninguém; as portas 80/443
nem chegam a ser publicadas.

## Como o app acha a API

O mesmo endereço tem três nomes, e a diferença é só de onde você olha:

| Quem                                        | `SUPABASE_URL`          |
| ------------------------------------------- | ----------------------- |
| `pnpm dev` (Next no host)                   | `http://127.0.0.1:8000` |
| container `web` (`pnpm stack prod`, e a VM) | `http://caddy:8000`     |
| scripts rodando na VM fora do container     | `http://127.0.0.1:8000` |

Confundir os dois primeiros dá `ECONNREFUSED`, não 401 — o 401 é o sintoma do outro erro,
mandar a chave certa para a stack errada.

O browser nunca fala com nenhum dos três. Todo acesso a dados é Server Component, Server
Action ou Route Handler — é por isso que não existe var `NEXT_PUBLIC_*` neste projeto, e é
por isso que a API do Supabase **não tem porta pública em lugar nenhum**, nem na VM.

## Segredos

`deploy/.env`, escrito por `scripts/gen-secrets.mjs` na primeira subida. É o **único**
arquivo de env do repositório: o compose lê dele, e o `pnpm dev` passa os três valores
`SUPABASE_*` para o Next que ele inicia.

A VM tem o **seu próprio** `deploy/.env`, gerado lá por `gen-secrets.mjs --server` durante o
`pnpm server init` — nunca copiado daqui. Os segredos de produção não podem ser os que
ficaram num laptop. Ele ganha duas linhas a mais, `DEPLOY_TARGET=server` e `DOMAIN`.

Só segredos e portas. Quem é o dono da instalação não está aqui — isso é fato do banco,
escrito uma vez por `pnpm db:owner <email>` (SPEC §12).

Os quatro valores gerados (`POSTGRES_PASSWORD`, `JWT_SECRET`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`) **não se editam à mão**: as duas chaves são JWTs assinados com
o `JWT_SECRET`, e se os três divergirem o único sintoma é um 401 sem explicação.

Nunca reaproveite as chaves do stack local da Supabase CLI: elas são **fixas e públicas**,
iguais em toda instalação. Em qualquer coisa alcançável de fora da máquina, qualquer pessoa
forja um token `service_role` e a RLS inteira vira decoração. Nenhuma variável do compose
tem default — o stack se recusa a subir sem elas em vez de cair nas chaves públicas.

## Ordem de subida

`db` → `auth` saudável → migrations → resto. Não é preferência: o GoTrue cria a tabela
`auth.users` nas migrations _dele_, e a nossa primeira migration põe um trigger em cima
dessa tabela. Subir tudo de uma vez faz o `db push` falhar. O `pnpm dev` respeita isso em
duas fases — e o `pnpm server`, na VM, é o mesmo script fazendo o mesmo.

## Operação

```bash
pnpm stack logs [serviço]   # db, auth, rest, caddy, studio, web
pnpm stack down             # para tudo (os dados ficam no volume nomeado)
pnpm stack reset            # para e apaga o banco
docker compose exec db psql -U postgres   # daqui, quando o Studio for demais
```

No servidor os mesmos comandos existem, a partir daqui e sem SSH à mão:

```bash
pnpm server            # o deploy de todo dia
pnpm server status     # commit, saúde dos containers, backups
pnpm server logs [svc]
pnpm server ssh        # um shell, já no repositório
```

Volumes: `db-data` (Postgres), `caddy-data`, `caddy-config`. `pnpm stack down` preserva
todos; só o `reset` apaga. Na VM o `caddy-data` guarda o certificado — apagá-lo faz o Caddy
pedir outro ao Let's Encrypt, e há limite de emissões por semana.

## Armadilhas

- **`POSTGRES_PASSWORD` só vale na primeira subida.** `init/zz-role-passwords.sql` roda uma
  única vez, com o volume vazio — a imagem `supabase/postgres` cria os roles mas **não** dá
  senha a eles, e sem esse arquivo o GoTrue morre no boot com _password authentication
  failed_. Trocar a senha no `.env` depois disso deixa arquivo e banco discordando. Para
  trocar de verdade: `ALTER USER postgres/supabase_auth_admin/authenticator WITH PASSWORD
'...'` no banco, e só então no arquivo.
- **`JWT_SECRET` assina as duas chaves.** Regerar o `.env` invalida toda sessão ativa e
  exige subir `auth`, `rest` e `web` juntos de novo.
- **A porta 3000 é disputada.** `pnpm dev` (Next no host) e `pnpm stack prod` (container
  `web`) querem a mesma. Os dois avisam em vez de falhar torto; rode um de cada vez, ou
  `WEB_PORT=3001 pnpm stack prod`.

## Backup

`pnpm db:dump` e `pnpm db:restore`, os dois servindo ao local e ao servidor. Na VM um timer
do systemd (`deploy/systemd/`) roda o dump toda noite às 03:20, com retenção de 7 diários.
O dump carrega `public` + `auth` + `supabase_migrations`; os roles e as extensões não vão
nele porque vêm da imagem, e é por isso que o restore exige uma stack que já subiu.

O procedimento inteiro, com as armadilhas (o `provision_user` criando household duplicado, o
`JWT_SECRET` diferente, o `external_id` que garante a idempotência do import), está em
[`docs/DEPLOY.md`](../docs/DEPLOY.md).

## O que **não** está aqui

- **Kong.** A API não é pública — o Caddy roteia.
- **Studio em produção.** Ele está atrás de um profile e não sobe na VM: num servidor seria
  um painel de administração do banco exposto, o oposto do que esta stack quer. Para olhar
  dados lá, túnel SSH até a 5432 e `psql`.
- **Realtime, Storage, imgproxy, Logflare, Supavisor.** O app não usa nenhum.
- **Qualquer porta pública além de 80 e 443**, inclusive na VM. Postgres, a API do Supabase
  e o Studio ficam em `127.0.0.1` lá também.
