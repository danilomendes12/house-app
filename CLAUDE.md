# CLAUDE.md — Finanças Pessoais

Contexto operacional para o Claude Code. A fonte da verdade de produto e arquitetura é o **`SPEC.md`** — leia a seção relevante antes de implementar qualquer feature. Este arquivo cobre *como trabalhar* neste repositório.

## O que é este projeto

App de finanças da casa: duas pessoas em um household compartilhado, controle de gastos mensais por categoria + acompanhamento de patrimônio/investimentos, mais uma lista de tarefas compartilhada. Web desktop + PWA mobile. Entrada de dados é manual, com import de CSV (fatura do cartão e posição da XP) para lançamento em lote. Dono: engenheiro de software sênior — pode assumir familiaridade com TypeScript, SQL e trade-offs de arquitetura; explique decisões, não conceitos básicos.

## Stack e estrutura

- **Monorepo pnpm**: `apps/web` (Next.js App Router, TypeScript strict, Tailwind + shadcn/ui, Recharts), `packages/shared` (tipos e helpers), `supabase/` (migrations SQL + seed), `deploy/` (a stack em `docker compose`).
- **Supabase self-hosted**: Postgres + GoTrue (Auth) + PostgREST atrás do Caddy, em containers. "Supabase" aqui são essas peças, não o produto hospedado — que saiu na Fase 9. Uma stack só, a mesma em qualquer lugar (SPEC §5.3), inclusive na VM de produção (Fase 11).
- **A Supabase CLI é ferramenta, não stack.** Ela cria e aplica migrations e gera os tipos. `supabase start` não é usado neste projeto: rodar um segundo Postgres/GoTrue/PostgREST ao lado dos do compose era o que fazia isto parecer dois projetos (Fase 10).
- Toda mutação passa por **Server Action**; `lib/db/*` (marcado `server-only`) é a única porta de entrada no Postgres.

## Comandos

```bash
pnpm install
pnpm dev                 # O comando: stack em Docker + migrations + dono + Next com hot reload
pnpm stack down|reset    # para a stack | para e apaga o banco
pnpm stack studio        # Supabase Studio em 127.0.0.1:54323 (profile, desligado por padrão)
pnpm stack prod          # build de produção em Docker, em vez do next dev (disputa a porta 3000)
pnpm stack logs [svc]    # db, auth, rest, caddy, studio, web
pnpm stack types         # regenera apps/web/lib/supabase/database.types.ts
pnpm db:invite <email>   # adiciona a segunda pessoa ao household do dono
pnpm db:password <email> # redefine a senha (não existe recuperação pela UI)
pnpm db:dump             # dump do banco → deploy/backups/ (--remote: na VM, e traz cópia)
pnpm db:restore --latest # restaura o dump mais novo (--remote: na VM). Destrutivo, confirma
pnpm server init --owner <email>   # deploy inicial numa VM vazia (uma vez)
pnpm server              # o deploy de manutenção: código novo, migrations, rebuild, health
pnpm server status|logs|ssh|run <script>   # operar a VM daqui
pnpm typecheck           # tsc --noEmit em todos os workspaces
pnpm test                # vitest
pnpm lint
pnpm exec supabase migration new <nome>   # nova migration (nunca edite migrations já aplicadas)
```

Antes de considerar qualquer tarefa concluída: `pnpm typecheck && pnpm lint && pnpm test` devem passar.

## Convenções inegociáveis

