# Finanças Pessoais

App da casa (duas pessoas, um household) para controle de gastos mensais e acompanhamento de
patrimônio.

- **Web + PWA** (instalável no iPhone) — Next.js App Router
- **Banco/Auth** — Supabase (Postgres + RLS), self-hosted
- **Entrada de dados** — manual, com import de CSV (fatura do cartão e posição da XP), idempotente
- **Deploy** — uma VM com `docker compose` (ver [`deploy/`](./deploy/README.md))

## Documentação

| Arquivo                          | Conteúdo                                                                 |
| -------------------------------- | ------------------------------------------------------------------------ |
| [`docs/SPEC.md`](./docs/SPEC.md) | Requisitos, arquitetura, modelo de dados, import de CSV e plano de fases |
| [`CLAUDE.md`](./CLAUDE.md)       | Contexto e convenções para desenvolvimento com Claude Code               |

## Estrutura

```
apps/web        Next.js 16 (App Router), auth e UI
  app/(dashboard)  telas autenticadas: resumo, tendências, lançamentos, orçamento,
                   patrimônio e ajustes (categorias, regras, import)
  lib/db           acesso ao Postgres e conversão bigint↔centavos (server-only)
  lib/supabase     clients e tipos gerados do schema
  public           manifest, ícones e service worker da PWA
packages/shared Regras puras e testáveis: dinheiro (centavos/bigint), datas
                (YYYY-MM-DD), orçamento, tendências, import CSV e patrimônio
supabase        Migrations SQL, seed e config do stack local
scripts         Utilitários de operação (provisionamento de usuários, segredos do deploy)
deploy          Stack self-hosted: docker compose, Caddy, backup e o passo a passo da VM
```

Os tipos do banco em `apps/web/lib/supabase/database.types.ts` são gerados — depois de
criar uma migration, rode:

```bash
pnpm exec supabase gen types typescript --local --schema public \
  > apps/web/lib/supabase/database.types.ts
```

## Setup rápido

Pré-requisitos: Node 20+, pnpm e Docker (para o Supabase local). O CLI do Supabase vem
como devDependency — use `pnpm exec supabase ...` se não tiver o binário global.

```bash
pnpm install
OWNER_EMAIL=voce@exemplo.com pnpm dev:local
```

`pnpm dev:local` sobe a stack inteira, em ordem e de forma idempotente: Docker → Supabase
(migrations aplicadas) → `apps/web/.env.local` → usuário dono → Next em
http://localhost:3000. Depois da primeira vez, `pnpm dev:local` sozinho basta — o
`OWNER_EMAIL` já está no `.env.local`. Por segurança o comando recusa rodar se o
`.env.local` não estiver apontando para o Supabase local.

| URL                    | O quê           |
| ---------------------- | --------------- |
| http://localhost:3000  | o app           |
| http://127.0.0.1:54323 | Supabase Studio |

O login é por **e-mail e senha**. `pnpm db:owner` cria o usuário e imprime a senha gerada
**uma única vez** — anote na hora. Perdeu? `pnpm db:password <email>` gera outra.
`Ctrl+C` encerra o Next; o Supabase continua de pé até `pnpm exec supabase stop`.

Passo a passo manual, se preferir:

```bash
pnpm exec supabase start   # Postgres local + aplica migrations
pnpm db:owner              # allowlist + cria o usuário dono (imprime a senha)
pnpm dev                   # http://localhost:3000
```

Depois de `supabase db reset`, rode `pnpm db:owner` de novo (o reset apaga o usuário).

### Verificações

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm format:check
```

### Variáveis de ambiente

Todas server-only: **não existe `NEXT_PUBLIC_*` neste projeto**. O browser não fala com o
Supabase — todo acesso é Server Component, Server Action ou Route Handler —, e por isso a
API não precisa de porta publicada no deploy. Todas são lidas em **runtime**, o que é o
que torna a imagem Docker portátil entre instalações.

| Variável                    | Origem                                                        |
| --------------------------- | ------------------------------------------------------------- |
| `SUPABASE_URL`              | dev: `http://127.0.0.1:54321`; deploy: `http://caddy:8000`    |
| `SUPABASE_ANON_KEY`         | dev: `supabase status`; deploy: `scripts/gen-secrets.mjs`     |
| `SUPABASE_SERVICE_ROLE_KEY` | idem — **nunca** expor no client                              |
| `OWNER_EMAIL`               | e-mail do dono; `pnpm db:invite` o usa para achar o household |
| `OWNER_PASSWORD`            | opcional; sem ela, `pnpm db:owner` gera uma senha e imprime   |
| `MEMBER_PASSWORD`           | idem, para `pnpm db:invite`                                   |

