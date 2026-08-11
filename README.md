# Finanças Pessoais

App pessoal (single-user) para controle de gastos mensais e acompanhamento de patrimônio.

- **Web + PWA** (instalável no iPhone) — Next.js App Router
- **Banco/Auth** — Supabase (Postgres + RLS)
- **Entrada de dados** — manual, com import de CSV da fatura (idempotente)
- **Custo de operação** — R$ 0 (free tiers)

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
scripts         Utilitários de operação (provisionamento do usuário dono)
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

| URL                    | O quê                                                      |
| ---------------------- | ---------------------------------------------------------- |
| http://localhost:3000  | o app                                                      |
| http://127.0.0.1:54324 | Mailpit — o magic link cai aqui, nada é enviado de verdade |
| http://127.0.0.1:54323 | Supabase Studio                                            |

O login é por magic link: peça o link em `/login`, abra o Mailpit e clique **no mesmo
navegador** (o PKCE guarda um cookie no pedido). `Ctrl+C` encerra o Next; o Supabase
continua de pé até `pnpm exec supabase stop`.

Passo a passo manual, se preferir:

```bash
pnpm exec supabase start   # Postgres local + aplica migrations
pnpm db:owner              # allowlist + cria o usuário dono
pnpm dev                   # http://localhost:3000
```

Depois de `supabase db reset`, rode `pnpm db:owner` de novo (o reset apaga o usuário).

### Verificações

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm format:check
```

### Variáveis de ambiente

| Variável                        | Escopo | Origem                                    |
| ------------------------------- | ------ | ----------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | client | Supabase → Project Settings → API         |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client | idem                                      |
| `SUPABASE_SERVICE_ROLE_KEY`     | server | idem — **nunca** expor no client          |
| `OWNER_EMAIL`                   | server | o único e-mail que pode entrar no sistema |

## Auth single-user

Três camadas, todas necessárias:

1. `enable_signup = false` no Supabase Auth (`supabase/config.toml` e o mesmo ajuste no
   dashboard do projeto hospedado).
2. Tabela `public.allowed_emails` + trigger `enforce_email_allowlist` em `auth.users`:
   qualquer `INSERT` com e-mail fora da lista é rejeitado no banco.
3. RLS habilitada em toda tabela; `allowed_emails` não tem policy alguma — só a service
   role chega nela.

## Deploy

**Supabase (hospedado)**

1. Crie o projeto e rode `pnpm exec supabase link --project-ref <ref>` + `pnpm exec supabase db push`.
2. Authentication → Providers → Email: **Confirm signup** ligado, **Allow new users to sign up** desligado.
3. Authentication → URL Configuration: `Site URL` e `Redirect URLs` com `https://<dominio>/auth/callback`.
4. Rode `pnpm db:owner` apontando as env vars para o projeto hospedado.

**Vercel**

1. Importe o repositório e defina **Root Directory = `apps/web`** (o pnpm workspace é detectado sozinho).
2. Configure as env vars da tabela acima (as `NEXT_PUBLIC_*` em todos os ambientes; os
   segredos apenas em Production/Preview).

## Status das fases

- [x] Fase 0 — Fundação (monorepo, Supabase, auth, CI)
- [x] Fase 1 — MVP Gastos (transações, categorias, orçamentos, dashboard)
- [x] Fase 2 — Tendências + PWA
- [x] Fase 3 — Entrada em lote (import CSV, regras, fila "a categorizar")
- [x] Fase 4 — Patrimônio (ativos, aportes, snapshots, evolução)
- [ ] Fase 5 — Refinos
