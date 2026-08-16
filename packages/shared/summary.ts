/**
 * Monthly aggregation (SPEC §6.1).
 *
 * Pure functions over plain values: the database only ever returns rows, everything the
 * dashboard shows is derived here so it can be tested without a database.
 */

import { ZERO_CENTS, type Cents } from './money';

export type CategoryKind = 'expense' | 'income';
export type TransactionType = 'expense' | 'income';
export type TransactionSource = 'manual' | 'csv';

/** The `null` category id — transactions waiting to be categorized. */
export type CategoryKey = string | null;

/** Minimal shape {@link summarizeMonth} needs; real transactions carry much more. */
export interface CategorizedAmount {
  categoryId: CategoryKey;
  type: TransactionType;
  amountCents: Cents;
}

export interface CategoryTotals {
  categoryId: CategoryKey;
  expenseCents: Cents;
  incomeCents: Cents;
  /**
   * `expense − income`. A refund is recorded as income in the same category (SPEC §6.1),
   * so it must cancel out the purchase it reverses instead of inflating the month.
   * Can be negative when refunds outweigh spending.
   */
  netCents: Cents;
}

export interface MonthTotals {
  expenseCents: Cents;
  incomeCents: Cents;
  byCategory: Map<CategoryKey, CategoryTotals>;
}

const emptyTotals = (categoryId: CategoryKey): CategoryTotals => ({
  categoryId,
  expenseCents: ZERO_CENTS,
  incomeCents: ZERO_CENTS,
  netCents: ZERO_CENTS,
});

/** Aggregates one month of transactions into totals, overall and per category. */
export function summarizeMonth(transactions: Iterable<CategorizedAmount>): MonthTotals {
  const byCategory = new Map<CategoryKey, CategoryTotals>();
  let expenseCents = ZERO_CENTS;
  let incomeCents = ZERO_CENTS;

  for (const { categoryId, type, amountCents } of transactions) {
    const totals = byCategory.get(categoryId) ?? emptyTotals(categoryId);

    if (type === 'expense') {
      totals.expenseCents += amountCents;
      expenseCents += amountCents;
    } else {
      totals.incomeCents += amountCents;
      incomeCents += amountCents;
    }
    totals.netCents = totals.expenseCents - totals.incomeCents;

    byCategory.set(categoryId, totals);
  }

  return { expenseCents, incomeCents, byCategory };
}
