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
3. **Lançamento em lote sem retrabalho:** importar o CSV da fatura do Nubank quantas vezes for preciso, sem gerar duplicatas, com categorização automática por regras.
4. **Acompanhamento de patrimônio:** valor consolidado, rendimento por ativo e evolução histórica mensal.
5. **Custo de operação: R$ 0/mês** (free tiers de Supabase e Vercel).

## 3. Não-objetivos (v1)

- **App iOS nativo** — a PWA cobre o uso mobile por ora; nativo fica como evolução futura (ver §11). Motivo: conta Apple gratuita expira builds a cada 7 dias.
- **Multiusuário / compartilhamento** — o sistema é single-user por design; simplifica auth, RLS e produto.
- **Suporte a múltiplas moedas** — tudo em BRL.
- **Recomendações financeiras / projeções de aposentadoria** — fora de escopo; o produto é de *registro e acompanhamento*.
- **Integração com bancos (Open Finance / agregadores)** — decisão de 2026-08-02: a v1 é
  alimentada por entrada manual + import de CSV. Sincronização automática exige conta em
  agregador, credenciais server-side e um deploy com cron; nada disso existe hoje, e o
  produto é plenamente utilizável sem. Fica como evolução futura (§11), e o schema já a
  acomoda sem migration de dados (ver §6.1).

## 4. Usuário e histórias

Persona única: **o dono do sistema** (engenheiro de software, usa web no desktop e PWA no iPhone).

Ordenadas por prioridade:

1. Como dono, quero **registrar uma despesa pelo celular em segundos** para não depender de lembrar depois.
2. Como dono, quero **ver o gasto do mês por categoria com o orçamento restante** para decidir se posso gastar mais.
3. Como dono, quero **importar a fatura do cartão de uma vez, já categorizada**, para não digitar nada que já existe digitalmente.
4. Como dono, quero **comparar meses e ver tendências (3/6/12 meses)** para identificar categorias que estão crescendo.
5. Como dono, quero **cadastrar meus investimentos e aportes** para saber quanto tenho e quanto cada ativo rendeu.
6. Como dono, quero **ver a evolução do meu patrimônio mês a mês** em um gráfico.
7. Como dono, quero **reimportar um CSV sem medo**, sabendo que nada será duplicado.
8. Como dono, quero **recategorizar uma transação importada** e, opcionalmente, criar uma regra para as próximas.

## 5. Arquitetura

### 5.1 Decisão (formato ADR resumido)

**Contexto:** projeto pessoal, single-user, custo zero, um desenvolvedor usando Claude Code. Precisa de web desktop + uso mobile, banco relacional e um lugar seguro para rodar o que não pode ir ao client (import de arquivos, chave de service role).

**Decisão:** monorepo TypeScript com **Next.js (App Router) como PWA** + **Supabase** (Postgres, Auth, RLS). Sem backend separado: o que precisa de servidor vive em **Server Actions** e, quando for um endpoint de verdade, em Route Handlers.

**Alternativas consideradas:**

| Opção | Prós | Contras | Veredito |
|---|---|---|---|
| Next.js PWA + Supabase (escolhida) | 1 deploy, 1 linguagem, RLS pronto, custo zero | Lógica server acoplada ao app web | ✅ |
| API separada (Fastify) + web + iOS | Separação limpa, pronto p/ múltiplos clients | 2 deploys, overhead injustificado p/ 1 usuário | ❌ por ora |
| SPA + Supabase direto, sem servidor | Nada de servidor para manter | Sem lugar para segredo nem para parse de arquivo | ❌ |

**Consequências:** fica fácil evoluir para app iOS depois (o iOS falaria direto com Supabase + endpoints do Next). O app roda inteiro em `localhost` durante o desenvolvimento; nada no produto depende de estar publicado.

### 5.2 Estrutura do monorepo

