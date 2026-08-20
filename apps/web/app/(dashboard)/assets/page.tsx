import Link from 'next/link';
import { FileUp, Plus } from 'lucide-react';
import {
  ALLOCATION_DIMENSIONS,
  ALLOCATION_DIMENSION_LABELS,
  ASSET_SORTS,
  ASSET_SORT_LABELS,
  ASSET_TYPE_LABELS,
  MATURITY_HORIZON_DAYS,
  STALE_SNAPSHOT_DAYS,
  ZERO_CENTS,
  formatCents,
  formatIsoDate,
  formatIsoMonth,
  formatIsoMonthShort,
  toReais,
  type AllocationDimension,
  type AssetSort,
  type PortfolioPeriod,
} from '@finance/shared';
import { AllocationBar } from '@/components/allocation-bar';
import { EmptyState, cardClass } from '@/components/fields';
import { FlowGainChart, type FlowGainPoint } from '@/components/flow-gain-chart';
import { MonthLineChart, type MonthLinePoint } from '@/components/month-line-chart';
import { PeriodNav } from '@/components/period-nav';
import { YieldTag } from '@/components/yield-tag';
import { getNetWorthOverview, type AssetLine, type NetWorthOverview } from '@/lib/db/net-worth';
import { resolveAllocationDimension, resolveAssetSort, resolvePeriod } from '@/lib/period-param';

export const metadata = { title: 'Patrimônio · App da casa' };

const percentFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  maximumFractionDigits: 1,
});

function AssetRow({ line, period }: { line: AssetLine; period: PortfolioPeriod }) {
  const { asset, performance } = line;

  const subtitle = [ASSET_TYPE_LABELS[asset.type], asset.institution]
    .filter((part) => part)
    .join(' · ');

  return (
    <li>
      <Link
        href={{ pathname: `/assets/${asset.id}`, query: { period } }}
        className="flex items-center gap-3 px-3 py-3 transition active:bg-[var(--color-surface-muted)]"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{asset.name}</p>
          <p className="truncate text-xs text-[var(--color-ink-muted)]">
            {subtitle}
            {performance.snapshotDate === null
              ? ' · sem valor atualizado'
              : ` · em ${formatIsoDate(performance.snapshotDate)}`}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-sm font-medium tabular-nums">
            {formatCents(performance.currentCents)}
          </p>
          <YieldTag
            yieldCents={line.period.gainCents}
            yieldPercent={line.period.returnPercent}
            className="justify-end"
          />
        </div>
      </Link>
    </li>
  );
}

