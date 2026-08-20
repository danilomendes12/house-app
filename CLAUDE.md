# CLAUDE.md — o app da casa

Contexto operacional para o Claude Code: o que é este projeto, como se trabalha nele e o que
já foi decidido. **Este arquivo é a fonte da verdade de produto** — o `SPEC.md` que ele citava
foi removido do repositório. Comentários no código ainda dizem "SPEC §x": leia como "isto é
decisão, não acidente", não como ponteiro para um arquivo a abrir.

## O que é este projeto

App do dia a dia de uma família — um casal e um filho. Quatro coisas em um lugar: **gastos**
do mês por categoria, **patrimônio/investimentos**, a **checklist** compartilhada da casa e
as **listas de compras** (casa e mercado). Web desktop + PWA mobile.

Não trate isto como um app de finanças com features penduradas. Dinheiro é a seção mais
antiga e a mais elaborada, não a razão de ser: o critério para uma feature entrar é "os dois
precisam disso no meio da semana, do celular", e a lista do mercado passa nesse critério
tão bem quanto o extrato do cartão.

Entrada de dados é manual, com import de CSV (fatura do cartão e posição da XP) para
lançamento em lote. Não há integração bancária, e ela saiu do escopo por decisão.

Dono: engenheiro de software sênior — pode assumir familiaridade com TypeScript, SQL e
trade-offs de arquitetura; explique decisões, não conceitos básicos.

## Stack e estrutura

- **Monorepo pnpm**: `apps/web` (Next.js App Router, TypeScript strict, Tailwind + shadcn/ui,
  Recharts), `packages/shared` (tipos e helpers puros), `supabase/` (migrations SQL + seed),
  `deploy/` (a stack em `docker compose`).
- **Supabase self-hosted**: Postgres + GoTrue (Auth) + PostgREST atrás do Caddy, em
  containers. "Supabase" aqui são essas peças, não o produto hospedado. Uma stack só, a mesma
  em qualquer lugar, inclusive na VM de produção.
- **A Supabase CLI é ferramenta, não stack.** Ela cria e aplica migrations e gera os tipos.
  `supabase start` não é usado neste projeto: rodar um segundo Postgres/GoTrue/PostgREST ao
  lado dos do compose era o que fazia isto parecer dois projetos.
- Toda mutação passa por **Server Action**; `lib/db/*` (marcado `server-only`) é a única porta
  de entrada no Postgres.

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

Antes de considerar qualquer tarefa concluída: `pnpm typecheck && pnpm lint && pnpm test`
devem passar.

## Convenções inegociáveis

1. **Dinheiro é `bigint` em centavos.** Nunca float, nunca `number` para aritmética de
   valores — use os helpers de `packages/shared/money.ts`. Formatação de exibição:
   `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`.
2. **Datas de transação são `date`** (sem hora). Timezone de referência:
   `America/Sao_Paulo`. Cuidado com off-by-one ao converter — nunca use
   `new Date('2026-08-01')` para datas de negócio; trate como string `YYYY-MM-DD` ou use
   helper de `shared`.
3. **RLS em toda tabela nova**, política `household_id = public.current_household_id()`, sem
   exceção. Toda tabela de dados carrega `household_id` (dono da linha, é o que autoriza)
   **e** `user_id` (quem lançou, atribuição apenas). Uniques também vão em `household_id` —
   em `user_id` eles dariam a cada pessoa a sua própria cópia de tudo.
4. **Schema muda só via migration** em `supabase/migrations/` (SQL). Nunca altere o banco
   pelo dashboard.
5. **Nada de `NEXT_PUBLIC_*`.** *Toda* env var é server-only (`SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`), lida por getter em `lib/env.ts` — ou
   seja, em runtime, que é o que mantém a imagem Docker portátil. Não existe client de
   browser do Supabase: se precisar de dado em client component, passe do servidor por props.
   Existe **um** arquivo de env, `deploy/.env`: o compose lê dele e o `pnpm dev` injeta os
   três `SUPABASE_*` no Next. Ao criar env var nova, adicione em `deploy/.env.example` (sem
   valor) e decida quem a lê — o app, o compose ou os scripts.
