import 'server-only';

import {
  toCents,
  type Cents,
  type CategoryKind,
  type IsoDate,
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

export interface Budget {
  id: string;
  categoryId: string;
  /** First day of the month, `YYYY-MM-01`. */
  month: IsoDate;
  amountCents: Cents;
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
    source: row.source === 'pluggy' || row.source === 'csv' ? row.source : 'manual',
    installmentNum: row.installment_num,
    installmentTotal: row.installment_total,
    notes: row.notes,
  };
}

export function toBudget(row: Tables<'budgets'>): Budget {
  return {
    id: row.id,
    categoryId: row.category_id,
    month: row.month,
    amountCents: toCents(row.amount_cents),
  };
}
