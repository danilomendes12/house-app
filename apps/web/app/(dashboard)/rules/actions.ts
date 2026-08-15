'use server';

import { revalidatePath } from 'next/cache';
import {
  createCategoryRule,
  deleteCategoryRule,
  updateCategoryRule,
} from '@/lib/db/category-rules';
import { applyRuleToQueue } from '@/lib/rules';

export type RuleFormState =
  { status: 'idle' } | { status: 'error'; message: string } | { status: 'done'; applied: number };

function parsePriority(value: FormDataEntryValue | null): number {
  const parsed = Number(String(value ?? '0'));
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

/**
 * Saves a rule and immediately applies it to the queue — a rule that only affects future
 * imports would leave the user categorizing by hand the very backlog they wrote it for.
 * Editing counts as saving: a corrected matcher is worth as much on the backlog as a new one.
 */
export async function saveRule(
  _previous: RuleFormState,
  formData: FormData,
): Promise<RuleFormState> {
  const matcher = String(formData.get('matcher') ?? '').trim();
  const categoryId = String(formData.get('categoryId') ?? '');
  const priority = parsePriority(formData.get('priority'));
  const id = String(formData.get('id') ?? '');

  if (matcher === '') return { status: 'error', message: 'Informe o texto a procurar.' };
  if (!categoryId) return { status: 'error', message: 'Escolha uma categoria.' };

  try {
    let ruleId = id;
    if (ruleId) {
      await updateCategoryRule(ruleId, { matcher, categoryId, priority });
    } else {
      ruleId = await createCategoryRule({ matcher, categoryId, priority });
    }

    const applied = await applyRuleToQueue(ruleId);

    revalidatePath('/', 'layout');
    return { status: 'done', applied };
  } catch (error) {
    console.error('[rules] save failed', error);
    return { status: 'error', message: 'Não foi possível salvar a regra.' };
  }
}

export async function removeRule(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await deleteCategoryRule(id);
  revalidatePath('/', 'layout');
}
