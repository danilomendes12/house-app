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

export async function createCategoryRule(input: CategoryRuleInput): Promise<void> {
  const { supabase, userId } = await authedClient();

  const { error } = await supabase.from('category_rules').insert({
    user_id: userId,
    matcher: input.matcher,
    category_id: input.categoryId,
    priority: input.priority,
  });
  if (error) throw error;
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
