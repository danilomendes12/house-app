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
- ~~**Multiusuário / compartilhamento**~~ — revisto em 2026-08-14: o produto passou a ser a
  gestão financeira da casa, com duas pessoas usando os mesmos dados. Virou a Fase 6 (§6.3).
  Continua fora de escopo o multi-tenant de verdade: existe **um** household, cada pessoa
  pertence a exatamente um, e não há convite pela UI.
- **Suporte a múltiplas moedas** — tudo em BRL.
- **Recomendações financeiras / projeções de aposentadoria** — fora de escopo; o produto é de *registro e acompanhamento*.
- **Integração com bancos (Open Finance / agregadores)** — decisão de 2026-08-02: a v1 é
  alimentada por entrada manual + import de CSV. Sincronização automática exige conta em
  agregador, credenciais server-side e um deploy com cron; nada disso existe hoje, e o
  produto é plenamente utilizável sem. Fica como evolução futura (§11), e o schema já a
  acomoda sem migration de dados (ver §6.1).

## 4. Usuário e histórias

Duas pessoas, **um household**: o dono do sistema (engenheiro de software, web no desktop e PWA
no iPhone) e sua companheira (só PWA). Os dois veem e editam exatamente os mesmos dados; o
sistema registra quem lançou cada coisa, mas isso é atribuição, não permissão — não há papel
com acesso reduzido.

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

**Onde isso roda (revisto na Fase 9).** A escolha acima é de *arquitetura*, não de
hospedagem — e a hospedagem virou uma segunda decisão:

| Opção | Prós | Contras | Veredito |
|---|---|---|---|
| **VM própria com `docker compose` (escolhida)** | Dados em casa, sem pausa por inatividade, custo previsível, o mesmo Postgres e o mesmo GoTrue do stack local | A VM é responsabilidade sua: backup, atualização, certificado | ✅ |
| Vercel + Supabase hospedado | Zero operação, free tier | O projeto Supabase **pausa após 7 dias** sem requisição; magic link exige SMTP e URL de redirect fixa; a config vai *assada* no build | ❌ desde a Fase 9 |

As duas continuam possíveis — o app não sabe onde está. O que a Fase 9 mudou para permitir
a primeira foi remover as três amarras: SMTP (login por senha), URL de redirect (idem) e
configuração em build time (`SUPABASE_URL` e `SUPABASE_ANON_KEY` viraram server-only,
lidas em runtime). Como consequência, **a mesma imagem Docker roda em qualquer VM**,
configurada só pelo `.env`, e a API do Supabase não precisa ser publicada: quem fala com
ela é o servidor Next, pela rede interna.

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
| Banco/Auth | Supabase (Postgres + Auth + RLS) | self-hosted; em dev, a Supabase CLI |
| Deploy | VM própria, `docker compose` (Fase 9) | `deploy/`; o app não depende disso, roda inteiro em localhost |
| PWA | `manifest.webmanifest` + service worker escrito à mão | instalável no iPhone via "Adicionar à Tela de Início"; sem dependência extra |
| Tooling | pnpm workspaces, ESLint, Prettier, Vitest | |

**Stack de deploy (Fase 9), em `deploy/docker-compose.yml`.** Seis serviços, toda imagem
com tag exata:

