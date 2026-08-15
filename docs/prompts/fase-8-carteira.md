# Prompt — Fase 8: Carteira (análise + valorização por ativo)

> Cole isto como prompt inicial de uma sessão do Claude Code. Ele assume que `CLAUDE.md` e
> `docs/SPEC.md` estão em contexto e que as Fases 0–7 estão entregues.

---

Implemente a **Fase 8 — Carteira**: transformar a aba Patrimônio, hoje um cadastro com um total
e uma linha de evolução, em uma tela de acompanhamento de carteira comparável à da XP ou da
Warren — sem sair das restrições do produto (dados manuais + import da XP, zero integração, zero
recomendação de investimento).

Leia antes de escrever código: SPEC §6.2 (modelo e regras de patrimônio), §7.1 (import da XP),
§3 (não-objetivos) e §12 (decisões já tomadas sobre patrimônio — em especial "ativo encerrado sai
do total, não da história", "ativo sem snapshot entra no total pelo valor aportado" e "posição da
XP vira snapshot, nunca aporte").

## 1. Problema que a fase resolve

Hoje a tela responde "quanto eu tenho" e "quanto rendeu desde sempre". Ela não responde as três
perguntas que fazem alguém abrir o app de investimento:

1. **Como minha carteira está distribuída?** — não há visão por classe, indexador ou instituição,
   nem noção de concentração. Com a posição da XP importada, a lista tem dezenas de linhas planas.
2. **Quanto esse ativo valorizou no período?** — o rendimento exibido é vitalício
   (`último snapshot − investido`) e não separa "cresceu porque aportei" de "cresceu porque rendeu".
   Um aporte grande em julho parece rendimento em agosto.
3. **Meus números estão atualizados?** — snapshot é manual/import; um ativo sem atualização há três
   meses contamina o total e nada na tela diz isso.

## 2. Escopo — três entregas

### 2.1 Análise da carteira (tela `/assets`)

- **Alocação por classe de ativo** (renda fixa, renda variável, fundos, cripto, caixa), com valor
  e percentual. A classe é derivada de `assets.type` por um mapa novo em `packages/shared` —
  **sem migration**.
- **Alocação por indexador** (CDI, IPCA, prefixado, Selic, sem indexador) e **por instituição**.
  As três visões são o mesmo componente com dimensão diferente.
- **Concentração**: as maiores posições e o percentual que cada uma representa do total, mais o
  percentual das 5 maiores. Descritivo, nunca prescritivo (§3: o produto não recomenda).
- **Vencimentos próximos**: ativos de renda fixa com `maturity_date` nos próximos 90 dias, com
  valor e data. É a informação de renda fixa que só existe neste app.
- **Posições desatualizadas**: ativos abertos cujo snapshot mais recente tem mais de 45 dias
  (constante nomeada), com "há N dias". Inclui os que nunca tiveram snapshot — hoje só existe uma
  contagem solta (`pendingSnapshotCount`), que passa a ser esta seção.

### 2.2 Acompanhamento de valorização

- **Seletor de período** no topo de `/assets` e da tela do ativo: `1M · 6M · 12M · Tudo`
  (default 12M), refletido na URL como já fazem `lib/month-param.ts` e `lib/trend-param.ts` —
  crie `lib/period-param.ts` no mesmo formato e mantenha as telas Server Components.
- **Rentabilidade no período**, separando dinheiro novo de valorização, para a carteira e para
  cada ativo. Cálculo em §4.
- **Aporte vs. valorização mês a mês**: para cada mês da janela, quanto do movimento do patrimônio
  foi fluxo (aportes − resgates) e quanto foi valorização. É o gráfico que responde "estou
  ficando mais rico ou só depositando mais".
- **Tela do ativo (`/assets/[id]`)**: gráfico da série de snapshots do ativo com os aportes e
  resgates marcados no eixo do tempo, rentabilidade no período selecionado ao lado do rendimento
  vitalício que já existe, e a lista de movimentações abaixo (já existe, mantenha).

### 2.3 Experiência

Referência: XP/Warren. O que importa copiar é a **hierarquia da informação**, não o visual:

1. Total no topo, com a variação do período selecionado em R$ e % logo abaixo — não só o valor
   vitalício.
2. Gráfico do período imediatamente em seguida.
3. Alocação como bloco compacto (uma dimensão por vez, alternável).
4. Lista de ativos **agrupada por classe**, com subtotal e percentual por grupo, cada grupo
   recolhível; ordenação por valor (default) ou por rentabilidade do período.
5. Encerrados continuam em seção separada, fora do total.

Mobile-first (CLAUDE.md §8): a tela é usada no iPhone. Nada de tabela larga com scroll horizontal
como forma primária; cada bloco deve caber em uma coluna de ~360px.

## 3. Decisões de produto (já tomadas — implemente assim, e registre em SPEC §12)

1. **Classe de ativo é derivada, não cadastrada.** `type` já existe e o import já o infere; uma
   coluna nova de classe seria um segundo lugar para errar. Mapa fixo em `shared`:
   renda fixa (`cdb`, `tesouro`, `lci_lca`, `poupanca`), renda variável (`acao`, `fii`, `etf`),
   fundos (`fundo`), cripto (`cripto`), outros (`outro`).
2. **Rentabilidade de período usa Modified Dietz** (§4), não "valor final − valor inicial". Com
   aporte no meio do período, a diferença simples atribui o depósito a rendimento — que é
   exatamente o erro que a fase existe para corrigir. XIRR fica fora: exige iteração numérica e
   não é mais legível para o usuário.
3. **O rendimento vitalício continua existindo e não muda de fórmula.** `assetPerformance` é o
   contrato do SPEC §6.2 e do critério de aceite do §9 ("R$ 480, +4,8%"). A rentabilidade de
   período é um número *adicional*, com rótulo próprio ("no período"), nunca um substituto.
4. **Sem benchmark externo.** Nada de comparar com CDI/IBOV: exigiria série de mercado, e o app
   não tem integração (§3). "Rendeu X% no período" sem comparação é o que dá para afirmar com
   honestidade.
5. **Alocação-alvo e rebalanceamento ficam fora desta fase.** Seria a única parte com migration
   (tabela de metas) e encosta em recomendação de investimento (§3). Se depois fizer sentido, é
   Fase 9 — não crie a tabela agora, mas não modele nada que a impeça.
6. **Concentração é fato, não alerta.** Mostre "maior posição: 31% do total". Sem cor de perigo,
   sem "considere diversificar".
7. **Ativo sem snapshot entra na alocação pelo valor aportado**, coerente com a decisão já tomada
   para o total (§12) — senão a alocação discordaria do número logo acima dela. Ele aparece
   simultaneamente na seção de posições desatualizadas.
8. **Período sem dado no início não é zero.** Se o ativo não tem snapshot anterior ao início do
   período, a rentabilidade é medida a partir do primeiro snapshot dentro dele e a UI diz
   "desde DD/MM" em vez de fingir 12 meses.

## 4. Cálculos novos (`packages/shared`, puros e testados)

Coloque em um arquivo novo (ex.: `packages/shared/portfolio.ts`), reaproveitando `money.ts`,
`date.ts` e o que já existe em `assets.ts`. Nada de `node:*` — `shared` é importado por client
components.

**Valor em uma data** — já existe em espírito (`latestSnapshot`, `valueAtMonth`): extraia o
carry-forward para uma função reutilizável em vez de duplicar a regra.

**Fluxo líquido no período** = Σ aportes − Σ resgates com `date` dentro do intervalo.

**Modified Dietz** para rentabilidade do período:

```
R = (Vf − Vi − F) / (Vi + Σ (wi × Fi))
onde  wi = (T − ti) / T   # T = dias do período, ti = dias do início até o fluxo i
```

- `Vf`/`Vi`: valor no fim/início do período (carry-forward; na ausência de snapshot inicial,
  regra 8 acima).
- `Fi`: fluxo com sinal (aporte positivo, resgate negativo).
- Numerador em `Cents` (`bigint`, exato). O denominador é ponderado e não é inteiro: converta para
  `number` **apenas** ali, como `percentOfCents` já faz. Documente isso no código.
- Denominador ≤ 0 → retorne `null` (não existe base para medir), e a UI mostra "—", nunca 0%.

**Decomposição mensal**: para cada mês da janela, `{ month, flowCents, gainCents, endCents }`, com
`gain = Δvalor − flow`. A soma dos `gain` do período deve bater com `Vf − Vi − F` — inclua um
teste que verifica isso.

**Alocação**: `allocationBy(lines, dimension)` devolvendo fatias ordenadas por valor decrescente,
com `cents` e `percent`, agrupando a cauda em "Outros" acima de N fatias.

Testes de unidade obrigatórios (CLAUDE.md — regra de negócio tem cobertura): Modified Dietz com
aporte no meio do período (o caso que motiva a fórmula), período sem fluxo, resgate total,
denominador zero, ativo cuja série começa depois do início do período, coerência da decomposição
mensal, e alocação com cauda longa.

## 5. Camada de dados

- Estenda `lib/db/net-worth.ts`; não escreva Supabase fora de `lib/db/*`.
- `getNetWorthOverview` já lê todos os eventos e snapshots em uma passada — mantenha isso e
  derive as novas visões da mesma leitura, sem query nova por ativo. A tela do ativo continua em
  `getAssetDetail`.
- **Nenhuma migration é necessária.** Se você concluir que alguma é, pare e explique antes de
  criar — é sinal de que uma das decisões acima está sendo contornada.
- `bigint` não atravessa a fronteira server→client: formate no servidor e passe string/number ao
  componente de gráfico, como `MonthLineChart` já faz.

## 6. UI e gráficos

- Antes de escrever qualquer gráfico novo, **carregue a skill `dataviz`**.
- Reaproveite `components/month-line-chart.tsx` (linha de patrimônio) e `components/yield-tag.tsx`.
  O gráfico de aporte vs. valorização é novo — barras mês a mês, valorização podendo ser negativa.
- **Cuidado com a paleta.** O SPEC já registra que a paleta semeada falha separação para
  daltonismo (laranja↔verde, ΔE 4,8) e que foi por isso que tendências viraram small multiples.
  Alocação com 8 fatias coloridas repetiria o erro: prefira **barra 100% empilhada com poucas
  classes + lista com valor e percentual ao lado**, onde a cor é redundante e nada precisa ser
  distinguido só por matiz. Todo valor plotado deve estar legível como texto em algum lugar da
  tela (é a regra que a tabela `<details>` de `/assets` já segue).
- `exactOptionalPropertyTypes` está ligado: render props do Recharts se tipam pela lib e estreitam
  no corpo.

## 7. Fora de escopo (não construa)

Alocação-alvo/rebalanceamento; benchmark de mercado (CDI/IBOV); projeção de rentabilidade futura;
proventos e dividendos (§7.1 os mantém fora do banco de propósito); imposto de renda; cotação
automática de ativo; qualquer coisa que dependa de rede externa; alterar a fórmula do rendimento
vitalício; mexer no parser da XP.

## 8. Critérios de aceite (acrescente ao SPEC §9 no formato de lá)

- Dado um ativo com R$ 10.000 aportados em janeiro, snapshot de R$ 10.000 em 30/jun, aporte de
  R$ 10.000 em 01/jul e snapshot de R$ 20.400 em 31/jul, quando abro o ativo com período "1M",
  então vejo valorização de **R$ 400**, e a rentabilidade percentual **não** é ~104% — o aporte
  não conta como rendimento.
- Dado que a carteira tem 60% em renda fixa e 40% em renda variável, quando abro Patrimônio, então
  vejo as duas classes com valor e percentual, e a soma dos percentuais é 100% (arredondamento
  não pode produzir 99% ou 101% visíveis).
- Dado um ativo aberto cujo último snapshot é de 90 dias atrás, então ele aparece em "posições
  desatualizadas" com "há 90 dias", e continua contando no total.
- Dado um CDB que vence em 60 dias, então ele aparece em "vencimentos próximos" com data e valor.
- Dado um período em que não houve aporte nem resgate, então a valorização do período é
  exatamente a diferença entre o valor final e o inicial.
- Dado um ativo encerrado, então ele fica fora da alocação e da rentabilidade do período, e
  continua na seção de encerrados (regra já vigente do §12).
- Dado que troco o período de 12M para 1M, então a URL muda, a página continua sendo Server
  Component e todos os números do topo, do gráfico e da lista refletem o novo período.

## 9. Como entregar

1. Comece pelo `packages/shared` com os testes — a matemática antes da tela.
2. Depois `lib/db/net-worth.ts`, depois `/assets`, depois `/assets/[id]`.
3. Rode `pnpm typecheck && pnpm lint && pnpm test` antes de considerar concluído.
4. Atualize `docs/SPEC.md`: regras novas em §6.2, critérios em §9, checklist em §8, linha da
   **Fase 8** na tabela do §10 e as decisões da seção 3 deste prompt em §12 (com o porquê, no tom
   das entradas existentes).
5. Commits em conventional commits, em inglês, um por parte coesa (shared → db → UI → docs).

Se alguma decisão de produto que este documento não cobre aparecer no caminho, **pergunte antes de
assumir** e registre a resposta no SPEC §12 (CLAUDE.md).