6. **Idempotência no import:** toda transação importada tem `external_id` único; inserções
   usam `on conflict do nothing`. Importar o mesmo arquivo duas vezes nunca pode duplicar
   dados.
7. **UI em pt-BR**; código, identificadores, commits e comentários em inglês. Commits:
   conventional commits (`feat:`, `fix:`, `chore:`...).
8. **Mobile-first**, e não só nos gastos: o caso de uso nº 1 é registrar despesa pelo iPhone
   via PWA, e o nº 2 é marcar item na lista do mercado empurrando o carrinho. Toque grande,
   uma mão, e as ações têm que funcionar em página ainda não hidratada — é por isso que
   tarefas e compras são `<form>` por linha, não checkbox com JavaScript.

## Regras de negócio que sempre confundem

**Dinheiro**

- Despesa de cartão conta na **data da compra** (competência); parcela conta na data da
  fatura em que cai — uma transação por parcela.
- **Pagamento de fatura não é despesa** — descartar na importação.
- Estorno = transação `type='income'` na mesma categoria.
- Rendimento de ativo = último snapshot − (Σ aportes − Σ resgates).
- Um snapshot por ativo por dia: salvar de novo na mesma data sobrescreve, em vez de criar
  uma segunda verdade para o mesmo dia.
- Ativo sem snapshot entra no total pelo valor aportado. Ativo fechado mantém o histórico e
  sai do total atual.
- A taxa do ativo ("110% do CDI") é **documentação**: nada no app projeta valor a partir dela.

**Casa**

- **Compras são duas listas, uma tabela**: `shopping_items.list` é `'home'` (casa) ou
  `'market'` (supermercado), com CHECK. Toda leitura, contagem e limpeza é escopada por
  `list` — "limpar comprados" no mercado não pode apagar o que a casa já comprou.
- Item de compra e tarefa são **só título** e um check: sem quantidade, sem valor, sem
  categoria, sem prazo. O custo de acrescentar um item é o que decide se a lista é usada.

## Decisões tomadas — não reabrir sem perguntar

- **Orçamento não existe.** A tabela `budgets`, as telas, `budgetStatus` e a barra de "quanto
  resta" foram removidos na Fase 12, e a aba virou Tarefas. A barra ao lado de cada categoria
  no Resumo é a **participação dela no mês**, não consumo de orçamento. Não reintroduza nada
  disso.
- **Login é e-mail + senha.** Não existe magic link, `/auth/callback`, `getSiteUrl` nem SMTP
  em lugar nenhum — se algo pedir "abra o e-mail", é código morto.
- **Trocar senha e recuperar senha não existem na UI**, por decisão: é `pnpm db:password`.
  Não construa a tela.
- **Não há integração bancária.** Os dados entram à mão ou por import de arquivo.
- **A URL do app é `momolados.com.br/financial`** — subcaminho, não raiz.
- **Seis abas é o teto.** Seção nova entra dentro de uma existente ou no header.

## Como trabalhar

- Implemente uma coisa coesa por vez; não antecipe features que ninguém pediu, mas não tome
  decisões que as inviabilizem.
- Testes: priorize testes de unidade nas regras de negócio (helpers de dinheiro, agregação do
  mês, dedup de import, cálculo de rendimento, escopo das listas). UI não precisa de cobertura
  alta.
- Prefira Server Components e queries no servidor; use client components apenas onde há
  interatividade real (formulários, gráficos).
- Se uma decisão de produto não estiver aqui, **pergunte antes de assumir** — e depois
  registre a resposta neste arquivo, na seção acima.

## Armadilhas conhecidas

- Tudo exige Docker rodando; se `pnpm dev` falhar logo no começo, verifique isso primeiro (no
  macOS ele tenta abrir o Docker Desktop sozinho).
- CSV do Nubank pode ter linhas idênticas legítimas (duas compras iguais no mesmo dia) — a
  chave de dedup inclui um índice de ocorrência.
