'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  createCategory,
  deleteCategory,
  setCategoryArchived,
  updateCategory,
  type CategoryInput,
} from '@/lib/db/categories';
import { isUniqueViolation } from '@/lib/db/client';

export type CategoryFormState = {
  status: 'idle' | 'error';
  message?: string;
};

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function parseForm(formData: FormData): CategoryInput | null {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return null;

  const color = String(formData.get('color') ?? '');
  const icon = String(formData.get('icon') ?? '').trim();

  return {
    name,
    kind: formData.get('kind') === 'income' ? 'income' : 'expense',
    color: COLOR_RE.test(color) ? color.toLowerCase() : null,
    icon: icon || null,
  };
}

export async function saveCategory(
  _previous: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  const input = parseForm(formData);
  if (!input) return { status: 'error', message: 'Informe um nome para a categoria.' };

  const id = String(formData.get('id') ?? '');

  try {
    if (id) await updateCategory(id, input);
    else await createCategory(input);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { status: 'error', message: `Já existe uma categoria chamada “${input.name}”.` };
    }
    console.error('[categories] save failed', error);
    return { status: 'error', message: 'Não foi possível salvar. Tente de novo.' };
  }

  revalidatePath('/', 'layout');
  redirect('/categories');
}

/** Archiving keeps history intact; it only hides the category from the pickers. */
export async function toggleCategoryArchived(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await setCategoryArchived(id, formData.get('isArchived') !== 'true');

  revalidatePath('/', 'layout');
  redirect('/categories');
}

export async function removeCategory(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await deleteCategory(id);

  revalidatePath('/', 'layout');
  redirect('/categories');
}
