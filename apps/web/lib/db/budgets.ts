import 'server-only';

import { fromCents, monthStart, type Cents, type IsoMonth } from '@finance/shared';
import { authedClient, unwrap } from './client';
import { toBudget, type Budget } from './types';

export async function listBudgetsForMonth(month: IsoMonth): Promise<Budget[]> {
  const { supabase } = await authedClient();

  const rows = unwrap(await supabase.from('budgets').select('*').eq('month', monthStart(month)));
  return rows.map(toBudget);
}

export interface BudgetEntry {
  categoryId: string;
  /** `null` clears the budget — that is what makes a category render without a bar. */
  amountCents: Cents | null;
}

/**
 * Writes a whole month of budgets: the page edits every category at once, so this is two
 * statements (one upsert, one delete) rather than one round-trip per category.
 */
export async function saveMonthBudgets(month: IsoMonth, entries: BudgetEntry[]): Promise<void> {
  const { supabase, userId } = await authedClient();
  const monthDate = monthStart(month);

  const cleared = entries
    .filter((entry) => entry.amountCents === null)
    .map((entry) => entry.categoryId);

  const rows = entries
    .filter((entry) => entry.amountCents !== null)
    .map((entry) => ({
      user_id: userId,
      category_id: entry.categoryId,
      month: monthDate,
      amount_cents: fromCents(entry.amountCents as Cents),
    }));

  if (rows.length > 0) {
    const { error } = await supabase
      .from('budgets')
      .upsert(rows, { onConflict: 'user_id,category_id,month' });
    if (error) throw error;
  }

  if (cleared.length > 0) {
    const { error } = await supabase
      .from('budgets')
      .delete()
      .eq('month', monthDate)
      .in('category_id', cleared);
    if (error) throw error;
  }
}

/**
 * Copies every budget of `from` into `to`, leaving months that already have budgets of
 * their own untouched — recreating the same numbers every month is the common case.
 */
export async function copyBudgets(from: IsoMonth, to: IsoMonth): Promise<number> {
  const { supabase, userId } = await authedClient();

  const [source, existing] = await Promise.all([
    listBudgetsForMonth(from),
    listBudgetsForMonth(to),
  ]);

  const alreadySet = new Set(existing.map((budget) => budget.categoryId));
  const rows = source
    .filter((budget) => !alreadySet.has(budget.categoryId))
    .map((budget) => ({
      user_id: userId,
      category_id: budget.categoryId,
      month: monthStart(to),
      amount_cents: fromCents(budget.amountCents),
    }));

  if (rows.length === 0) return 0;

  const { error } = await supabase.from('budgets').insert(rows);
  if (error) throw error;

  return rows.length;
}
