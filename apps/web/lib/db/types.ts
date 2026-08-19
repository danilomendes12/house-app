import 'server-only';

import {
  isAssetIndexer,
  isAssetType,
  isShoppingList,
  toCents,
  type AssetEventType,
  type AssetIndexer,
  type AssetType,
  type Cents,
  type CategoryKind,
  type IsoDate,
  type ShoppingList,
  type TransactionSource,
  type TransactionType,
} from '@finance/shared';
import type { Tables } from '@/lib/supabase/database.types';

/**
 * Domain models and the row → model boundary.
 *
 * PostgREST serializes `bigint` columns as JSON numbers and the generated types say
 * `number`. Every amount is converted to {@link Cents} here, at the edge, so nothing
 * above this layer ever sees money as a `number`. `text` columns constrained by a CHECK
 * in the database (`type`, `kind`, `source`) are narrowed to their union here too.
 */

export interface Category {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  kind: CategoryKind;
  isArchived: boolean;
  sortOrder: number;
}

export interface Transaction {
  id: string;
  categoryId: string | null;
  date: IsoDate;
  description: string;
  amountCents: Cents;
  type: TransactionType;
  source: TransactionSource;
  installmentNum: number | null;
  installmentTotal: number | null;
  notes: string | null;
}

/** One item of the household's shared checklist. */
export interface Todo {
  id: string;
  title: string;
  /** When it was checked off, as a timestamp; `null` while pending. */
  doneAt: string | null;
}

/**
 * One line of a shopping list. Same shape as {@link Todo} plus the list it belongs to —
 * they are siblings, not the same thing: a chore is done, an item is bought.
 */
export interface ShoppingItem {
  id: string;
  list: ShoppingList;
  title: string;
  /** When it was bought, as a timestamp; `null` while pending. */
  doneAt: string | null;
}

export interface Asset {
  id: string;
  name: string;
  type: AssetType;
  institution: string | null;
  indexer: AssetIndexer | null;
  /** Percent of the indexer (110 = 110% do CDI) or percent a.a. Documentation only. */
  rate: number | null;
  maturityDate: IsoDate | null;
  isClosed: boolean;
}

/** A contribution or a withdrawal. `amountCents` is always positive; `type` is the sign. */
export interface AssetEvent {
  id: string;
  assetId: string;
  date: IsoDate;
  type: AssetEventType;
  amountCents: Cents;
  notes: string | null;
}

export interface AssetSnapshot {
  id: string;
  assetId: string;
  date: IsoDate;
  grossValueCents: Cents;
}

export function toCategory(row: Tables<'categories'>): Category {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    kind: row.kind === 'income' ? 'income' : 'expense',
    isArchived: row.is_archived,
    sortOrder: row.sort_order,
  };
}

export function toTransaction(row: Tables<'transactions'>): Transaction {
  return {
    id: row.id,
    categoryId: row.category_id,
    date: row.date,
    description: row.description,
    amountCents: toCents(row.amount_cents),
    type: row.type === 'income' ? 'income' : 'expense',
    source: row.source === 'csv' ? 'csv' : 'manual',
    installmentNum: row.installment_num,
    installmentTotal: row.installment_total,
    notes: row.notes,
  };
}

export function toTodo(row: Tables<'todos'>): Todo {
  return {
    id: row.id,
    title: row.title,
    doneAt: row.done_at,
  };
}

/**
 * `list` is CHECK-constrained to the same two values as the union, so the fallback only
 * fires if the constraint and the union drift apart — in which case showing the row on the
 * house list beats dropping it.
 */
export function toShoppingItem(row: Tables<'shopping_items'>): ShoppingItem {
  return {
    id: row.id,
    list: isShoppingList(row.list) ? row.list : 'home',
    title: row.title,
    doneAt: row.done_at,
  };
}

/**
 * `type` and `indexer` are CHECK-constrained to the shared unions, so the guards below only
 * ever fire if the constraint and the union drift apart — in which case falling back beats
 * crashing the whole net-worth page over one row.
 */
export function toAsset(row: Tables<'assets'>): Asset {
  return {
    id: row.id,
    name: row.name,
    type: isAssetType(row.type) ? row.type : 'outro',
    institution: row.institution,
    indexer: row.indexer !== null && isAssetIndexer(row.indexer) ? row.indexer : null,
    rate: row.rate,
    maturityDate: row.maturity_date,
    isClosed: row.is_closed,
  };
}

export function toAssetEvent(row: Tables<'asset_events'>): AssetEvent {
  return {
    id: row.id,
    assetId: row.asset_id,
    date: row.date,
    type: row.type === 'withdrawal' ? 'withdrawal' : 'contribution',
    amountCents: toCents(row.amount_cents),
    notes: row.notes,
  };
}

export function toAssetSnapshot(row: Tables<'asset_snapshots'>): AssetSnapshot {
  return {
    id: row.id,
    assetId: row.asset_id,
    date: row.date,
    grossValueCents: toCents(row.gross_value_cents),
  };
}
