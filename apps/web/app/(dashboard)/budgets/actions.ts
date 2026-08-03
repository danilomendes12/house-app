'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  ZERO_CENTS,
  addMonths,
  currentIsoMonth,
  isIsoMonth,
  parseCentsOrNull,
  type IsoMonth,
} from '@finance/shared';
import { copyBudgets, saveMonthBudgets, type BudgetEntry } from '@/lib/db/budgets';

export type BudgetsFormState = {
  status: 'idle' | 'saved' | 'error';
  message?: string;
};

function readMonth(formData: FormData): IsoMonth {
  const month = String(formData.get('month') ?? '');
  return isIsoMonth(month) ? month : currentIsoMonth();
}

/**
 * Saves the whole month in one submit: the page renders one amount input per category and
 * this walks every `amount:<categoryId>` field. An empty field clears the budget, which is
 * what makes the category render without a progress bar.
 */
export async function saveBudgets(
  _previous: BudgetsFormState,
  formData: FormData,
): Promise<BudgetsFormState> {
  const month = readMonth(formData);
  const invalid: string[] = [];
  const entries: BudgetEntry[] = [];

  for (const [field, value] of formData.entries()) {
    if (!field.startsWith('amount:')) continue;

    const categoryId = field.slice('amount:'.length);
    const raw = String(value).trim();

    if (raw === '') {
      entries.push({ categoryId, amountCents: null });
      continue;
    }

    const amountCents = parseCentsOrNull(raw);
    if (amountCents === null || amountCents < ZERO_CENTS) {
      invalid.push(raw);
      continue;
    }

    entries.push({ categoryId, amountCents });
  }

  if (invalid.length > 0) {
    return { status: 'error', message: `Valor inválido: ${invalid.join(', ')}.` };
  }

  try {
    await saveMonthBudgets(month, entries);
  } catch (error) {
    console.error('[budgets] save failed', error);
    return { status: 'error', message: 'Não foi possível salvar os orçamentos.' };
  }

  revalidatePath('/', 'layout');
  return { status: 'saved', message: 'Orçamentos salvos.' };
}

/** Repeats the previous month's budgets, without touching what is already set here. */
export async function copyPreviousMonth(formData: FormData): Promise<void> {
  const month = readMonth(formData);

  await copyBudgets(addMonths(month, -1), month);

  revalidatePath('/', 'layout');
  redirect(`/budgets?month=${month}`);
}
