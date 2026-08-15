# Deploy — VM própria com `docker compose`

Stack self-hosted do app: Next.js + Postgres + GoTrue + PostgREST atrás do Caddy, sem
Vercel e sem Supabase hospedado. Fonte da verdade das decisões: `docs/SPEC.md` §5.1, §5.3
e §5.4.

| Serviço  | Imagem                         | Publica                    | Papel                                 |
| -------- | ------------------------------ | -------------------------- | ------------------------------------- |
| `caddy`  | `caddy:2.10.2-alpine`          | **80/443** + `:8000` local | TLS automático, proxy do app e da API |
| `web`    | build local (`../Dockerfile`)  | —                          | Next.js standalone                    |
| `db`     | `supabase/postgres:17.6.1.156` | `5432` só em loopback      | Postgres, schema `auth` e roles       |
| `auth`   | `supabase/gotrue:v2.194.0`     | —                          | `/auth/v1/*`                          |
| `rest`   | `postgrest/postgrest:v14.15`   | —                          | `/rest/v1/*`                          |
| `backup` | `postgres:17.7-alpine`         | —                          | `pg_dump` diário, 14 dias de retenção |

As tags são as **mesmas** que a Supabase CLI usa no stack local — dev e produção rodam o
mesmo Postgres e o mesmo GoTrue, e nenhuma imagem é `latest`.

Só a porta 80/443 fica exposta na VM. A API do Supabase (`:8000`) e o Postgres (`5432`)
escutam apenas em `127.0.0.1`: são acesso de manutenção, alcançáveis de fora só por túnel
SSH. Quem fala com a API é o container `web`, pela rede interna do Docker — o browser
nunca fala com o Supabase, e é por isso que não existe Kong aqui.

## Pré-requisitos

- Uma VM com Docker e Docker Compose, e o repositório clonado nela (a imagem do app é
  construída localmente).
- Um **domínio** apontando para o IP da VM. Com domínio o Caddy emite o certificado
  sozinho, e é o HTTPS que devolve o _secure context_ sem o qual o service worker da PWA
  não registra (o iPhone não instala o app).
- Na sua máquina de desenvolvimento: Node e pnpm, para rodar as migrations e o
  provisionamento. Nada disso precisa estar na VM.

## Instalação

### 1. Segredos

```bash
node scripts/gen-secrets.mjs        # escreve deploy/.env (modo 600)
```

Preencha `DOMAIN`, `TLS_EMAIL` e `OWNER_EMAIL`. Os quatro valores gerados
(`POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`) **não** se editam à
mão: as duas chaves são JWTs assinados com o `JWT_SECRET`, e se os três divergirem o
sintoma é um 401 sem explicação. Guarde o arquivo em algum lugar seguro; ele não é
recuperável e não vai para o git.

Nunca use as chaves do stack local da CLI: elas são **fixas e públicas**, iguais em toda
instalação. Expostas, qualquer pessoa forja um token `service_role` e a RLS inteira vira
decoração.

### 2. Banco e autenticação, nessa ordem

```bash
cd deploy
docker compose up -d db auth
docker compose ps          # espere `auth` ficar (healthy)
```

A ordem importa: o GoTrue cria a tabela `auth.users` nas migrations dele, e a nossa
primeira migration põe um trigger **em cima dessa tabela**. Subir tudo de uma vez faria o
`db push` do próximo passo falhar.

### 3. Migrations

Rodadas da sua máquina, com a Supabase CLI — que continua sendo a única dona do schema.
Abra o túnel para as portas de manutenção:

```bash
ssh -L 5432:127.0.0.1:5432 -L 8000:127.0.0.1:8000 usuario@vm
```

e, em outro terminal, na raiz do repositório:

```bash
pnpm exec supabase db push \
  --db-url "postgresql://postgres:$POSTGRES_PASSWORD@127.0.0.1:5432/postgres?sslmode=disable"
```

`sslmode=disable` é obrigatório: o Postgres do compose não fala TLS, e quem cifra o
caminho é o túnel SSH.

### 4. Resto do stack

