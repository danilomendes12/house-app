import 'server-only';

import { authedClient, unwrap } from './client';
import { toTodo, type Todo } from './types';

/**
 * The whole checklist, pending first and newest first within each group.
 *
 * One query rather than one per group: the list is a household's chores, not a feed, and
 * splitting it in the page keeps the two sections from drifting out of sync.
 */
export async function listTodos(): Promise<Todo[]> {
  const { supabase } = await authedClient();

  const rows = unwrap(
    await supabase
      .from('todos')
      .select('*')
      // `nullsFirst` is what puts the pending ones on top: done_at is null while pending.
      .order('done_at', { ascending: true, nullsFirst: true })
      .order('created_at', { ascending: false }),
  );

  return rows.map(toTodo);
}

export async function createTodo(title: string): Promise<void> {
  const { supabase, userId, householdId } = await authedClient();

  const { error } = await supabase
    .from('todos')
    .insert({ household_id: householdId, user_id: userId, title });
  if (error) throw error;
}

/** Checking and unchecking are the same write — `done_at` is the whole state. */
export async function setTodoDone(id: string, isDone: boolean): Promise<void> {
  const { supabase } = await authedClient();

  const { error } = await supabase
    .from('todos')
    .update({ done_at: isDone ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteTodo(id: string): Promise<void> {
  const { supabase } = await authedClient();

  const { error } = await supabase.from('todos').delete().eq('id', id);
  if (error) throw error;
}

/** Clears the done section in one go. @returns how many items were removed. */
export async function deleteDoneTodos(): Promise<number> {
  const { supabase } = await authedClient();

  const rows = unwrap(await supabase.from('todos').delete().not('done_at', 'is', null).select('id'));
  return rows.length;
}
