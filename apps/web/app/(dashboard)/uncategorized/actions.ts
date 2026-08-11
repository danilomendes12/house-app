'use server';

import { revalidatePath } from 'next/cache';
import { createCategoryRule } from '@/lib/db/category-rules';
import { applyMatcherToUncategorized, setTransactionCategory } from '@/lib/db/transactions';

export type QueueState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'done'; transactionId: string; ruleApplied: number };

/**
 * Categorizes one queued transaction and, when asked, saves a rule so the next import
 * lands categorized (SPEC §9).
 *
 * The rule is also applied to whatever is already in the queue — creating "uber →
 * Transporte" and still having to click through twenty Uber rows would be absurd.
 */
export async function categorizeTransaction(
  _previous: QueueState,
  formData: FormData,
): Promise<QueueState> {
  const transactionId = String(formData.get('transactionId') ?? '');
  const categoryId = String(formData.get('categoryId') ?? '');

  if (!transactionId) return { status: 'error', message: 'Lançamento não identificado.' };
  if (!categoryId) return { status: 'error', message: 'Escolha uma categoria.' };

  const wantsRule = formData.get('createRule') === 'on';
  const matcher = String(formData.get('matcher') ?? '').trim();

  if (wantsRule && matcher === '') {
    return { status: 'error', message: 'Informe o texto que a regra deve procurar.' };
  }

  try {
    await setTransactionCategory(transactionId, categoryId);

    let ruleApplied = 0;
    if (wantsRule) {
      await createCategoryRule({ matcher, categoryId, priority: 0 });
      ruleApplied = await applyMatcherToUncategorized(matcher, categoryId);
    }

    revalidatePath('/', 'layout');
    return { status: 'done', transactionId, ruleApplied };
  } catch (error) {
    console.error('[uncategorized] categorize failed', error);
    return { status: 'error', message: 'Não foi possível salvar. Tente de novo.' };
  }
}
