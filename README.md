# Finanças Pessoais

App pessoal (single-user) para controle de gastos mensais e acompanhamento de patrimônio.

- **Web + PWA** (instalável no iPhone) — Next.js na Vercel
- **Banco/Auth** — Supabase (Postgres + RLS)
- **Sync do cartão Nubank** — Pluggy (Open Finance), com fallback de import CSV
- **Custo de operação** — R$ 0 (free tiers)

## Documentação

| Arquivo | Conteúdo |
|---|---|
| [`SPEC.md`](./SPEC.md) | Requisitos, arquitetura, modelo de dados, integração Pluggy e plano de fases |
| [`CLAUDE.md`](./CLAUDE.md) | Contexto e convenções para desenvolvimento com Claude Code |

## Setup rápido

Pré-requisitos: Node 20+, pnpm, Docker (para Supabase local), Supabase CLI.

```bash
pnpm install
cp .env.example apps/web/.env.local   # preencher com as chaves do seu projeto
supabase start                        # Postgres local + aplica migrations
pnpm dev                              # http://localhost:3000
```

### Variáveis de ambiente

| Variável | Escopo | Origem |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client | idem |
| `SUPABASE_SERVICE_ROLE_KEY` | server | idem — **nunca** expor no client |
| `PLUGGY_CLIENT_ID` / `PLUGGY_CLIENT_SECRET` | server | dashboard Pluggy |
| `CRON_SECRET` | server | gerar (`openssl rand -hex 32`) e replicar na Vercel |

## Status das fases

- [ ] Fase 0 — Fundação (monorepo, Supabase, auth, deploy)
- [ ] Fase 1 — MVP Gastos (transações, categorias, orçamentos, dashboard)
- [ ] Fase 2 — Tendências + PWA
- [ ] Fase 3 — Sync Nubank (Pluggy + CSV)
- [ ] Fase 4 — Patrimônio
- [ ] Fase 5 — Refinos
