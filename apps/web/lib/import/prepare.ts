import 'server-only';

import {
  matchRule,
  parseStatement,
  type ImportedTransaction,
  type RowError,
  type SkippedRow,
} from '@finance/shared';
import { listCategoryRules } from '@/lib/db/category-rules';
import type { ImportRow } from '@/lib/db/import';
import { externalIdFor } from './external-id';

export interface PreparedRow extends ImportedTransaction {
  externalId: string;
  categoryId: string | null;
}

export interface PreparedImport {
  rows: PreparedRow[];
  skipped: SkippedRow[];
  errors: RowError[];
  categorizedCount: number;
}

/**
 * The whole read-side of an import: parse, categorize by rule, derive the dedup key.
 *
 * Deliberately pure with respect to the database — nothing is written here. The preview
 * and the confirmation both call it on the same file text, so what the user approves is
 * exactly what gets inserted (SPEC §7).
 */
export async function prepareImport(text: string): Promise<PreparedImport> {
  const { transactions, skipped, errors } = parseStatement(text);
  const rules = await listCategoryRules();

  let categorizedCount = 0;

  const rows = transactions.map((draft) => {
    // Rules match the cleaned description, not the raw title: an instalment suffix is
    // noise that would make "Loja - Parcela 3/10" miss a rule written as "Loja".
    const categoryId = matchRule(draft.description, rules)?.categoryId ?? null;
    if (categoryId) categorizedCount += 1;

    return { ...draft, categoryId, externalId: externalIdFor(draft.dedupSource) };
  });

  return { rows, skipped, errors, categorizedCount };
}

export function toImportRows(rows: PreparedRow[]): ImportRow[] {
  return rows.map((row) => ({
    externalId: row.externalId,
    date: row.date,
    description: row.description,
    amountCents: row.amountCents,
    type: row.type,
    categoryId: row.categoryId,
    installmentNum: row.installmentNum,
    installmentTotal: row.installmentTotal,
  }));
}
