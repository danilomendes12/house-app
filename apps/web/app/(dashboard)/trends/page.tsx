import Link from 'next/link';
import {
  ZERO_CENTS,
  formatCents,
  formatIsoMonth,
  formatIsoMonthShort,
  toReais,
} from '@finance/shared';
import { CategoryIcon } from '@/components/category-icon';
import { ChangeBadge } from '@/components/change-badge';
import { EmptyState, cardClass } from '@/components/fields';
import { MonthNav } from '@/components/month-nav';
import { MonthLineChart, type MonthLinePoint } from '@/components/month-line-chart';
import { Sparkline } from '@/components/sparkline';
import { getTrendOverview, type CategoryTrend } from '@/lib/db/trends';
import { resolveMonth } from '@/lib/month-param';
import { DEFAULT_TREND_WINDOW, TREND_WINDOWS, resolveTrendWindow } from '@/lib/trend-param';

export const metadata = { title: 'Tendências · Finanças' };

function CategoryRow({ trend, months }: { trend: CategoryTrend; months: string[] }) {
  const name = trend.category?.name ?? 'A categorizar';

  return (
    <li className="flex items-center gap-3 px-3 py-3">
      <CategoryIcon icon={trend.category?.icon ?? null} color={trend.category?.color ?? null} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <ChangeBadge change={trend} />
      </div>

      <Sparkline
        values={trend.series}
        color={trend.category?.color ?? null}
        className="h-7 w-16 shrink-0"
      />

      <span className="w-24 shrink-0 text-right text-sm font-medium tabular-nums">
        {formatCents(trend.currentCents)}
        <span className="sr-only"> em {formatIsoMonth(months[months.length - 1] as string)}</span>
      </span>
    </li>
  );
}

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; window?: string }>;
}) {
  const params = await searchParams;
  const month = resolveMonth(params.month);
  const window = resolveTrendWindow(params.window);

  const overview = await getTrendOverview(month, window);

  const points: MonthLinePoint[] = overview.months.map((isoMonth, index) => ({
    month: isoMonth,
    label: formatIsoMonthShort(isoMonth),
    fullLabel: formatIsoMonth(isoMonth),
    value: toReais(overview.totals[index] ?? ZERO_CENTS),
  }));

  const hasSpending = overview.totals.some((cents) => cents > ZERO_CENTS);

  return (
    <section className="space-y-4">
      {/* One filter row above everything it scopes: the month and the window. */}
      <MonthNav
        month={month}
        basePath="/trends"
        query={window === DEFAULT_TREND_WINDOW ? {} : { window: String(window) }}
      />

      <div
        role="group"
        aria-label="Janela de tempo"
        className={`${cardClass} flex gap-1 p-1 text-sm`}
      >
        {TREND_WINDOWS.map((size) => (
          <Link
            key={size}
            href={{ pathname: '/trends', query: { month, window: String(size) } }}
            aria-current={size === window ? 'true' : undefined}
            className={`flex-1 rounded-xl py-2 text-center transition ${
              size === window
                ? 'bg-[var(--color-brand)] font-medium text-white'
                : 'text-[var(--color-ink-muted)]'
            }`}
          >
            {size} meses
          </Link>
        ))}
      </div>

      <div className={`${cardClass} p-5`}>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Gasto em <span className="capitalize">{formatIsoMonth(month)}</span>
        </p>
        {/* Hero figure: proportional digits, not tabular — 121 looks loose at this size. */}
        <p className="mt-1 text-3xl font-semibold">{formatCents(overview.total.currentCents)}</p>
        <ChangeBadge change={overview.total} className="mt-1" />

        {hasSpending ? (
          <>
            <h2 className="mt-5 mb-1 text-xs font-medium text-[var(--color-ink-muted)]">
              Total por mês — últimos {window} meses
            </h2>
            <MonthLineChart points={points} />

            {/* The table view: every plotted value readable without hovering. */}
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-[var(--color-ink-muted)]">
                Ver como tabela
              </summary>
              <table className="mt-2 w-full text-sm">
                <caption className="sr-only">
                  Gasto total por mês nos últimos {window} meses
                </caption>
                <thead>
                  <tr className="text-left text-xs text-[var(--color-ink-muted)]">
                    <th scope="col" className="py-1 font-medium">
                      Mês
                    </th>
                    <th scope="col" className="py-1 text-right font-medium">
                      Gasto
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-line)]">
                  {overview.months.map((isoMonth, index) => (
                    <tr key={isoMonth}>
                      <th scope="row" className="py-1.5 text-left font-normal capitalize">
                        {formatIsoMonth(isoMonth)}
                      </th>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatCents(overview.totals[index] ?? ZERO_CENTS)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        ) : (
          <p className="mt-4 text-xs text-[var(--color-ink-muted)]">
            Sem despesas nos últimos {window} meses.
          </p>
        )}
      </div>

      <div>
        <h2 className="mb-1.5 px-1 text-xs font-medium text-[var(--color-ink-muted)]">
          Por categoria — variação contra <span className="lowercase">o mês anterior</span>
        </h2>

        {overview.categories.length === 0 ? (
          <EmptyState>
            Nada para comparar ainda. Registre despesas em dois meses seguidos para ver a variação.
          </EmptyState>
        ) : (
          <ul className={`${cardClass} divide-y divide-[var(--color-line)]`}>
            {overview.categories.map((trend) => (
              <CategoryRow
                key={trend.categoryId ?? 'uncategorized'}
                trend={trend}
                months={overview.months}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
