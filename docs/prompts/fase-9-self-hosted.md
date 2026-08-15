# Prompt — Fase 9: Self-hosted (login por senha + deploy em VM)

> Cole isto como prompt inicial de uma sessão do Claude Code. Ele assume que `CLAUDE.md` e
> `docs/SPEC.md` estão em contexto e que as Fases 0–8 estão entregues.

---

Implemente a **Fase 9 — Self-hosted**: tornar o app instalável em **uma VM qualquer** com
`docker compose up`, sem depender de Vercel nem do Supabase hospedado, e trocar o login por
magic link por **e-mail + senha**, que é o que remove a dependência de SMTP e de URL de redirect.

Leia antes de escrever código: SPEC §5.1 (ADR da arquitetura), §5.4 (segurança do household
fechado), §12 (decisões já tomadas sobre auth) e o README (seções "Auth e household" e "Deploy",
que serão reescritas).

## 1. Problema que a fase resolve

O deploy hoje é Vercel + Supabase hospedado, e o login é magic link. Para rodar em uma VM própria
isso trava em quatro pontos, todos verificáveis no código atual:

1. **O magic link exige SMTP.** O stack local usa Mailpit, que captura e não envia. Sem provedor
   de e-mail configurado não existe login nenhum — e `signInWithOtp` é o único caminho de entrada
   ([`app/login/actions.ts`](../../apps/web/app/login/actions.ts)).
