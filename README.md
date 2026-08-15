# Finanças Pessoais

App da casa (duas pessoas, um household) para controle de gastos mensais e acompanhamento de
patrimônio.

- **Web + PWA** (instalável no iPhone) — Next.js App Router
- **Banco/Auth** — Supabase (Postgres + RLS)
- **Entrada de dados** — manual, com import de CSV (fatura do cartão e posição da XP), idempotente
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

| Variável                        | Escopo | Origem                                                        |
| ------------------------------- | ------ | ------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | client | Supabase → Project Settings → API                             |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client | idem                                                          |
| `SUPABASE_SERVICE_ROLE_KEY`     | server | idem — **nunca** expor no client                              |
| `OWNER_EMAIL`                   | server | e-mail do dono; `pnpm db:invite` o usa para achar o household |

## Auth e household

O app é de **uma casa**: duas pessoas, um conjunto de dados. Cada uma tem seu login; a linha
pertence ao household (`household_id`), e `user_id` só registra quem lançou.

Três camadas de acesso, todas necessárias:

1. `enable_signup = false` no Supabase Auth (`supabase/config.toml` e o mesmo ajuste no
   dashboard do projeto hospedado).
2. Tabela `public.allowed_emails` + trigger `enforce_email_allowlist` em `auth.users`:
   qualquer `INSERT` com e-mail fora da lista é rejeitado no banco.
3. RLS habilitada em toda tabela, com `household_id = current_household_id()`;
   `allowed_emails` não tem policy alguma — só a service role chega nela.

Para adicionar a segunda pessoa:

```bash
pnpm db:invite namorada@exemplo.com
```

O script põe o e-mail na allowlist **já apontando para o household do dono** e cria o usuário.
É esse `household_id` que o trigger `provision_user` lê no primeiro login — sem ele, a pessoa
cairia numa casa própria e veria o app vazio. As categorias padrão são semeadas uma única vez
por household, então o segundo membro não ganha uma segunda cópia da lista.

## Deploy

**Supabase (hospedado)**

Free tier: 500 MB de banco, suficiente com folga para anos de lançamentos. O projeto **pausa
após 7 dias sem nenhuma requisição** — uso diário resolve; se ficarem um tempo sem abrir, basta
despausar pelo dashboard.

1. Crie o projeto e rode `pnpm exec supabase link --project-ref <ref>` + `pnpm exec supabase db push`.
2. Authentication → Providers → Email: **Confirm signup** ligado, **Allow new users to sign up** desligado.
3. Authentication → URL Configuration: `Site URL` e `Redirect URLs` com `https://<dominio>/auth/callback`.
4. Rode `pnpm db:owner` e depois `pnpm db:invite <e-mail da segunda pessoa>`, com as env vars
   apontando para o projeto hospedado. A ordem importa: o convite lê o household do dono.

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
- [x] Fase 6 — Casa (household compartilhado, RLS por membership, `db:invite`)
- [x] Fase 7 — Import da posição consolidada da XP
