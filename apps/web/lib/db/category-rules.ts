import 'server-only';

import { sortRules, type CategoryRule } from '@finance/shared';
import { authedClient, unwrap } from './client';

export interface CategoryRuleInput {
  matcher: string;
  categoryId: string;
  priority: number;
}

/**
 * All rules, already in evaluation order (SPEC §7).
 *
 * The database sorts by `priority desc` but knows nothing about the matcher-length
 * tie-break, so the final ordering is applied here — one place, shared with the import.
 */
export async function listCategoryRules(): Promise<CategoryRule[]> {
  const { supabase } = await authedClient();

  const rows = unwrap(
    await supabase.from('category_rules').select('*').order('priority', { ascending: false }),
  );

  return sortRules(
    rows.map((row) => ({
      id: row.id,
      matcher: row.matcher,
      categoryId: row.category_id,
      priority: row.priority,
    })),
  );
}

/** @returns the id of the new rule, which the caller needs to apply it to the queue. */
export async function createCategoryRule(input: CategoryRuleInput): Promise<string> {
  const { supabase, userId, householdId } = await authedClient();

  const { data, error } = await supabase
    .from('category_rules')
    .insert({
      household_id: householdId,
      user_id: userId,
      matcher: input.matcher,
      category_id: input.categoryId,
      priority: input.priority,
    })
    .select('id')
    .single();
  if (error) throw error;

  return data.id;
}

export async function updateCategoryRule(id: string, input: CategoryRuleInput): Promise<void> {
  const { supabase } = await authedClient();

  const { error } = await supabase
    .from('category_rules')
    .update({ matcher: input.matcher, category_id: input.categoryId, priority: input.priority })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteCategoryRule(id: string): Promise<void> {
  const { supabase } = await authedClient();

  const { error } = await supabase.from('category_rules').delete().eq('id', id);
  if (error) throw error;
}