```
finance/
├── apps/
│   └── web/                    # Next.js 16 (App Router), PWA
│       ├── app/
│       │   ├── (dashboard)/    # rotas autenticadas: gastos, tendências, patrimônio, ajustes
│       │   └── login/
│       ├── components/
│       ├── lib/                # clients supabase (browser/server), acesso a dados
│       └── public/             # manifest.webmanifest, ícones, service worker
├── packages/
│   └── shared/                 # tipos TS e regras puras: dinheiro, datas, orçamento,
│                               # tendências, import CSV, categorização, patrimônio
├── supabase/
│   ├── migrations/             # SQL versionado (fonte da verdade do schema)
│   └── seed.sql                # dados de bootstrap
├── docs/SPEC.md                # este documento
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
| Deploy | Vercel (Hobby), quando houver | o app não depende disso; roda inteiro em localhost |
| PWA | `manifest.webmanifest` + service worker escrito à mão | instalável no iPhone via "Adicionar à Tela de Início"; sem dependência extra |
| Tooling | pnpm workspaces, ESLint, Prettier, Vitest | |

### 5.4 Segurança (single-user)

- **Signups desabilitados** no Supabase Auth; login apenas com o e-mail do dono (magic link ou senha). Defesa em profundidade: trigger que rejeita `INSERT` em `auth.users` para e-mails fora da allowlist.
- **RLS habilitado em todas as tabelas**, política `user_id = auth.uid()` — mesmo sendo single-user.
- **Segredos apenas server-side:** `SUPABASE_SERVICE_ROLE_KEY` e `OWNER_EMAIL` nunca recebem o prefixo `NEXT_PUBLIC_` nem são importados de client component.

## 6. Modelo de dados

Convenções: valores monetários em **centavos** (`bigint`), datas de transação como `date` (sem hora), timestamps em `timestamptz`, timezone de referência **America/Sao_Paulo**. Todas as tabelas têm `id uuid pk default gen_random_uuid()`, `user_id uuid references auth.users`, `created_at timestamptz default now()`.

### 6.1 Gastos

```sql
-- Contas (origem das transações)
accounts (
  name        text not null,                -- "Nubank Cartão", "Dinheiro"
  type        text not null,                -- 'credit_card' | 'checking' | 'cash'
  institution text
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
  source          text not null,                -- 'manual' | 'csv'
  external_id     text unique,                  -- hash da linha do CSV (dedup, §7)
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

- **Regime de competência:** despesa de cartão conta no mês da **data da compra** (parcelas: cada parcela na data da respectiva fatura).
- **Pagamento de fatura não é despesa** (é transferência interna) — descartado no import para não duplicar.
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
  is_closed     boolean default false
)

-- Movimentações (aportes e resgates)
asset_events (
  asset_id     uuid references assets,
  date         date not null,
  type         text not null,               -- 'contribution' | 'withdrawal'
  amount_cents bigint not null check (amount_cents > 0)
)

-- Snapshots de valor (informados manualmente)
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
- Todo ativo recebe **snapshot manual** (tela simples: "atualizar valor atual").
- Evolução mensal = série dos snapshots agregados por mês (último snapshot de cada mês, por ativo). Um mês sem snapshot novo herda o último valor conhecido do ativo — senão o patrimônio total pareceria despencar em todo mês sem atualização.

## 7. Import de CSV da fatura

Entrada em lote sem integração: o app do Nubank exporta a fatura como CSV, e o arquivo é
enviado na tela **Ajustes → Importar CSV**. O parse roda em Server Action (server-only) e
devolve uma prévia antes de gravar qualquer coisa.

**Formato aceito.** Cabeçalho `date,title,amount` (o do Nubank) e as variações em pt-BR
(`data,título,valor`). Datas em `YYYY-MM-DD` ou `DD/MM/YYYY`; valores com vírgula ou ponto
decimal, parseados por `parseCents` — nunca por `parseFloat`.

**Sinal do valor.** No CSV da fatura, valor positivo é despesa e negativo é estorno/crédito.
O import inverte isso para o modelo do §6.1: `amount_cents` sempre positivo, com a direção
em `type` (`expense` / `income`).