2. **O magic link exige URL de redirect fixa.** `site_url` e `additional_redirect_urls` estão
   presos em `localhost:3000` ([`supabase/config.toml`](../../supabase/config.toml)), e
   `getSiteUrl()` assume `https` para qualquer host que não comece com `localhost`
   ([`lib/site-url.ts:14`](../../apps/web/lib/site-url.ts#L14)) — em `http://IP:3000` o link sai
   inválido.
3. **A configuração do Supabase é assada no build.** `NEXT_PUBLIC_SUPABASE_URL` e
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` são inlinados pelo Next em build time, então a imagem Docker
   ficaria amarrada a uma instalação específica.
4. **Não existe stack de produção.** `supabase start` é ambiente de desenvolvimento, com JWT
   secret e chaves `anon`/`service_role` **fixas e públicas** — as mesmas em toda instalação do
   CLI. Exposto, qualquer pessoa forja um token `service_role` e a RLS inteira (§5.4) vira
   decoração.

## 2. Escopo — três entregas

### 2.1 Login por e-mail e senha

Substitua o magic link inteiro. Superfície pequena e já mapeada:

- [`app/login/actions.ts`](../../apps/web/app/login/actions.ts) — `signInWithOtp` vira
  `signInWithPassword`; o estado `'sent'` de `LoginState` desaparece; em sucesso, `redirect('/')`.
  Mantenha a resposta **indistinguível** entre "senha errada" e "e-mail não existe" (a lógica de
  não vazar existência de usuário já está lá, no tratamento do 422 — preserve a intenção).
- [`app/login/login-form.tsx`](../../apps/web/app/login/login-form.tsx) — campo de senha
  (`type="password"`, `autoComplete="current-password"`) e some a tela "abra o e-mail neste mesmo
  navegador". Mobile-first, no padrão visual atual.
- **Apague** [`app/auth/callback/route.ts`](../../apps/web/app/auth/callback/route.ts) e
  [`lib/site-url.ts`](../../apps/web/lib/site-url.ts). Confirmei que `getSiteUrl` não tem outro
  uso; se o seu grep discordar, pare e me diga.
- `PUBLIC_PATHS` em [`lib/supabase/proxy.ts`](../../apps/web/lib/supabase/proxy.ts) perde `/auth`.
- [`supabase/config.toml`](../../supabase/config.toml) — `site_url`, `additional_redirect_urls` e
  `[local_smtp]` deixam de ter função. Remova o que ficou morto, mantenha
  `enable_signup = false`, e defina um comprimento mínimo de senha explícito.

O que **não** muda, e é onde mora a segurança (§5.4): `enable_signup = false`, a tabela
`public.allowed_emails` com o trigger `enforce_email_allowlist` em `auth.users`, o trigger
`provision_user` lendo o `household_id` da linha da allowlist, e a RLS com
`household_id = current_household_id()`. Só o meio de provar identidade muda; o JWT continua sendo
emitido pelo GoTrue igual.

**Provisionamento.** [`scripts/create-owner.mjs`](../../scripts/create-owner.mjs) e
[`scripts/invite-member.mjs`](../../scripts/invite-member.mjs) já criam o usuário via
`POST /auth/v1/admin/users`; passe `password` no corpo. Regra: usa a senha de env
(`OWNER_PASSWORD` / `MEMBER_PASSWORD`) se houver; senão **gera uma forte** (`crypto`) e imprime
**uma vez** no terminal, deixando claro que não será mostrada de novo. Ambos continuam
idempotentes — se o usuário já existe, não sobrescreva a senha em silêncio. Acrescente
`pnpm db:password <email>` para redefinir (`PATCH /auth/v1/admin/users/:id`); é o substituto do
"esqueci minha senha", que **não** vai existir na UI.

### 2.2 Configuração em runtime, imagem portátil

Hoje a config do Supabase é `NEXT_PUBLIC_*`. Verifiquei que **nada importa**
[`lib/supabase/client.ts`](../../apps/web/lib/supabase/client.ts) — todo acesso é Server
Component, Server Action ou Route Handler. Então:

- Apague `lib/supabase/client.ts` (é código morto e o único motivo de as chaves serem públicas).
- Renomeie para `SUPABASE_URL` e `SUPABASE_ANON_KEY`, movendo-as de `publicEnv` para `serverEnv`
  em [`lib/env.ts`](../../apps/web/lib/env.ts). Como `serverEnv` já lê por getter, elas passam a
  ser resolvidas em runtime — **a mesma imagem roda em qualquer VM**, configurada só pelo `.env`.
- Atualize todos os consumidores: `lib/supabase/server.ts`, `lib/supabase/proxy.ts`, os scripts de
  `scripts/*.mjs`, `scripts/dev-up.mjs` (inclusive o guard de segurança da linha ~111),
  `.env.example` e o README.
- Consequência de segurança que vale registrar: sem client de browser, **a API do Supabase não
  precisa ser publicada**. GoTrue e PostgREST ficam só na rede interna do Docker; a única porta
  exposta na VM é a do proxy.

### 2.3 `docker compose` para a VM

Crie `deploy/` (ou `docker/`, escolha e seja consistente) com `docker-compose.yml`, `Caddyfile`,
`.env.example` do deploy e um `README.md` curto de operação. Serviços:

| Serviço  | Imagem                | Publica portas? | Papel                                     |
| -------- | --------------------- | --------------- | ----------------------------------------- |
| `caddy`  | `caddy:2-alpine`      | **80/443**      | TLS automático + proxy do app; roteia a API do Supabase só na rede interna |
| `web`    | build local           | não             | Next.js standalone                        |
| `auth`   | `supabase/gotrue`     | não             | `/auth/v1/*`                              |
| `rest`   | `postgrest/postgrest` | não             | `/rest/v1/*`                              |
| `db`     | `supabase/postgres`   | não             | Postgres + roles e schema `auth`          |
| `backup` | `postgres:17-alpine`  | não             | `pg_dump` diário em volume                |

Regras:

- **Pin de versão em toda imagem** (tag exata, nunca `latest`). Reprodutibilidade é o ponto da
  fase; e o pin de toolchain do repo (TS 6.x / ESLint 9.x) já é intencional.
- `db` usa **`supabase/postgres`**, não `postgres` puro: as migrations dependem de `auth.uid()`,
  do schema `auth` e dos roles `anon` / `authenticated` / `service_role` / `authenticator`. Se
  algum role ou GUC não vier pronto na imagem, crie em `deploy/init/*.sql` (montado em
  `/docker-entrypoint-initdb.d`), **idempotente**, com senhas vindas do `.env`. Verifique o que a
  imagem já traz em vez de assumir.
- `caddy` com dois blocos: o público (domínio → `web:3000`) e um interno em `:8000` que faz
  `handle_path /auth/v1/*` → `auth:9999` e `handle_path /rest/v1/*` → `rest:3000` (os dois
  servem na raiz, então o prefixo tem que ser **removido**). `SUPABASE_URL` do `web` aponta para
  esse endereço interno.
- Healthcheck em `db`, `auth` e `rest`; `depends_on` com `condition: service_healthy`.
- Volumes nomeados para dados do Postgres, certificados do Caddy e dumps.

**`Dockerfile` do app** (na raiz ou em `apps/web/`): multi-stage com pnpm via corepack,
`next.config.ts` ganhando `output: 'standalone'`, imagem final `node:22-alpine` non-root copiando
`.next/standalone`, `.next/static` e `public/`. Atenção ao monorepo: `@finance/shared` é
`transpilePackages` e o standalone precisa do workspace resolvido — valide que a imagem sobe de
fato, não só que buildou.

## 3. Decisões (já tomadas — implemente assim e registre em SPEC §12)

1. **Senha, não OTP de 6 dígitos.** OTP também dispensaria a redirect URL, mas continua exigindo
   SMTP para entregar o código. Só a senha corta as duas dependências. Para dois usuários fixos,
   provisionados por script, com cadastro desabilitado no servidor, é o modelo mais simples que
   ainda é honesto.
2. **Sem "esqueci minha senha" e sem troca de senha na UI.** É `pnpm db:password <email>` no
   servidor. Um fluxo de recuperação por e-mail traria o SMTP de volta pela porta dos fundos —
   que é exatamente o que a fase remove. É uma regressão de conveniência assumida, para duas
   pessoas com acesso à VM.
3. **Sem Kong.** O gateway oficial do Supabase existe para key-auth, CORS e rate limit de uma API
   pública. Aqui a API não é pública: quem fala com ela é o servidor Next na rede interna, o role
   `anon` não tem grant nenhum (as migrations revogam tudo dele) e o PostgREST valida o JWT
   sozinho. Caddy cobre o roteamento e ainda resolve o TLS. Menos um container e menos um arquivo
   de config para divergir.
4. **Stack mínimo: nada de Studio, Realtime, Storage, imgproxy, Logflare ou Supavisor.** Confirmei
   que o app não usa nenhum deles. Studio em produção seria um painel de administração do banco
   exposto na VM — o oposto do que a fase quer.
5. **As chaves são geradas na instalação, nunca as do CLI.** Crie `scripts/gen-secrets.mjs`, que
   emite JWT secret, senha do Postgres e os JWTs `anon` e `service_role` assinados com ele, no
   formato de `.env` do deploy. O `docker-compose.yml` **não sobe** sem essas variáveis (sem
   default embutido). Esta é a correção do problema nº 4 do §1.
6. **A Supabase CLI continua sendo a única dona do schema.** Migrations em produção são
   `pnpm exec supabase db push --db-url "$DATABASE_URL"` — não um init container que aplica os
   `.sql` na mão, o que criaria um segundo histórico de migrations divergindo do
   `supabase db reset` local. `db push --db-url` é operação de cliente e não precisa de Docker.
7. **Ordem de deploy importa.** O GoTrue cria `auth.users` nas migrations dele, e a nossa primeira
   migration cria um trigger **em cima dessa tabela**. Sequência: sobe `db` → sobe `auth` e espera
   ficar saudável → `supabase db push` → sobe `web`. Documente isso e reflita no `depends_on`.
8. **`pnpm dev:local` continua sendo o fluxo de desenvolvimento.** O compose é só para deploy. Não
   troque o ambiente local pelos containers de produção: o ciclo de dev com a CLI (reset, seed,
   `gen types`) é melhor e já funciona. As duas configurações precisam continuar equivalentes.
9. **Backup diário por `pg_dump`, retenção de 14 dias**, em volume nomeado. Hoje não existe backup
   nenhum; num VPS o disco é responsabilidade sua. Documente o comando de **restore** — backup que
   nunca foi restaurado não é backup.
10. **HTTPS com domínio, não IP.** Com um domínio (inclusive DuckDNS e afins) o Caddy emite
    certificado sozinho. Isso devolve o secure context, sem o qual o service worker de
    [`public/sw.js`](../../apps/web/public/sw.js) não registra e a PWA perde o offline. Deixe
    documentado o `tls internal` como saída para LAN, dizendo o que se perde. Recomende Tailscale
    para acesso externo sem abrir porta no roteador.

## 4. Variáveis de ambiente

Reescreva `.env.example` (app) e crie o do deploy, com a tabela no README. Do lado do app:
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OWNER_EMAIL` — todas
server-only, nenhuma `NEXT_PUBLIC_*` sobrando. Do lado do deploy: domínio, senha do Postgres, JWT
secret, as duas chaves derivadas e as URLs internas.

Pontos que costumam quebrar em silêncio e que você deve conferir:

- `GOTRUE_JWT_SECRET` e `PGRST_JWT_SECRET` **têm** que ser o mesmo segredo que assinou as chaves
  `anon`/`service_role`. Divergiu, o sintoma é 401 genérico.
- GoTrue sem SMTP: `GOTRUE_MAILER_AUTOCONFIRM=true` e o provider de e-mail habilitado (é o que
  permite senha), com `GOTRUE_DISABLE_SIGNUP=true` — o endpoint de signup morre, o de
  `grant_type=password` não.
- PostgREST conecta como `authenticator` com `PGRST_DB_ANON_ROLE=anon`, jamais como superuser.
- Confirme os nomes exatos das envs contra a documentação da **tag que você pinou**; elas mudam
  entre versões.

## 5. Fora de escopo (não construa)

Kubernetes, Terraform ou qualquer IaC; CI/CD de deploy automático; múltiplos ambientes;
observabilidade (Prometheus/Grafana/Sentry); Studio ou pgAdmin em produção; recuperação de senha;
2FA; OAuth social; migrar de Supabase para outra stack de auth; mexer em regra de negócio, import,
`external_id`, `positionKey` ou qualquer coisa de patrimônio.

## 6. Critérios de aceite (acrescente ao SPEC §9 no formato de lá)

- Dado um `.env` preenchido em uma VM limpa, quando rodo a sequência documentada do README, então
  o app responde em `https://<domínio>` e eu entro com e-mail e senha.
- Dado que peço a mesma imagem em outra VM com `.env` diferente, então ela funciona **sem
  rebuild** — nenhuma configuração de Supabase ficou assada no bundle.
- Dado um e-mail fora de `allowed_emails`, quando tento entrar, então a resposta é idêntica à de
  senha errada, e nada no app revela se o usuário existe.
- Dado que o `enforce_email_allowlist` está ativo, quando tento criar usuário fora da lista pela
  API admin, então o banco recusa.
- Dado `docker compose down` seguido de `up`, então os dados continuam lá (volume nomeado).
- Dado um dump gerado pelo serviço de backup, quando sigo o procedimento de restore do README em
  um banco vazio, então os lançamentos e o patrimônio voltam íntegros.
- Dado que as duas pessoas do household entram, então cada uma vê os mesmos dados e a atribuição
  por `user_id` continua correta (a RLS não mudou).
- Dado que abro pelo iPhone no domínio com HTTPS, então a PWA instala e o service worker registra.
- Dado `pnpm dev:local` em uma máquina de desenvolvimento, então tudo continua funcionando como
  antes desta fase.

## 7. Como entregar

1. Primeiro o app: login por senha, remoção do magic link, `lib/env.ts` em runtime, scripts de
   provisionamento. Valide com `pnpm dev:local` — isso tem que ficar verde antes de existir
   qualquer Dockerfile.
2. Depois `Dockerfile` + `output: 'standalone'`, e **suba a imagem de verdade** contra o Supabase
   local antes de escrever o compose.
3. Depois o `docker compose` completo, testado do zero em um diretório limpo: `gen-secrets` →
   `up db auth` → `db push` → `up` → `db:owner` → login.
4. `pnpm typecheck && pnpm lint && pnpm test && pnpm format:check` antes de concluir.
5. Atualize `docs/SPEC.md`: §5.1 (o ADR passa a ter a opção self-hosted), §5.3 (stack de deploy),
   §5.4 (o modelo de acesso agora é senha), critérios em §9, checklist em §8, linha da **Fase 9**
   na tabela do §10 e as decisões do §3 deste prompt em §12, com o porquê, no tom das entradas
   existentes. Reescreva as seções "Auth e household" e "Deploy" do README, e ajuste as armadilhas
   de `CLAUDE.md` que citarem magic link ou `NEXT_PUBLIC_SUPABASE_*`.
6. Commits em conventional commits, em inglês, um por parte coesa (auth → env/runtime → docker →
   docs).

Se alguma decisão de produto que este documento não cobre aparecer no caminho, **pergunte antes de
assumir** e registre a resposta no SPEC §12 (CLAUDE.md).
