import 'server-only';

import { fromCents, monthRange, type Cents, type IsoDate, type IsoMonth } from '@finance/shared';
import type { TransactionType } from '@finance/shared';
import { authedClient, unwrap } from './client';
import { toTransaction, type Transaction } from './types';

export interface TransactionInput {
  date: IsoDate;
  description: string;
  amountCents: Cents;
  type: TransactionType;
  categoryId: string | null;
  notes: string | null;
}

/** All transactions of a month, newest first. */
export async function listTransactionsForMonth(month: IsoMonth): Promise<Transaction[]> {
  const { supabase } = await authedClient();
  const { start, endExclusive } = monthRange(month);

  const rows = unwrap(
    await supabase
      .from('transactions')
      .select('*')
      .gte('date', start)
      .lt('date', endExclusive)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false }),
  );

  return rows.map(toTransaction);
}

/**
 * Every transaction from `fromMonth` through `toMonth`, inclusive — the trend window.
 * Newest first, like every other listing here.
 */
export async function listTransactionsBetweenMonths(
  fromMonth: IsoMonth,
  toMonth: IsoMonth,
): Promise<Transaction[]> {
  const { supabase } = await authedClient();

  const rows = unwrap(
    await supabase
      .from('transactions')
      .select('*')
      .gte('date', monthRange(fromMonth).start)
      .lt('date', monthRange(toMonth).endExclusive)
      .order('date', { ascending: false }),
  );

  return rows.map(toTransaction);
}

/**
 * The "a categorizar" queue (SPEC §9): everything with no category, newest first.
 *
 * Not scoped to a month on purpose — the queue is a to-do list, and a stray uncategorized
 * row from March should not be invisible just because the dashboard is showing August.
 */
export async function listUncategorizedTransactions(limit = 200): Promise<Transaction[]> {
  const { supabase } = await authedClient();

  const rows = unwrap(
    await supabase
      .from('transactions')
      .select('*')
      .is('category_id', null)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit),
  );

  return rows.map(toTransaction);
}

export async function countUncategorizedTransactions(): Promise<number> {
  const { supabase } = await authedClient();

  const { count, error } = await supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .is('category_id', null);
  if (error) throw error;

  return count ?? 0;
}

/** Single-field update used by the queue, which never touches the rest of the row. */
export async function setTransactionCategory(id: string, categoryId: string): Promise<void> {
  const { supabase } = await authedClient();

  const { error } = await supabase
    .from('transactions')
    .update({ category_id: categoryId })
    .eq('id', id);
  if (error) throw error;
}

/**
 * Applies a matcher to the rows still waiting in the queue — what "criar regra" does after
 * saving the rule, so an existing backlog gets cleared instead of only future imports
 * benefiting (SPEC §9).
 *
 * `ilike` with an escaped pattern is the SQL equivalent of the case-insensitive substring
 * test in `matchRule`. It is not accent-insensitive the way the shared helper is, so it
 * catches a subset — the queue is the safety net for whatever it misses.
 *
 * @returns how many transactions were categorized.
 */
export async function applyMatcherToUncategorized(
  matcher: string,
  categoryId: string,
): Promise<number> {
  const { supabase } = await authedClient();

  const pattern = `%${matcher.replace(/([\\%_])/g, '\\$1')}%`;

  const { data, error } = await supabase
    .from('transactions')
    .update({ category_id: categoryId })
    .is('category_id', null)
    .ilike('description', pattern)
    .select('id');
  if (error) throw error;

  return data?.length ?? 0;
}

export async function getTransaction(id: string): Promise<Transaction | null> {
  const { supabase } = await authedClient();

  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;

  return data ? toTransaction(data) : null;
}

export async function createTransaction(input: TransactionInput): Promise<void> {
  const { supabase, userId } = await authedClient();

  const { error } = await supabase.from('transactions').insert({
    user_id: userId,
    date: input.date,
    description: input.description,
    amount_cents: fromCents(input.amountCents),
    type: input.type,
    category_id: input.categoryId,
    notes: input.notes,
    source: 'manual',
  });
  if (error) throw error;
}

export async function updateTransaction(id: string, input: TransactionInput): Promise<void> {
  const { supabase } = await authedClient();

  const { error } = await supabase
    .from('transactions')
    .update({
      date: input.date,
      description: input.description,
      amount_cents: fromCents(input.amountCents),
      type: input.type,
      category_id: input.categoryId,
      notes: input.notes,
    })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteTransaction(id: string): Promise<void> {
  const { supabase } = await authedClient();

  const { error } = await supabase.from('transactions').delete().eq('id', id);
  if (error) throw error;
}
