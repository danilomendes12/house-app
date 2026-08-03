import 'server-only';

import {
  ZERO_CENTS,
  budgetStatus,
  percentOfCents,
  summarizeMonth,
  type BudgetStatus,
  type Cents,
  type IsoMonth,
} from '@finance/shared';
import { listBudgetsForMonth } from './budgets';
import { listCategories } from './categories';
import { listTransactionsForMonth } from './transactions';
import type { Category, Transaction } from './types';

/** One row of the dashboard breakdown. `category` is `null` for "a categorizar". */
export interface CategoryLine {
  key: string;
  category: Category | null;
  expenseCents: Cents;
  incomeCents: Cents;
  /** Expenses minus refunds booked in the category — what the budget is measured against. */
  netCents: Cents;
  budget: BudgetStatus;
  /** Share of the month's spending, `0`–`100`, for the bar next to the amount. */
  sharePercent: number;
  transactionCount: number;
}

export interface MonthOverview {
  month: IsoMonth;
  /** Net spending: expenses minus refunds. The headline number. */
  expenseCents: Cents;
  /** Income booked in income categories (salary, refunds that are not category-specific). */
  incomeCents: Cents;
  /** Total budgeted for the month across every category with a budget. */
  budgetedCents: Cents;
  /** `budgeted − spent in budgeted categories`; negative once the month is blown. */
  budgetRemainingCents: Cents;
  expenseLines: CategoryLine[];
  incomeLines: CategoryLine[];
  transactions: Transaction[];
  uncategorizedCount: number;
}

/**
 * Everything the monthly dashboard shows, in one pass.
 *
 * Aggregation happens in TypeScript rather than SQL on purpose: a single-user month is a
 * few hundred rows, and the rules that matter (refund netting, budget arithmetic) then
 * live in `@finance/shared`, unit-tested and shared with anything else that needs them.
 */
export async function getMonthOverview(month: IsoMonth): Promise<MonthOverview> {
  const [categories, transactions, budgets] = await Promise.all([
    listCategories({ includeArchived: true }),
    listTransactionsForMonth(month),
    listBudgetsForMonth(month),
  ]);

  const totals = summarizeMonth(transactions);
  const budgetByCategory = new Map(
    budgets.map((budget) => [budget.categoryId, budget.amountCents]),
  );

  const countByCategory = new Map<string | null, number>();
  for (const transaction of transactions) {
    countByCategory.set(
      transaction.categoryId,
      (countByCategory.get(transaction.categoryId) ?? 0) + 1,
    );
  }

  const expenseLines: CategoryLine[] = [];
  const incomeLines: CategoryLine[] = [];

  for (const category of categories) {
    const categoryTotals = totals.byCategory.get(category.id);
    const budgetCents = budgetByCategory.get(category.id) ?? null;

    // Archived and untouched categories only earn a row once they have a number to show.
    if (!categoryTotals && budgetCents === null) continue;
    if (category.isArchived && !categoryTotals) continue;

    const line: CategoryLine = {
      key: category.id,
      category,
      expenseCents: categoryTotals?.expenseCents ?? ZERO_CENTS,
      incomeCents: categoryTotals?.incomeCents ?? ZERO_CENTS,
      netCents: categoryTotals?.netCents ?? ZERO_CENTS,
      budget: budgetStatus(categoryTotals?.netCents ?? ZERO_CENTS, budgetCents),
      sharePercent: 0,
      transactionCount: countByCategory.get(category.id) ?? 0,
    };

    (category.kind === 'income' ? incomeLines : expenseLines).push(line);
  }

  const uncategorized = totals.byCategory.get(null);
  if (uncategorized) {
    expenseLines.push({
      key: 'uncategorized',
      category: null,
      expenseCents: uncategorized.expenseCents,
      incomeCents: uncategorized.incomeCents,
      netCents: uncategorized.netCents,
      budget: budgetStatus(uncategorized.netCents, null),
      sharePercent: 0,
      transactionCount: countByCategory.get(null) ?? 0,
    });
  }

  const expenseCents = expenseLines.reduce((total, line) => total + line.netCents, ZERO_CENTS);
  const incomeCents = incomeLines.reduce((total, line) => total + line.incomeCents, ZERO_CENTS);

  for (const line of expenseLines) {
    line.sharePercent = Math.max(0, Math.min(100, percentOfCents(line.netCents, expenseCents)));
  }

  expenseLines.sort((a, b) => (b.netCents === a.netCents ? 0 : b.netCents > a.netCents ? 1 : -1));
  incomeLines.sort((a, b) =>
    b.incomeCents === a.incomeCents ? 0 : b.incomeCents > a.incomeCents ? 1 : -1,
  );

  const budgetedCents = budgets.reduce((total, budget) => total + budget.amountCents, ZERO_CENTS);
  const spentAgainstBudgets = expenseLines
    .filter((line) => line.budget.budgetCents !== null)
    .reduce((total, line) => total + line.netCents, ZERO_CENTS);

  return {
    month,
    expenseCents,
    incomeCents,
    budgetedCents,
    budgetRemainingCents: budgetedCents - spentAgainstBudgets,
    expenseLines,
    incomeLines,
    transactions,
    uncategorizedCount: countByCategory.get(null) ?? 0,
  };
}
