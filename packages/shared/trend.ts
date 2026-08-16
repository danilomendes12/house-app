/**
 * Spending over time: the monthly series behind the trend chart and the month-over-month
 * comparison (SPEC §8, P1).
 *
 * Trends answer "what did I spend", so income categories are excluded entirely
 * (SPEC §12). A refund booked in an *expense* category still nets out against it — that
 * is the same rule {@link summarizeMonth} applies within a single month.
 */

import { monthOf, type IsoDate, type IsoMonth } from './date';
import { ZERO_CENTS, type Cents } from './money';
import type { CategoryKey, TransactionType } from './summary';

/** Window sizes offered by the trend screen. */
export const TREND_WINDOWS = [3, 6, 12] as const;
export type TrendWindow = (typeof TREND_WINDOWS)[number];

export function isTrendWindow(value: number): value is TrendWindow {
  return (TREND_WINDOWS as readonly number[]).includes(value);
}

/** Minimal shape the series needs; real transactions carry much more. */
export interface DatedAmount {
  date: IsoDate;
  categoryId: CategoryKey;
  type: TransactionType;
  amountCents: Cents;
}

export interface MonthPoint {
  month: IsoMonth;
  /** Net spending in the month: expenses minus refunds, income categories excluded. */
  totalCents: Cents;
  /** Net spending per category. Only categories with movement in the month appear. */
  byCategory: Map<CategoryKey, Cents>;
}

/**
 * Net spending per month across a fixed window.
 *
 * Every month in `months` gets a point, zeroed when nothing happened — a chart with gaps
 * in the axis reads as missing data rather than as a month without spending. Transactions
 * outside the window are ignored, so the caller can pass a slightly wider query result.
 */
export function monthlySpendSeries(
  transactions: Iterable<DatedAmount>,
  months: readonly IsoMonth[],
  incomeCategoryIds: ReadonlySet<string> = new Set(),
): MonthPoint[] {
  const points = new Map<IsoMonth, MonthPoint>(
    months.map((month) => [month, { month, totalCents: ZERO_CENTS, byCategory: new Map() }]),
  );

  for (const { date, categoryId, type, amountCents } of transactions) {
    if (categoryId !== null && incomeCategoryIds.has(categoryId)) continue;

    const point = points.get(monthOf(date));
    if (!point) continue;

    // A refund is income booked in an expense category: it cancels the purchase out.
    const signed = type === 'expense' ? amountCents : -amountCents;

    point.totalCents += signed;
    point.byCategory.set(categoryId, (point.byCategory.get(categoryId) ?? ZERO_CENTS) + signed);
  }

  return months.map((month) => points.get(month) as MonthPoint);
}

/**
 * `new` and `gone` are called out separately because a percentage cannot describe them:
 * "R$ 0 → R$ 300" is not "+∞%", it is a category that showed up this month.
 */
export type ChangeDirection = 'up' | 'down' | 'flat' | 'new' | 'gone';

export interface Change {
  currentCents: Cents;
  previousCents: Cents;
  /** `current − previous`. Positive means spending grew. */
  deltaCents: Cents;
  /** `null` when the previous month cannot anchor a percentage (zero or negative). */
  percentChange: number | null;
  direction: ChangeDirection;
}

export interface CategoryChange extends Change {
  categoryId: CategoryKey;
}

/** Month-over-month change for one number. */
export function changeOf(currentCents: Cents, previousCents: Cents): Change {
  const deltaCents = currentCents - previousCents;

  return {
    currentCents,
    previousCents,
    deltaCents,
    // Only a positive baseline makes a percentage meaningful. A month that netted zero
    // (or negative, when refunds outweighed spending) has nothing to grow from.
    percentChange:
      previousCents > ZERO_CENTS ? Number((deltaCents * 10000n) / previousCents) / 100 : null,
    direction: directionOf(currentCents, previousCents, deltaCents),
  };
}

function directionOf(current: Cents, previous: Cents, delta: Cents): ChangeDirection {
  if (delta === ZERO_CENTS) return 'flat';
  if (previous <= ZERO_CENTS && current > ZERO_CENTS) return 'new';
  if (current <= ZERO_CENTS && previous > ZERO_CENTS) return 'gone';
  return delta > ZERO_CENTS ? 'up' : 'down';
}

/**
 * Per-category change between two months, biggest increase first — the ordering the
 * screen exists for ("which categories are growing?", SPEC §4, história 4).
 *
 * Categories that were zero in both months are dropped rather than listed as unchanged.
 */
export function compareMonths(current: MonthPoint, previous: MonthPoint): CategoryChange[] {
  const keys = new Set<CategoryKey>([...current.byCategory.keys(), ...previous.byCategory.keys()]);

  const changes: CategoryChange[] = [];

  for (const categoryId of keys) {
    const currentCents = current.byCategory.get(categoryId) ?? ZERO_CENTS;
    const previousCents = previous.byCategory.get(categoryId) ?? ZERO_CENTS;
    if (currentCents === ZERO_CENTS && previousCents === ZERO_CENTS) continue;

    changes.push({ categoryId, ...changeOf(currentCents, previousCents) });
  }

  return changes.sort((a, b) => compareCents(b.deltaCents, a.deltaCents));
}

/**
 * The categories that moved the most across the whole window, by total spending —
 * how the chart decides which lines are worth drawing.
 */
export function topCategories(points: readonly MonthPoint[], limit: number): CategoryKey[] {
  const totals = new Map<CategoryKey, Cents>();

  for (const point of points) {
    for (const [categoryId, cents] of point.byCategory) {
      totals.set(categoryId, (totals.get(categoryId) ?? ZERO_CENTS) + cents);
    }
  }

  return [...totals]
    .filter(([, cents]) => cents > ZERO_CENTS)
    .sort(([, a], [, b]) => compareCents(b, a))
    .slice(0, limit)
    .map(([categoryId]) => categoryId);
}

/** `bigint` differences overflow `number`; comparators must not subtract them. */
function compareCents(a: Cents, b: Cents): number {
  return a === b ? 0 : a > b ? 1 : -1;
}