| Serviço | Imagem | Publica | Papel |
|---|---|---|---|
| `caddy` | `caddy:2.10.2-alpine` | **80/443**, e `:8000` em loopback | TLS automático (Let's Encrypt), proxy do app e roteamento da API |
| `web` | build local (`Dockerfile`) | — | Next.js `output: 'standalone'`, non-root |
| `db` | `supabase/postgres:17.6.1.156` | `5432` em loopback | Postgres, schema `auth`, roles `anon`/`authenticated`/`service_role`/`authenticator` |
| `auth` | `supabase/gotrue:v2.194.0` | — | `/auth/v1/*` |
| `rest` | `postgrest/postgrest:v14.15` | — | `/rest/v1/*` |
| `backup` | `postgres:17.7-alpine` | — | `pg_dump` diário, retenção de 14 dias |

As tags são **as mesmas que a Supabase CLI usa no stack local**, de propósito: dev e
produção rodam o mesmo Postgres e o mesmo GoTrue. Fora do stack, também de propósito:
Kong (a API não é pública), Studio, Realtime, Storage, imgproxy, Logflare e Supavisor — o
app não usa nenhum, e um painel de administração do banco exposto na VM seria o oposto do
que a fase quer.

O Caddy tem dois blocos: o público (domínio → `web:3000`) e um interno em `:8000` que faz
`handle_path /auth/v1/*` → `auth:9999` e `/rest/v1/*` → `rest:3000` (os dois servem na
raiz, então o prefixo é removido). É esse endereço interno que `SUPABASE_URL` aponta. As
portas em `127.0.0.1` são acesso de manutenção — `supabase db push` e provisionamento —
alcançáveis de fora apenas por túnel SSH.

### 5.4 Segurança (household fechado)

- **Entra-se com e-mail e senha** (Fase 9; antes era magic link). Só o meio de provar identidade mudou — o JWT continua sendo emitido pelo GoTrue, e as três camadas abaixo são exatamente as mesmas.
- **Signups desabilitados** no Supabase Auth; entram apenas os e-mails da `allowed_emails`. Defesa em profundidade: trigger que rejeita `INSERT` em `auth.users` para e-mails fora da allowlist. Provisionamento é por script (`pnpm db:owner`, `pnpm db:invite`) — não existe convite pela UI, e a senha é gerada pelo script e impressa uma única vez.
- **A resposta do login não distingue "senha errada" de "e-mail inexistente"** — nada na tela revela quem tem conta.
- **Sem recuperação de senha e sem troca de senha na UI.** O reset é `pnpm db:password <email>` no servidor: um fluxo por e-mail traria o SMTP de volta, que é o que a Fase 9 removeu.
- **RLS habilitado em todas as tabelas**, política `household_id = current_household_id()` (§6.3). Sessão sem membership não lê nem escreve nada: a função devolve `null` e toda comparação falha, que é a direção segura.
- **`user_id` não concede acesso.** Depois da Fase 6 ele diz apenas *quem lançou*; quem autoriza é o `household_id`. Confundir os dois é o erro que reabriria os dados de uma casa para outra.
- **Nenhum segredo no client, e nenhuma configuração pública.** Depois da Fase 9 não existe var `NEXT_PUBLIC_*`: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e `OWNER_EMAIL` são server-only. O browser não fala com o Supabase — todo acesso é Server Component, Server Action ou Route Handler —, e por isso a API não precisa de porta publicada na VM.
- **As chaves são geradas na instalação** (`scripts/gen-secrets.mjs`), nunca as do stack local da CLI, que são fixas e públicas: expostas, qualquer pessoa forja um token `service_role` e a RLS vira decoração. O `docker-compose.yml` não sobe sem elas.

## 6. Modelo de dados

Convenções: valores monetários em **centavos** (`bigint`), datas de transação como `date` (sem hora), timestamps em `timestamptz`, timezone de referência **America/Sao_Paulo**. Todas as tabelas têm `id uuid pk default gen_random_uuid()`, `household_id uuid references households` (dono da linha, é o que a RLS checa), `user_id uuid references auth.users` (quem lançou) e `created_at timestamptz default now()`.

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
  external_id     text,                         -- hash da linha do CSV; unique (household_id, external_id) (dedup, §7)
  installment_num   int,                        -- parcela atual (nullable)
  installment_total int,                        -- total de parcelas (nullable)
  notes           text
)

