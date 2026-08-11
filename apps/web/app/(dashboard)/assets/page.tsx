import Link from 'next/link';
import { Plus } from 'lucide-react';
import {
  ASSET_TYPE_LABELS,
  ZERO_CENTS,
  formatCents,
  formatIsoDate,
  formatIsoMonth,
  formatIsoMonthShort,
  toReais,
} from '@finance/shared';
import { EmptyState, cardClass } from '@/components/fields';
import { MonthLineChart, type MonthLinePoint } from '@/components/month-line-chart';
import { YieldTag } from '@/components/yield-tag';
import { getNetWorthOverview, type AssetLine } from '@/lib/db/net-worth';

export const metadata = { title: 'Patrimônio · Finanças' };

function AssetRow({ line }: { line: AssetLine }) {
  const { asset, performance } = line;

  const subtitle = [ASSET_TYPE_LABELS[asset.type], asset.institution]
    .filter((part) => part)
    .join(' · ');

  return (
    <li>
      <Link
        href={`/assets/${asset.id}`}
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
            yieldCents={performance.yieldCents}
            yieldPercent={performance.yieldPercent}
            className="justify-end"
          />
        </div>
      </Link>
    </li>
  );
}

export default async function AssetsPage() {
  const overview = await getNetWorthOverview();

  const points: MonthLinePoint[] = overview.series.map((point) => ({
    month: point.month,
    label: formatIsoMonthShort(point.month),
    fullLabel: formatIsoMonth(point.month),
    value: toReais(point.totalCents),
  }));

  const hasHistory = overview.series.some((point) => point.totalCents > ZERO_CENTS);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Patrimônio</h2>
        <Link
          href="/assets/new"
          className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] pr-4 pl-3 text-sm font-medium text-white"
        >
          <Plus aria-hidden className="size-4" />
          Novo
        </Link>
      </div>

      {overview.open.length === 0 && overview.closed.length === 0 ? (
        <EmptyState>
          Nenhum ativo cadastrado. Toque em “Novo” para registrar o primeiro investimento.
        </EmptyState>
      ) : (
        <>
          <div className={`${cardClass} p-5`}>
            <p className="text-sm text-[var(--color-ink-muted)]">Total investido hoje</p>
            <p className="mt-1 text-3xl font-semibold">{formatCents(overview.totalCents)}</p>

            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-ink-muted)]">
              <span className="tabular-nums">{formatCents(overview.investedCents)} aportados</span>
              <YieldTag yieldCents={overview.yieldCents} yieldPercent={overview.yieldPercent} />
            </p>

            {hasHistory ? (
              <>
                <h3 className="mt-5 mb-1 text-xs font-medium text-[var(--color-ink-muted)]">
                  Evolução — últimos {overview.months.length} meses
                </h3>
                <MonthLineChart points={points} />

                {/* The table view: every plotted value readable without hovering. */}
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-[var(--color-ink-muted)]">
                    Ver como tabela
                  </summary>
                  <table className="mt-2 w-full text-sm">
                    <caption className="sr-only">
                      Patrimônio total por mês nos últimos {overview.months.length} meses
                    </caption>
                    <thead>
                      <tr className="text-left text-xs text-[var(--color-ink-muted)]">
                        <th scope="col" className="py-1 font-medium">
                          Mês
                        </th>
                        <th scope="col" className="py-1 text-right font-medium">
                          Patrimônio
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-line)]">
                      {overview.series.map((point) => (
                        <tr key={point.month}>
                          <th scope="row" className="py-1.5 text-left font-normal capitalize">
                            {formatIsoMonth(point.month)}
                          </th>
                          <td className="py-1.5 text-right tabular-nums">
                            {formatCents(point.totalCents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </>
            ) : (
              <p className="mt-4 text-xs text-[var(--color-ink-muted)]">
                A evolução aparece assim que houver valores informados. Abra um ativo e toque em
                “Atualizar valor atual”.
              </p>
            )}

            {/* Why the chart can end below the number above it. */}
            {hasHistory && overview.pendingSnapshotCount > 0 ? (
              <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
                {overview.pendingSnapshotCount === 1
                  ? '1 ativo ainda sem valor informado entra no total pelo valor aportado, mas não na evolução.'
                  : `${overview.pendingSnapshotCount} ativos ainda sem valor informado entram no total pelo valor aportado, mas não na evolução.`}
              </p>
            ) : null}
          </div>

          {overview.open.length > 0 ? (
            <ul className={`${cardClass} divide-y divide-[var(--color-line)]`}>
              {overview.open.map((line) => (
                <AssetRow key={line.asset.id} line={line} />
              ))}
            </ul>
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
                  <AssetRow key={line.asset.id} line={line} />
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