**Descarte de pagamento de fatura.** Linhas cujo título casa com o padrão de pagamento
(`Pagamento recebido`, `Pagamento em ...`) não viram transação: são transferência interna,
e lançá-las duplicaria o mês inteiro (§6.1).

**Parcelas.** Títulos no formato `Loja - Parcela 3/10` viram `installment_num = 3`,
`installment_total = 10`, com o sufixo removido da descrição. Uma transação por parcela,
na data da fatura em que ela cai.

**Dedup idempotente.** Cada linha recebe uma chave estável
`external_id = sha256("<date>|<title normalizado>|<amount>|<ocorrência>")`, onde *ocorrência*
é o índice (0, 1, 2…) daquela linha entre as **idênticas do mesmo arquivo**. Isso preserva
duas compras iguais legítimas no mesmo dia e ainda assim torna a reimportação um no-op:
a gravação usa `on conflict (user_id, external_id) do nothing`. O hash é calculado no
servidor (`node:crypto`); `packages/shared` só produz a string a ser hasheada, para
continuar livre de dependências de runtime.

**Categorização automática.** Cada linha importada passa pelas `category_rules` (§6.1),
ordenadas por `priority desc`: a primeira cujo `matcher` for substring case-insensitive da
descrição define a categoria. Sem regra que case, a transação entra como "a categorizar" e
aparece na fila (§9).

## 8. Requisitos por prioridade

### P0 — sem isso não existe produto
- [x] Auth single-user funcionando (signups bloqueados, RLS em tudo) — Fase 0, validado no stack local
- [x] CRUD de transações manuais (web e PWA mobile) com categoria e data — Fase 1
- [x] Categorias padrão (seed) + CRUD de categorias — Fase 1; o seed é por usuário (trigger em `auth.users`), já que categorias são dados do usuário
- [x] Dashboard mensal: total do mês, breakdown por categoria (lista com barras), navegação entre meses — Fase 1
- [x] Orçamento por categoria com "quanto resta" (barra de progresso) — Fase 1, critérios do §9 validados no stack local

### P1 — o produto fica bom
- [x] Gráficos de tendência (linha, 3/6/12 meses) por categoria e total — Fase 2
- [x] Comparação mês vs. mês anterior (variação % por categoria) — Fase 2
- [x] PWA instalável (manifest, ícones, service worker) com tela de entrada rápida de despesa — Fase 2
- [x] Import CSV idempotente — Fase 3, critérios do §9 validados no stack local
- [x] Regras de categorização + fila "a categorizar" — Fase 3
- [x] Patrimônio: CRUD de ativos, aportes/resgates, snapshots manuais, rendimento por ativo, gráfico de evolução total — Fase 4, critério do §9 validado no stack local

### P2 — futuro (guiar arquitetura, não construir agora)
- [ ] App iOS nativo (SwiftUI) consumindo Supabase + endpoints existentes; widget de entrada rápida
- [ ] Integração Open Finance (agregador tipo Pluggy): sync de cartão e snapshots de investimento, com cron diário. Removida da v1 em 2026-08-02 (§3); o `external_id` único e a coluna `source` já acomodam uma segunda origem de dados sem migration de dados
- [ ] Exportação de dados (CSV/JSON) e backup automático
- [ ] Notificações (orçamento estourando)

## 9. Critérios de aceite dos fluxos principais

**Entrada rápida (PWA):**
- Dado que estou logado no celular, quando abro o PWA, então o botão "+" de nova despesa está acessível em 1 toque; ao salvar (valor, categoria, descrição opcional, data = hoje por default), a despesa aparece no dashboard do mês imediatamente.

**Orçamento:**
- Dado um orçamento de R$ 800 em "Mercado" e R$ 600 gastos, quando abro o dashboard, então vejo "R$ 200 restantes" e barra em 75%; ao ultrapassar 100%, a barra muda de cor e mostra o excedente.