## Auth e household

O app é de **uma casa**: duas pessoas, um conjunto de dados. Cada uma tem seu login; a linha
pertence ao household (`household_id`), e `user_id` só registra quem lançou.

Entra-se com **e-mail e senha**. Não há cadastro, não há convite pela UI e não há
"esqueci minha senha" — os usuários são criados por script, e a senha é redefinida por
script. Um fluxo de recuperação por e-mail exigiria um servidor de SMTP, que é justamente
a dependência que o deploy self-hosted removeu.

Três camadas de acesso, todas necessárias e nenhuma alterada pela troca do magic link:

1. `enable_signup = false` no Supabase Auth (`supabase/config.toml`; no deploy,
   `GOTRUE_DISABLE_SIGNUP=true`).
2. Tabela `public.allowed_emails` + trigger `enforce_email_allowlist` em `auth.users`:
   qualquer `INSERT` com e-mail fora da lista é rejeitado no banco, inclusive pela API admin.
3. RLS habilitada em toda tabela, com `household_id = current_household_id()`;
   `allowed_emails` não tem policy alguma — só a service role chega nela.

A tela de login responde a mesma coisa para senha errada e para e-mail que não existe: nada
ali diz quem tem conta.

Para adicionar a segunda pessoa:

```bash
pnpm db:invite namorada@exemplo.com     # imprime a senha gerada uma única vez
pnpm db:password namorada@exemplo.com   # redefine, quando precisar
```

O script põe o e-mail na allowlist **já apontando para o household do dono** e cria o usuário.
É esse `household_id` que o trigger `provision_user` lê no primeiro login — sem ele, a pessoa
cairia numa casa própria e veria o app vazio. As categorias padrão são semeadas uma única vez
por household, então o segundo membro não ganha uma segunda cópia da lista.

Passar `OWNER_PASSWORD` / `MEMBER_PASSWORD` no ambiente escolhe a senha em vez de gerar uma.
Nos dois casos os scripts são idempotentes: rodar de novo **não** troca a senha de quem já
existe.

## Deploy

Uma VM com Docker, `docker compose up` e um domínio. O passo a passo completo — segredos,
ordem de subida, migrations, backup e restore — está em
[`deploy/README.md`](./deploy/README.md). Em resumo:

```bash
node scripts/gen-secrets.mjs            # deploy/.env com chaves próprias (nunca as da CLI)
cd deploy && docker compose up -d db auth
pnpm exec supabase db push --db-url "...?sslmode=disable"   # por túnel SSH
docker compose up -d
pnpm db:owner                           # com SUPABASE_URL=http://127.0.0.1:8000
```

Só 80/443 ficam expostos: o Caddy resolve o TLS e roteia a API do Supabase apenas pela rede
interna. A imagem do app não carrega configuração nenhuma — a mesma imagem roda em qualquer
VM, configurada só pelo `.env`.

## Status das fases

- [x] Fase 0 — Fundação (monorepo, Supabase, auth, CI)
- [x] Fase 1 — MVP Gastos (transações, categorias, orçamentos, dashboard)
- [x] Fase 2 — Tendências + PWA
- [x] Fase 3 — Entrada em lote (import CSV, regras, fila "a categorizar")
- [x] Fase 4 — Patrimônio (ativos, aportes, snapshots, evolução)
- [ ] Fase 5 — Refinos
- [x] Fase 6 — Casa (household compartilhado, RLS por membership, `db:invite`)
- [x] Fase 7 — Import da posição consolidada da XP
- [x] Fase 8 — Carteira (alocação, rentabilidade por período, aporte vs. valorização)
- [x] Fase 9 — Self-hosted (login por senha, imagem portátil, `docker compose` na VM)