```bash
docker compose up -d       # constrói a imagem do app na primeira vez
```

### 5. Usuários

Com o túnel aberto, da raiz do repositório:

```bash
SUPABASE_URL=http://127.0.0.1:8000 \
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY do deploy/.env> \
OWNER_EMAIL=voce@exemplo.com \
  pnpm db:owner

# depois, a segunda pessoa (a ordem importa: o convite lê o household do dono)
SUPABASE_URL=http://127.0.0.1:8000 \
SUPABASE_SERVICE_ROLE_KEY=<...> OWNER_EMAIL=voce@exemplo.com \
  pnpm db:invite namorada@exemplo.com
```

Cada script imprime **uma vez** a senha gerada. Anote na hora: ela não é recuperável, e
não existe "esqueci minha senha" na UI — o reset é `pnpm db:password <email>`, com as
mesmas variáveis acima.

Pronto: `https://<DOMAIN>` pede e-mail e senha.

## Atualizar o app

```bash
git pull
docker compose up -d --build web
```

Se a atualização trouxer migrations novas, rode o passo 3 antes (com o túnel aberto).

## Backup e restore

O serviço `backup` roda um `pg_dump` completo (schema + dados, `public` e `auth`) ao subir
e a cada 24 h, no volume `backups`, apagando o que passa de 14 dias. Para copiar um dump
para fora da VM — que é o que o transforma em backup de verdade:

```bash
docker compose cp backup:/backups/financas-2026-08-15.sql.gz .
```

### Restore

Testado. Restaura em um banco **vazio** — o dump traz o schema inteiro, inclusive os
usuários, então nada precisa ser provisionado de novo:

```bash
docker compose down
docker volume rm financas_db-data      # o banco vai embora aqui; tenha o dump em mãos
docker compose up -d db                # a imagem recria roles e schema base
docker compose ps                      # espere (healthy)

gunzip -c financas-2026-08-15.sql.gz | docker compose exec -T db psql -U supabase_admin -d postgres

docker compose up -d
```

O restore é como `supabase_admin` (superusuário) porque o schema `auth` pertence a ele;
como `postgres` a restauração falha em centenas de objetos. O dump, esse sim, é feito como
`postgres` — é o menor privilégio que dá conta.

Depois do restore não rode `db push` nem `db:owner`: o dump já contém as migrations
aplicadas e os usuários, com as senhas que eles já usavam.

## Operação

```bash
docker compose ps                  # saúde de cada serviço
docker compose logs -f web         # ou auth, rest, caddy, backup
docker compose restart web
docker compose down                # dados ficam nos volumes nomeados
```

Volumes: `db-data` (Postgres), `backups` (dumps), `caddy-data` (certificados),
`caddy-config`. `docker compose down` sem `-v` preserva todos.

## Armadilhas

- **`POSTGRES_PASSWORD` só vale na primeira subida.** `init/zz-role-passwords.sql` roda
  uma única vez, com o volume vazio. Trocar a senha no `.env` depois disso deixa o `.env` e
  o banco discordando, e o GoTrue para de conectar. Para trocar de verdade:
  `ALTER USER postgres/supabase_auth_admin/authenticator WITH PASSWORD '...'` no banco, e
  só então no arquivo.
- **`JWT_SECRET` assina as duas chaves.** Regerar o `.env` invalida toda sessão ativa e
  exige `docker compose up -d` em `auth`, `rest` e `web` ao mesmo tempo.
- **Sem domínio, sem PWA.** Em LAN dá para trocar o bloco público do `Caddyfile` pelo IP e
  usar `tls internal`, mas o certificado passa a ser autoassinado: o browser avisa a cada
  visita e o iOS não instala a PWA (o service worker exige secure context). Para acessar de
  fora sem abrir porta no roteador, **Tailscale** resolve melhor do que port forwarding: a
  VM ganha um nome estável na sua rede privada e o Caddy continua com `tls internal`.
- **Nada de Studio em produção.** Um painel de administração do banco exposto na VM é o
  oposto do que este deploy quer. Para inspecionar, `docker compose exec db psql -U postgres`.