**Import CSV idempotente:**
- Dado que importei o mesmo arquivo duas vezes, então a segunda importação insere 0 registros e informa "N ignorados (já existentes)".
- Dado um arquivo com duas linhas idênticas legítimas (mesma compra, mesmo dia), então ambas são importadas — e reimportar o arquivo continua inserindo 0.
- Dado um pagamento de fatura no arquivo, então ele **não** aparece como despesa.

**Fila "a categorizar":**
- Dado um lançamento sem categoria, quando escolho a categoria na fila, então ele sai da fila sem recarregar a tela inteira; marcando "criar regra", os próximos títulos parecidos entram já categorizados.

**Tendências:**
- Dado 6 meses de histórico, quando abro Tendências, então vejo a linha do total por mês e a variação % de cada categoria contra o mês anterior, com as maiores altas primeiro.

**Patrimônio:**
- Dado um ativo com aportes de R$ 10.000 e snapshot atual de R$ 10.480, então a tela mostra rendimento de R$ 480 (+4,8%).

## 10. Plano de desenvolvimento por fases

Cada fase termina com o app funcionando de ponta a ponta no stack local. Uma fase por sessão de trabalho com o Claude Code, idealmente.

| Fase | Entrega | Conteúdo |
|---|---|---|
| **0 — Fundação** | Repo + "hello world" autenticado | Monorepo pnpm, Next.js, Supabase (projeto, auth single-user, migrations iniciais), CI mínima (typecheck + test) |
| **1 — MVP Gastos** | Uso diário já possível | Schema de gastos (§6.1), CRUD transações/categorias, dashboard mensal, orçamentos com restante, seed de categorias |
| **2 — Tendências + PWA** | Análise + mobile de verdade | Gráficos de tendência e comparação entre meses, manifest + service worker, UI mobile-first de entrada rápida |
| **3 — Entrada em lote** | Fim da digitação | Import CSV idempotente (§7), regras de categorização, fila "a categorizar" |
| **4 — Patrimônio** | Visão completa | Schema §6.2, CRUD ativos/eventos/snapshots, rendimento, gráfico de evolução |
| **5 — Refinos** | Qualidade de vida | Exportação de dados, notificações de orçamento, melhorias de UX apontadas pelo uso real |

## 11. Questões em aberto

| # | Questão | Quem responde | Bloqueia |
|---|---|---|---|
| ~~Q1~~ | ~~Termos do plano gratuito Pluggy~~ | — | Resolvida em 2026-08-02: integração saiu da v1 (§3) |
| ~~Q2~~ | ~~Renda entra no sistema para calcular "sobra do mês"?~~ | — | Resolvida em 2026-08-02: tendências cobrem só despesas (§12) |
| Q3 | Quando migrar PWA → iOS nativo? Sugestão: só se a fricção da PWA incomodar após 1 mês de uso real | Você | Não bloqueia |
| Q4 | Vale conectar transações a `accounts` (Nubank Cartão, Dinheiro) na UI, ou `account_id` continua sempre nulo? | Você | Não bloqueia (tabela existe, ninguém escreve nela) |

## 12. Decisões assumidas (mude se discordar)

- Dinheiro em **centavos (`bigint`)**, nunca float.
- **Competência** (data da compra) e não caixa (data do pagamento da fatura).
- Parcelamentos: **uma transação por parcela**, na data em que a parcela cai na fatura.
- Categorias **flat** (sem hierarquia) na v1.
- Idioma da UI: **pt-BR**; código, commits e identificadores em **inglês** — inclusive os
  segmentos de rota (`/transactions`, `/budgets`, `/categories`).
- **Estorno abate o gasto da categoria** (Fase 1): o "gasto" de uma categoria no mês é
  `Σ despesas − Σ receitas lançadas nela`. É o que dá sentido à regra do §6.1 de registrar
  o estorno como `income` na mesma categoria — senão a compra estornada continuaria
  consumindo orçamento. Categorias de `kind = 'income'` (salário) ficam fora dessa conta e
  aparecem em uma seção separada do dashboard.
