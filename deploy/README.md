# A stack

Postgres + GoTrue + PostgREST atrás do Caddy, em `docker compose`. **Isto é o Supabase** —
as mesmas peças que o produto hospedado roda, self-hosted, menos tudo que o app não usa.

Você não sobe nada daqui à mão: quem dirige é o `pnpm dev`, da raiz do repositório. Este
documento existe para quando algo quebrar e você precisar saber o que é cada container.

| Serviço  | Imagem                         | Publica             | Papel                                                                                       |
| -------- | ------------------------------ | ------------------- | ------------------------------------------------------------------------------------------- |
| `db`     | `supabase/postgres:17.6.1.156` | `5432` em loopback  | Postgres, schema `auth`, roles `anon`/`authenticated`/`service_role`                        |
| `auth`   | `supabase/gotrue:v2.194.0`     | —                   | **é o Supabase Auth**: guarda `auth.users`, valida a senha, emite o JWT                     |
| `rest`   | `postgrest/postgrest:v14.15`   | —                   | **é a API REST do Supabase**: é com ela que o `supabase-js` fala, e é onde a RLS é aplicada |
| `caddy`  | `caddy:2.10.2-alpine`          | `8000` em loopback  | dá uma origem única às duas acima                                                           |
| `studio` | `supabase/studio`              | `54323` em loopback | UI do banco. Profile `studio`, desligado por padrão                                         |
| `meta`   | `supabase/postgres-meta`       | —                   | como o Studio lê e escreve o schema. Profile `studio`                                       |
| `web`    | build local (`../Dockerfile`)  | `3000` em loopback  | build de produção do Next. Profile `prod`, desligado por padrão                             |

Nenhuma porta sai de `127.0.0.1`, e nenhuma imagem é `latest`.

## Por que o Caddy existe

O `supabase-js` é construído em torno de **uma** URL base: ele chama `/auth/v1/token` e
`/rest/v1/<tabela>` embaixo dela. Só que essas duas rotas são dois containers diferentes.
O Caddy é o que junta os dois em `:8000` — e é o que substitui o **Kong**, o gateway
oficial do Supabase.

Kong existe para key-auth, CORS e rate limit de uma API _pública_. Aqui a API não é
pública: quem fala com ela é o servidor Next, o role `anon` não tem grant nenhum (as
migrations revogam tudo) e o PostgREST valida o JWT sozinho. Sobrou roteamento de prefixo,
que o Caddy faz em 12 linhas.

## Como o app acha a API

O mesmo endereço tem dois nomes, e a diferença é de onde você olha:

| Quem                                | `SUPABASE_URL`          |
| ----------------------------------- | ----------------------- |
| `pnpm dev` (Next no host)           | `http://127.0.0.1:8000` |
| container `web` (`pnpm stack prod`) | `http://caddy:8000`     |

O browser nunca fala com nenhum dos dois. Todo acesso a dados é Server Component, Server
Action ou Route Handler — é por isso que não existe var `NEXT_PUBLIC_*` neste projeto.

## Segredos

`deploy/.env`, escrito por `scripts/gen-secrets.mjs` na primeira subida. É o **único**
arquivo de env do repositório: o compose lê dele, e o `pnpm dev` passa os três valores
`SUPABASE_*` para o Next que ele inicia.

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
duas fases.

## Operação

```bash
pnpm stack logs [serviço]   # db, auth, rest, caddy, studio, web
pnpm stack down             # para tudo (os dados ficam no volume nomeado)
pnpm stack reset            # para e apaga o banco
docker compose exec db psql -U postgres   # daqui, quando o Studio for demais
```

Volumes: `db-data` (Postgres), `caddy-data`, `caddy-config`. `pnpm stack down` preserva
todos; só o `reset` apaga.

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

## O que **não** está aqui

Nada disto existe hoje, e a ausência é deliberada — a hospedagem ainda não foi escolhida
(SPEC §11, Q5), e configuração para uma infra inexistente é o que faz um repositório
parecer que descreve outro projeto:

- **Bloco público do Caddy, domínio e TLS.** Sem servidor não há certificado a emitir.
  Quando houver, volta um bloco `{$DOMAIN} { reverse_proxy web:3000 }` e o `web` sai do
  profile `prod`. Vale lembrar do custo de não ter domínio: sem HTTPS não há _secure
  context_, e sem ele o service worker de `public/sw.js` não registra — o iPhone não
  instala a PWA.
- **Backup automático.** O `pg_dump` diário fazia sentido num VPS onde o disco é sua
  responsabilidade. Na sua máquina, o backup é o Time Machine. Volta junto com o servidor,
  e junto com o teste de restore — backup que nunca foi restaurado não é backup.
- **Kong, Studio em produção, Realtime, Storage, imgproxy, Logflare, Supavisor.** O app não
  usa nenhum. O Studio existe aqui como ferramenta de desenvolvimento, atrás de um profile;
  num servidor ele seria um painel de administração do banco exposto, que é o oposto do que
  este stack quer.
