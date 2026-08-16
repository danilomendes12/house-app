import 'server-only';

import type { CategoryKind } from '@finance/shared';
import { authedClient, unwrap } from './client';
import { toCategory, type Category } from './types';

export interface CategoryInput {
  name: string;
  kind: CategoryKind;
  color: string | null;
  icon: string | null;
}

/** Categories in display order. Archived ones are hidden unless asked for. */
export async function listCategories({ includeArchived = false } = {}): Promise<Category[]> {
  const { supabase } = await authedClient();

  let query = supabase.from('categories').select('*');
  if (!includeArchived) query = query.eq('is_archived', false);

  const rows = unwrap(await query.order('sort_order').order('name'));
  return rows.map(toCategory);
}

export async function createCategory(input: CategoryInput): Promise<void> {
  const { supabase, userId, householdId } = await authedClient();

  // New categories sort after the seeded ones without renumbering anything.
  const last = unwrap(
    await supabase
      .from('categories')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1),
  );

  const { error } = await supabase.from('categories').insert({
    household_id: householdId,
    user_id: userId,
    name: input.name,
    kind: input.kind,
    color: input.color,
    icon: input.icon,
    sort_order: (last[0]?.sort_order ?? 0) + 10,
  });
  if (error) throw error;
}

export async function updateCategory(id: string, input: CategoryInput): Promise<void> {
  const { supabase } = await authedClient();

  const { error } = await supabase
    .from('categories')
    .update({ name: input.name, kind: input.kind, color: input.color, icon: input.icon })
    .eq('id', id);
  if (error) throw error;
}

export async function setCategoryArchived(id: string, isArchived: boolean): Promise<void> {
  const { supabase } = await authedClient();

  const { error } = await supabase
    .from('categories')
    .update({ is_archived: isArchived })
    .eq('id', id);
  if (error) throw error;
}

/**
 * Permanently deletes a category. Transactions that referenced it fall back to
 * "a categorizar" (`on delete set null`), which is why archiving is the default action in
 * the UI.
 */
export async function deleteCategory(id: string): Promise<void> {
  const { supabase } = await authedClient();

  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) throw error;
}

/** How many transactions point at a category — the warning shown before deleting it. */
export async function countTransactionsByCategory(): Promise<Map<string, number>> {
  const { supabase } = await authedClient();

  const rows = unwrap(await supabase.from('transactions').select('category_id'));

  const counts = new Map<string, number>();
  for (const { category_id: categoryId } of rows) {
    if (categoryId) counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
  }
  return counts;
}