1. **Dinheiro é `bigint` em centavos.** Nunca float, nunca `number` para aritmética de valores — use os helpers de `packages/shared/money.ts` (criar na Fase 0). Formatação de exibição: `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`.
2. **Datas de transação são `date`** (sem hora). Timezone de referência: `America/Sao_Paulo`. Cuidado com off-by-one ao converter — nunca use `new Date('2026-08-01')` para datas de negócio; trate como string `YYYY-MM-DD` ou use helper de `shared`.
3. **RLS em toda tabela nova**, política `household_id = public.current_household_id()`, sem exceção. Toda tabela de dados carrega `household_id` (dono da linha, é o que autoriza) **e** `user_id` (quem lançou, atribuição apenas). Uniques também vão em `household_id` — em `user_id` eles dariam a cada pessoa a sua própria cópia de tudo.
4. **Schema muda só via migration** em `supabase/migrations/` (SQL). Nunca altere o banco pelo dashboard.
5. **Nada de `NEXT_PUBLIC_*`.** *Toda* env var é server-only (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`), lida por getter em `lib/env.ts` — ou seja, em runtime, que é o que mantém a imagem Docker portátil. Não existe client de browser do Supabase: se precisar de dado em client component, passe do servidor por props. Existe **um** arquivo de env, `deploy/.env`: o compose lê dele e o `pnpm dev` injeta os três `SUPABASE_*` no Next. Ao criar env var nova, adicione em `deploy/.env.example` (sem valor) e decida quem a lê — o app, o compose ou os scripts.
6. **Idempotência no import:** toda transação importada tem `external_id` único; inserções usam `on conflict do nothing`. Importar o mesmo arquivo duas vezes nunca pode duplicar dados.
7. **UI em pt-BR**; código, identificadores, commits e comentários em inglês. Commits: conventional commits (`feat:`, `fix:`, `chore:`...).
8. **Mobile-first** nas telas de gastos — o caso de uso nº 1 é registrar despesa pelo iPhone via PWA.

## Regras de negócio que sempre confundem (resumo do SPEC §6)

- **Orçamento não existe mais** (Fase 12): a tabela `budgets`, as telas, `budgetStatus` e a barra de "quanto resta" foram removidos, e a aba virou Tarefas. A barra ao lado de cada categoria no Resumo é a participação dela no mês. Não reintroduza nada disso — a decisão está no SPEC §12.
- Despesa de cartão conta na **data da compra** (competência); parcela conta na data da fatura em que cai — uma transação por parcela.
- **Pagamento de fatura não é despesa** — descartar na importação.
- Estorno = transação `type='income'` na mesma categoria.
- Rendimento de ativo = último snapshot − (Σ aportes − Σ resgates).

## Como trabalhar

- Siga o **plano de fases do SPEC §10**. Implemente uma fase (ou parte coesa dela) por vez; não antecipe features de fases futuras, mas não tome decisões que as inviabilizem (P2 do SPEC §8 é o guia).
- Ao concluir uma fase, atualize o checklist de requisitos no SPEC §8.
- Testes: priorize testes de unidade nas regras de negócio (helpers de dinheiro, agregação do mês, dedup de import, cálculo de rendimento). UI não precisa de cobertura alta na v1.
- Prefira Server Components e queries no servidor; use client components apenas onde há interatividade real (formulários, gráficos).
- Se uma decisão de produto não estiver no SPEC, **pergunte antes de assumir** — e depois registre a resposta no SPEC §12.

## Armadilhas conhecidas

- Tudo exige Docker rodando; se `pnpm dev` falhar logo no começo, verifique isso primeiro (no macOS ele tenta abrir o Docker Desktop sozinho).
- CSV do Nubank pode ter linhas idênticas legítimas (duas compras iguais no mesmo dia) — a chave de dedup inclui um índice de ocorrência (ver SPEC §7).
- `packages/shared` é importado por client components: nada de `node:*` ali. Hashing e I/O ficam em `apps/web/lib/` — é por isso que o leitor de `.xlsx` (ZIP + `node:zlib`) mora em `lib/import/xlsx.ts` e entrega texto delimitado para o parser puro de `shared`.
- Depois de criar migration: `pnpm dev` (aplica) e `pnpm stack types` (regenera `apps/web/lib/supabase/database.types.ts`) — o typecheck quebra sem o segundo.
- Mudar `lib/import/external-id.ts` quebra a idempotência em silêncio: todo `external_id` já gravado passa a ser outro, e o próximo import duplica tudo. O mesmo vale para `positionKey` em `packages/shared/xp-position.ts`, que é o `external_ref` dos ativos importados da XP.
- Escrita nova em `lib/db` tem que passar `household_id` (de `authedClient()`), não só `user_id`: sem ele o insert é recusado pela RLS. `onConflict` de upsert também mudou de escopo — é `household_id,...`.
- `bigint` não atravessa a fronteira server→client. Formate no servidor (`formatCents`) e passe string para o client component.
- `exactOptionalPropertyTypes` está ligado: render props do Recharts (`dot`, por exemplo) não aceitam um tipo de props mais estreito que o da lib — tipe pelo Recharts e estreite dentro do corpo.
- Login é **e-mail + senha** (Fase 9). Não existe magic link, `/auth/callback`, `getSiteUrl` nem SMTP em lugar nenhum — se algo pedir "abra o e-mail", é código morto. A resposta de erro do login tem que continuar idêntica para senha errada e para e-mail inexistente.
- Trocar de senha e recuperar senha **não existem na UI** por decisão (SPEC §12): é `pnpm db:password`. Não construa a tela.
- **Auth se configura em um lugar só:** o ambiente do GoTrue em `deploy/docker-compose.yml`. `supabase/config.toml` foi esvaziado de propósito na Fase 10 — nada lá é lido, e repor config de auth ali cria uma segunda fonte da verdade que ninguém aplica.
- A imagem `supabase/postgres` **não** define senha para os roles — quem faz isso é `deploy/init/zz-role-passwords.sql`, e só na primeira subida, com o volume vazio.
- O Caddy não é opcional, mesmo sem TLS: o `supabase-js` precisa de **uma** URL base, e `/auth/v1/*` e `/rest/v1/*` são dois containers. É ele que junta os dois, e é o que substitui o Kong.
- `SUPABASE_URL` tem três valores para o mesmo endereço: `http://127.0.0.1:8000` para o Next no host (`pnpm dev`), `http://caddy:8000` para o container `web` (`pnpm stack prod` e a VM) e de novo `http://127.0.0.1:8000` para os scripts que rodam **na VM fora dos containers** (`db:owner`, `db:invite`, `db push`). Confundir os dois primeiros dá ECONNREFUSED, não 401.
- `OWNER_EMAIL` é **argumento de bootstrap**, não configuração: `pnpm db:owner <email>` a usa uma vez, numa instalação sem dono, e depois disso quem sabe quem é o dono é o banco. Ela não está no `deploy/.env`, não é lida pelo app e não deve voltar a `lib/env.ts` — ela já esteve lá sem nenhum consumidor.
- `provision_user` dispara no **insert** em `auth.users`, não no primeiro login: o household existe a partir de `db:owner`, e `db:invite` funciona na hora, sem a pessoa precisar entrar antes.
- Scripts chamados pelo `stack.mjs` recebem `SUPABASE_URL` **explicitamente** (`webEnv`), porque quem manda na porta é `SUPABASE_API_PORT` e o `SUPABASE_URL` do `deploy/.env` é só o default de execução manual. Deixar o arquivo vencer manda a chave certa para a stack errada, e o sintoma é um 401 seco.
- Hospedagem é uma **VM Always Free da Oracle** (Ampere A1 ARM, Ubuntu 24.04), domínio `tinocot.com`, TLS pelo Caddy (Fase 11 — SPEC §11 Q5 respondida). O procedimento inteiro está em `docs/DEPLOY.md`; não reinvente nem duplique.
- **O que difere entre laptop e servidor é um arquivo:** `deploy/docker-compose.server.yml` (80/443, `DOMAIN` obrigatório, `web` ligado). Quem decide layerizá-lo é `DEPLOY_TARGET=server` no `deploy/.env` **daquela** instalação, não uma flag. Ao mexer no compose, pergunte se a mudança vale nos dois lugares — se valer, ela vai no arquivo base.
- `scripts/stack.mjs` é o **mesmo** script nos dois lugares. `scripts/server.mjs` só sabe alcançar a VM por SSH; o que fazer lá dentro continua tendo uma implementação só. Não duplique a sequência de subida em `server.mjs`.
- O comando é `pnpm server`, **não** `pnpm deploy`: `deploy` é builtin do pnpm e sombrearia o script.
- O `Caddyfile` tem dois blocos. `:8000` é a API do Supabase e é **privado nas duas instalações** — nada de rotear `/auth/v1` ou `/rest/v1` no bloco público. `{$DOMAIN:localhost}`: o default é o que mantém o Caddy subindo na sua máquina, onde `DOMAIN` não existe.
- O restore (`pnpm db:restore`) **apaga `public`, `auth` e `supabase_migrations` antes de carregar** — é isso que impede o `provision_user` de criar household duplicado. Não o transforme num merge. O dump não carrega roles nem extensões (vêm da imagem), então o destino tem que ser uma stack que já subiu.
- O dump antes de migration só acontece quando há migration **pendente**. É o que faz `pnpm server` duas vezes seguidas não deixar rastro; não passe a tirar dump em todo deploy.
