'use server';

import { revalidatePath } from 'next/cache';
import { isShoppingList, type ShoppingList } from '@finance/shared';
import {
  createShoppingItem,
  deleteDoneShoppingItems,
  deleteShoppingItem,
  setShoppingItemDone,
} from '@/lib/db/shopping';

export type ShoppingFormState = { status: 'idle' | 'added' } | { status: 'error'; message: string };

/** Longer than this is a note, not a shopping item — and it would wrap three lines. */
const MAX_TITLE_LENGTH = 200;

/**
 * Which list the form or the row was submitted from. Every action carries it in the
 * FormData: the actions are shared by both lists, and the one that got the click is the
 * only one that should be re-rendered.
 */
function listFrom(formData: FormData): ShoppingList | null {
  const list = String(formData.get('list') ?? '');
  return isShoppingList(list) ? list : null;
}

export async function addShoppingItem(
  _previous: ShoppingFormState,
  formData: FormData,
): Promise<ShoppingFormState> {
  const list = listFrom(formData);
  if (!list) return { status: 'error', message: 'Lista inválida.' };

  const title = String(formData.get('title') ?? '').trim();

  if (title === '') return { status: 'error', message: 'Escreva o item.' };
  if (title.length > MAX_TITLE_LENGTH) {
    return { status: 'error', message: `Máximo de ${MAX_TITLE_LENGTH} caracteres.` };
  }

  try {
    await createShoppingItem(list, title);
  } catch (error) {
    console.error('[shopping] create failed', error);
    return { status: 'error', message: 'Não foi possível salvar o item.' };
  }

  revalidatePath(`/shopping/${list}`);
  return { status: 'added' };
}

/**
 * The checkbox is a form: no client state to keep in sync, and it keeps working before the
 * page hydrates — which in a supermarket aisle is most of the time you are looking at it.
 */
export async function toggleShoppingItem(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const list = listFrom(formData);
  if (!id || !list) return;

  await setShoppingItemDone(id, String(formData.get('done') ?? '') === 'true');
  revalidatePath(`/shopping/${list}`);
}

export async function removeShoppingItem(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const list = listFrom(formData);
  if (!id || !list) return;

  await deleteShoppingItem(id);
  revalidatePath(`/shopping/${list}`);
}

export async function clearDoneShoppingItems(formData: FormData): Promise<void> {
  const list = listFrom(formData);
  if (!list) return;

  await deleteDoneShoppingItems(list);
  revalidatePath(`/shopping/${list}`);
}