- `packages/shared` é importado por client components: nada de `node:*` ali. Hashing e I/O
  ficam em `apps/web/lib/` — é por isso que o leitor de `.xlsx` (ZIP + `node:zlib`) mora em
  `lib/import/xlsx.ts` e entrega texto delimitado para o parser puro de `shared`.
- Depois de criar migration: `pnpm dev` (aplica) e `pnpm stack types` (regenera
  `apps/web/lib/supabase/database.types.ts`) — o typecheck quebra sem o segundo.
- Mudar `lib/import/external-id.ts` quebra a idempotência em silêncio: todo `external_id` já
  gravado passa a ser outro, e o próximo import duplica tudo. O mesmo vale para `positionKey`
  em `packages/shared/xp-position.ts`, que é o `external_ref` dos ativos importados da XP.
- Escrita nova em `lib/db` tem que passar `household_id` (de `authedClient()`), não só
  `user_id`: sem ele o insert é recusado pela RLS. `onConflict` de upsert também é
  `household_id,...`.
- `bigint` não atravessa a fronteira server→client. Formate no servidor (`formatCents`) e
  passe string para o client component.
- `exactOptionalPropertyTypes` está ligado: render props do Recharts (`dot`, por exemplo) não
  aceitam um tipo de props mais estreito que o da lib — tipe pelo Recharts e estreite dentro
  do corpo.
- A tab bar tem **seis** abas, e o rótulo do celular é o gargalo: acima de ~8 caracteres a aba
  precisa de `shortLabel` em `components/main-nav.tsx`. Uma sétima não cabe.
- A resposta de erro do login tem que continuar idêntica para senha errada e para e-mail
  inexistente.
- **Auth se configura em um lugar só:** o ambiente do GoTrue em `deploy/docker-compose.yml`.
  `supabase/config.toml` foi esvaziado de propósito — nada lá é lido, e repor config de auth
  ali cria uma segunda fonte da verdade que ninguém aplica.
- A imagem `supabase/postgres` **não** define senha para os roles — quem faz isso é
  `deploy/init/zz-role-passwords.sql`, e só na primeira subida, com o volume vazio.
- A imagem do PostgREST **não é a mesma nas duas arquiteturas**: a de `linux/amd64` (a VM)
  traz só `/bin/postgrest`, sem shell nenhum; a de `arm64` (o laptop) é Debian e tem bash.
  Por isso `rest` não declara healthcheck — qualquer `test:` com shell passa aqui e falha
  lá, e o sintoma é `web` parado em `Created` atrás do `depends_on` com o Caddy em 502.
  Quem espera a API ficar de pé é `waitForApi`, em `scripts/lib/bringup.mjs`. Ao acrescentar
  healthcheck em qualquer serviço, confirme que a imagem tem o binário nos dois arcos.
- O Caddy não é opcional, mesmo sem TLS: o `supabase-js` precisa de **uma** URL base, e
  `/auth/v1/*` e `/rest/v1/*` são dois containers. É ele que junta os dois, e é o que
  substitui o Kong.
- `SUPABASE_URL` tem três valores para o mesmo endereço: `http://127.0.0.1:8000` para o Next
  no host (`pnpm dev`), `http://caddy:8000` para o container `web` (`pnpm stack prod` e a VM)
  e de novo `http://127.0.0.1:8000` para os scripts que rodam **na VM fora dos containers**
  (`db:owner`, `db:invite`, `db push`). Confundir os dois primeiros dá ECONNREFUSED, não 401.
- `OWNER_EMAIL` é **argumento de bootstrap**, não configuração: `pnpm db:owner <email>` a usa
  uma vez, numa instalação sem dono, e depois disso quem sabe quem é o dono é o banco. Ela não
  está no `deploy/.env`, não é lida pelo app e não deve voltar a `lib/env.ts` — ela já esteve
  lá sem nenhum consumidor.
- `provision_user` dispara no **insert** em `auth.users`, não no primeiro login: o household
  existe a partir de `db:owner`, e `db:invite` funciona na hora, sem a pessoa precisar entrar
  antes.
