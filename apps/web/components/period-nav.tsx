import Link from 'next/link';
import { PORTFOLIO_PERIODS, PORTFOLIO_PERIOD_LABELS, type PortfolioPeriod } from '@finance/shared';
import { cardClass } from './fields';

/**
 * The window every number on a portfolio screen is measured over.
 *
 * One filter row above everything it scopes, and a plain link per option: the choice
 * lives in the URL, so the pages stay Server Components and a shared link carries the
 * window with it. Same shape as the trend window selector.
 */
export function PeriodNav({
  period,
  basePath,
  query = {},
}: {
  period: PortfolioPeriod;
  basePath: string;
  query?: Record<string, string>;
}) {
  return (
    <div role="group" aria-label="Período" className={`${cardClass} flex gap-1 p-1 text-sm`}>
      {PORTFOLIO_PERIODS.map((option) => (
        <Link
          key={option}
          href={{ pathname: basePath, query: { ...query, period: option } }}
          aria-current={option === period ? 'true' : undefined}
          className={`flex-1 rounded-xl py-2 text-center transition ${
            option === period
              ? 'bg-[var(--color-brand)] font-medium text-white'
              : 'text-[var(--color-ink-muted)]'
          }`}
        >
          {PORTFOLIO_PERIOD_LABELS[option]}
        </Link>
      ))}
    </div>
  );
}