- **Categorias padrão são semeadas por usuário**, via trigger `seed_default_categories` em
  `auth.users`, e não em `seed.sql` — que não tem como conhecer o `user_id`. Depois de
  criadas são dados comuns: podem ser renomeadas, arquivadas ou excluídas.
- **Orçamento é por mês, sem herança automática:** um mês sem orçamento cadastrado não
  herda o anterior (a categoria aparece sem barra). A tela de orçamento tem um botão de
  "copiar do mês anterior" para o caso comum de repetir os mesmos valores.
- **Tendências cobrem só despesas** (Fase 2, resposta ao Q2): os gráficos e a comparação
  mês a mês olham gasto por categoria e total de despesas. Receita continua na seção
  separada do dashboard; não há indicador de "sobra do mês" na v1. O schema suporta
  `type='income'`, então incluir renda depois é trabalho de UI, não de dados.
- **Mutações são Server Actions**, não Route Handlers — inclusive o upload do CSV. É o
  mecanismo que o resto do app já usa (`useActionState` + `SubmitButton`), e não há
  cliente externo que precise de um endpoint HTTP. Route Handler volta a fazer sentido
  quando algo de fora do app precisar chamar (webhook, cron, app iOS).
- **Snapshot de patrimônio é por dia** (`unique (asset_id, date)`): atualizar o valor de um
  ativo duas vezes no mesmo dia sobrescreve, em vez de criar duas linhas. A evolução
  mensal usa o último snapshot de cada mês.
- **Ajustes fica no header, não na tab bar** (Fase 3): as 5 abas são os fluxos diários e a
  zona do polegar vale mais que um sexto ícone. `/settings` reúne Importar CSV, A
  categorizar, Regras e Categorias — esta última era uma página órfã, sem link de lugar
  nenhum.
- **A tab bar tem só substantivos; lançar é o FAB** (Fase 5): a aba de `/transactions` se
  chama **Extrato**, não "Lançar" — ela leva à lista do mês, e um rótulo em verbo prometia
  um formulário. As cinco abas nomeiam *lugares* (Resumo, Tendências, Extrato, Orçamento,
  Patrimônio); a única *ação* de rotina, registrar despesa, continua no botão "+" flutuante
  do Resumo, que é o que o §9 exige (1 toque).
- **Regra criada pela fila é aplicada ao backlog** (Fase 3): salvar "uber → Transporte"
  categoriza na hora os lançamentos que já estavam esperando (`applyMatcherToUncategorized`),
  não só os próximos imports. Uma regra que só vale para o futuro deixaria o usuário
  categorizando à mão justamente a pilha que o motivou a escrevê-la.
- **Ativo encerrado sai do total, não da história** (Fase 4): `monthlyNetWorthSeries`
  arrasta o último valor conhecido de cada ativo para frente — senão o patrimônio
  despencaria em todo mês sem atualização (§6.2) —, mas para de arrastar um ativo
  `is_closed` depois do último snapshot dele, senão dinheiro já resgatado seguiria contando
  hoje. Antes do primeiro snapshot o ativo contribui 0.
- **Ativo sem snapshot entra no total pelo valor aportado** (Fase 4): o total do topo soma o
  valor *atual* de cada ativo aberto, que na ausência de snapshot é o que foi aportado
  (`assetPerformance`). O §6.2 define o total só a partir de snapshots; ao pé da letra, um
  ativo recém-cadastrado apareceria como R$ 0 logo acima de uma lista que mostra o saldo
  real dele. O gráfico continua sendo só de snapshots, então o último ponto pode ficar
  abaixo do total — a tela diz isso em uma linha quando há ativos nessa situação.
- **Gráfico de patrimônio é linha simples** (Fase 4): a decisão de virar small multiples na
  Fase 2 valia para o gasto *por categoria*, onde a paleta semeada falhava separação para
  daltonismo (laranja↔verde, ΔE 4,8). Patrimônio é série única, então não há cor
  codificando nada e a linha volta a ser a forma certa. As duas telas usam o mesmo
  componente (`components/month-line-chart.tsx`).
