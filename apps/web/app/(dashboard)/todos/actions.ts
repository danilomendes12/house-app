'use server';

import { revalidatePath } from 'next/cache';
import { createTodo, deleteDoneTodos, deleteTodo, setTodoDone } from '@/lib/db/todos';

export type TodoFormState = { status: 'idle' | 'added' } | { status: 'error'; message: string };

/** Longer than this is a note, not a checklist item — and it would wrap three lines. */
const MAX_TITLE_LENGTH = 200;

export async function addTodo(
  _previous: TodoFormState,
  formData: FormData,
): Promise<TodoFormState> {
  const title = String(formData.get('title') ?? '').trim();

  if (title === '') return { status: 'error', message: 'Escreva a tarefa.' };
  if (title.length > MAX_TITLE_LENGTH) {
    return { status: 'error', message: `Máximo de ${MAX_TITLE_LENGTH} caracteres.` };
  }

  try {
    await createTodo(title);
  } catch (error) {
    console.error('[todos] create failed', error);
    return { status: 'error', message: 'Não foi possível salvar a tarefa.' };
  }

  revalidatePath('/todos');
  return { status: 'added' };
}

/**
 * The checkbox is a form: no client state to keep in sync, and it keeps working before the
 * page hydrates — which on the phone is most of the time you are looking at it.
 */
export async function toggleTodo(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await setTodoDone(id, String(formData.get('done') ?? '') === 'true');
  revalidatePath('/todos');
}

export async function removeTodo(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await deleteTodo(id);
  revalidatePath('/todos');
}

export async function clearDoneTodos(): Promise<void> {
  await deleteDoneTodos();
  revalidatePath('/todos');
}
