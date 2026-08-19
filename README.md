# Finanças Pessoais

App da casa (duas pessoas, um household) para controle de gastos mensais e acompanhamento de
patrimônio.

- **Web + PWA** (instalável no iPhone) — Next.js App Router
- **Banco/Auth** — Supabase self-hosted (Postgres + GoTrue + PostgREST) em `docker compose`
- **Entrada de dados** — manual, com import de CSV (fatura do cartão e posição da XP), idempotente

## Como rodar

Pré-requisitos: Node 20+, pnpm e Docker.

```bash
pnpm install
OWNER_EMAIL=voce@exemplo.com pnpm dev
```

É só isso, e é o único fluxo. `pnpm dev` sobe a stack em Docker, aplica as migrations,
provisiona o usuário dono e inicia o Next em http://localhost:3000 com hot reload — em
ordem e de forma idempotente, então rodar de novo depois de um crash retoma de onde parou.
Da segunda vez em diante, `pnpm dev` sozinho basta. O `OWNER_EMAIL` é pedido **uma única
vez**, numa instalação que ainda não tem dono: como o cadastro é fechado (signups
desligados e a allowlist rejeitando o resto no banco), o primeiro e-mail é a única coisa
que o sistema não consegue decidir sozinho. Depois disso ele está no banco, e a variável
não é mais lida por nada.

O login é por **e-mail e senha**. A primeira execução imprime a senha gerada **uma única
vez** — anote na hora. Perdeu? `pnpm db:password <email>` gera outra.

| Comando             | O quê                                                        |
| ------------------- | ------------------------------------------------------------ |
| `pnpm dev`          | a stack + o Next com hot reload                              |
| `pnpm stack up`     | só a stack (sem o Next)                                      |
| `pnpm stack down`   | para tudo; os dados ficam no volume                          |
| `pnpm stack reset`  | para e **apaga o banco** — a próxima subida recria do zero   |
| `pnpm stack studio` | Supabase Studio em http://127.0.0.1:54323                    |
| `pnpm stack prod`   | roda o build de produção em Docker, em vez do `next dev`     |
| `pnpm stack logs`   | logs de todos os serviços (ou de um: `pnpm stack logs auth`) |
| `pnpm stack types`  | regenera `apps/web/lib/supabase/database.types.ts`           |

`pnpm stack prod` é o smoke test da imagem que roda no servidor: mesmo build,
mesmas variáveis, sem hot reload. Ele disputa a porta 3000 com o `pnpm dev` — rode um de
cada vez, ou `WEB_PORT=3001 pnpm stack prod`.

### Verificações

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm format:check
```

### Banco

O schema muda **só por migration**. A Supabase CLI continua sendo a dona dele, mas agora
como ferramenta, não como stack — não existe `supabase start` neste projeto.

```bash
pnpm exec supabase migration new <nome>   # nova migration
pnpm dev                                  # aplica as pendentes
pnpm stack types                          # regenera os tipos (o typecheck quebra sem isso)
pnpm stack reset && pnpm dev              # recria o banco do zero, com seed
```

## Documentação

| Arquivo                                  | Conteúdo                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| [`docs/SPEC.md`](./docs/SPEC.md)         | Requisitos, arquitetura, modelo de dados, import de CSV e plano de fases |
| [`docs/DEPLOY.md`](./docs/DEPLOY.md)     | Hospedagem: a VM na GCP, deploy, acesso à produção, backup e restore     |
| [`deploy/README.md`](./deploy/README.md) | O que é cada container da stack, e por quê                               |
| [`CLAUDE.md`](./CLAUDE.md)               | Contexto e convenções para desenvolvimento com Claude Code               |

## Estrutura

```
apps/web        Next.js 16 (App Router), auth e UI
  app/(dashboard)  telas autenticadas: resumo, tendências, lançamentos, patrimônio,
                   tarefas e ajustes (categorias, regras, import)
  lib/db           acesso ao Postgres e conversão bigint↔centavos (server-only)
  lib/supabase     clients e tipos gerados do schema
  public           manifest, ícones e service worker da PWA
