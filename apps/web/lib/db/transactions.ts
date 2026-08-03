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
