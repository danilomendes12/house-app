# SPEC — Finanças Pessoais

**Status:** Aprovado para desenvolvimento
**Data:** 2026-08-02
**Autor/Decisor:** (você) — projeto pessoal, single-user
**Documento companheiro:** `CLAUDE.md` (contexto operacional para o Claude Code)

---

## 1. Problema

Hoje não existe um lugar único e confiável para responder três perguntas recorrentes: *quanto gastei este mês e em quê*, *quanto ainda posso gastar* e *quanto meu patrimônio rendeu*. Os dados estão espalhados entre o app do Nubank, planilhas e extratos de corretoras, e a consolidação manual é trabalhosa o suficiente para não acontecer com regularidade.

## 2. Objetivos

1. **Visibilidade de gastos em < 10 segundos:** abrir o app e ver imediatamente o total do mês, o gasto por categoria e quanto resta do orçamento.
2. **Entrada de despesa manual em < 15 segundos** pelo celular (PWA), incluindo categoria.
3. **Sincronização automática do cartão Nubank** via Pluggy (Open Finance), com no máximo 1 dia de defasagem e zero duplicatas.
4. **Acompanhamento de patrimônio:** valor consolidado, rendimento por ativo e evolução histórica mensal.
5. **Custo de operação: R$ 0/mês** (free tiers de Supabase, Vercel e Pluggy pessoal).

## 3. Não-objetivos (v1)

- **App iOS nativo** — a PWA cobre o uso mobile por ora; nativo fica como evolução futura (ver §11). Motivo: conta Apple gratuita expira builds a cada 7 dias.
- **Multiusuário / compartilhamento** — o sistema é single-user por design; simplifica auth, RLS e produto.
- **Suporte a múltiplas moedas** — tudo em BRL.
- **Recomendações financeiras / projeções de aposentadoria** — fora de escopo; o produto é de *registro e acompanhamento*.
- **Conciliação bancária completa (conta corrente)** — o foco do sync automático é o **cartão de crédito** Nubank; conta corrente pode entrar depois.
- **Open Finance com outros bancos** — a arquitetura via Pluggy já suporta, mas v1 conecta apenas Nubank.

## 4. Usuário e histórias

Persona única: **o dono do sistema** (engenheiro de software, usa web no desktop e PWA no iPhone).

Ordenadas por prioridade:

1. Como dono, quero **registrar uma despesa pelo celular em segundos** para não depender de lembrar depois.
2. Como dono, quero **ver o gasto do mês por categoria com o orçamento restante** para decidir se posso gastar mais.
3. Como dono, quero que **as compras do meu cartão Nubank apareçam sozinhas e categorizadas** para não digitar nada que já existe digitalmente.
4. Como dono, quero **comparar meses e ver tendências (3/6/12 meses)** para identificar categorias que estão crescendo.
5. Como dono, quero **cadastrar meus investimentos e aportes** para saber quanto tenho e quanto cada ativo rendeu.
6. Como dono, quero **ver a evolução do meu patrimônio mês a mês** em um gráfico.
7. Como dono, quero **importar um CSV da fatura** quando o sync automático falhar, sem gerar duplicatas.
8. Como dono, quero **recategorizar uma transação sincronizada** e, opcionalmente, criar uma regra para as próximas.

## 5. Arquitetura

### 5.1 Decisão (formato ADR resumido)

**Contexto:** projeto pessoal, single-user, custo zero, um desenvolvedor usando Claude Code. Precisa de web desktop + uso mobile, banco relacional, jobs de sincronização e segredos server-side (credenciais Pluggy nunca podem ir ao client).

**Decisão:** monorepo TypeScript com **Next.js (App Router) como PWA na Vercel** + **Supabase** (Postgres, Auth, RLS). Sem backend separado: o que precisa de servidor (Pluggy, import CSV) vive em **Route Handlers do Next.js**, com **Vercel Cron** para o sync diário.

**Alternativas consideradas:**

| Opção | Prós | Contras | Veredito |
|---|---|---|---|
| Next.js PWA + Supabase (escolhida) | 1 deploy, 1 linguagem, RLS pronto, custo zero | Lógica server acoplada ao app web | ✅ |
| API separada (Fastify) + web + iOS | Separação limpa, pronto p/ múltiplos clients | 2 deploys, overhead injustificado p/ 1 usuário | ❌ por ora |
| Supabase Edge Functions p/ sync | Independente da Vercel | Deno, DX pior, mais um lugar p/ deploy | ❌ (revisitar se sair da Vercel) |

**Consequências:** fica fácil evoluir para app iOS depois (o iOS falaria direto com Supabase + endpoints do Next). Fica mais difícil trocar de Vercel sem levar os Route Handlers junto — aceitável.