/** The evolution line plus the month-by-month split of what moved it. */
function PortfolioCharts({ overview }: { overview: NetWorthOverview }) {
  const points: MonthLinePoint[] = overview.series.map((point) => ({
    month: point.month,
    label: formatIsoMonthShort(point.month),
    fullLabel: formatIsoMonth(point.month),
    value: toReais(point.totalCents),
  }));

  const movements: FlowGainPoint[] = overview.movements.map((movement) => ({
    month: movement.month,
    label: formatIsoMonthShort(movement.month),
    fullLabel: formatIsoMonth(movement.month),
    flow: toReais(movement.flowCents),
    gain: toReais(movement.gainCents),
  }));

  const hasHistory = overview.series.some((point) => point.totalCents > ZERO_CENTS);
  const hasMovement = overview.movements.some(
    (movement) => movement.flowCents !== ZERO_CENTS || movement.gainCents !== ZERO_CENTS,
  );

  if (!hasHistory) {
    return (
      <p className="mt-4 text-xs text-[var(--color-ink-muted)]">
        A evolução aparece assim que houver valores informados. Abra um ativo e toque em “Atualizar
        valor atual”.
      </p>
    );
  }

  return (
    <>
      <h3 className="mt-5 mb-1 text-xs font-medium text-[var(--color-ink-muted)]">
        Evolução — {overview.months.length} {overview.months.length === 1 ? 'mês' : 'meses'}
      </h3>
      <MonthLineChart points={points} />

      {/* The table view: every plotted value readable without hovering. */}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-[var(--color-ink-muted)]">
          Ver como tabela
        </summary>
        <table className="mt-2 w-full text-sm">
          <caption className="sr-only">Patrimônio e composição do movimento, mês a mês</caption>
          <thead>
            <tr className="text-left text-xs text-[var(--color-ink-muted)]">
              <th scope="col" className="py-1 font-medium">
                Mês
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Aporte
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Valorização
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Patrimônio
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {overview.series.map((point, index) => {
              const movement = overview.movements[index];

              return (
                <tr key={point.month}>
                  <th scope="row" className="py-1.5 text-left font-normal">
                    {formatIsoMonthShort(point.month)}
                  </th>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatCents(movement?.flowCents ?? ZERO_CENTS)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatCents(movement?.gainCents ?? ZERO_CENTS)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatCents(point.totalCents)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>

      {hasMovement ? (
        <>
          <h3 className="mt-5 mb-1 text-xs font-medium text-[var(--color-ink-muted)]">
            Aporte vs. valorização
          </h3>
          <FlowGainChart points={movements} />
        </>
      ) : null}
    </>
  );
}

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; alloc?: string; sort?: string }>;
}) {
  const params = await searchParams;
  const period = resolvePeriod(params.period);
  const dimension: AllocationDimension = resolveAllocationDimension(params.alloc);
  const sort: AssetSort = resolveAssetSort(params.sort);

  const overview = await getNetWorthOverview(period, sort);
  const query = { period, alloc: dimension, sort };

  const { periodPerformance: movement } = overview;
  const slices = overview.allocation[dimension];
  const neverValued = overview.stale.filter((position) => position.ageDays === null).length;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Patrimônio</h2>

        {/* Uploading the XP position belongs here, next to the assets it updates. */}
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/import/investments"
            className="flex h-10 items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] pr-4 pl-3 text-sm font-medium"
          >
            <FileUp aria-hidden className="size-4" />
            Importar
          </Link>

          <Link
            href="/assets/new"
            className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] pr-4 pl-3 text-sm font-medium text-white"
          >
            <Plus aria-hidden className="size-4" />
            Novo
          </Link>
        </div>
      </div>

      {overview.open.length === 0 && overview.closed.length === 0 ? (
        <EmptyState>
          Nenhum ativo cadastrado. Toque em “Novo” para registrar o primeiro investimento, ou em
          “Importar” para subir a posição da XP.
        </EmptyState>
      ) : (
        <>
          {/* One filter row above everything it scopes. */}
          <PeriodNav period={period} basePath="/assets" query={{ alloc: dimension, sort }} />

          <div className={`${cardClass} p-5`}>
            <p className="text-sm text-[var(--color-ink-muted)]">Total investido hoje</p>
            <p className="mt-1 text-3xl font-semibold">{formatCents(overview.totalCents)}</p>

            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-ink-muted)]">
              <YieldTag yieldCents={movement.gainCents} yieldPercent={movement.returnPercent} />
              <span>no período</span>
            </p>

            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-ink-muted)]">
              <span className="tabular-nums">
                {movement.flowCents < ZERO_CENTS ? 'Resgate líquido de ' : 'Aporte líquido de '}
                {formatCents(
                  movement.flowCents < ZERO_CENTS ? -movement.flowCents : movement.flowCents,
                )}
              </span>
              <span>·</span>
              <span className="tabular-nums">
                {formatCents(overview.investedCents)} aportados desde sempre
              </span>
              <YieldTag yieldCents={overview.yieldCents} yieldPercent={overview.yieldPercent} />
            </p>

            <PortfolioCharts overview={overview} />

            {/* Why the chart can end below the number above it. */}
            {neverValued > 0 ? (
              <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
                {neverValued === 1
                  ? '1 ativo ainda sem valor informado entra no total pelo valor aportado, mas não na evolução.'
                  : `${neverValued} ativos ainda sem valor informado entram no total pelo valor aportado, mas não na evolução.`}
              </p>
            ) : null}
          </div>

          {slices.length > 0 ? (
            <div className={`${cardClass} space-y-3 p-5`}>
              <div role="group" aria-label="Ver alocação por" className="flex gap-1 text-xs">
                {ALLOCATION_DIMENSIONS.map((option) => (
                  <Link
                    key={option}
                    href={{ pathname: '/assets', query: { ...query, alloc: option } }}
                    aria-current={option === dimension ? 'true' : undefined}
                    className={`rounded-full px-3 py-1.5 transition ${
                      option === dimension
                        ? 'bg-[var(--color-surface-muted)] font-medium'
                        : 'text-[var(--color-ink-muted)]'
                    }`}
                  >
                    {ALLOCATION_DIMENSION_LABELS[option]}
                  </Link>
                ))}
              </div>

              <AllocationBar slices={slices} />

              {overview.concentration.top.length > 0 ? (
                <div className="border-t border-[var(--color-line)] pt-3">
                  <h3 className="text-xs font-medium text-[var(--color-ink-muted)]">
                    Concentração
                  </h3>

                  <p className="mt-1 text-sm">
                    Maior posição:{' '}
                    <span className="font-medium">{overview.concentration.top[0]?.label}</span>,{' '}
                    <span className="tabular-nums">
                      {percentFormatter.format((overview.concentration.top[0]?.percent ?? 0) / 100)}
                    </span>{' '}
                    do total.
                  </p>

                  {overview.concentration.top.length > 1 ? (
                    <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">
                      As {overview.concentration.top.length} maiores somam{' '}
                      <span className="tabular-nums">
                        {percentFormatter.format(overview.concentration.topPercent / 100)}
                      </span>
                      .
                    </p>
                  ) : null}

                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-xs text-[var(--color-ink-muted)]">
                      Ver as maiores posições
                    </summary>
                    <ul className="mt-1.5 space-y-1">
                      {overview.concentration.top.map((position) => (
                        <li key={position.key} className="flex items-center gap-2 text-sm">
                          <span className="min-w-0 flex-1 truncate">{position.label}</span>
                          <span className="shrink-0 tabular-nums">
                            {formatCents(position.cents)}
                          </span>
                          <span className="w-14 shrink-0 text-right text-[var(--color-ink-muted)] tabular-nums">
                            {percentFormatter.format(position.percent / 100)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              ) : null}
            </div>
          ) : null}

          {overview.maturities.length > 0 ? (
            <div>
              <h3 className="mb-1.5 px-1 text-xs font-medium text-[var(--color-ink-muted)]">
                Vencimentos nos próximos {MATURITY_HORIZON_DAYS} dias
              </h3>
              <ul className={`${cardClass} divide-y divide-[var(--color-line)]`}>
                {overview.maturities.map((maturity) => (
                  <li key={maturity.asset.id}>
                    <Link
                      href={{ pathname: `/assets/${maturity.asset.id}`, query: { period } }}
                      className="flex items-center gap-3 px-3 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{maturity.asset.name}</p>
                        <p className="text-xs text-[var(--color-ink-muted)]">
                          {formatIsoDate(maturity.maturityDate)} · em {maturity.daysAhead}{' '}
                          {maturity.daysAhead === 1 ? 'dia' : 'dias'}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-medium tabular-nums">
                        {formatCents(maturity.currentCents)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {overview.stale.length > 0 ? (
            <div>
              <h3 className="mb-1.5 px-1 text-xs font-medium text-[var(--color-ink-muted)]">
                Posições desatualizadas — sem valor novo há mais de {STALE_SNAPSHOT_DAYS} dias
              </h3>
              <ul className={`${cardClass} divide-y divide-[var(--color-line)]`}>
                {overview.stale.map((position) => (
                  <li key={position.asset.id}>
                    <Link
                      href={{ pathname: `/assets/${position.asset.id}`, query: { period } }}
                      className="flex items-center gap-3 px-3 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{position.asset.name}</p>
                        <p className="text-xs text-[var(--color-ink-muted)]">
                          {position.ageDays === null
                            ? 'Nunca teve valor informado — entra pelo aportado'
                            : `Há ${position.ageDays} dias · último em ${formatIsoDate(position.snapshotDate as string)}`}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-medium tabular-nums">
                        {formatCents(position.currentCents)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 px-1 text-xs text-[var(--color-ink-muted)]">
                Elas continuam contando no total pelo último valor conhecido.
              </p>
            </div>
          ) : null}

          {overview.groups.length > 0 ? (
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-3 px-1">
                <h3 className="text-xs font-medium text-[var(--color-ink-muted)]">Ativos</h3>

                <div role="group" aria-label="Ordenar por" className="flex gap-1 text-xs">
                  <span className="py-1 text-[var(--color-ink-muted)]">Ordenar:</span>
                  {ASSET_SORTS.map((option) => (
                    <Link
                      key={option}
                      href={{ pathname: '/assets', query: { ...query, sort: option } }}
                      aria-current={option === sort ? 'true' : undefined}
                      className={`rounded-full px-2.5 py-1 transition ${
                        option === sort
                          ? 'bg-[var(--color-surface-muted)] font-medium'
                          : 'text-[var(--color-ink-muted)]'
                      }`}
                    >
                      {ASSET_SORT_LABELS[option]}
                    </Link>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                {overview.groups.map((group) => (
                  <details key={group.assetClass} open className={`${cardClass} overflow-hidden`}>
                    <summary className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {group.label}
                        <span className="ml-1.5 text-xs font-normal text-[var(--color-ink-muted)]">
                          {group.lines.length}
                        </span>
                      </span>

                      <span className="shrink-0 text-sm tabular-nums">
                        {formatCents(group.totalCents)}
                      </span>
                      <span className="w-14 shrink-0 text-right text-xs text-[var(--color-ink-muted)] tabular-nums">
                        {percentFormatter.format(group.percent / 100)}
                      </span>
                    </summary>

                    <ul className="divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
                      {group.lines.map((line) => (
                        <AssetRow key={line.asset.id} line={line} period={period} />
                      ))}
                    </ul>
                  </details>
                ))}
              </div>

              <p className="mt-1.5 px-1 text-xs text-[var(--color-ink-muted)]">
                A variação ao lado de cada ativo é a do período selecionado.
              </p>
            </div>
          ) : (
            <EmptyState>Nenhum ativo aberto — todos foram encerrados.</EmptyState>
          )}

          {overview.closed.length > 0 ? (
            <div>
              <h3 className="mb-1.5 px-1 text-xs font-medium text-[var(--color-ink-muted)]">
                Encerrados — fora do total
              </h3>
              <ul className={`${cardClass} divide-y divide-[var(--color-line)] opacity-70`}>
                {overview.closed.map((line) => (
                  <AssetRow key={line.asset.id} line={line} period={period} />
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
