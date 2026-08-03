import { currentIsoMonth, isIsoMonth, type IsoMonth } from '@finance/shared';

/**
 * The `?month=YYYY-MM` search param every month-scoped page shares.
 *
 * A full date is truncated (easy to paste by accident) and anything else falls back to
 * the current month — a bad URL should never break the dashboard.
 */
export function resolveMonth(value: string | string[] | undefined): IsoMonth {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return currentIsoMonth();

  const candidate = raw.slice(0, 7);
  return isIsoMonth(candidate) ? candidate : currentIsoMonth();
}
