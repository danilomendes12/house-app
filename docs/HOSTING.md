# Onde hospedar — estudo e recomendação

A Fase 11 escolheu uma VM Always Free da Oracle Cloud ([SPEC §11 Q5](./SPEC.md#11-questões-em-aberto))
e ela **nunca subiu**: `Out of host capacity` em todas as tentativas de criar o shape Ampere
A1, por dias. Este documento refaz a escolha, desta vez com a disponibilidade real como
critério de corte e não como nota de rodapé.

Ele **não** substitui o [`docs/DEPLOY.md`](./DEPLOY.md), que é o procedimento.

> **Status em 2026-08-19: vale a [Parte 7](#parte-7--gcp--aws-qual-das-duas-é-a-mais-barata).**
> As Partes 1 a 6 continuam valendo como medição e como histórico — foi assim que se chegou à
> netcup, que rodou de 16 a 19/08 —, mas a produção hoje é a **VM `e2-micro` do Always Free da
> GCP** em `us-east1`. Leia a Parte 1 pelos números, a Parte 7 pela decisão.

**Data das consultas de preço das Partes 1 a 6: 2026-08-16.** Câmbio do dia
([open.er-api.com](https://open.er-api.com/v6/latest/USD), atualizado 2026-08-16 00:02 UTC):
**USD/BRL 5,1853** e **EUR/BRL 5,9963** (derivado de EUR/USD 0,864749). Sobre toda cobrança
em moeda estrangeira no cartão somei **3,5% de IOF**.

- [Parte 1 — os requisitos apurados](#parte-1--os-requisitos-apurados) (medidos, não estimados)
- [Parte 2 — a alavanca: build na VM ou fora dela](#parte-2--a-alavanca-build-na-vm-ou-fora-dela)
- [Parte 3 — a tabela comparativa](#parte-3--a-tabela-comparativa)
- [Parte 4 — a recomendação](#parte-4--a-recomendação)
- [Parte 5 — o que me faria mudar de ideia](#parte-5--o-que-me-faria-mudar-de-ideia)
- [Parte 6 — o que muda no repositório](#parte-6--o-que-muda-no-repositório)
- [Parte 7 — GCP × AWS: qual das duas é a mais barata](#parte-7--gcp--aws-qual-das-duas-é-a-mais-barata) (adendo de 2026-08-19, depois da netcup já estar de pé)

---

## Parte 1 — os requisitos apurados

Tudo nesta parte foi **medido nesta máquina**, contra este commit. Onde extrapolei, está dito.

### 1.1 RAM — o número que decide metade da comparação

O `docs/DEPLOY.md` registra "o build do Next roda em 6 GB". Isso é verdade e é inútil: 6 GB
era o que a VM tinha, não o que o build precisa. O piso real eu achei por bisseção,
reproduzindo o estágio `builder` do [`Dockerfile`](../Dockerfile) (`pnpm install` +
`pnpm --filter @finance/web build`) dentro de um container com `--memory` fixo e `--cpus=1`:

| Limite de memória | Resultado | Pico de RSS observado |
| ----------------- | --------- | --------------------- |
| 6 GB              | ✅ passou (62 s) | 1294 MiB |
| 2 GB              | ✅ passou (36 s) | 886 MiB |
| 1536 MiB          | ✅ passou (35 s) | 951 MiB |
| 1280 MiB          | ✅ passou (35 s) | 975 MiB |
| **1152 MiB**      | **✅ passou (34 s)** | **1005 MiB** |
| **1024 MiB**      | **❌ OOM-kill (137)** | 1015 MiB |
| 768 MiB           | ❌ OOM-kill (137) | 759 MiB |

**O piso do build sozinho está entre 1024 e 1152 MiB.** Duas observações que importam mais
que o número:

1. **O que morre é o `tsc`, não o compilador.** Em 1 GB o log mostra
   `✓ Compiled successfully in 6.0s` e só então `Running TypeScript… Killed`. O Turbopack
   cabe folgado; a checagem de tipos é o pico.
2. **O pico de RSS cresce quando o teto cresce.** 886 MiB sob teto de 2 GB, 1294 MiB sob teto
   de 6 GB. Isso é o V8 dimensionando o heap pelo cgroup — o processo não *precisa* de 1,3 GB,
   ele *usa* o que existe. É por isso que "rodou em 6 GB" nunca disse nada sobre o piso.

**Swap resgata, mas só até certo ponto** — e o motivo é o mesmo V8:

| Memória + swap | Resultado |
| -------------- | --------- |
| 1 GB RAM + 2 GB swap | ✅ passou (35 s), pico 815 MiB |
| 512 MB RAM + 1,5 GB swap | ❌ falhou — e **não** por OOM do kernel |

Em 512 MB o erro é `FATAL ERROR: Ineffective mark-compacts near heap limit — JavaScript heap
out of memory`, com o heap velho estabilizado em ~251 MB. O V8 dimensionou o próprio heap a
partir da memória *física* visível e se recusou a crescer para dentro do swap. Ou seja: swap
compra uma faixa (1 GB vira viável), não compra o andar de baixo.

**O piso da VM, então**, somando o que roda ao mesmo tempo durante um `pnpm server`:

| Componente | Medido |
| ---------- | ------ |
| Build (`pnpm install` + `next build`) | ~1150 MiB |
| Containers de produção, ociosos (ver 1.2) | 305 MiB |
| Ubuntu 24.04 + dockerd, ocioso | ~200–300 MiB (estimativa) |
| **Total** | **~1,7 GB** |

→ **2 GB é o piso honesto para construir na VM.** 1 GB só com swapfile, e sem margem.
4 GB é conforto, não requisito.

### 1.2 O runtime, medido

Os cinco containers que a produção sobe (`db`, `auth`, `rest`, `caddy`, `web` — `studio` e
`meta` ficam atrás de profile e o [`scripts/stack.mjs`](../scripts/stack.mjs) não os liga no
servidor), com a stack de pé e o app respondendo:

| Container | Imagem | Memória |
| --------- | ------ | ------- |
| `rest` | `postgrest/postgrest:v14.15` | 151,6 MiB |
| `db` | `supabase/postgres:17.6.1.156` | 71,8 MiB |
| `web` | `financas-web:local` (Next standalone) | 39,2 MiB (aquecido com 8 requisições) |
| `auth` | `supabase/gotrue:v2.194.0` | 24,2 MiB |
| `caddy` | `caddy:2.10.2-alpine` | 18,5 MiB |
| **Total** | | **305 MiB** |

Se o build sair da VM, **este é o requisito inteiro**: 305 MiB + sistema. Uma VM de 1 GB
sobra.

### 1.3 Disco

| Item | Medido |
| ---- | ------ |
| As 5 imagens de produção (arm64) | 2,87 GB (`postgres` 1,76 GB, `postgrest` 661 MB, `web` 285 MB, `gotrue` 86,5 MB, `caddy` 80,1 MB) |
| Cache do BuildKit após **um** build a partir do zero | **3,24 GB** |
| Crescimento do cache por deploy (1 arquivo alterado, deps intactas) | **+145 MB** |
| Volume `db-data` hoje | 61,7 MB (banco `postgres`: 11 MB) |
| Ubuntu 24.04 server + Docker + Node 22 | ~2,5 GB (estimativa) |

**Projeção de 3 anos de lançamentos.** Hoje são 64 transações ocupando 88 kB com índices
(~1,4 kB/linha, e isso superestima: tabelas pequenas pagam o mínimo de 8 kB por página).
Duas pessoas, sendo generoso com 150 transações/mês (fatura importada + manuais), dão
5.400 linhas em 36 meses ≈ **8 MB**. Somando snapshots de ativos (12 ativos × 36 meses = 432
linhas) e o `todos`, o volume do banco não passa de **~200 MB em 3 anos**, e o dump continua
na casa das centenas de kB (o teste de restore registrado no `DEPLOY.md` usou um dump de
175 kB). A retenção de 17 dumps (7 diários + 7 pre-deploy + 3 pre-restore) é ruído.

**O que enche o disco não são os dados — é o cache de build.** Somando: 2,5 (SO) + 2,9
(imagens) + 3,2 (cache do primeiro build) + 0,2 (banco+backups) ≈ **9 GB**, crescendo
145 MB por deploy sem nada podando. Cem deploys são +14,5 GB.

→ **25 GB dá, com um `docker builder prune` no deploy. 40 GB é confortável. Com o build fora
da VM, ~6 GB e nada cresce.**

### 1.4 Rede (egress)

Medido contra a imagem de produção servindo `/login`, com `Accept-Encoding: gzip, br` como o
Caddy serve:

- **HTML:** 2.888 bytes comprimidos.
- **Sub-recursos (JS/CSS):** 194.049 bytes comprimidos em 11 arquivos.
- **Primeiro acesso frio: ~197 kB.** `.next/static` inteiro tem 1,6 MB não comprimido, e
  `public/` 36 kB.

Navegações seguintes não repetem isso: os assets têm hash e cache imutável, e o que trafega é
o payload RSC — poucos kB. Contando muito por cima: 2 pessoas × 10 aberturas/dia × 30 dias ×
~15 kB ≈ 9 MB/mês, mais um carregamento frio por pessoa por deploy (~8 deploys/mês × 2 ×
197 kB ≈ 3 MB). **Multiplicando por 5 para cobrir tudo que não pensei: menos de 100 MB/mês.**

→ **A franquia mais magra da tabela (500 GB) é 5.000× o necessário.** Egress não separa
candidato nenhum. O que ele ainda faz é separar *modelos de cobrança*: quem fatura por GB
transferido não custa mais caro, mas transforma um laço infinito num incidente de fatura. Por
isso, e só por isso, esses provedores levam ressalva.

### 1.5 CPU

Irrelevante em runtime — os cinco containers ficam a 0% ociosos. Relevante no build. Medido
com teto de 2 GB, variando `--cpus`:

| vCPU | Tempo do build |
| ---- | -------------- |
| 2 | 25 s |
| 1 | 33 s |
| 0,5 | 86 s |

De 1 para 2 núcleos ganha-se 25%: o build é **dominado por trabalho de uma thread só**
(Turbopack + `tsc`). Pagar por mais vCPU não compra deploy mais rápido.

⚠️ **Extrapolação, não medição:** isso rodou num núcleo Apple Silicon. Um vCore compartilhado
de VPS barato costuma render 2 a 2,5× menos em single-thread, o que põe o `next build` em
**60–90 s** e o `pnpm server` inteiro (git, `pnpm install`, build, restart, healthchecks) em
**2 a 4 minutos**. O primeiro deploy é maior: o store do pnpm e as imagens Docker vêm da rede.

### 1.6 Arquitetura (ARM × x86) — confirmado, não presumido

Inspecionei o manifesto de **cada tag fixada** no [`deploy/docker-compose.yml`](../deploy/docker-compose.yml):

| Imagem | Plataformas publicadas |
| ------ | ---------------------- |
| `supabase/postgres:17.6.1.156` | linux/amd64, **linux/arm64** |
| `supabase/gotrue:v2.194.0` | linux/amd64, **linux/arm64** |
| `postgrest/postgrest:v14.15` | linux/amd64, **linux/arm64** |
| `caddy:2.10.2-alpine` | amd64, arm, **arm64**, ppc64le, riscv64, s390x |
| `node:22.22.1-alpine` (base do `Dockerfile`) | amd64, arm, **arm64**, s390x |
| `supabase/studio:2026.07.27-sha-cbb076d` | linux/amd64, **linux/arm64** |
| `supabase/postgres-meta:v0.96.6` | linux/amd64, **linux/arm64** |

E a prova de vida: a stack está rodando **agora, em aarch64** nesta máquina — `db`, `auth`,
`rest` e `caddy` respondem `aarch64` a `uname -m`. Há relatos antigos de que
`supabase/postgres` não tinha arm64; **não valem para esta tag**.

→ **ARM × x86 é indiferente.** Não elimina nem desempata nada, e não há `platform:` fixado em
lugar nenhum para atrapalhar.

---

## Parte 2 — a alavanca: build na VM ou fora dela

Hoje o [`scripts/server.mjs`](../scripts/server.mjs) (`bringStackUp`) roda `pnpm install` e
`docker compose build` **na própria VM**. A alternativa é construir a imagem fora (GitHub
Actions → GHCR, ou build local → push) e a VM só fazer `pull`. Os dois são viáveis; a escolha
muda o piso de RAM e, por consequência, a faixa de preço.

|  | **Build na VM** (hoje) | **Build fora (GHCR)** |
| --- | --- | --- |
| RAM mínima | **2 GB** (ou 1 GB + swap) | **1 GB** |
| Disco | ~9 GB, +145 MB/deploy | ~6 GB, estável |
| Plano viável mais barato | netcup Lite 1 G12s — **R$ 25,45/mês** | netcup nano G11s — **R$ 16,06/mês** |
| Economia | — | **~R$ 9/mês (R$ 113/ano)** |
| `pnpm server` é autossuficiente? | **Sim** — um comando, do laptop ao HTTPS | **Não** — depende do CI ter terminado |
| Peças novas | nenhuma | workflow do Actions, registry, credencial na VM, runner arm64 (pago em repo privado) |
| Onde o deploy pode falhar | na VM | na VM **ou** no CI |
| Tempo do deploy | 2–4 min | ~40 s na VM, 2–5 min no CI antes |

**Recomendo manter o build na VM.** O argumento não é técnico, é de proporção: mover o build
economiza **R$ 113 por ano** e cobra, em troca, uma peça de infraestrutura permanente e a
propriedade que o repositório escolheu proteger explicitamente — o `CLAUDE.md` diz que
`scripts/stack.mjs` é *"o mesmo script nos dois lugares"* e que a sequência de subida tem
*"uma implementação só"*. Um pipeline de CI entre o commit e a produção quebra exatamente
isso: `pnpm server` deixaria de ser a coisa que faz o deploy e viraria a coisa que *espera*
o deploy. Para uma casa de duas pessoas, R$ 113/ano é barato pela propriedade de que existe
um comando e ele basta.

A economia só valeria a pena se o orçamento fosse o vínculo — e não é: **o plano de 4 GB cabe
no teto de R$ 30 com o build na VM.** Se um dia o teto cair para R$ 15, a alavanca existe e é
esta.

---

## Parte 3 — a tabela comparativa

Todos os preços vêm da **página do próprio provedor**, consultada em **2026-08-16**. Onde não
consegui fonte primária, está marcado — e um número marcado assim não deve virar compra sem
alguém abrir o checkout.

R$/mês = preço × câmbio × 1,035 (IOF). Preços europeus estão **líquidos de VAT**: a
[documentação de VAT da Hetzner](https://docs.hetzner.com/general/billing-and-account-management/billing-at-hetzner/value-added-tax/)
confirma que clientes fora da UE são faturados sem VAT alemão, e a netcup exibe €4,10
"incl. 0% VAT" para país sem VAT — o preço de vitrine alemão (€4,88) traz 19% embutidos.

| # | Provedor / plano | vCPU / RAM / disco | Região | Vitrine | **R$/mês c/ tudo** | 36 meses | Compromisso | Latência medida → SP |
| - | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **netcup VPS Lite 1 G12s** | 2 vCore x86 / **4 GB** / 80 GB SSD | Nuremberg, Viena ou Amsterdam | €4,88 c/ VAT → **€4,10** líq. | **R$ 25,45** | R$ 916 | **6 meses**, setup €0 | **259 ms** |
| 2 | **netcup VPS nano G11s** | 2 vCore / **2 GB** / 60 GB SSD | Nuremberg (só) | €3,08 c/ VAT → €2,59 líq. | **R$ 16,06** | R$ 578 | 6–12 meses, setup €0 | **259 ms** |
| 3 | **netcup VPS piko G11s** | 1 vCore / **1 GB** / 30 GB SSD | Nuremberg (só) | €1,84 c/ VAT → €1,55 líq. | **R$ 9,60** | R$ 345 | 6–12 meses, setup €0 | **259 ms** |
| 4 | **Vultr `vc2-1c-1gb`** | 1 vCPU / **1 GB** / 25 GB / 1 TB | **São Paulo** | US$ 5,00 | **R$ 26,83** | R$ 966 | **nenhum** (hora) | **16 ms** |
| 5 | **netcup VPS 500 G12** | 2 vCore / 4 GB DDR5 / 128 GB NVMe | NUE/VIE/AMS/**Manassas-US**/SIN | €5,91 c/ VAT → €4,97 líq. | **R$ 30,82** | R$ 1.110 | **12 meses**, setup €0 | 259 ms (EU) |
| 6 | **Hetzner CAX11** | 2 vCPU Ampere ARM / 4 GB / 40 GB / 20 TB | Falkenstein, Nuremberg, Helsinki | €5,99 + €0,50 IPv4 | **R$ 40,28** | R$ 1.450 | **nenhum** (hora) | **260 ms** |
| 7 | **AWS Lightsail 1 GB** | 2 vCPU burst / 1 GB / 40 GB / 1 TB† | **São Paulo** | US$ 7,00 | **R$ 37,57** | R$ 1.352 | nenhum | ~16 ms (não medido) |
| 8 | **DigitalOcean Basic 1 GB** | 1 vCPU / 1 GB / 25 GB / 1 TB | sem região na América do Sul | US$ 6,00 | **R$ 32,20** | R$ 1.159 | nenhum | 155 ms (NYC) |
| 9 | **Hostinger KVM 1** | 1 vCPU / 4 GB / 50 GB | **São Paulo** | US$ 6,49 (24 m) → **US$ 11,99** renov. | **R$ 44,67** (média 36 m) | R$ 1.608 | **24 meses à vista** | ~16 ms (não medido) |
| 10 | **OVHcloud VPS-1** ⚠️ | 2 vCore / 4 GB / 40 GB | Canadá / EUA / UE | "a partir de" US$ 4,54 | **R$ 24,37** ⚠️ | R$ 877 ⚠️ | 12 meses adiantados | 157 ms (BHS) |
| 11 | **Contabo Cloud VPS 4** ⚠️ | 4 vCore / 8 GB / 100 GB SSD | 11 locais | €5,50 (24 m) / €4,40 (12 m) — fontes divergem | **R$ 28,68** ⚠️ | R$ 1.033 ⚠️ | 24 meses p/ o preço de vitrine | não medida |
| 12 | **RackNerd** ⚠️⚠️ | ~2 vCPU / 2 GB / 35 GB | EUA | ~US$ 17–18/**ano** (não confirmado) | ~R$ 8 ⚠️⚠️ | ~R$ 280 ⚠️⚠️ | 12 meses à vista | não medida |

† Lightsail: São Paulo é uma das regiões com **metade** da franquia de transferência.
⚠️ = preço de fonte secundária ou incompleto. ⚠️⚠️ = não confirmado de forma alguma.

**Notas de fonte, uma por linha problemática:**

- **OVH (10):** a página diz "*starting at* $4.54/month" e não abre o preço mensal sem
  compromisso, nem quais datacenters aceitam o VPS-1. O número está na tabela porque é
  competitivo, mas **não foi confirmado** — o valor real só aparece no configurador.
- **Contabo (11):** a página de VPS exibe preços "para assinaturas de 24 meses"; um artigo da
  própria base de ajuda cita €4,40 em 12 meses. **As duas fontes são da Contabo e se
  contradizem.** Além disso a Contabo cobra *location fees* por região, que não estão em
  nenhum dos dois números.
- **RackNerd (12):** o checkout devolve HTTP 403 a qualquer leitura automatizada, e as fontes
  secundárias divergem entre si (US$ 17/ano, US$ 35,99/ano, US$ 3,49/mês para o mesmo plano de
  2 GB). **Não confirmei nada.** É o mais barato da lista no papel e o único do qual eu não
  afirmaria uma única linha.

### Descartados no portão (critério 1: dá para comprar hoje?)

- **Oracle Cloud Always Free — reprovado, e é a razão deste documento.** Além do
  `Out of host capacity` persistente, a Oracle **cortou a franquia Always Free de A1 pela
  metade em 15/06/2026** (de 4 OCPU/24 GB para 2 OCPU/12 GB), sem anúncio, blog ou aviso a
  cliente — a documentação simplesmente mudou. Some-se a política de recuperação por
  ociosidade que o próprio `DEPLOY.md` documenta (§1.1) e o resultado é: capacidade que não
  existe, termos que mudam em silêncio e uma VM que some se ninguém usar. Não é hospedagem
  para o orçamento da casa.
- **Google Cloud e2-micro Always Free — reprovado por custo variável.** 1 GB de RAM (abaixo do
  piso de build), regiões só nos EUA, e egress cobrado por GB além da franquia. Custo fixo
  R$ 0 até deixar de ser.
- **Scaleway Stardust1-S — reprovado.** €0,43/mês é o preço da CPU: a própria página diz que
  "storage (local, block) and attached public IPv4 addresses are excluded", e o IP flutuante
  sai a €0,004/h (~€2,92/mês). Preço montado por peça, com o histórico de esgotamento crônico
  do Stardust.
- **AWS/Azure free tiers — reprovados:** expiram em 12 meses.
- **Hetzner nos EUA — fora do orçamento.** Seria a resposta óbvia para latência (Ashburn a
  148 ms), mas o CAX (ARM) **não existe nos EUA** — só em Falkenstein, Nuremberg e Helsinki —
  e o reajuste de 15/06/2026 levou o CPX11 de €5,99 para **€17,49/mês** (+192%). O Hetzner
  barato é, hoje, obrigatoriamente europeu.
- **Hetzner CX23 (€5,49)** aparece na tabela de reajuste da própria Hetzner, mas **não achei
  nenhuma página de produto** que confirme specs ou que ele esteja à venda — as páginas atuais
  mostram só CAX (cost-optimized), CPX (regular) e CCX (dedicated). Deixei fora por isso.

### Latência — medida, não estimada

`ping -c 8` desta máquina, contra os hosts de looking glass/speedtest de cada provedor,
2026-08-16. 0% de perda em todos:

| Região | Host | Média |
| --- | --- | --- |
| **Vultr São Paulo** | `sao-br-ping.vultr.com` | **16,1 ms** |
| Hetzner Ashburn (US-East) | `ash-speed.hetzner.com` | 148,3 ms |
| Linode Newark | `speedtest.newark.linode.com` | 154,4 ms |
| Vultr New Jersey | `nj-us-ping.vultr.com` | 154,8 ms |
| OVH Beauharnois (Canadá) | `proof.ovh.ca` | 157,5 ms |
| Vultr Miami | `fl-us-ping.vultr.com` | 171,1 ms |
| Scaleway Paris | `ping.online.net` | 229,0 ms |
| **netcup (rede, Nuremberg)** | `lg.netcup.net` | **259,5 ms** |
| Hetzner Nuremberg | `nbg1-speed.hetzner.com` | 259,8 ms |
| Hetzner Falkenstein | `fsn1-speed.hetzner.com` | 265,0 ms |
| Hetzner Helsinki | `hel1-speed.hetzner.com` | 329,5 ms |
| Hetzner Singapura | `sin-speed.hetzner.com` | 380,3 ms |

> Medi também `contabo.com` (17 ms) e `www.hostinger.com` (16 ms) e **joguei fora**: são
> respostas de CDN anycast, não dos datacenters. Reportá-las seria mentira com três casas
> decimais. Por isso Contabo e Hostinger estão sem latência na tabela principal.

**O que 260 ms significam aqui.** O app é Server Components: cada navegação é, no mínimo, um
round-trip até a origem antes de qualquer pixel mudar. Alemanha custa ~0,26 s de espera por
toque; São Paulo, ~0,02 s. Não é a diferença entre usável e inusável — é a diferença entre
"instantâneo" e "percebo que está carregando". Com a conexão HTTP/2 já aberta (o caso normal
de uma PWA aberta há alguns minutos) não há handshake por cima; num app recém-aberto, o TLS
custa mais um a dois RTTs, e aí a abertura fria na Alemanha fica perto de 1 s.

---

## Parte 4 — a recomendação

### Vencedor: **netcup VPS Lite 1 G12s** — R$ 25,45/mês, build na VM

2 vCore x86, **4 GB de RAM**, 80 GB SSD, Nuremberg/Viena/Amsterdam. €4,10/mês líquidos de VAT,
**sem taxa de setup**, prazo mínimo de 6 meses, ciclo de faturamento de 6 meses. Disponível
para pedido imediato.

**Por que ele.** É o único candidato que fecha as quatro coisas ao mesmo tempo: cabe no teto
com folga (R$ 25,45 contra R$ 30), tem RAM suficiente para o build continuar na VM (4 GB
contra o piso medido de ~1,7 GB), tem disco de sobra para o cache do BuildKit crescer sem
disciplina (80 GB contra os ~9 GB de partida), e não exige compromisso longo. Os R$ 4,55/mês
que sobram do teto não estão sendo economizados — estão comprando a folga que faz o
`pnpm server` continuar sendo um comando só.

O plano é da linha "Lite" da netcup, e vale saber o que "Lite" custa: SSD em vez de NVMe,
interface de 500 Mbit/s e *throttling* quando a média móvel de 24 h passa de 100 Mbit/s.
Para um banco de 11 MB e 197 kB por carregamento frio, os três são invisíveis. É exatamente
o tipo de corte que se quer comprar: eles cortaram o que este app não usa.

**Sobre a sobrevivência dos dados** (critério 3, o que mais me preocupou depois da Oracle): a
netcup existe desde 2008 (com raiz em 2007), é de Karlsruhe, faz parte do grupo Anexia desde
2016 e declara mais de 200 mil clientes. Não tem política de recuperação por ociosidade —
você paga, a máquina fica de pé. Snapshots copy-on-write estão inclusos no plano. E o
`pnpm db:dump --remote` continua funcionando como está: ele puxa o dump para o seu Mac por
SSH, que é o que transforma isso em backup de verdade, já que os dumps da VM moram no mesmo
disco do banco.

**O que eu troquei, e por quê.** Troquei **244 ms de latência** por **R$ 15/mês e 4 GB de
RAM**. É a troca que o dono autorizou explicitamente ("não precisa ser no Brasil"), e é a
única troca desconfortável do estudo — veja a Parte 5. Troquei também a reputação de suporte:
as avaliações recentes da netcup em 2026 são desiguais, com relatos de tickets levando mais de
24 h. Para uma stack em que o suporte do provedor só entra se o *hardware* falhar (nada aqui é
gerenciado por eles), aceitei; se o app fosse ganhar dinheiro, não aceitaria.

### Vice: **Vultr `vc2-1c-1gb` em São Paulo** — R$ 26,83/mês

1 vCPU, 1 GB, 25 GB NVMe, 1 TB de tráfego, IPv4 incluso, cobrança por hora **sem nenhum
compromisso**. Preço e specs vêm da API pública da própria Vultr
(`api.vultr.com/v2/plans`, consultada em 2026-08-16), que é a fonte primária mais limpa que
achei em todo o estudo.

**Por que ele é o vice e não o vencedor.** Ele ganha em três critérios de uma vez: 16 ms
contra 259 ms, zero compromisso contra 6 meses, e SLA de 100% com crédito. Custa quase o
mesmo. O que o derruba é a linha 1.1 deste documento: **1 GB não constrói.** Para usá-lo é
preciso escolher um remendo — swapfile de 2 GB (medido: funciona) ou mover o build para o
GHCR (a alavanca que a Parte 2 recomendou não puxar). E o disco de 25 GB, contra os ~9 GB de
partida crescendo 145 MB/deploy, obriga a podar o cache do BuildKit como rotina, não como
faxina. São duas obrigações operacionais permanentes para economizar nada — ele é *mais* caro
que o vencedor.

Ele vira vencedor no minuto em que a latência deixar de ser aceitável. Veja a Parte 5.

### Terceiro, se o teto subir: **Hetzner CAX11** — R$ 40,28/mês

Fora do teto em 34%, e listado mesmo assim porque é a compra que eu faria se o orçamento não
fosse o vínculo: 4 GB, 40 GB, **20 TB** de tráfego, cobrança por hora sem compromisso, snapshots,
e a melhor reputação operacional do conjunto. Note que o preço inclui **€0,50/mês pelo IPv4**,
cobrado à parte — o CAX11 sozinho é €5,99, e é fácil orçar errado por causa disso. A latência
é a mesma da netcup (260 ms), então subir para ele **não compra desempenho percebido**: compra
tranquilidade de fornecedor. Só vale se essa for a preocupação.

### O teto de R$ 30 forçou uma escolha ruim?

**Não.** Isso precisa ser dito com número, porque era o risco real deste estudo: o teto
comporta 4 GB de RAM, 80 GB de disco e um provedor de 18 anos, com R$ 4,55/mês de folga, sem
compromisso longo e sem pagamento adiantado. O teto não está apertando nada. O que aperta é
outra coisa — a geografia — e essa não é uma restrição de orçamento: **o plano equivalente em
São Paulo não existe em nenhum provedor por R$ 30.** O mais próximo é a Vultr com 1 GB
(R$ 26,83, e não constrói) ou o Lightsail com 1 GB (R$ 37,57, também não constrói). Para ter
4 GB em São Paulo o piso é a Hostinger a R$ 44,67/mês **com 24 meses à vista** (~R$ 808 num
único lançamento no cartão), que é a definição de risco travestida de desconto.

Ou seja: **R$ 30 compram uma máquina boa na Europa ou uma máquina apertada no Brasil.** A
escolha entre as duas é sobre latência, não sobre dinheiro, e por isso está inteira na Parte 5.

---

## Parte 5 — o que me faria mudar de ideia

Três condições. Se qualquer uma virar falsa, a escolha se refaz — e é para isso que a Parte 1
está cheia de números medidos em vez de conclusões.

**1. Se 260 ms incomodarem no uso real.** É a condição mais provável de todas, e a única que
depende de uma coisa que ninguém sabe hoje: como é abrir a PWA no iPhone, na fila do mercado,
para lançar uma despesa, com cada toque custando um quarto de segundo. O caso de uso nº 1 do
projeto é justamente esse (`CLAUDE.md`, "mobile-first"). Se depois de um mês a resposta for
"dá para sentir", **o vice vira o vencedor**: Vultr São Paulo a 16 ms, com swapfile de 2 GB
ou com o build no GHCR. O custo é praticamente o mesmo (R$ 26,83 contra R$ 25,45); a diferença
é operacional, não financeira. Vale a pena instrumentar isso — um mês de uso real responde
melhor que qualquer estimativa neste documento.

**2. Se o build passar de ~1,8 GB.** O piso medido é ~1150 MiB e o plano tem 4 GB: a margem é
de 3,5×, e ela é o que permite não pensar mais nisso. Mas o pico é dominado pelo `tsc` sobre
um monorepo que só cresce, e a Fase 12 já removeu telas em vez de acrescentar — quando isso se
inverter, o número sobe. **Vale remedir a bisseção da seção 1.1 uma vez por ano**, e é barato:
é um `docker run --memory=…` repetindo o estágio `builder`. Se o piso passar de ~1,8 GB, o
netcup nano (2 GB) sai da mesa como alternativa de queda e a alavanca do GHCR volta a valer
a discussão. Se passar de 3 GB, o próprio vencedor sai.

**3. Se a netcup mudar de comportamento — ou se o preço mudar.** Duas coisas distintas sob o
mesmo item. A primeira: os relatos de 2026 sobre lentidão de suporte e um caso de conectividade
IPv4 arrastada são o tipo de coisa que se aceita a R$ 25 e não se aceita quando vira o seu
problema. A segunda é a lição da Hetzner deste mesmo ano: **reajuste de +192% no CPX11 e de
+30% no CAX, num anúncio só, em 15/06/2026** — o preço de hoje não é promessa de nada. O
antídoto já está no repositório e é o que torna esta decisão barata de refazer: `pnpm db:dump`,
`pnpm db:restore --remote` e um `deploy/docker-compose.server.yml` que é *a única* diferença
entre laptop e servidor. Trocar de provedor é criar VM, `pnpm server init`, `db:restore`,
mudar o A record. **Custo de saída baixo é o que permite escolher o barato sem medo** — e é
por isso que descartei no portão todo mundo que exigia 24 meses adiantados.

---

## Parte 6 — o que muda no repositório

Se a recomendação for aceita. **Nada disto foi implementado** — este documento só acrescenta
a si mesmo.

| Arquivo | Mudança |
| --- | --- |
| [`docs/DEPLOY.md`](./DEPLOY.md) | **A maior mudança.** A Parte 1 inteira ("o que você faz no console da Oracle", §1.1 a §1.7) é substituída pelo fluxo da netcup: comprar o VPS Lite 1 G12s, escolher Ubuntu 24.04, colar a chave SSH no painel, anotar o IPv4. Some o §1.1 (upgrade para Pay As You Go), some o §1.4 e o box "Quando falhar com Out of host capacity", e some o §1.5 (IP reservado — o IPv4 da netcup já é fixo). O §1.3 (Security List) vira, no máximo, uma nota curta: ⚠️ não confirmei se o painel da netcup tem firewall próprio a liberar — confira na compra, e se não tiver, o §1.3 some junto. O §1.6 (DNS na Cloudflare, nuvem cinza) e o §1.7 (confirmar SSH) ficam **como estão**. Partes 2, 3 e 4 seguem válidas sem alteração. O título e o resumo do topo mudam, e "Custo: R$ 0" vira "Custo: ~R$ 25/mês". |
| [`scripts/server.mjs`](../scripts/server.mjs) | Menos código, não mais. `openFirewall` (linhas 69–85) existe por um motivo específico da Oracle: *"a imagem Ubuntu da Oracle vem com regras de iptables que descartam tudo além do 22"*, **atrás** de uma Security List. Nenhuma das duas metades desse problema existe na netcup, então o passo e a dependência de `iptables-persistent` **saem**. ⚠️ Confirme na compra se a netcup expõe algum firewall no SCP que precise de 80/443 liberadas; se expuser, o passo vira uma nota no `DEPLOY.md`, não código. A lista de diagnóstico de `assertPubliclyServed` (linhas 183–198) perde o item 3 ("Security List da Oracle") e o item 4 muda de tom. `installRuntime`, `fetchCode`, `installDeps` e `bringStackUp` **não mudam** — é o ponto do desenho atual, e ele se paga aqui. |
| [`scripts/lib/remote.mjs:24`](../scripts/lib/remote.mjs#L24) | `user: env.DEPLOY_USER \|\| 'ubuntu'` → `'root'`. A netcup entrega `root` como usuário padrão e aceita a chave SSH pelo painel no momento da instalação (confirmado no helpcenter deles). Uma linha. |
| [`deploy/.env.example:48-54`](../deploy/.env.example#L48-L54) | O comentário da linha 48 aponta para "o console da Oracle"; a linha 50 documenta `DEPLOY_USER=ubuntu` como default e a 54 dá o exemplo `~/.ssh/oracle_financas`. Só texto. Nenhuma variável nova: `DEPLOY_TARGET=server` continua sendo o que decide tudo. |
| [`deploy/docker-compose.server.yml`](../deploy/docker-compose.server.yml) | **Provavelmente nada.** 80/443, `DOMAIN` e o profile `web` valem igual. Confirme só que não há nada específico de ARM — pela seção 1.6, não deveria haver, e não há `platform:` fixado. |
| [`docs/SPEC.md`](./SPEC.md) | §11 Q5 é reaberta e respondida de novo (a resposta atual, de 2026-08-15, aponta para a Oracle). §12 ganha a decisão nova com a data e um ponteiro para este documento. O §8 (checklist da Fase 11) volta a "não concluída". |
| [`CLAUDE.md`](../CLAUDE.md) | Duas armadilhas na seção "Armadilhas conhecidas": a que diz *"Hospedagem é uma VM Always Free da Oracle (Ampere A1 ARM…)"* é reescrita, e o `docs/DEPLOY.md` continua sendo o ponteiro único ("não reinvente nem duplique"). |
| `README.md` | Se citar Oracle ou "R$ 0", acompanha. |

**Duas mudanças de código que este estudo recomenda de forma independente**, valham qual
provedor for:

1. **Podar o cache do BuildKit no deploy.** Medi 3,24 GB depois de um build e +145 MB por
   deploy, sem nada removendo. Num disco de 80 GB isso leva anos para doer, mas dói em
   silêncio e o sintoma é um `docker compose build` que falha por disco cheio no pior momento
   possível. Um `docker builder prune --keep-storage 5GB -f` ao final do `bringStackUp`
   resolve, e é uma linha.
2. **Criar swapfile no `init`.** Não porque a recomendação precise — 4 GB não precisa — mas
   porque é o que torna o **vice** viável sem repensar nada, e o que dá margem se o build
   crescer (condição 2 da Parte 5). 2 GB de swap num disco de 80 GB são de graça e mudam o
   piso de 2 GB para 1 GB de RAM, como a seção 1.1 mediu.

---

## Apêndice — como reproduzir as medições

Tudo abaixo roda contra este commit, sem alterar o repositório.

**Piso de RAM do build** — reproduz o estágio `builder` do `Dockerfile` sob um teto:

```bash
docker run --rm --memory=1152m --memory-swap=1152m --cpus=1 \
  -v "$PWD:/src:ro" -v /tmp/pnpm-store:/pnpm-store \
  -e NEXT_TELEMETRY_DISABLED=1 -e CI=1 node:22.22.1-alpine sh -c '
    set -e; cp -a /src /repo && cd /repo; corepack enable
    pnpm config set store-dir /pnpm-store
    pnpm install --frozen-lockfile --reporter=append-only
    pnpm --filter @finance/web build'
# rc=0 passa; rc=137 é OOM-kill do kernel. Varie --memory para bissetar.
# --cpus varia o tempo; --memory-swap maior que --memory habilita swap.
```

**Runtime dos containers:** `docker stats --no-stream` com a stack de pé (`pnpm dev`).

**Custo de disco do build:** um builder buildx dedicado torna a medida limpa —
`docker buildx create --name p --driver docker-container --bootstrap`, depois
`docker buildx build --builder p -t x .` e `docker buildx du --builder p`.

**Egress por carregamento:** com a imagem servindo em `:3100`,
`curl -s -o /dev/null -H 'Accept-Encoding: gzip, br' -w '%{size_download}' …/login` para o
HTML, e o mesmo para cada `/_next/static/*` referenciado no HTML.

**Multi-arch:** `docker manifest inspect <tag>` para cada imagem fixada em
`deploy/docker-compose.yml`.

**Latência:** `ping -c 8` contra o host de looking glass do provedor. Desconfie de qualquer
resposta abaixo de ~100 ms vindo da Europa ou dos EUA — é CDN, não é o datacenter.

---

## Parte 7 — GCP × AWS: qual das duas é a mais barata

Adendo pedido em **2026-08-19**, quando a stack já roda numa **netcup VPS piko G11s** (1 vCore,
1 GB, 30 GB, Nuremberg, ~R$ 9,67/mês) com o build no GitHub Actions. A Parte 3 descartou GCP e
AWS "no portão"; esta parte refaz a conta com **as duas como candidatas de primeira classe**, e
com o requisito de hoje — que é menor que o da Parte 1.

**Data de todas as consultas desta parte: 2026-08-19.** Câmbio
([open.er-api.com](https://open.er-api.com/v6/latest/USD), atualizado 2026-08-19 00:02 UTC):
**USD/BRL 5,2073**. Com **3,5% de IOF**, o fator usado é **R$ 5,3895 por US$ 1**.

### 7.1 O requisito mudou, e isso muda a comparação

A Parte 1 mediu o piso com o build na VM (~1,7 GB). A Fase 13 moveu o build para o CI
([`.github/workflows/ci.yml`](../.github/workflows/ci.yml) → GHCR), então o que a VM precisa hoje é
o que a seção 1.2 mediu, e nada mais:

| Requisito | Número | Origem |
| --- | --- | --- |
| RAM | **1 GB** (305 MiB de containers + SO) | §1.2, medido |
| Disco | **~6 GB**, estável (sem cache de build) | §1.3, medido |
| Egress | **< 100 MB/mês** | §1.4, medido |
| Arquitetura | **x86**, porque o CI publica só `linux/amd64` | `ci.yml` |
| Portas | 80/443 públicas; nada mais | `docker-compose.server.yml` |

Isso é exatamente o tamanho de um `e2-micro` e de um Lightsail de 1 GB — e é por isso que a
pergunta vale a pena ser refeita.

### 7.2 A linha que decide a comparação inteira

**A GCP tem compute grátis que não expira. A AWS não tem — nenhum, em 2026.** As duas cobram
exatamente o mesmo pelo IPv4 público: **US$ 0,005/hora = US$ 3,65/mês**.

**GCP — Always Free** ([docs](https://docs.cloud.google.com/free/docs/free-cloud-features)),
verbatim: *"1 non-preemptible `e2-micro` VM instance per month"* em `us-west1`, `us-central1` ou
`us-east1`; *"30 GB-months standard persistent disk"*; *"1 GB of outbound data transfer from North
America to all region destinations (excluding China and Australia) per month"*. Não expira, e vale
também em conta paga (exige billing ativo).

O que **não** está incluso, e é a conta inteira da GCP:

- **O IPv4.** A [página de rede](https://cloud.google.com/vpc/network-pricing) diz
  *"Static and ephemeral IP addresses in use on standard VM instances — $0.005 / 1 hour"*, e o free
  tier dele é *"limited to one hour per month per account"*. Uma hora. **US$ 3,65/mês.**
- **O egress para o Brasil no Premium tier.** A faixa "0 a 1 GiB grátis" existe para destinos na
  América do Norte, Europa e Ásia; a linha *"TO Australia, Indonesia, Korea, South America, Saudi
  Arabia"* começa em **US$ 0,19/GiB, sem faixa grátis**. Nos nossos <100 MB/mês isso é ~US$ 0,02 —
  e some de vez escolhendo **Standard Tier**, que tem *"First 200 GiB per month free (per account,
  across all regions)"*.

**AWS — não há equivalente.** Desde **15/07/2025** a conta nova não recebe mais 12 meses de
t2/t3.micro: recebe **US$ 100 em créditos + até US$ 100 por atividades**, o plano gratuito *"ends
after six months or when your credits are fully used"* e **a conta fecha sozinha** se não virar
paga ([docs](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html)).
Os créditos *"expire 12 months from the date you create your AWS account"*
([FAQ](https://aws.amazon.com/free/free-tier-faqs/)). Conta criada antes dessa data está no tier
legado de 12 meses — que, para qualquer conta existente, já queimou.

→ **Na AWS, o custo de 36 meses é o preço de tabela. Na GCP, é o preço do IPv4.**

### 7.3 A tabela

Preços de fonte primária, exceto onde marcado. AWS: arquivos oficiais de preço
(`pricing.us-east-1.amazonaws.com/offers/v1.0/...` e `b0.p.awsstatic.com/pricing/2.0/...`,
publicação de 2026-07-24). GCP: páginas de preço da própria Google, exceto o preço do e2-micro
pago (⚠️, ver nota).

| # | Opção | Specs | Região | US$/mês | **R$/mês** | 36 meses | Serve? |
| - | --- | --- | --- | --- | --- | --- | --- |
| 1 | **GCP e2-micro Always Free** + IPv4 | 2 vCPU comp., 1 GB, 30 GB HDD | us-east1 / us-central1 / us-west1 | **3,65** | **R$ 19,67** | R$ 708 | ✅ |
| 2 | GCP e2-micro Always Free, **VM IPv6-only** | idem, sem IPv4 | idem | **0,00** | **R$ 0** | R$ 0 | ⚠️ exige proxy (7.5) |
| 3 | **AWS Lightsail 1 GB IPv6-only** | 2 vCPU, 1 GB, 40 GB SSD, 2 TB | qualquer, inclusive SP | 5,00 | R$ 26,95 | R$ 970 | ⚠️ mesmo caso |
| 4 | **AWS Lightsail 1 GB** (dual-stack) | 2 vCPU, 1 GB, 40 GB SSD, 2 TB† | qualquer, inclusive **São Paulo** | 7,00 | **R$ 37,73** | R$ 1.358 | ✅ |
| 5 | AWS Lightsail 512 MB (dual-stack) | 2 vCPU, 0,5 GB, 20 GB | qualquer | 5,00 | R$ 26,95 | R$ 970 | ❌ RAM (7.4) |
| 6 | AWS EC2 t4g.micro + 20 GB gp3 + IPv4 | 2 vCPU **ARM**, 1 GB | us-east-1 | 11,38 | R$ 61,33 | R$ 2.208 | ⚠️ CI teria que virar multi-arch |
| 7 | AWS EC2 t3.micro + 20 GB gp3 + IPv4 | 2 vCPU x86, 1 GB | us-east-1 | 12,84 | R$ 69,20 | R$ 2.491 | ✅, caro |
| 8 | GCP e2-micro **São Paulo** + disco + IPv4 | 2 vCPU comp., 1 GB | southamerica-east1 | ~14,96 ⚠️ | R$ 80,63 ⚠️ | R$ 2.903 ⚠️ | ✅, caro |
| 9 | AWS EC2 t3.micro + 20 GB gp3 + IPv4 | 2 vCPU x86, 1 GB | sa-east-1 | 18,95 | R$ 102,13 | R$ 3.677 | ✅, caro |
| — | *netcup piko G11s (o que roda hoje)* | 1 vCore, 1 GB, 30 GB | Nuremberg | 1,79 | **R$ 9,67** | R$ 348 | ✅ |

† São Paulo tem **metade** da franquia (1 TB) — irrelevante para <100 MB/mês.

**Números que sustentam a tabela**, todos verificáveis pelos comandos do apêndice 7.8:

- **Lightsail custa o mesmo em São Paulo e na Virgínia.** `SAE1-BundleUsage:1GB` = `USE1-BundleUsage:1GB` =
  **US$ 0,0094/h** (teto de US$ 7/mês); as versões IPv6-only, US$ 0,00672/h (teto US$ 5). Essa é a
  descoberta mais útil deste adendo: na AWS, ficar no Brasil **não custa nada a mais** no Lightsail,
  enquanto no EC2 custa +48% (t3.micro: US$ 0,0168/h em SP contra US$ 0,0104/h em us-east-1) e no
  disco custa +90% (gp3: US$ 0,152 contra US$ 0,08 por GB-mês).
- **IPv4 público: US$ 0,005/h nas duas** (`SAE1-PublicIPv4:InUseAddress`, `USE1-PublicIPv4:InUseAddress`,
  e a mesma tarifa na página de rede da GCP). São US$ 3,65/mês, e é o custo integral da opção 1.
- ⚠️ **O e2-micro pago (linha 8) é o único número de fonte secundária deste adendo:** US$ 0,0133/h em
  southamerica-east1 e US$ 0,0084/h em us-central1, de [gcloud-compute.com](https://gcloud-compute.com/southamerica-east1/e2-micro.html)
  (derivado da Billing API da Google). As tabelas oficiais da GCP são renderizadas por JavaScript e não
  consegui lê-las. Some-se ~US$ 1,60 de disco, também estimado. **Não vire compra sem abrir o
  console** — mas note que a linha 8 perde por margem larga demais para o erro importar.
- E2 de núcleo compartilhado **não tem sustained use discount** (⚠️ mesma fonte), então não há desconto
  automático escondido na linha 8.

### 7.4 512 MB não serve — e o número que prova isso

A opção mais barata da AWS no papel é o Lightsail de 512 MB IPv6-only (US$ 3,50/mês, R$ 18,86). Ela está
fora pela §1.2: **305 MiB só de containers de produção**, mais Ubuntu 24.04 + dockerd (~200–300 MiB).
Isso põe o repouso em 500–600 MiB num teto de 512 MB — sem margem para um `docker pull`, um `pg_dump` ou
um pico do PostgREST. O piso da AWS que serve é o de **1 GB**, e é ele que está na tabela.

### 7.5 O truque do IPv6-only vale a pena?

Nas duas nuvens, tirar o IPv4 é a maior economia percentual disponível: **-100% na GCP** (a máquina fica
literalmente de graça) e **-29% na AWS** (US$ 7 → US$ 5). O preço não-financeiro é o mesmo nas duas: **um
servidor só-IPv6 é inalcançável de qualquer rede IPv4**, e isso inclui Wi-Fi corporativo, hotel e boa parte
do Wi-Fi doméstico brasileiro. O único jeito honesto de usá-lo é pôr a **Cloudflare em modo proxy** (nuvem
laranja) na frente — ela aceita origem IPv6-only e atende os clientes em IPv4.

Isso **contradiz o passo 2 da Parte 1 do [`DEPLOY.md`](./DEPLOY.md)**, que exige nuvem *cinza* justamente
para o Caddy conseguir o certificado por HTTP-01. Com proxy ligado, o TLS na ponta passa a ser da
Cloudflare e o Caddy precisaria de DNS-01 (token de API da Cloudflare no `.env`, plugin no build da
imagem) ou de um Origin Certificate. **É uma peça de infraestrutura nova para economizar R$ 19,67/mês.**
Está aqui como opção documentada, não como recomendação.

### 7.6 Latência, medida hoje

| Destino | Método | Medido |
| --- | --- | --- |
| **AWS sa-east-1 (São Paulo)** | handshake TCP contra `s3.sa-east-1.amazonaws.com` | **16–18 ms** |
| **AWS us-east-1 (Virgínia)** | handshake TCP contra `s3.us-east-1.amazonaws.com` | **144–150 ms** |
| GCP `southamerica-east1` | requisição completa via gcping | ~100–120 ms† |
| GCP `us-east1` | idem | ~225–245 ms† |
| GCP `us-central1` | idem | ~250–275 ms† |
| GCP `us-west1` | idem | ~260–310 ms† |

† Os números da GCP **não são comparáveis em valor absoluto** com os da AWS: os endpoints do gcping são
Cloud Run atrás do frontend anycast da Google, então o handshake mede a POP mais próxima e o total carrega
o overhead da aplicação (a linha de São Paulo, ~110 ms, é quase toda overhead). O que vale é a **diferença
entre as linhas**: `us-east1` custa **+130 ms** sobre São Paulo, `us-central1` +150 ms, `us-west1` +190 ms —
coerente com os 148 ms medidos direto contra a Virgínia da AWS.

→ Para efeito de decisão: **qualquer região americana das duas nuvens fica em ~150 ms** (melhor que os 259 ms
da Alemanha de hoje, pior que os 16 ms de São Paulo), e **São Paulo fica em ~16 ms nas duas**.

### 7.7 A resposta

**A GCP é a mais barata — por R$ 18,06/mês, ou R$ 650 em 36 meses — e a razão inteira é uma linha de free
tier que não expira.**

| | GCP | AWS |
| --- | --- | --- |
| Mais barata que serve, com IPv4 | **R$ 19,67/mês** (e2-micro Always Free, EUA) | R$ 37,73/mês (Lightsail 1 GB) |
| 36 meses | **R$ 708** | R$ 1.358 |
| Se a régua for **São Paulo** | R$ 80,63/mês ⚠️ | **R$ 37,73/mês** (mesmo preço da Virgínia) |
| Conta nova, primeiro ano | US$ 300 / 90 dias de trial | até US$ 200 em créditos, expiram em 12 meses |
| Compromisso | nenhum | nenhum |

Três leituras, e todas importam:

1. **Se a região puder ser nos EUA, a GCP ganha e não é perto:** R$ 19,67 contra R$ 37,73, e o que ela cobra
   é só o IPv4 — a máquina e os 30 GB de disco são de graça, para sempre, sem compromisso. É a única opção
   deste documento inteiro em que o preço **não sobe** quando a promoção acaba, porque não há promoção.
2. **Se a régua for São Paulo, a AWS ganha e também não é perto:** R$ 37,73 contra R$ 80,63. O Lightsail
   cobra o mesmo em SP e na Virgínia; a GCP cobra 58% a mais pelo e2-micro em SP e ainda não tem free tier lá.
   Essa é a única configuração deste documento que entrega **16 ms de latência por menos de R$ 40**.
3. **As duas são mais caras do que o que já roda.** A netcup piko custa R$ 9,67/mês. Ir para a GCP dobra a
   conta (+R$ 120/ano) e compra ~110 ms de latência; ir para o Lightsail em São Paulo quadruplica
   (+R$ 337/ano) e compra ~243 ms. **Nenhuma das duas compra RAM, disco ou disponibilidade** — compra
   geografia, e nada mais.

**Se a decisão for "sair da netcup para uma hyperscaler", a recomendação é:**

- **GCP `us-east1`, e2-micro Always Free, IPv4 pago, Standard Tier de rede** — R$ 19,67/mês, se o critério
  for preço. É a região gratuita mais próxima do Brasil (South Carolina).
- **AWS Lightsail 1 GB em `sa-east-1`** — R$ 37,73/mês, se o critério for a latência que a Parte 5 previu
  que ia incomodar. Franquia de tráfego inclusa (1 TB), IPv4 incluso, preço fixo mensal: é o **único** item
  desta parte que não tem o risco de fatura descrito abaixo.

### 7.8 O que o preço não mostra

Três coisas que a tabela não captura e que valem mais que os R$ 18 de diferença:

1. **Nenhuma das duas tem teto de gasto.** Um VPS que custa R$ 9,67 custa R$ 9,67 mesmo se algo der errado;
   uma conta de nuvem cobra o que consumir. GCP e AWS oferecem *alertas* de orçamento, não *limites*
   (a exceção é o Lightsail, que é preço fechado e franquia inclusa). Para um app de casa, isso é a
   diferença entre um bug ser um bug e um bug ser uma fatura.
2. **O disco grátis da GCP é HDD.** O free tier cobre *standard persistent disk* (`pd-standard`), cuja IOPS
   escala com o tamanho: 30 GB entregam ~22 IOPS de leitura e ~45 de escrita. Para um banco de 11 MB que
   cabe inteiro em page cache, é irrelevante em regime; para `docker pull`, `apt upgrade` e boot, é lento.
   Trocar por `pd-balanced` custa ~US$ 0,10/GB-mês e **sai do free tier** — 20 GB acrescentariam ~R$ 11/mês,
   levando a opção 1 para ~R$ 30 e apagando metade da vantagem.
3. **O e2-micro é 2 vCPU compartilhados de 0,25 vCPU garantidos.** Pelo §1.5 isso não importa em runtime
   (os containers ficam a 0% ociosos) e o build não roda mais lá. Mas é o mesmo perfil de "burst" do
   t3.micro: nenhum dos dois é uma máquina para trabalho sustentado.

### 7.9 O que muda no repositório

**Feito em 2026-08-19** — a lista virou o que está em [`docs/DEPLOY.md`](./DEPLOY.md), Parte 1.1. Comparado
com a migração da Oracle→netcup da Parte 6, esta foi pequena: o `scripts/server.mjs` já era agnóstico de
provedor e já lidava com usuário não-root (`SUDO=` por `id -u`), então só mudaram o usuário padrão em
`scripts/lib/remote.mjs`, o diagnóstico de firewall e os documentos.

| Arquivo | GCP (e2-micro) | AWS (Lightsail) |
| --- | --- | --- |
| [`deploy/.env`](../deploy/.env.example) | `DEPLOY_USER=<usuário do OS Login>` em vez de `root` | `DEPLOY_USER=ubuntu` |
| [`docs/DEPLOY.md`](./DEPLOY.md) Parte 1 | passo 1 vira "criar VM e2-micro, Ubuntu 24.04, us-east1, **reservar IP estático**, abrir 80/443 na **VPC firewall**" | passo 1 vira "criar instância Lightsail 1 GB Ubuntu 24.04, **anexar IP estático**, abrir 80/443 no **Networking** da instância" |
| Rede | escolher **Standard Tier** na criação (é o que dá 200 GiB grátis) | nada — franquia inclusa no plano |
| [`ci.yml`](../.github/workflows/ci.yml) | nada (e2-micro é x86) | nada (bundles do Lightsail são x86); **só muda se optar por Graviton no EC2**, e aí é `platforms: linux/amd64,linux/arm64` |
| [`deploy/docker-compose.server.yml`](../deploy/docker-compose.server.yml) | nada | nada |
| [`docs/SPEC.md`](./SPEC.md) | §11 Q5 reaberta e §12 ganha a decisão nova, com ponteiro para esta parte | idem |

⚠️ Em ambos, o **IP tem que ser estático e reservado** antes do DNS: IP efêmero muda a cada parada da VM, e
o `A` da Cloudflare aponta para o antigo. Na AWS, IP estático **não anexado** continua sendo cobrado
(`PublicIPv4:IdleAddress`, US$ 0,005/h) — desanexar não economiza nada, só quebra o DNS.

### 7.10 Como reproduzir os preços desta parte

```bash
# AWS — EC2 sob demanda, por região (JSON público, sem credencial; vem gzipado)
curl -s "https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/\
ec2-ondemand-without-sec-sel/South%20America%20(Sao%20Paulo)/Linux/index.json" | gunzip | \
  python3 -c 'import json,sys; d=json.load(sys.stdin); [print(v["Instance Type"],v["price"]) \
  for r in d["regions"].values() for v in r.values() if v["Instance Type"].startswith("t3.")]'

# AWS — EBS por região (mesma origem, também gzipado)
curl -s "https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ebs.json" | gunzip

# AWS — Lightsail e IPv4 público (offer files oficiais, JSON puro)
curl -s "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonLightsail/current/sa-east-1/index.json"
curl -s "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/current/sa-east-1/index.json"

# GCP — as tabelas são JS, mas os preços estão no HTML servido; grepar funciona
curl -sL "https://cloud.google.com/vpc/network-pricing" | \
  python3 -c 'import sys,re; t=re.sub(r"\s+"," ",re.sub(r"<[^>]+>"," ",sys.stdin.read())); \
  i=t.find("in use on standard VM"); print(t[i-200:i+600])'

# Latência de uma região da AWS (o handshake TCP é o RTT; endpoints regionais não são anycast)
curl -s -o /dev/null -w '%{time_connect}\n' https://s3.sa-east-1.amazonaws.com
```
