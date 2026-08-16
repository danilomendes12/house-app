# Hospedagem — Oracle Cloud Always Free

Onde este app roda em produção, como colocá-lo lá e como operá-lo depois. A decisão está
registrada no [SPEC §11 (Q5)](./SPEC.md#11-questões-em-aberto) e no §12; aqui é o
procedimento.

**Resumo:** uma VM Ampere A1 (ARM) no tier Always Free da Oracle, Ubuntu 24.04, rodando a
mesma stack `docker compose` de `deploy/` que roda na sua máquina. Caddy termina o TLS em
`tinocot.com` com certificado do Let's Encrypt. Custo: R$ 0.

- [Parte 1 — o que você faz no console da Oracle](#parte-1--o-que-você-faz-no-console-da-oracle) (uma vez, antes de qualquer script)
- [Parte 2 — o deploy inicial](#parte-2--o-deploy-inicial) (um comando)
- [Parte 3 — acesso à produção](#parte-3--acesso-à-produção) (URL, senha, PWA, convidar a segunda pessoa)
- [Parte 4 — operação](#parte-4--operação) (deploy do dia a dia, backup, restore, migrations)

---

## Parte 1 — o que você faz no console da Oracle

Nada disto é automatizável a partir daqui: é o console da Oracle, com a sua conta. Ao final
você tem um IP público e uma chave SSH que funciona.

### 1.1 Suba a conta para Pay As You Go — faça isto primeiro

**Continua custando R$ 0** dentro dos limites Always Free; o cartão fica cadastrado e não é
cobrado enquanto você não criar recurso pago. O motivo de fazer isso é outro: contas de
avaliação gratuita ("Free Trial") têm as instâncias A1 sujeitas à **política de recuperação
por ociosidade** — a Oracle recupera VMs cujo p95 de CPU, tráfego de rede *e* memória fique
abaixo de 20% por 7 dias seguidos. Um app de duas pessoas fica exatamente nessa faixa.

Contas Pay As You Go estão fora dessa política. É a diferença entre um servidor e um
servidor que some numa semana em que vocês viajaram.

_Console → o menu do perfil (canto superior direito) → **Upgrade to Pay As You Go**._

Como efeito colateral bom, também sobe o limite de tentativas de criação da A1, que é o
próximo problema.

### 1.2 Rede: VCN + subnet pública

_Menu ☰ → Networking → **Virtual Cloud Networks** → **Start VCN Wizard** → "Create VCN with
Internet Connectivity"._

O wizard é o caminho certo aqui: ele cria de uma vez a VCN, a subnet pública, o Internet
Gateway e a rota default `0.0.0.0/0 → Internet Gateway`, que é a peça que as pessoas
esquecem quando montam à mão.

| Campo             | Valor                              |
| ----------------- | ---------------------------------- |
| VCN Name          | `financas-vcn`                     |
| Compartment       | o raiz (o da sua conta)            |
| VCN CIDR Block    | `10.0.0.0/16` (o default)          |
| Public Subnet     | `10.0.0.0/24` (o default)          |
| Use DNS hostnames | marcado                            |

Ao final, **Create**. Guarde o nome da subnet pública — é onde a instância vai.

### 1.3 Abrir 80 e 443 na Security List

_VCN → **Security Lists** → a "Default Security List for financas-vcn" → **Add Ingress
Rules**._

Duas regras, e só:

| Stateless | Source CIDR | IP Protocol | Destination Port Range | Descrição |
| --------- | ----------- | ----------- | ---------------------- | --------- |
| não       | `0.0.0.0/0` | TCP         | `80`                   | ACME (Let's Encrypt) + redirect para HTTPS |
| não       | `0.0.0.0/0` | TCP         | `443`                  | o app                                       |

A porta 80 **não** é opcional mesmo com o app só em HTTPS: é por ela que o Let's Encrypt
faz o desafio HTTP-01. Fechá-la significa nunca emitir o certificado.

**A regra 22 que já existe:** o wizard abre SSH para `0.0.0.0/0`. Se o seu IP residencial é
estável, restrinja — edite a regra existente e troque o source por `<seu.ip.aqui>/32`
(descubra com `curl -s ifconfig.me`). Se ele muda, deixe aberto: você depende do SSH para
tudo aqui, e se trancar sozinho do lado de fora a saída é o console serial da Oracle.

**Nada mais entra nesta lista.** Não abra 5432, 8000, 54323 nem 3000. O Postgres, a API do
Supabase e o Studio ficam em `127.0.0.1` dentro da VM; o que é público é o Caddy, e o que
o Caddy publica é o app.

### 1.4 Criar a instância A1

_Menu ☰ → Compute → **Instances** → **Create Instance**._

| Campo             | Valor                                                     |
| ----------------- | --------------------------------------------------------- |
| Name              | `financas`                                                |
| Image             | **Canonical Ubuntu 24.04** — troque via "Change image"     |
| Shape             | **VM.Standard.A1.Flex** — "Change shape" → Ampere          |
| OCPUs / Memória   | **2 OCPU / 12 GB**                                        |
| Rede              | a VCN e a subnet **pública** do passo 1.2                 |
| Public IPv4       | **Assign a public IPv4 address** — marcado                 |
| Boot volume       | 50 GB (o default de 47 serve; acima de 100 GB sai do free) |

A imagem tem que ser a **Ubuntu**, não a Oracle Linux: no Ubuntu o `docker compose` v2 vem
do repositório oficial (`docker-compose-v2`), e é um passo a menos. O shape é ARM
(`aarch64`); as cinco imagens fixadas no `docker-compose.yml` têm build `arm64`, então nada
muda na stack.

**A chave SSH** fica em "Add SSH keys" → "Paste public keys". Cole a sua pública:

```bash
cat ~/.ssh/id_ed25519.pub    # ou gere: ssh-keygen -t ed25519 -C financas
```

Se preferir uma chave separada para esta VM, gere-a e depois aponte `DEPLOY_SSH_KEY` no
`deploy/.env` para a privada correspondente.

O usuário da imagem Ubuntu é **`ubuntu`** — é o default de `DEPLOY_USER`.

#### Quando falhar com "Out of host capacity"

É o modo de falha mais comum do A1 e não é erro seu: a região está sem Ampere livre no
momento. O que funciona, em ordem:

1. **Tente outro Availability Domain** (AD-1, AD-2, AD-3) na mesma região, se a sua tiver
   mais de um. É o clique mais barato.
2. **Peça menos**: 1 OCPU / 6 GB costuma entrar quando 2/12 não entra. Você pode aumentar
   depois (Instance → Edit → Edit shape, com a VM desligada) sem recriar nada. 12 GB é
   folga, não requisito: o build do Next roda em 6 GB.
3. **Insista com intervalo.** A capacidade é liberada aos poucos. Repetir a criação a cada
   ~15 minutos costuma resolver em algumas horas.
4. **Considere outra região** se você acabou de criar a conta e ainda não tem nada nela —
   a região *home* é definitiva, então isso só vale antes de existir qualquer recurso.

Estar em Pay As You Go (1.1) ajuda aqui também: contas de trial disputam um pool menor.

### 1.5 IP público estático

O IP que a instância recebe é **efêmero** por padrão: ele muda se a VM for parada e
reiniciada, e aí o DNS aponta para o vazio. Reserve:

_Instance → Resources → **Attached VNICs** → clique na VNIC → **IPv4 Addresses** → o menu ⋮
do IP → **Edit** → Public IP: "Reserved public IP" → "Reserve new public IP"._

Nome: `financas-ip`. Ele continua gratuito enquanto estiver atribuído a uma instância que
está de pé.

Anote o IP: é o `DEPLOY_HOST`.

### 1.6 Apontar o DNS

O domínio é **tinocot.com**, com DNS na Cloudflare. Dois registros:

| Type | Name | Content            | Proxy status         |
| ---- | ---- | ------------------ | -------------------- |
| A    | `@`  | o IP reservado     | **DNS only** (cinza) |
| A    | `www`| o IP reservado     | **DNS only** (cinza) |

> **A nuvem tem que estar cinza.** Com o proxy da Cloudflare ligado (laranja), o desafio do
> Let's Encrypt na porta 80 é interceptado pela Cloudflare e o Caddy nunca consegue emitir o
> certificado — e no modo "Flexible" você ainda ganha um loop de redirecionamento. Aqui quem
> termina o TLS é o Caddy, na VM, e para isso o tráfego tem que chegar direto.

Confira antes de seguir (a propagação leva de segundos a alguns minutos):

```bash
dig +short tinocot.com     # tem que devolver o IP da VM, e nenhum outro
```

Se você preferir um subdomínio (`financas.tinocot.com`), é a mesma coisa: crie o A com esse
nome e use-o como `DOMAIN`. O `www` só faz sentido no apex.

### 1.7 Confirme o SSH

```bash
ssh ubuntu@<IP>    # ou: ssh -i ~/.ssh/sua_chave ubuntu@<IP>
```

Entrou? A Parte 1 acabou. Saia (`exit`) — daqui em diante é script.

> Note que a VM **não** tem 80/443 realmente abertas ainda, mesmo com a Security List certa:
> a imagem Ubuntu da Oracle vem com regras de `iptables` que descartam tudo além do 22, e
> elas ficam *depois* da Security List no caminho do pacote. O sintoma é uma conexão que
> pendura em vez de ser recusada — que se parece muito com problema de DNS. O
> `pnpm server init` abre as duas portas e persiste a regra com `netfilter-persistent`, para
> que sobreviva ao reboot. É só para saber o que ele está fazendo e por quê.

---

## Parte 2 — o deploy inicial

Na **sua máquina**, no repositório. Primeiro diga a ele onde fica o servidor —
essas variáveis são lidas só pelos scripts, só aqui, e o `docker compose` as ignora:

```bash
# acrescente ao seu deploy/.env (referência completa em deploy/.env.example)
DEPLOY_HOST=<o IP reservado>
DEPLOY_REPO=git@github.com:voce/my-financial-app.git
DOMAIN=tinocot.com
# DEPLOY_SSH_KEY=~/.ssh/sua_chave     # só se não for a chave padrão
```

O `DEPLOY_REPO` precisa ser alcançável **de dentro da VM**. Com um repositório privado no
GitHub, o caminho mais simples é um [deploy key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh):
gere um par na VM (`ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519`), cole a pública em
Settings → Deploy keys do repositório, e use a URL `git@…`. Com repositório público, a URL
`https://…` funciona sem nada.

Então:

```bash
pnpm server init --owner voce@exemplo.com
```

Ele faz, em ordem, e para no primeiro erro:

1. instala Docker + compose v2, Node 22 e ajusta o fuso para `America/Sao_Paulo`;
2. abre 80 e 443 no `iptables` da VM e persiste;
3. clona o repositório em `/opt/financas` e instala as dependências;
4. **gera os segredos de produção na VM** com `scripts/gen-secrets.mjs --server`. Eles são
   novos e ficam lá: o `deploy/.env` da sua máquina nunca sobe. Os segredos de produção não
   podem ser os que estão num laptop;
5. instala o timer de backup diário;
6. sobe a stack na ordem obrigatória — `db` → `auth` saudável → migrations → `rest`, `caddy`
   e `web` — e provisiona o dono;
7. confere que todo container está saudável e que `https://tinocot.com/login` responde.

**A senha do dono é impressa uma única vez, no passo 6.** Anote na hora. Se perder,
`pnpm server run db:password voce@exemplo.com` gera outra.

O primeiro certificado leva alguns segundos; se o passo 7 falhar, ele lista o que costuma
estar errado, na ordem. `pnpm server logs caddy` mostra o que o ACME respondeu.

### Levar os dados que já existem na sua máquina

O `init` deixa uma produção vazia, com o dono provisionado. Se você já usa o app localmente
— e usa —, os dados reais vão junto assim:

```bash
pnpm db:dump                                   # salva o banco local em deploy/backups/
pnpm db:restore --remote deploy/backups/manual-<data>.dump
```

O restore **substitui** a produção inteira, inclusive as contas: depois dele você entra com
o mesmo e-mail e a **mesma senha que usa localmente**, não a que o `init` imprimiu. O
household criado pelo `db:owner` na VM é descartado junto — é por isso que não sobra
household duplicado. Detalhes de por que isso funciona estão em
[Backup e restore](#backup-e-restore).

---

## Parte 3 — acesso à produção

### Qual URL eu abro

**https://tinocot.com** — a mesma no desktop e no iPhone. Não existe outra: `127.0.0.1:3000`
é a sua máquina, e a API do Supabase não tem endereço público em lugar nenhum.

### Instalar a PWA no iPhone

1. Abra `https://tinocot.com` no **Safari** (não no Chrome — só o Safari instala PWA no iOS).
2. Faça login.
3. Botão de compartilhar (o quadrado com a seta) → **Adicionar à Tela de Início**.
4. Confirme o nome ("Finanças") → **Adicionar**.

O ícone entra na tela inicial e abre em tela cheia, sem barra do Safari. É isto que o HTTPS
compra: sem _secure context_ o `public/sw.js` não registra e o "Adicionar à Tela de Início"
vira só um atalho de navegador.

Atalho útil: segure o ícone → **Nova despesa** cai direto no formulário.

### De onde vêm meu e-mail e minha senha

O e-mail é o que você passou em `--owner`. A senha foi **gerada e impressa uma única vez**
pelo `pnpm db:owner`, que o `init` chamou por dentro.

Agora que a stack é remota, esse comando roda **na VM, dentro de `/opt/financas`**. Você não
precisa entrar lá para isso:

```bash
pnpm server run db:owner voce@exemplo.com      # idempotente: não troca a senha de quem já existe
```

O `SUPABASE_URL` certo chega até ele porque `pnpm server run` o passa **explicitamente**,
derivado de `SUPABASE_API_PORT`. Isso não é zelo: o `deploy/.env` também tem um
`SUPABASE_URL`, que é só o default para execução manual, e se ele vencer o script manda a
chave de service role certa para a stack errada. O sintoma é um `401` seco, sem nada no log
que explique.

Se você entrar na VM à mão (`pnpm server ssh`), o `deploy/.env` de lá está certo e
`pnpm db:owner` funciona direto — a ressalva vale só se você tiver mudado
`SUPABASE_API_PORT`.

### Como adicionar minha esposa

```bash
pnpm server run db:invite esposa@exemplo.com
```

Imprime a senha dela uma única vez. Funciona na hora, sem ela precisar entrar antes: o
household existe desde o `db:owner`, porque o trigger `provision_user` dispara no **insert**
em `auth.users` e não no primeiro login. O script põe o e-mail na allowlist já apontando
para o household existente — é isso que faz os dois verem os mesmos dados em vez de cada um
cair numa casa própria.

### Como redefinir senha

```bash
pnpm server run db:password esposa@exemplo.com
```

**Trocar senha e recuperar senha não existem na UI, por decisão** (SPEC §12). Não há tela de
"esqueci minha senha" e não deve haver: um fluxo de recuperação por e-mail traria o SMTP de
volta, que é exatamente a dependência que a Fase 9 removeu. Para duas pessoas com acesso ao
servidor, o reset é este comando.

---

## Parte 4 — operação

### O deploy de todo dia

```bash
pnpm server
```

Pega o código novo, instala dependências, **tira um dump se houver migration pendente**,
aplica as migrations, rebuilda só a imagem do app, sobe sem derrubar o banco, espera todos
os healthchecks e confere o HTTPS de fora. Falha alto em qualquer um desses passos.

É idempotente: rodar duas vezes sem commit novo não faz nada — nem sequer um dump a mais,
porque o dump é condicionado a haver migration pendente, não à execução do deploy.

```bash
pnpm server status        # commit, saúde dos containers, backups, próximo timer
pnpm server logs [svc]    # db, auth, rest, caddy, web
pnpm server ssh           # um shell, já no /opt/financas
pnpm server run <script>  # qualquer script do package.json, lá
```

### Migrations remotas

A rotina normal **não precisa de nada especial**: você commita a migration, roda
`pnpm server`, e o `supabase db push` acontece na VM, contra `127.0.0.1:5432` — a porta do
Postgres é publicada em loopback lá, exatamente como aqui, e não sai da máquina.

Depois de criar migration nova, o de sempre: `pnpm dev` aplica localmente e
`pnpm stack types` regenera os tipos (o typecheck quebra sem isso). O `pnpm server` leva as
duas coisas para produção.

Quando você precisar apontar a CLI da sua máquina para o banco de produção — inspecionar,
rodar um `db push` de fora, gerar tipos a partir de lá —, o caminho é um **túnel SSH**, e
não abrir a 5432:

```bash
ssh -N -L 55432:127.0.0.1:5432 ubuntu@<IP>     # deixe rodando num terminal

# no outro, com a senha do deploy/.env da VM (pnpm server ssh; cat deploy/.env)
pnpm exec supabase db push --db-url \
  "postgresql://postgres:<POSTGRES_PASSWORD>@127.0.0.1:55432/postgres?sslmode=disable"
```

`sslmode=disable` é honesto aqui: o Postgres do compose não fala TLS, e quem cifra é o SSH.

### Backup e restore

Um dump por noite, às 03:20 (horário de São Paulo), por um timer do systemd. Retenção: **7
diários**. Além deles, o mesmo diretório guarda os dumps `pre-deploy` (antes de cada
migration, 7) e `pre-restore` (antes de cada restore, 3) — a poda é por rótulo, então uma
tarde movimentada de deploys não come o histórico das noites.

```bash
pnpm server status                    # quando foi o último, quando é o próximo
pnpm server run db:dump               # um dump avulso, agora
pnpm db:dump --remote                 # dump na VM e traz uma cópia para cá
```

Trazer uma cópia para o seu Mac de vez em quando é o que transforma isto em backup de
verdade: os dumps da VM moram no mesmo disco do banco.

Restaurar:

```bash
pnpm db:restore --remote --latest              # o dump mais novo da VM, restaurado lá
pnpm db:restore --remote <arquivo local>       # sobe este dump e restaura
pnpm db:restore --latest                       # o mais novo daqui, no banco local
```

Ele pede confirmação (`--yes` pula), tira um dump de segurança do que está prestes a
destruir, e conta as linhas em voz alta no final.

#### O que o restore faz, e por que assim

O dump carrega três schemas: `public` (os dados), `auth` (as contas do GoTrue) e
`supabase_migrations` (o histórico da CLI). Não carrega os roles nem as extensões — esses
vêm da imagem `supabase/postgres` e do próprio GoTrue, e por isso o restore exige uma stack
que já subiu ao menos uma vez, nunca um Postgres pelado.

O restore **substitui** a instalação: derruba `auth`, `rest` e `web`, apaga os três schemas e
carrega o dump numa transação só. É a decisão que resolve a armadilha do `provision_user` —
o trigger dispara no `insert` em `auth.users` e cria household, então trazer usuários por
cima de um banco já provisionado por `db:owner` deixaria dois. Apagando antes não há nada
para inserir por cima; e, de quebra, um `pg_restore` completo carrega os dados **antes** de
recriar os triggers, então nada está ligado no momento em que as linhas entram.

Três consequências que valem saber:

- **As sessões ativas morrem** quando o dump vem de outra instalação: o `JWT_SECRET` de lá é
  outro. É esperado — é só entrar de novo.
- **As senhas atravessam.** O hash bcrypt em `auth.users.encrypted_password` não é assinado
  por nada; ele vem no dump e continua valendo.
- **`external_id` e `external_ref` vêm junto**, porque o dump é completo. São eles que fazem
  o import de CSV e o da posição da XP serem idempotentes (SPEC §7); um restore que os
  perdesse duplicaria tudo no import seguinte, em silêncio.

#### O teste de restore

Foi executado de verdade, contra a stack local, a partir de um dump tirado pelo mesmo
comando que o timer roda (`--label daily --keep 7`): 175 KB, 402 objetos. Depois de
`pnpm db:restore`, voltaram 2 usuários, **1 household** (não dois — o trigger não disparou),
64 transações, 12 ativos, os 2 triggers em `auth.users`, 10 policies de RLS, RLS ligada nas
11 tabelas, as 7 migrations no histórico (o `db push` seguinte respondeu "Remote database is
up to date"), os 64 `external_id` e os 12 `external_ref`. O GoTrue e o PostgREST voltaram
saudáveis e o app serviu `/login` com os dados de volta.

### Atualizar o sistema da VM

```bash
pnpm server ssh
sudo apt update && sudo apt upgrade -y
sudo reboot     # quando pedir; a stack volta sozinha (restart: unless-stopped)
```

Vale de vez em quando. O `Persistent=true` do timer garante que o backup da noite em que a
VM estava desligada acontece no boot seguinte, em vez de ser pulado.

---

## O que **não** existe aqui, e é de propósito

- **Studio em produção.** Ele está atrás de um profile e não sobe na VM. Um painel de
  administração do banco exposto é o oposto do que esta stack quer. Para olhar dados lá,
  túnel SSH até a 5432 e `psql`.
- **Qualquer porta pública além de 80 e 443.** Postgres, a API do Supabase e o app ficam em
  `127.0.0.1` dentro da VM.
- **CI que faz deploy.** `pnpm server` é manual, e para duas pessoas isso é uma feature: o
  deploy acontece quando você está olhando.
- **Segundo ambiente (staging).** Não há.
