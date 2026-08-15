# CLAUDE.md — Finanças Pessoais

Contexto operacional para o Claude Code. A fonte da verdade de produto e arquitetura é o **`SPEC.md`** — leia a seção relevante antes de implementar qualquer feature. Este arquivo cobre *como trabalhar* neste repositório.

## O que é este projeto

App de finanças da casa: duas pessoas em um household compartilhado, controle de gastos mensais com orçamento por categoria + acompanhamento de patrimônio/investimentos. Web desktop + PWA mobile. Entrada de dados é manual, com import de CSV (fatura do cartão e posição da XP) para lançamento em lote. Dono: engenheiro de software sênior — pode assumir familiaridade com TypeScript, SQL e trade-offs de arquitetura; explique decisões, não conceitos básicos.

## Stack e estrutura

- **Monorepo pnpm**: `apps/web` (Next.js App Router, TypeScript strict, Tailwind + shadcn/ui, Recharts), `packages/shared` (tipos e helpers), `supabase/` (migrations SQL + seed).
- **Supabase**: Postgres + Auth + RLS.
- Toda mutação passa por **Server Action**; `lib/db/*` (marcado `server-only`) é a única porta de entrada no Postgres.

## Comandos

```bash
pnpm install
pnpm dev:local           # sobe tudo: Docker + Supabase + usuário dono + Next (smoke test)
pnpm db:invite <email>   # adiciona a segunda pessoa ao household do dono
pnpm dev                 # apps/web em localhost:3000 (assume Supabase já rodando)
pnpm typecheck           # tsc --noEmit em todos os workspaces
pnpm test                # vitest
pnpm lint
supabase start           # stack local (Docker)
supabase db reset        # aplica migrations + seed do zero
supabase migration new <nome>   # nova migration (nunca edite migrations já aplicadas)
```

Antes de considerar qualquer tarefa concluída: `pnpm typecheck && pnpm lint && pnpm test` devem passar.

## Convenções inegociáveis

1. **Dinheiro é `bigint` em centavos.** Nunca float, nunca `number` para aritmética de valores — use os helpers de `packages/shared/money.ts` (criar na Fase 0). Formatação de exibição: `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`.
2. **Datas de transação são `date`** (sem hora). Timezone de referência: `America/Sao_Paulo`. Cuidado com off-by-one ao converter — nunca use `new Date('2026-08-01')` para datas de negócio; trate como string `YYYY-MM-DD` ou use helper de `shared`.
3. **RLS em toda tabela nova**, política `household_id = public.current_household_id()`, sem exceção. Toda tabela de dados carrega `household_id` (dono da linha, é o que autoriza) **e** `user_id` (quem lançou, atribuição apenas). Uniques também vão em `household_id` — em `user_id` eles dariam a cada pessoa a sua própria cópia de tudo.
4. **Schema muda só via migration** em `supabase/migrations/` (SQL). Nunca altere o banco pelo dashboard.
5. **Segredos nunca no client.** `SUPABASE_SERVICE_ROLE_KEY` e `OWNER_EMAIL` são server-only. Só chaves com prefixo `NEXT_PUBLIC_` podem aparecer em código de browser. Ao criar env var nova, adicione em `.env.example` (sem valor).
6. **Idempotência no import:** toda transação importada tem `external_id` único; inserções usam `on conflict do nothing`. Importar o mesmo arquivo duas vezes nunca pode duplicar dados.
7. **UI em pt-BR**; código, identificadores, commits e comentários em inglês. Commits: conventional commits (`feat:`, `fix:`, `chore:`...).
8. **Mobile-first** nas telas de gastos — o caso de uso nº 1 é registrar despesa pelo iPhone via PWA.

## Regras de negócio que sempre confundem (resumo do SPEC §6)

- Despesa de cartão conta na **data da compra** (competência); parcela conta na data da fatura em que cai — uma transação por parcela.
- **Pagamento de fatura não é despesa** — descartar na importação.
- Estorno = transação `type='income'` na mesma categoria.
- Rendimento de ativo = último snapshot − (Σ aportes − Σ resgates).

## Como trabalhar

- Siga o **plano de fases do SPEC §10**. Implemente uma fase (ou parte coesa dela) por vez; não antecipe features de fases futuras, mas não tome decisões que as inviabilizem (P2 do SPEC §8 é o guia).
- Ao concluir uma fase, atualize o checklist de requisitos no SPEC §8.
- Testes: priorize testes de unidade nas regras de negócio (helpers de dinheiro, cálculo de orçamento restante, dedup de import, cálculo de rendimento). UI não precisa de cobertura alta na v1.
- Prefira Server Components e queries no servidor; use client components apenas onde há interatividade real (formulários, gráficos).
- Se uma decisão de produto não estiver no SPEC, **pergunte antes de assumir** — e depois registre a resposta no SPEC §12.

## Armadilhas conhecidas

- Supabase local exige Docker rodando; se `supabase start` falhar, verifique isso primeiro.
- CSV do Nubank pode ter linhas idênticas legítimas (duas compras iguais no mesmo dia) — a chave de dedup inclui um índice de ocorrência (ver SPEC §7).
- `packages/shared` é importado por client components: nada de `node:*` ali. Hashing e I/O ficam em `apps/web/lib/` — é por isso que o leitor de `.xlsx` (ZIP + `node:zlib`) mora em `lib/import/xlsx.ts` e entrega texto delimitado para o parser puro de `shared`.
- Depois de criar migration, regenere `apps/web/lib/supabase/database.types.ts` (comando no README) — o typecheck quebra sem isso.
- Mudar `lib/import/external-id.ts` quebra a idempotência em silêncio: todo `external_id` já gravado passa a ser outro, e o próximo import duplica tudo. O mesmo vale para `positionKey` em `packages/shared/xp-position.ts`, que é o `external_ref` dos ativos importados da XP.
- Escrita nova em `lib/db` tem que passar `household_id` (de `authedClient()`), não só `user_id`: sem ele o insert é recusado pela RLS. `onConflict` de upsert também mudou de escopo — é `household_id,...`.
- `bigint` não atravessa a fronteira server→client. Formate no servidor (`formatCents`) e passe string para o client component.
- `exactOptionalPropertyTypes` está ligado: render props do Recharts (`dot`, por exemplo) não aceitam um tipo de props mais estreito que o da lib — tipe pelo Recharts e estreite dentro do corpo.