### 5.2 Estrutura do monorepo

```
finance/
├── apps/
│   └── web/                    # Next.js 15+ (App Router), PWA
│       ├── app/
│       │   ├── (dashboard)/    # rotas autenticadas: gastos, patrimônio, config
│       │   ├── api/
│       │   │   ├── pluggy/     # connect-token, sync, webhook (opcional)
│       │   │   ├── import/     # upload e parse de CSV
│       │   │   └── cron/sync/  # alvo do Vercel Cron (protegido por CRON_SECRET)
│       │   └── login/
│       ├── components/
│       ├── lib/                # clients supabase (browser/server), pluggy client
│       └── public/manifest.webmanifest
├── packages/
│   └── shared/                 # tipos TS, enums de categoria, helpers de dinheiro/datas
├── supabase/
│   ├── migrations/             # SQL versionado (fonte da verdade do schema)
│   └── seed.sql                # categorias padrão
├── SPEC.md                     # este documento
├── CLAUDE.md
└── README.md
```

### 5.3 Stack

| Camada | Escolha | Observação |
|---|---|---|
| Web/PWA | Next.js 15+, React, TypeScript strict | App Router, Server Components onde fizer sentido |
| UI | Tailwind CSS + shadcn/ui | rápido e consistente |
| Gráficos | Recharts | linha, barra, donut cobrem tudo do escopo |
| Banco/Auth | Supabase (Postgres + Auth + RLS) | free tier |
| Deploy | Vercel (Hobby) | inclui Vercel Cron (1 job diário é suficiente) |
| Open Finance | Pluggy | plano pessoal gratuito; SDK `pluggy-sdk` (Node) |
| PWA | `manifest.webmanifest` + service worker (Serwist/next-pwa) | instalável no iPhone via "Adicionar à Tela de Início" |
| Tooling | pnpm workspaces, Turborepo (opcional), ESLint, Prettier, Vitest | |

### 5.4 Segurança (single-user)

- **Signups desabilitados** no Supabase Auth; login apenas com o e-mail do dono (magic link ou senha). Defesa em profundidade: trigger que rejeita `INSERT` em `auth.users` para e-mails fora da allowlist.
- **RLS habilitado em todas as tabelas**, política `user_id = auth.uid()` — mesmo sendo single-user.
- **Segredos apenas server-side:** `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` vivem em env vars da Vercel e nunca são expostos com prefixo `NEXT_PUBLIC_`.
- Rota de cron exige header `Authorization: Bearer ${CRON_SECRET}`.

## 6. Modelo de dados

Convenções: valores monetários em **centavos** (`bigint`), datas de transação como `date` (sem hora), timestamps em `timestamptz`, timezone de referência **America/Sao_Paulo**. Todas as tabelas têm `id uuid pk default gen_random_uuid()`, `user_id uuid references auth.users`, `created_at timestamptz default now()`.

### 6.1 Gastos

```sql
-- Contas (origem das transações)
accounts (
  name            text not null,            -- "Nubank Cartão", "Dinheiro"
  type            text not null,            -- 'credit_card' | 'checking' | 'cash'
  institution     text,
  pluggy_item_id  text,                     -- item conectado no Pluggy
  pluggy_account_id text unique             -- conta específica dentro do item
)

-- Categorias (flat; sem subcategorias na v1)
categories (
  name        text not null,
  icon        text,                         -- nome de ícone lucide
  color       text,                         -- hex
  kind        text not null default 'expense',  -- 'expense' | 'income'
  is_archived boolean default false
)

-- Transações
transactions (
  account_id      uuid references accounts,
  category_id     uuid references categories,   -- null = "a categorizar"
  date            date not null,                -- data da compra (competência)
  description     text not null,
  amount_cents    bigint not null check (amount_cents > 0),
  type            text not null,                -- 'expense' | 'income'
  source          text not null,                -- 'manual' | 'pluggy' | 'csv'
  external_id     text unique,                  -- id Pluggy ou hash do CSV (dedup)
  installment_num   int,                        -- parcela atual (nullable)
  installment_total int,                        -- total de parcelas (nullable)
  notes           text
)

-- Orçamentos mensais por categoria
budgets (
  category_id  uuid references categories,
  month        date not null,               -- sempre dia 1 (ex.: 2026-08-01)
  amount_cents bigint not null,
  unique (user_id, category_id, month)
)

-- Regras de categorização automática
category_rules (
  matcher      text not null,               -- substring case-insensitive da descrição
  category_id  uuid references categories,
  priority     int default 0
)
```

**Regras de negócio de gastos:**

