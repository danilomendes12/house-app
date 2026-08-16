import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addMonths, currentIsoMonth, formatIsoMonth, type IsoMonth } from '@finance/shared';

/** Route the arrows navigate within — the page keeps its month across prev/next. */
export type MonthRoute = '/' | '/transactions' | '/trends' | '/assets';

const arrowClass =
  'grid size-10 shrink-0 place-items-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] transition active:scale-95';

/**
 * @param query Extra search params to carry across the arrows, so a page's other
 *   controls (the trend window, say) survive a month change.
 */
export function MonthNav({
  month,
  basePath,
  query = {},
}: {
  month: IsoMonth;
  basePath: MonthRoute;
  query?: Record<string, string>;
}) {
  const previous = addMonths(month, -1);
  const next = addMonths(month, 1);
  const isCurrent = month === currentIsoMonth();

  return (
    <nav className="flex items-center justify-between gap-2" aria-label="Navegação entre meses">
      <Link
        href={{ pathname: basePath, query: { ...query, month: previous } }}
        className={arrowClass}
        aria-label={`Mês anterior: ${formatIsoMonth(previous)}`}
      >
        <ChevronLeft aria-hidden className="size-5" />
      </Link>

      <div className="text-center">
        <p className="text-base font-medium capitalize">{formatIsoMonth(month)}</p>
        {isCurrent ? null : (
          <Link
            href={{ pathname: basePath, query: { ...query, month: currentIsoMonth() } }}
            className="text-xs text-[var(--color-brand)] underline-offset-2 hover:underline"
          >
            voltar para o mês atual
          </Link>
        )}
      </div>

      <Link
        href={{ pathname: basePath, query: { ...query, month: next } }}
        className={arrowClass}
        aria-label={`Próximo mês: ${formatIsoMonth(next)}`}
      >
        <ChevronRight aria-hidden className="size-5" />
      </Link>
    </nav>
  );
}
