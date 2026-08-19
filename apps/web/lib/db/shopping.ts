import 'server-only';

import { isShoppingList, type ShoppingList } from '@finance/shared';
import { authedClient, unwrap } from './client';
import { toShoppingItem, type ShoppingItem } from './types';

/**
 * One list, pending first and newest first within each group — the same read as the
 * checklist, scoped to `list`.
 *
 * Scoped rather than fetched whole and split in the page: the two lists are looked at in
 * different places (one at home, one in a store aisle), so there is no screen that wants
 * both, and the index is `(household_id, list, done_at, created_at desc)` for this query.
 */
export async function listShoppingItems(list: ShoppingList): Promise<ShoppingItem[]> {
  const { supabase } = await authedClient();

  const rows = unwrap(
    await supabase
      .from('shopping_items')
      .select('*')
      .eq('list', list)
      // `nullsFirst` is what puts the pending ones on top: done_at is null while pending.
      .order('done_at', { ascending: true, nullsFirst: true })
      .order('created_at', { ascending: false }),
  );

  return rows.map(toShoppingItem);
}

/** How many items are still pending in each list — the count the tab strip shows. */
export async function countPendingByList(): Promise<Record<ShoppingList, number>> {
  const { supabase } = await authedClient();

  const rows = unwrap(await supabase.from('shopping_items').select('list').is('done_at', null));

  const counts: Record<ShoppingList, number> = { home: 0, market: 0 };
  for (const { list } of rows) {
    if (isShoppingList(list)) counts[list] += 1;
  }
  return counts;
}

export async function createShoppingItem(list: ShoppingList, title: string): Promise<void> {
  const { supabase, userId, householdId } = await authedClient();

  const { error } = await supabase
    .from('shopping_items')
    .insert({ household_id: householdId, user_id: userId, list, title });
  if (error) throw error;
}

/** Buying and un-buying are the same write — `done_at` is the whole state. */
export async function setShoppingItemDone(id: string, isDone: boolean): Promise<void> {
  const { supabase } = await authedClient();

  const { error } = await supabase
    .from('shopping_items')
    .update({ done_at: isDone ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteShoppingItem(id: string): Promise<void> {
  const { supabase } = await authedClient();

  const { error } = await supabase.from('shopping_items').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Clears the bought section of **one** list. Scoped on purpose: emptying the cart after the
 * supermarket must not wipe what the house still owes.
 *
 * @returns how many items were removed.
 */
export async function deleteDoneShoppingItems(list: ShoppingList): Promise<number> {
  const { supabase } = await authedClient();

  const rows = unwrap(
    await supabase
      .from('shopping_items')
      .delete()
      .eq('list', list)
      .not('done_at', 'is', null)
      .select('id'),
  );
  return rows.length;
}