- **Regime de competência:** despesa de cartão conta no mês da **data da compra** (parcelas: cada parcela na data da respectiva fatura, conforme retornado pelo Pluggy).
- **Pagamento de fatura não é despesa** (é transferência interna) — filtrado no sync para não duplicar.
- Estorno/refund vira transação `type = 'income'` na mesma categoria.
- "Restante do orçamento" = `budgets.amount_cents − Σ despesas da categoria no mês`. Categoria sem orçamento aparece sem barra de progresso.

### 6.2 Patrimônio

```sql
-- Ativos
assets (
  name          text not null,              -- "CDB Banco X 110% CDI"
  type          text not null,              -- 'cdb'|'tesouro'|'lci_lca'|'fundo'|'acao'|'fii'|'etf'|'cripto'|'poupanca'|'outro'
  institution   text,
  indexer       text,                       -- 'cdi'|'ipca'|'prefixado'|'selic'|null
  rate          numeric,                    -- ex.: 110 (% do CDI) ou 6.5 (a.a.)
  maturity_date date,
  pluggy_investment_id text unique,         -- se sincronizado via Pluggy
  is_closed     boolean default false
)

-- Movimentações (aportes e resgates)
asset_events (
  asset_id     uuid references assets,
  date         date not null,
  type         text not null,               -- 'contribution' | 'withdrawal'
  amount_cents bigint not null check (amount_cents > 0)
)

-- Snapshots de valor (manual ou via Pluggy)
asset_snapshots (
  asset_id          uuid references assets,
  date              date not null,
  gross_value_cents bigint not null,        -- valor bruto atual
  unique (asset_id, date)
)
```

**Regras de negócio de patrimônio:**

- **Valor investido** de um ativo = Σ aportes − Σ resgates.
- **Rendimento** = último snapshot − valor investido (absoluto e %).
- **Patrimônio total** em uma data = Σ do snapshot mais recente ≤ data, por ativo aberto.
- Ativos sem integração recebem **snapshot manual** (tela simples: "atualizar valor atual"); ativos via Pluggy recebem snapshot no sync diário.
- Evolução mensal = série dos snapshots agregados por mês (último snapshot de cada mês).

## 7. Integração Pluggy (Nubank)

**Fluxo de conexão (uma vez):**
1. Web chama `POST /api/pluggy/connect-token` (server-side, usa client id/secret) → recebe `connectToken`.
2. Front abre o **Pluggy Connect** (widget) com o token; usuário autentica no Nubank via Open Finance.
3. Callback retorna `itemId` → salvo em `accounts.pluggy_item_id`; contas do item (cartão) viram registros em `accounts`.

**Sync (diário, via Vercel Cron → `/api/cron/sync`):**
1. Para cada `account` com `pluggy_account_id`: buscar transações desde `último sync − 7 dias` (janela de segurança para transações retroativas).
2. **Dedup por `external_id`** (id da transação no Pluggy) — `insert ... on conflict do nothing`, com update de categoria Pluggy se a transação ainda estiver "a categorizar".
3. **Filtros:** ignorar pagamento de fatura; mapear estornos para `income`.
4. **Categorização:** aplicar `category_rules` (prioridade desc) → senão, mapear categoria do Pluggy via tabela de-para em `packages/shared` → senão, deixar "a categorizar" (badge no dashboard).
5. Buscar `investments` do item (se houver) e gravar `asset_snapshots` do dia.
6. Registrar resultado em uma tabela `sync_logs` (started_at, finished_at, inserted, errors) para debug.

**Fallback CSV:** upload da fatura exportada pelo app Nubank (`date, title, amount`) em `/api/import`. `external_id = sha256(date|title|amount|nº da linha repetida)` para dedup idempotente — reimportar o mesmo arquivo não duplica nada.

**Riscos conhecidos:** consentimento Open Finance expira periodicamente (~12 meses) e exige reconexão; plano gratuito do Pluggy pode ter limites de itens/chamadas — validar termos vigentes na Fase 3 (questão em aberto Q1). O fallback CSV garante que o produto nunca fica inutilizável.

## 8. Requisitos por prioridade

### P0 — sem isso não existe produto
- [ ] Auth single-user funcionando (signups bloqueados, RLS em tudo)
- [ ] CRUD de transações manuais (web e PWA mobile) com categoria e data
- [ ] Categorias padrão (seed) + CRUD de categorias
- [ ] Dashboard mensal: total do mês, breakdown por categoria (donut/lista), navegação entre meses
- [ ] Orçamento por categoria com "quanto resta" (barra de progresso)
- [ ] Deploy na Vercel + Supabase provisionado

