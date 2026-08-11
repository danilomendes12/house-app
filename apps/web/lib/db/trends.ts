import 'server-only';

import {
  ZERO_CENTS,
  addMonths,
  changeOf,
  compareMonths,
  lastMonths,
  monthlySpendSeries,
  type Cents,
  type Change,
  type CategoryChange,
  type IsoMonth,
  type MonthPoint,
  type TrendWindow,
} from '@finance/shared';
import { listCategories } from './categories';
import { listTransactionsBetweenMonths } from './transactions';
import type { Category } from './types';

/** One row of the per-category breakdown: how it moved, plus its own little series. */
export interface CategoryTrend extends CategoryChange {
  /** `null` for "a categorizar". */
  category: Category | null;
  /** Net spending per month across the window, aligned with {@link TrendOverview.months}. */
  series: Cents[];
}

export interface TrendOverview {
  /** The month everything is measured against. */
  month: IsoMonth;
  window: TrendWindow;
  /** Oldest first — the x-axis. */
  months: IsoMonth[];
  points: MonthPoint[];
  /** The window's spending total per month, oldest first. Aligned with `months`. */
  totals: Cents[];
  /** The reference month against the one before it. */
  total: Change;
  /** Biggest increase first (SPEC §9). */
  categories: CategoryTrend[];
}

/**
 * Everything the trend screen shows, in one pass.
 *
 * The window is queried one month wider than it is drawn: the comparison needs the month
 * before the first one on the chart, and fetching it here keeps the page to a single
 * round-trip.
 */
export async function getTrendOverview(
  month: IsoMonth,
  window: TrendWindow,
): Promise<TrendOverview> {
  const months = lastMonths(month, window);
  const previousMonth = addMonths(months[0] as IsoMonth, -1);

  const [categories, transactions] = await Promise.all([
    listCategories({ includeArchived: true }),
    listTransactionsBetweenMonths(previousMonth, month),
  ]);

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const incomeCategoryIds = new Set(
    categories.filter((category) => category.kind === 'income').map((category) => category.id),
  );

  // One extra leading point so the reference month always has something to compare to,
  // even when the window starts at the very first month with data.
  const allPoints = monthlySpendSeries(transactions, [previousMonth, ...months], incomeCategoryIds);
  const points = allPoints.slice(1);

  const current = allPoints[allPoints.length - 1] as MonthPoint;
  const before = allPoints[allPoints.length - 2] as MonthPoint;

  const categoryTrends: CategoryTrend[] = compareMonths(current, before).map((change) => ({
    ...change,
    category: change.categoryId === null ? null : (categoryById.get(change.categoryId) ?? null),
    series: points.map((point) => point.byCategory.get(change.categoryId) ?? ZERO_CENTS),
  }));

  return {
    month,
    window,
    months,
    points,
    totals: points.map((point) => point.totalCents),
    total: changeOf(current.totalCents, before.totalCents),
    categories: categoryTrends,
  };
}
