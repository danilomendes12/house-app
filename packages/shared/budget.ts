/**
 * Monthly aggregation and budget arithmetic (SPEC §6.1).
 *
 * Pure functions over plain values: the database only ever returns rows, everything the
 * dashboard shows is derived here so it can be tested without a database.
 */

import { ZERO_CENTS, percentOfCents, type Cents } from './money';

export type CategoryKind = 'expense' | 'income';
export type TransactionType = 'expense' | 'income';
export type TransactionSource = 'manual' | 'pluggy' | 'csv';

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

export type BudgetState = 'no-budget' | 'within' | 'over';

export interface BudgetStatus {
  /** Net spending in the category (see {@link CategoryTotals.netCents}). */
  spentCents: Cents;
  budgetCents: Cents | null;
  /** `budget − spent`; negative once the budget is blown. `null` without a budget. */
  remainingCents: Cents | null;
  /** How much the budget was exceeded by, `0` while still within it. */
  overCents: Cents;
  /** `0`–`100+`, for the progress bar. `0` without a budget. */
  percentUsed: number;
  state: BudgetState;
}

/**
 * "How much can I still spend here?" — the number the dashboard exists to answer.
 *
 * A category with no budget for the month gets `state: 'no-budget'` and no progress bar,
 * rather than a fake 0-budget that would read as instantly overspent.
 */
export function budgetStatus(spentCents: Cents, budgetCents: Cents | null): BudgetStatus {
  if (budgetCents === null) {
    return {
      spentCents,
      budgetCents: null,
      remainingCents: null,
      overCents: ZERO_CENTS,
      percentUsed: 0,
      state: 'no-budget',
    };
  }

  const remainingCents = budgetCents - spentCents;
  const isOver = remainingCents < ZERO_CENTS;

  return {
    spentCents,
    budgetCents,
    remainingCents,
    overCents: isOver ? -remainingCents : ZERO_CENTS,
    // percentOfCents cannot divide by a zero budget; any spending against one is 100% used.
    percentUsed:
      budgetCents === ZERO_CENTS
        ? spentCents > ZERO_CENTS
          ? 100
          : 0
        : Math.max(0, percentOfCents(spentCents, budgetCents)),
    state: isOver ? 'over' : 'within',
  };
}