### P1 — o produto fica bom
- [ ] Gráficos de tendência (linha, 3/6/12 meses) por categoria e total
- [ ] Comparação mês vs. mês anterior (variação % por categoria)
- [ ] PWA instalável (manifest, ícones, service worker) com tela de entrada rápida de despesa
- [ ] Sync Pluggy (conexão + cron diário + dedup + filtro de pagamento de fatura)
- [ ] Import CSV idempotente
- [ ] Regras de categorização + fila "a categorizar"
- [ ] Patrimônio: CRUD de ativos, aportes/resgates, snapshots manuais, rendimento por ativo, gráfico de evolução total

### P2 — futuro (guiar arquitetura, não construir agora)
- [ ] App iOS nativo (SwiftUI) consumindo Supabase + endpoints existentes; widget de entrada rápida
- [ ] Snapshots de investimentos via Pluggy (se o plano gratuito cobrir)
- [ ] Conta corrente Nubank e outros bancos
- [ ] Exportação de dados (CSV/JSON) e backup automático
- [ ] Notificações (orçamento estourando, sync falhou)

## 9. Critérios de aceite dos fluxos principais

**Entrada rápida (PWA):**
- Dado que estou logado no celular, quando abro o PWA, então o botão "+" de nova despesa está acessível em 1 toque; ao salvar (valor, categoria, descrição opcional, data = hoje por default), a despesa aparece no dashboard do mês imediatamente.

**Orçamento:**
- Dado um orçamento de R$ 800 em "Mercado" e R$ 600 gastos, quando abro o dashboard, então vejo "R$ 200 restantes" e barra em 75%; ao ultrapassar 100%, a barra muda de cor e mostra o excedente.

**Sync sem duplicatas:**
- Dado que o cron rodou duas vezes no mesmo dia, então nenhuma transação aparece duplicada (garantido por `external_id unique`).
- Dado um pagamento de fatura no extrato do cartão, então ele **não** aparece como despesa.

**Import CSV idempotente:**
- Dado que importei o mesmo arquivo duas vezes, então a segunda importação insere 0 registros e informa "N ignorados (já existentes)".

**Patrimônio:**
- Dado um ativo com aportes de R$ 10.000 e snapshot atual de R$ 10.480, então a tela mostra rendimento de R$ 480 (+4,8%).

## 10. Plano de desenvolvimento por fases

Cada fase termina com deploy funcional. Uma fase por sessão de trabalho com o Claude Code, idealmente.

| Fase | Entrega | Conteúdo |
|---|---|---|
| **0 — Fundação** | Repo + deploy "hello world" autenticado | Monorepo pnpm, Next.js, Supabase (projeto, auth single-user, migrations iniciais), CI mínima (typecheck + test), deploy Vercel |
| **1 — MVP Gastos** | Uso diário já possível | Schema de gastos (§6.1), CRUD transações/categorias, dashboard mensal, orçamentos com restante, seed de categorias |
| **2 — Tendências + PWA** | Análise + mobile de verdade | Gráficos de tendência e comparação entre meses, manifest + service worker, UI mobile-first de entrada rápida |
| **3 — Sync Nubank** | Fim da digitação | Conexão Pluggy, cron diário, dedup, filtros, regras de categorização, fila "a categorizar", import CSV fallback, `sync_logs` |
| **4 — Patrimônio** | Visão completa | Schema §6.2, CRUD ativos/eventos/snapshots, rendimento, gráfico de evolução, (se viável) snapshots via Pluggy |
| **5 — Refinos** | Qualidade de vida | Exportação de dados, notificações de orçamento, melhorias de UX apontadas pelo uso real |

## 11. Questões em aberto

| # | Questão | Quem responde | Bloqueia |
|---|---|---|---|
| Q1 | Termos vigentes do plano gratuito Pluggy: limites de itens, chamadas e acesso a `investments`? | Você (verificar no dashboard Pluggy ao criar a conta) | Fase 3 |
| Q2 | Renda (salário) entra no sistema para calcular "sobra do mês", ou o produto trata só despesas + orçamento? | Você | Não bloqueia (schema já suporta `type='income'`) |
| Q3 | Quando migrar PWA → iOS nativo? Sugestão: só se a fricção da PWA incomodar após 1 mês de uso real | Você | Não bloqueia |

## 12. Decisões assumidas (mude se discordar)

- Dinheiro em **centavos (`bigint`)**, nunca float.
- **Competência** (data da compra) e não caixa (data do pagamento da fatura).
- Parcelamentos: **uma transação por parcela**, na data em que a parcela cai na fatura.
- Categorias **flat** (sem hierarquia) na v1.
- Idioma da UI: **pt-BR**; código, commits e identificadores em **inglês**.