- Scripts chamados pelo `stack.mjs` recebem `SUPABASE_URL` **explicitamente** (`webEnv`),
  porque quem manda na porta é `SUPABASE_API_PORT` e o `SUPABASE_URL` do `deploy/.env` é só o
  default de execução manual. Deixar o arquivo vencer manda a chave certa para a stack errada,
  e o sintoma é um 401 seco.
- Hospedagem é uma **VM `e2-micro` do Always Free da GCP** (projeto `financial-app-506021`,
  zona `us-east1-b`, x86, Ubuntu 24.04, IP fixo `35.211.95.169`), domínio `momolados.com.br`
  (registro.br), TLS pelo Caddy. O procedimento inteiro está em `docs/DEPLOY.md`; não
  reinvente nem duplique. Oracle e netcup são história.
- O `basePath` do Next é build-time: o prefixo `/financial` é assado na imagem pelo CI, e é a
  única configuração deste projeto que não é lida em runtime. Ao mexer em manifest, service
  worker, ícones, healthcheck ou em qualquer URL absoluta escrita à mão, lembre que o Next
  **não** prefixa essas — só `next/link`, `redirect()` e o que ele mesmo emite. A receita
  completa está em `docs/DEPLOY.md` §1.3.
- O `HEALTHCHECK` do `Dockerfile` é uma dessas URLs à mão, e a mais traiçoeira: ele pede
  `/financial/login`. Sem o prefixo o `wget --spider` leva 404 e o container fica
  `unhealthy` com o app perfeitamente no ar — o sintoma é `pnpm server` morrendo em
  "container financas-web-1 is unhealthy". Corrigir isso exige build novo do CI: o
  healthcheck está assado na imagem, como o `basePath`.
- **O que é grátis na VM é exatamente `e2-micro` + 30 GB de disco `pd-standard` + Standard
  Tier de rede.** Trocar o tipo da máquina, pôr disco `balanced`, criar uma segunda VM ou
  deixar a rede em Premium tira a instalação do free tier — e o único aviso é a fatura. O que
  se paga hoje é só o IPv4 (US$ 0,005/h).
- A VM **não tem login root**: o usuário é `financas` (criado pela metadata `ssh-keys`), com
  sudo sem senha. Todo script remoto já prefixa `$SUDO` quando `id -u` não é 0 — mantenha
  assim ao acrescentar passos.
- **O que difere entre laptop e servidor é um arquivo:** `deploy/docker-compose.server.yml`
  (80/443, `DOMAIN` obrigatório, `web` ligado). Quem decide layerizá-lo é
  `DEPLOY_TARGET=server` no `deploy/.env` **daquela** instalação, não uma flag. Ao mexer no
  compose, pergunte se a mudança vale nos dois lugares — se valer, ela vai no arquivo base.
- `scripts/stack.mjs` é o **mesmo** script nos dois lugares. `scripts/server.mjs` só sabe
  alcançar a VM por SSH; o que fazer lá dentro continua tendo uma implementação só. Não
  duplique a sequência de subida em `server.mjs`.
- O comando é `pnpm server`, **não** `pnpm deploy`: `deploy` é builtin do pnpm e sombrearia o
  script.
- O `Caddyfile` tem dois blocos. `:8000` é a API do Supabase e é **privado nas duas
  instalações** — nada de rotear `/auth/v1` ou `/rest/v1` no bloco público.
  `{$DOMAIN:localhost}`: o default é o que mantém o Caddy subindo na sua máquina, onde
  `DOMAIN` não existe.
- O restore (`pnpm db:restore`) **apaga `public`, `auth` e `supabase_migrations` antes de
  carregar** — é isso que impede o `provision_user` de criar household duplicado. Não o
  transforme num merge. O dump não carrega roles nem extensões (vêm da imagem), então o
  destino tem que ser uma stack que já subiu.
- O dump antes de migration só acontece quando há migration **pendente**. É o que faz
  `pnpm server` duas vezes seguidas não deixar rastro; não passe a tirar dump em todo deploy.
- Nomes herdados: o repo é `my-financial-app`, os pacotes são `@finance/*` e a PWA se instala
  como "Finanças". São de quando o app era só de dinheiro — não leia escopo neles.
