'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ZERO_CENTS, isIsoDate, monthOf, parseCentsOrNull, todayIso } from '@finance/shared';
import {
  createTransaction,
  deleteTransaction,
  updateTransaction,
  type TransactionInput,
} from '@/lib/db/transactions';

export type TransactionFormState = {
  status: 'idle' | 'error';
  message?: string;
  fieldErrors?: Partial<Record<'amount' | 'date' | 'description', string>>;
};

function parseForm(
  formData: FormData,
): { ok: true; input: TransactionInput } | { ok: false; state: TransactionFormState } {
  const fieldErrors: NonNullable<TransactionFormState['fieldErrors']> = {};

  const amountCents = parseCentsOrNull(String(formData.get('amount') ?? ''));
  if (amountCents === null) {
    fieldErrors.amount = 'Informe um valor válido, ex.: 42,90.';
  } else if (amountCents <= ZERO_CENTS) {
    fieldErrors.amount = 'O valor precisa ser maior que zero.';
  }

  const date = String(formData.get('date') ?? '');
  if (!isIsoDate(date)) fieldErrors.date = 'Informe uma data válida.';

  const type = formData.get('type') === 'income' ? 'income' : 'expense';
  const rawCategoryId = String(formData.get('categoryId') ?? '');
  const categoryId = rawCategoryId === '' ? null : rawCategoryId;

  // Description is optional on the quick-entry flow (SPEC §9); the category name is a
  // better fallback than an empty string, which the database rejects anyway.
  const description =
    String(formData.get('description') ?? '').trim() ||
    String(formData.get('categoryName') ?? '').trim() ||
    (type === 'income' ? 'Receita' : 'Despesa');

  const notes = String(formData.get('notes') ?? '').trim() || null;

  if (Object.keys(fieldErrors).length > 0 || amountCents === null) {
    return { ok: false, state: { status: 'error', fieldErrors } };
  }

  return { ok: true, input: { date, description, amountCents, type, categoryId, notes } };
}

/** Creates or updates a transaction, then returns to the month it belongs to. */
export async function saveTransaction(
  _previous: TransactionFormState,
  formData: FormData,
): Promise<TransactionFormState> {
  const parsed = parseForm(formData);
  if (!parsed.ok) return parsed.state;

  const id = String(formData.get('id') ?? '');

  try {
    if (id) {
      await updateTransaction(id, parsed.input);
    } else {
      await createTransaction(parsed.input);
    }
  } catch (error) {
    console.error('[transactions] save failed', error);
    return { status: 'error', message: 'Não foi possível salvar. Tente de novo.' };
  }

  revalidatePath('/', 'layout');
  redirect(`/transactions?month=${monthOf(parsed.input.date)}`);
}

export async function removeTransaction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const month = String(formData.get('month') ?? '') || monthOf(todayIso());
  if (!id) return;

  await deleteTransaction(id);

  revalidatePath('/', 'layout');
  redirect(`/transactions?month=${month}`);
}