packages/shared Regras puras e testáveis: dinheiro (centavos/bigint), datas
                (YYYY-MM-DD), resumo do mês, tendências, import CSV e patrimônio
supabase        Migrations SQL e seed (a CLI é ferramenta, não stack)
deploy          A stack: docker compose (base + o override do servidor), Caddy, os
                segredos, o timer de backup e os dumps
scripts         Operação: subir a stack, gerar segredos, provisionar usuários, dump e
                restore, e dirigir a VM (lib/ é o que os três compartilham)
```

## Variáveis de ambiente

Existe **um** arquivo: `deploy/.env`, escrito na primeira subida e nunca commitado
(referência em [`deploy/.env.example`](./deploy/.env.example)). O compose lê dele, e o
`pnpm dev` passa os três valores `SUPABASE_*` para o Next que ele inicia — não há segundo
arquivo para divergir.

Todas são server-only: **não existe `NEXT_PUBLIC_*` neste projeto**. O browser não fala com
o Supabase — todo acesso é Server Component, Server Action ou Route Handler —, e todas são
lidas em **runtime**, o que é o que torna a imagem Docker portátil entre instalações.

| Variável                                                             | Quem lê                                                         |
| -------------------------------------------------------------------- | --------------------------------------------------------------- |
| `SUPABASE_URL`                                                       | o app. `127.0.0.1:8000` do host, `caddy:8000` de dentro da rede |
| `SUPABASE_ANON_KEY`                                                  | o app e o Studio                                                |
| `SUPABASE_SERVICE_ROLE_KEY`                                          | o app e os scripts de provisionamento — **nunca** vai ao client |
| `POSTGRES_PASSWORD`                                                  | `db`, `auth`, `rest`, e o `db push`                             |
| `JWT_SECRET`                                                         | `auth` e `rest`; é o que assina as duas chaves acima            |
| `OWNER_PASSWORD` / `MEMBER_PASSWORD`                                 | opcionais; sem elas os scripts geram a senha e imprimem         |
| `DEPLOY_TARGET` / `DOMAIN`                                           | só no `.env` **da VM**: os scripts e o compose. O app não lê    |
| `DEPLOY_HOST` / `_USER` / `_PATH` / `_REPO` / `_BRANCH` / `_SSH_KEY` | só no `.env` **daqui**, e só `pnpm server`                      |
| `BACKUP_DIR`                                                         | opcional; os scripts de dump e restore                          |

`OWNER_EMAIL` **não está no arquivo** — é argumento de bootstrap, não configuração:
`pnpm db:owner <email>` grava o dono no banco uma vez, e daí em diante `pnpm dev` e
`pnpm db:invite` leem de lá. Um `.env` que guardasse essa resposta estaria duplicando algo
que o Postgres já sabe.

## Auth e household

O app é de **uma casa**: duas pessoas, um conjunto de dados. Cada uma tem seu login; a linha
pertence ao household (`household_id`), e `user_id` só registra quem lançou.

Entra-se com **e-mail e senha**. Não há cadastro, não há convite pela UI e não há "esqueci
minha senha" — os usuários são criados por script, e a senha é redefinida por script. Um
fluxo de recuperação por e-mail exigiria um servidor de SMTP, que é justamente a dependência
que o login por senha removeu.

Três camadas de acesso, todas necessárias:

1. `GOTRUE_DISABLE_SIGNUP=true` no GoTrue.
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

O script põe o e-mail na allowlist **já apontando para o household existente** e cria o
usuário. É esse `household_id` que o trigger `provision_user` lê — no `insert` em
`auth.users`, ou seja, no momento em que o script cria a pessoa, não quando ela entra pela
primeira vez. Sem ele ela cairia numa casa própria e veria o app vazio. As categorias
padrão são semeadas uma única vez por household, então o segundo membro não ganha uma
segunda cópia da lista.

Qual household é o convidado descoberto no banco, não em configuração: havendo **um**, é
ele; havendo mais de um, o script para e pede `HOUSEHOLD_ID=<uuid>` em vez de adivinhar.

Os scripts são idempotentes: rodar de novo **não** troca a senha de quem já existe.

## Hospedagem

Uma **VM `e2-micro` do Always Free do Google Compute Engine** (2 vCPU compartilhados, 1 GB,
30 GB, `us-east1`, Ubuntu 24.04), rodando a mesma stack `docker compose`, com TLS do Let's
Encrypt em **https://financas.tinocot.com**. A imagem do app vem do GHCR, construída pelo CI —
a VM é host de containers, não máquina de build.

Custo: **~R$ 20/mês**, e é só o IPv4 público — a VM e o disco estão no free tier que não
expira. A comparação com a AWS que levou a essa escolha está na
[Parte 7 do `docs/HOSTING.md`](./docs/HOSTING.md#parte-7--gcp--aws-qual-das-duas-é-a-mais-barata);
o passo a passo — o que o `gcloud` já fez, o que sobra para você, deploy, backup, restore,
acesso — está em [`docs/DEPLOY.md`](./docs/DEPLOY.md).

```bash
pnpm server init --owner voce@exemplo.com   # uma vez, numa VM recém-criada
pnpm server                                  # o deploy de todo dia
pnpm server status|logs|ssh                  # operar a VM daqui
pnpm server run db:invite <email>            # um script do package.json, lá
```

`pnpm server` pega o código novo, tira um dump **se houver migration pendente**, aplica as
migrations, rebuilda só a imagem do app, sobe sem derrubar o banco e falha alto se algo não
ficar saudável. Rodá-lo duas vezes seguidas sem commit novo não faz nada.

O único arquivo que difere entre a sua máquina e o servidor é
[`deploy/docker-compose.server.yml`](./deploy/docker-compose.server.yml): 80/443 no Caddy,
`DOMAIN` obrigatório e o `web` ligado. Quem manda layerizá-lo é `DEPLOY_TARGET=server` no
`deploy/.env` **da VM** — não uma flag para você lembrar. O app continua não sabendo onde
está: `SUPABASE_URL` e as chaves são lidas em runtime, então a mesma imagem roda em qualquer
lugar.

### Backup

Um dump por noite na VM (timer do systemd, 03:20, 7 diários), mais um antes de toda
migration. Restore testado — não é figura de linguagem, está em `docs/DEPLOY.md`.

```bash
pnpm db:dump                  # dump do banco local em deploy/backups/
pnpm db:dump --remote         # dump na VM, e traz uma cópia para cá
pnpm db:restore --latest      # restaura o mais novo (--remote: na VM). Destrutivo, confirma
```

O restore **substitui** a instalação: apaga `public`, `auth` e `supabase_migrations` antes
de carregar. É o que impede o trigger `provision_user` de criar um household duplicado ao
trazer usuários por cima de um banco já provisionado. As senhas atravessam (o hash bcrypt
vai no dump); as sessões de outra instalação, não.

## Status das fases

- [x] Fase 0 — Fundação (monorepo, Supabase, auth, CI)
- [x] Fase 1 — MVP Gastos (transações, categorias, dashboard; os orçamentos saíram na Fase 12)
- [x] Fase 2 — Tendências + PWA
- [x] Fase 3 — Entrada em lote (import CSV, regras, fila "a categorizar")
- [x] Fase 4 — Patrimônio (ativos, aportes, snapshots, evolução)
- [ ] Fase 5 — Refinos
- [x] Fase 6 — Casa (household compartilhado, RLS por membership, `db:invite`)
- [x] Fase 7 — Import da posição consolidada da XP
- [x] Fase 8 — Carteira (alocação, rentabilidade por período, aporte vs. valorização)
- [x] Fase 9 — Self-hosted (login por senha, imagem portátil, `docker compose`)
- [x] Fase 10 — Um fluxo só (stack única em Docker, fim da stack paralela da CLI)
- [x] Fase 11 — Hospedagem (VM `e2-micro` do Always Free da GCP, TLS em financas.tinocot.com, backup com restore testado)
- [x] Fase 12 — Tarefas (fim do orçamento; a aba virou a checklist compartilhada da casa)