-- Orçamentos mensais por categoria
budgets (
  category_id  uuid references categories,
  month        date not null,               -- sempre dia 1 (ex.: 2026-08-01)
  amount_cents bigint not null,
  unique (household_id, category_id, month)
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

**Carteira (Fase 8).** O rendimento acima é vitalício e não distingue "cresceu porque
aportei" de "cresceu porque rendeu". A análise de carteira acrescenta, sem mudar nada do
que já existe e sem migration:

- **Classe do ativo** é *derivada* de `assets.type`, não cadastrada: renda fixa
  (`cdb`, `tesouro`, `lci_lca`, `poupanca`), renda variável (`acao`, `fii`, `etf`),
  fundos (`fundo`), cripto (`cripto`), outros (`outro`).
- **Janela de análise** (`1M · 6M · 12M · Tudo`, default 12M) é ancorada em fim de mês:
  "1M" vai do último dia do mês anterior até hoje. Snapshot é fotografia de fim de mês
  (é o que a posição da XP é), então uma janela por dia corrido cairia no mesmo valor
  arrastado enquanto o rótulo prometia outra coisa. `Tudo` começa um mês antes da
  movimentação mais antiga, para o saldo inicial ser genuinamente zero.
- A janela é o intervalo **`(início, fim]`**: um fluxo datado exatamente no dia-âncora
  pertence ao saldo inicial, não ao período — senão ele contaria duas vezes.
- **Valor em uma data** = último snapshot ≤ data (arrastado) e, antes do primeiro
  snapshot, o valor aportado até ali. É a mesma regra do total do topo, então alocação,
  período e total nunca discordam.
- **Fluxo líquido no período** = Σ aportes − Σ resgates dentro da janela.
- **Rentabilidade do período** = Modified Dietz:
  `R = (Vf − Vi − F) / (Vi + Σ wi × Fi)`, com `wi = (T − ti)/T`. O numerador é exato
  (`bigint`); só o denominador — média ponderada, que não é um número inteiro de
  centavos — vira `number`. Sem base positiva (ou sem janela com dias), a
  rentabilidade é `null` e a tela mostra "—", nunca 0%.
- **Decomposição mensal**: por mês, `fluxo` e `valorização = Δvalor − fluxo`. A soma das
  valorizações do período fecha exatamente com `Vf − Vi − F`.
- **Posição desatualizada** = ativo aberto cujo snapshot mais recente tem mais de
  **45 dias**, ou que nunca teve snapshot. Continua contando no total.
- **Vencimento próximo** = ativo de renda fixa com `maturity_date` dentro de **90 dias**.
- **Alocação**: fatias por classe, indexador ou instituição, ordenadas por valor, com a
  cauda além de 5 fatias agrupada em "Outros". Os percentuais são distribuídos por maior
  resto, de modo que somam exatamente 100%.

### 6.3 Household (Fase 6)

```sql
households (
  name text not null                      -- "Casa"
)

household_members (
  household_id uuid references households,
  user_id      uuid references auth.users,
  role         text not null default 'member',   -- 'owner' | 'member'
  primary key (household_id, user_id)
)

-- allowed_emails ganha a coluna que diz em qual casa o e-mail entra
allowed_emails (
  email        text primary key,
  household_id uuid references households   -- null = "crie uma casa nova" (o dono)
)
```

**Regras:**

- Toda tabela de dados carrega `household_id` (dono da linha) **e** `user_id` (quem lançou). A
  RLS compara **só** o primeiro; `current_household_id()` é `security definer` porque as
  policies a chamam e ler `household_members` de dentro de uma policy sobre
  `household_members` recursaria.
- **Os uniques seguem o dono, não a pessoa.** `categories (household_id, lower(name))`,
  `budgets (household_id, category_id, month)`, `transactions (household_id, external_id)`.
  Deixá-los em `user_id` daria a cada pessoa a sua própria "Mercado", o seu próprio orçamento do
  mês e a sua própria cópia da fatura importada — a idempotência do §7 só vale dentro do escopo
  do índice único que a sustenta.
- **Uma pessoa pertence a exatamente um household**; `current_household_id()` pega a primeira
  membership. Sessão sem membership não vê nada.
- **Provisionamento é por trigger + script.** `provision_user` (after insert em `auth.users`) põe
  a pessoa no household indicado pela allowlist — ou cria a casa, se for a primeira — e semeia as
  categorias padrão **apenas quando o household ainda não tem nenhuma**: o segundo membro não
  pode ganhar uma segunda cópia da lista.

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

### 7.1 Import da posição consolidada da XP (Fase 7)

Segunda origem de arquivo, para o patrimônio. A tela é **Ajustes → Importar investimentos**, com
o mesmo fluxo de duas etapas (prévia → confirmar) e o mesmo re-parse no servidor do texto
aprovado.

**O que o arquivo é.** Uma *fotografia*, não um extrato: cada linha diz quanto um produto vale
hoje. Por isso uma linha vira `asset_snapshots`, nunca `asset_events`. A "posição detalhada"
até traz o total aplicado por produto, mas ele **não** vira aporte: o usuário já lança aportes
à mão, e importá-los contaria cada um duas vezes, corrompendo o rendimento do §6.2. O valor é
lido e mostrado na prévia (coluna "Aplicado") para não sumir de vista, e nada mais.

**Formato aceito.** Dois containers: **`.xlsx`** (a "posição detalhada" que o portal exporta) e
CSV/TSV. O `.xlsx` é aberto em `apps/web/lib/import/xlsx.ts` — um leitor mínimo de ZIP + XML, no
`apps/web` porque descompactar precisa de `node:zlib`, que `packages/shared` não pode importar
— e convertido para texto delimitado *uma vez*, na prévia; é esse texto que trafega até o
confirmar e é re-parseado no servidor. O container é farejado pelos bytes (`PK\x03\x04`), não
pela extensão. Células são convertidas para o texto que a planilha mostra; a exceção são datas,
que são números com formato e viram `DD/MM/YYYY` enquanto ainda carregam o formato.

O arquivo traz preâmbulo em prosa e **várias tabelas**, cada uma com seu cabeçalho, e o parser
relê o cabeçalho toda vez que encontra um. Colunas obrigatórias: uma de produto e uma de valor,
casadas por prefixo para tolerar `Valor bruto (R$)` e `Posição a mercado`. Na posição detalhada
**nenhuma coluna se chama "produto"**: o cabeçalho começa com `"22,7% | Prefixado"` — alocação e
sub-classe —, e é esse marcador que identifica a tabela e a coluna do produto. Entre as colunas
de valor, bruto vence líquido: `Valor Líquido` já é descontado de IR.

**O que o arquivo tem e não é posição.** O mesmo arquivo lista **proventos provisionados**
(dividendo anunciado e ainda não pago) e o **saldo disponível** em conta. Nenhum dos dois vira
ativo: o provento é dinheiro de uma ação cujo valor de mercado já está no arquivo, e importá-lo
inventaria um ativo e inflaria o patrimônio. Tabelas de provento são reconhecidas pelo próprio
cabeçalho (`Valor provisionado bruto`) e **zeram o mapeamento de colunas** — sem isso as linhas
seguintes seriam lidas com o cabeçalho da última tabela de posição, e uma quantidade de ações
entraria como reais. O que ficou de fora é reportado na prévia, com valor, nunca descartado em
silêncio. As linhas de título de classe (`Renda Fixa` … `R$ 61.340,71`, o total da seção) são
descartadas pelo mesmo motivo: importá-las contaria a classe inteira duas vezes.

**Conferência contra o total do arquivo.** A prévia soma o que vai importar mais o que deixou
de fora e compara com o `Total investido` que o arquivo declara sobre si mesmo, com tolerância
de R$ 1,00 para arredondamento da XP. É a defesa contra o único erro que um import de posição
pode cometer em silêncio: a XP muda uma seção, as linhas deixam de casar com qualquer cabeçalho
e o patrimônio simplesmente encolhe — sem erro, sem prévia vazia, só um número menor.

**Indexador quando a linha não diz.** Na posição detalhada o indexador não é coluna: está na
taxa (`114,00% CDI`, `IPC-A +13,37%`) ou, no Tesouro, apenas na sub-classe do cabeçalho
(`Prefixado`, `Inflação`, `Pós-Fixado`). Vale a taxa da linha primeiro e a sub-classe depois;
`Pós-Fixado` é Selic em título público e CDI no resto. Como o tipo, é palpite que a prévia
mostra e `/assets` corrige.

**Tipo do ativo é palpite.** `inferAssetType` deduz do nome (`CDB` → `cdb`, ticker terminado em
11 → `fii` salvo ETFs conhecidos, e assim por diante) e a prévia mostra o resultado; corrigir é
trabalho de `/assets`. Por isso o import **não** sobrescreve nome, tipo e taxa de um ativo que já
existe: sobrescrever desfaria a correção a cada arquivo.

**Data do snapshot.** Ordem: data de referência impressa no arquivo ("Posição em 31/07/2026") →
data de exportação da planilha (`dcterms:created`, convertida para `America/Sao_Paulo`) → campo
da tela → hoje. O arquivo tem prioridade sobre o campo, que já vem preenchido com hoje: o
contrário arquivaria a posição de julho dentro de agosto para quem não notasse a diferença. A
posição detalhada não imprime data nenhuma, e a de exportação é o que o arquivo diz de si mesmo
— a prévia nomeia a origem da data antes de qualquer gravação.

**Idempotência (regra 6 do CLAUDE.md) por duas chaves, não por hash do arquivo:**
`assets (household_id, external_ref)` decide se o produto é novo, e `asset_snapshots
(asset_id, date)` faz o segundo import do mesmo dia sobrescrever em vez de criar uma segunda
verdade (§12). `external_ref` é `positionKey` — nome e instituição normalizados —, o análogo de
`transactions.external_id`: mudá-lo quebra o casamento em silêncio e o próximo import cria
gêmeos. O mesmo produto listado duas vezes no arquivo é **somado**, não duplicado.

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
- [x] Household compartilhado: dois logins, os mesmos dados, RLS por household, atribuição de quem lançou — Fase 6, critérios do §9 validados no stack local
- [x] Import da posição consolidada da XP (§7.1) — Fase 7, critérios do §9 validados no stack local
- [x] Carteira: alocação por classe/indexador/instituição, concentração, vencimentos próximos, posições desatualizadas, rentabilidade por período (Modified Dietz) e aporte vs. valorização mês a mês — Fase 8
- [x] Self-hosted: login por e-mail e senha, configuração em runtime (imagem portátil) e `docker compose` completo para uma VM, com TLS automático e backup diário — Fase 9, critérios do §9 validados no stack de deploy

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

**Import de investimentos (Fase 7):**
- Dado um arquivo de posição da XP, quando importo, então cada produto vira um ativo com o valor do dia — e o total do patrimônio reflete a soma.
- Dado que importei o mesmo arquivo duas vezes, então a segunda importação cria 0 ativos e mantém um único snapshot por ativo naquela data.
- Dado um ativo cujo tipo eu corrigi à mão em `/assets`, quando reimporto o arquivo, então a correção permanece.

**Carteira (Fase 8):**
- Dado um ativo com R$ 10.000 aportados em janeiro, snapshot de R$ 10.000 em 30/jun, aporte de R$ 10.000 em 01/jul e snapshot de R$ 20.400 em 31/jul, quando abro o ativo com período "1M", então vejo valorização de **R$ 400** — e a rentabilidade **não** é ~104%: o aporte não conta como rendimento.
- Dado que a carteira tem 60% em renda fixa e 40% em renda variável, quando abro Patrimônio, então vejo as duas classes com valor e percentual, e a soma dos percentuais é exatamente 100% (arredondamento não produz 99% nem 101% visíveis).
- Dado um ativo aberto cujo último snapshot é de 90 dias atrás, então ele aparece em "posições desatualizadas" com "há 90 dias", e continua contando no total.
- Dado um CDB que vence em 60 dias, então ele aparece em "vencimentos próximos" com data e valor.
- Dado um período sem aporte nem resgate, então a valorização do período é exatamente a diferença entre o valor final e o inicial.
- Dado um ativo encerrado, então ele fica fora da alocação e da rentabilidade do período, e continua na seção de encerrados.
- Dado que troco o período de 12M para 1M, então a URL muda, a página continua sendo Server Component e o topo, o gráfico e a lista refletem a nova janela.

**Self-hosted (Fase 9):**
- Dado um `.env` preenchido em uma VM limpa, quando rodo a sequência documentada do README, então o app responde em `https://<domínio>` e eu entro com e-mail e senha.
- Dado que peço a mesma imagem em outra VM com `.env` diferente, então ela funciona **sem rebuild** — nenhuma configuração de Supabase ficou assada no bundle.
- Dado um e-mail fora de `allowed_emails`, quando tento entrar, então a resposta é idêntica à de senha errada, e nada no app revela se o usuário existe.
- Dado que o `enforce_email_allowlist` está ativo, quando tento criar usuário fora da lista pela API admin, então o banco recusa.
- Dado `docker compose down` seguido de `up`, então os dados continuam lá (volume nomeado).
- Dado um dump gerado pelo serviço de backup, quando sigo o procedimento de restore do README em um banco vazio, então os lançamentos e o patrimônio voltam íntegros.
- Dado que as duas pessoas do household entram, então cada uma vê os mesmos dados e a atribuição por `user_id` continua correta (a RLS não mudou).
- Dado que abro pelo iPhone no domínio com HTTPS, então a PWA instala e o service worker registra.
- Dado `pnpm dev:local` em uma máquina de desenvolvimento, então tudo continua funcionando como antes desta fase.

**Household (Fase 6):**
- Dado que as duas pessoas estão na casa, quando uma lança uma despesa, então a outra a vê no mesmo mês, com a mesma lista de categorias e o mesmo orçamento.
- Dado um convite novo (`pnpm db:invite`), quando a pessoa entra pela primeira vez, então ela cai no household existente e **não** ganha uma segunda cópia das categorias padrão.
- Dada uma sessão sem membership, então ela não lê nem escreve linha alguma — e um `insert` com `household_id` forjado é recusado pela RLS.
- Dado um arquivo de fatura que uma delas já importou, quando a outra importa o mesmo arquivo, então 0 são inseridos.

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
| **6 — Casa** | Duas pessoas, os mesmos dados | Household (§6.3): schema, RLS por membership, `pnpm db:invite`, deploy em Supabase Free + Vercel Hobby |
| **7 — Investimentos por arquivo** | Fim da digitação do patrimônio | Import da posição consolidada da XP (§7.1), idempotente por `assets.external_ref` |
| **8 — Carteira** | Patrimônio vira acompanhamento, não cadastro | Alocação por classe/indexador/instituição, concentração, vencimentos, posições desatualizadas, rentabilidade por período (Modified Dietz) e aporte vs. valorização mês a mês (§6.2). Sem migration |
| **9 — Self-hosted** | O app instala em uma VM qualquer | Login por e-mail e senha (fim do magic link, do SMTP e da URL de redirect), configuração do Supabase em runtime (imagem portátil, fim das `NEXT_PUBLIC_*`), `Dockerfile` standalone e `deploy/docker-compose.yml` com Caddy + Postgres + GoTrue + PostgREST + backup diário (§5.3). Sem migration |

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
- **Posição da XP vira snapshot, nunca aporte** (Fase 7): o arquivo diz quanto o produto vale,
  não quanto entrou nele. Derivar `asset_events` dali faria o rendimento (§6.2) sair sempre zero,
  porque o "investido" passaria a ser o próprio valor de mercado. Vale também para a posição
  detalhada, que *tem* a coluna "Total aplicado": ela é lida e exibida na prévia, mas continua
  fora do banco enquanto aportes forem lançados à mão — importar os dois contaria em dobro. Se um
  dia o aporte manual sair de cena, essa coluna é o caminho para reconstruir `asset_events`.
- **Provento provisionado e saldo em conta não são ativo** (Fase 7): estão no "Total investido"
  que a XP declara, mas o provento é dinheiro de uma ação já avaliada no arquivo e o saldo é
  caixa. Entram na prévia como "fora da importação", com valor, para que a conferência contra o
  total do arquivo feche — o que também é o motivo de a conferência existir: um import de posição
  que perde uma seção não dá erro, só devolve um patrimônio menor.
- **O import não sobrescreve ativo existente** (Fase 7): só cria os que faltam e escreve o
  snapshot. O tipo vem de um palpite (`inferAssetType`), e `/assets` é onde ele é corrigido — um
  import que sobrescrevesse desfaria a correção todo mês.
- **O dono da linha é o household; `user_id` virou atribuição** (Fase 6): a RLS compara
  `household_id`, e `user_id` passou a responder "quem lançou". Renomear a coluna para
  `created_by` seria o rótulo honesto, mas ela é escrita por todo módulo de `lib/db` e lida
  pelos tipos gerados — o `comment on column` carrega o significado no lugar do rename.
- **O convite nomeia a casa; nada adivinha** (Fase 6): `allowed_emails.household_id` diz em qual
  household o e-mail entra, e `provision_user` lê isso. A alternativa — "entre no household que
  já existir" — funciona com duas pessoas e vira um vazamento silencioso na primeira vez que
  existirem duas casas.
- **Não há convite pela UI** (Fase 6): `households` e `household_members` são somente leitura
  para o app; quem provisiona é `pnpm db:invite` com a service role. Uma tela de convite exigiria
  papel de admin e fluxo de aceite para dois usuários que se conhecem pessoalmente.
- **Classe de ativo é derivada, não cadastrada** (Fase 8): `type` já existe e o import já o
  infere; uma coluna de classe seria um segundo lugar para errar e um segundo lugar para
  corrigir. O mapa fixo mora em `packages/shared/portfolio.ts` — mudá-lo é mudar a alocação
  de todo mundo de uma vez, que é exatamente o que se quer de uma derivação.
- **Rentabilidade de período usa Modified Dietz** (Fase 8): "valor final − valor inicial"
  atribui um aporte de meio de período a rendimento — o erro que a fase existe para
  corrigir. XIRR ficou de fora: exige iteração numérica e não é mais legível para quem lê.
  O numerador continua em `bigint`; só o denominador ponderado vira `number`, porque uma
  média ponderada por dias não é um número inteiro de centavos.
- **O rendimento vitalício não muda de fórmula** (Fase 8): `assetPerformance` é o contrato
  do §6.2 e do critério de aceite do §9 ("R$ 480, +4,8%"). A rentabilidade de período é um
  número *adicional*, com rótulo próprio ("no período"), nunca um substituto — as duas
  aparecem lado a lado na tela do ativo.
- **A janela é ancorada em fim de mês** (Fase 8): "1M" é do último dia do mês anterior até
  hoje, não "hoje menos 30 dias". Os snapshots chegam em fim de mês (a posição da XP é uma
  fotografia de fim de mês), então uma janela por dia corrido arrastaria o mesmo valor de
  fim de mês enquanto o rótulo prometia outro recorte. De quebra, cada barra do gráfico de
  aporte vs. valorização é um mês inteiro.
- **Sem benchmark externo** (Fase 8): nada de comparar com CDI ou IBOV. Exigiria série de
  mercado, e o app não tem integração (§3). "Rendeu X% no período", sem comparação, é o que
  dá para afirmar com honestidade.
- **Alocação-alvo e rebalanceamento ficam fora** (Fase 8): seriam a única parte com
  migration (tabela de metas) e encostam em recomendação de investimento (§3). Nada foi
  modelado que os impeça depois.
- **Concentração é fato, não alerta** (Fase 8): a tela diz "maior posição: 17,4% do total"
  e para por aí. Sem cor de perigo, sem limite, sem "considere diversificar" — o produto é
  de registro e acompanhamento (§3).
- **Ativo sem snapshot entra na alocação pelo valor aportado** (Fase 8): é a mesma regra já
  vigente para o total (acima). O contrário faria a alocação discordar do número impresso
  logo acima dela. Ele aparece simultaneamente em "posições desatualizadas", que é onde o
  palpite pede confirmação.
- **Período sem dado no início não é zero** (Fase 8): sem snapshot anterior ao início da
  janela, a rentabilidade é medida a partir do primeiro snapshot *dentro* dela e a tela diz
  "desde DD/MM" em vez de fingir 12 meses. Se esse primeiro snapshot for do próprio dia de
  hoje, não há janela: a tela mostra "—", não 0% — "não medi" e "ficou parado" são
  afirmações diferentes.
- **A alocação é uma barra 100% de um só matiz, com a lista ao lado** (Fase 8): oito fatias
  coloridas repetiriam o erro que virou small multiples na Fase 2 (a paleta falha separação
  para daltonismo). A rampa é o roxo da marca em cinco degraus de luminosidade, validada
  para luminosidade monótona, ΔL ≥ 0,06 e ≥ 2:1 contra a superfície nos dois temas — e a
  cor é redundante de propósito: todo valor está escrito por extenso na lista.
- **Senha, não magic link nem OTP de 6 dígitos** (Fase 9): o magic link exige um provedor
  de SMTP *e* uma URL de redirect fixa — em uma VM, sem provedor de e-mail configurado,
  não existe login nenhum. O OTP dispensaria a redirect URL, mas continua precisando de
  SMTP para entregar o código; só a senha corta as duas dependências. Para duas pessoas
  fixas, provisionadas por script, com cadastro desabilitado no servidor, é o modelo mais
  simples que ainda é honesto. O que **não** mudou: `enable_signup = false`, a
  `allowed_emails` com o trigger em `auth.users`, o `provision_user` e a RLS por
  household. Só o meio de provar identidade é outro.
- **Sem "esqueci minha senha" e sem troca de senha na UI** (Fase 9): o reset é
  `pnpm db:password <email>` no servidor. Um fluxo de recuperação por e-mail traria o SMTP
  de volta pela porta dos fundos — exatamente o que a fase remove. É uma regressão de
  conveniência assumida, para duas pessoas com acesso à VM. Pelo mesmo motivo os scripts
  de provisionamento geram a senha e a imprimem **uma única vez**: ela não fica guardada
  em lugar nenhum além do hash do GoTrue.
- **A configuração do Supabase é lida em runtime** (Fase 9): `SUPABASE_URL` e
  `SUPABASE_ANON_KEY` deixaram de ser `NEXT_PUBLIC_*` e passaram a `serverEnv`, que lê por
  getter. Como `NEXT_PUBLIC_*` é inlinado pelo Next em build time, a imagem Docker ficaria
  amarrada a uma instalação específica — trocar de VM exigiria rebuild. O que tornou isso
  possível foi apagar `lib/supabase/client.ts`: nada importava o client de browser, todo
  acesso já era Server Component, Server Action ou Route Handler. Consequência de
  segurança que vale registrar: **a API do Supabase não precisa ser publicada**, porque
  ninguém fora da rede interna fala com ela.
- **Sem Kong** (Fase 9): o gateway oficial do Supabase existe para key-auth, CORS e rate
  limit de uma API *pública*. Aqui a API não é pública — quem fala com ela é o servidor
  Next, na rede interna do Docker —, o role `anon` não tem grant nenhum (as migrations
  revogam tudo) e o PostgREST valida o JWT sozinho. O Caddy cobre o roteamento e ainda
  resolve o TLS: menos um container e menos um arquivo de config para divergir.
- **Stack mínimo** (Fase 9): nada de Studio, Realtime, Storage, imgproxy, Logflare ou
  Supavisor — o app não usa nenhum. Studio em produção seria um painel de administração do
  banco exposto na VM, o oposto do que a fase quer.
- **As chaves são geradas na instalação** (Fase 9): `scripts/gen-secrets.mjs` emite o JWT
  secret, a senha do Postgres e os JWTs `anon` e `service_role` assinados com ele. As do
  stack local da CLI são **fixas e públicas**, iguais em toda instalação: expostas em uma
  VM, qualquer pessoa forja um token `service_role` e a RLS inteira (§5.4) vira decoração.
  O `docker-compose.yml` não sobe sem essas variáveis — nenhuma tem default embutido.
- **A Supabase CLI continua sendo a única dona do schema** (Fase 9): migrations em
  produção são `supabase db push --db-url`, uma operação de cliente, rodada por túnel SSH.
  Um init container aplicando os `.sql` na mão criaria um segundo histórico de migrations,
  divergindo do `supabase db reset` local.
- **A ordem de subida importa** (Fase 9): o GoTrue cria `auth.users` nas migrations dele e
  a nossa primeira migration põe um trigger em cima dessa tabela. Sequência: `db` → `auth`
  saudável → `db push` → resto. Está no `depends_on` e no `deploy/README.md`.
- **A imagem `supabase/postgres` não dá senha aos roles** (Fase 9): ela cria `auth`,
  `auth.uid()` e os roles, mas quem define as senhas de `postgres`, `supabase_auth_admin` e
  `authenticator` é um arquivo que a CLI injeta e que **não** está na imagem. Sem
  `deploy/init/zz-role-passwords.sql` o GoTrue morre no boot com *password authentication
  failed*. Ele roda uma única vez, com o volume vazio: trocar `POSTGRES_PASSWORD` no
  `.env` depois disso não repropaga.
- **`pnpm dev:local` continua sendo o fluxo de desenvolvimento** (Fase 9): o compose é só
  para deploy. O ciclo com a CLI (reset, seed, `gen types`) é melhor e já funciona; as
  duas configurações têm que continuar equivalentes, e é por isso que as imagens do
  compose são pinadas nas mesmas versões que a CLI usa.
- **Backup diário por `pg_dump`, retenção de 14 dias** (Fase 9), em volume nomeado: num
  VPS o disco é responsabilidade sua, e até aqui não havia backup nenhum. O dump é
  completo (schema + dados, `public` e `auth`), o que faz o restore funcionar contra um
  banco vazio sem reprovisionar ninguém. O restore é como `supabase_admin`, porque o schema
  `auth` pertence a ele — como `postgres` a restauração falha em centenas de objetos. O
  procedimento está no `deploy/README.md` e foi executado: backup que nunca foi restaurado
  não é backup.
- **HTTPS com domínio, não IP** (Fase 9): com um domínio (inclusive DuckDNS) o Caddy emite
  o certificado sozinho, e é o secure context que faz o service worker de `public/sw.js`
  registrar — sem ele a PWA perde o offline e o iPhone não instala. `tls internal` fica
  documentado como saída para LAN, com o custo explícito (certificado autoassinado, aviso
  no browser, sem PWA no iOS); para acesso externo sem abrir porta no roteador, Tailscale.
- **Gráfico de patrimônio é linha simples** (Fase 4): a decisão de virar small multiples na
  Fase 2 valia para o gasto *por categoria*, onde a paleta semeada falhava separação para
  daltonismo (laranja↔verde, ΔE 4,8). Patrimônio é série única, então não há cor
  codificando nada e a linha volta a ser a forma certa. As duas telas usam o mesmo
  componente (`components/month-line-chart.tsx`).
