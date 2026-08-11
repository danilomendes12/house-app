import 'server-only';

import { fromCents, type Cents, type IsoDate, type TransactionType } from '@finance/shared';
import { authedClient } from './client';

export interface ImportRow {
  /** sha256 of the draft's `dedupSource` — see `lib/import/external-id.ts`. */
  externalId: string;
  date: IsoDate;
  description: string;
  amountCents: Cents;
  type: TransactionType;
  categoryId: string | null;
  installmentNum: number | null;
  installmentTotal: number | null;
}

export interface ImportResult {
  inserted: number;
  /** Rows already present from an earlier import of the same file (SPEC §9). */
  ignored: number;
}

/**
 * Writes imported rows, idempotently (SPEC §7).
 *
 * `on conflict (user_id, external_id) do nothing` is what makes re-importing a file safe:
 * the second run inserts nothing and reports every row as ignored. PostgREST returns only
 * the rows it actually wrote, which is where the counts come from.
 *
 * Batched because a year of statements is thousands of rows and PostgREST has a request
 * size limit; the conflict clause makes a partially applied import harmless to retry.
 */
export async function importTransactions(rows: ImportRow[]): Promise<ImportResult> {
  if (rows.length === 0) return { inserted: 0, ignored: 0 };

  const { supabase, userId } = await authedClient();

  // A file can hold the same external_id twice only if the occurrence counter failed;
  // guard anyway, because Postgres rejects a batch that conflicts with itself.
  const unique = [...new Map(rows.map((row) => [row.externalId, row])).values()];

  const payload = unique.map((row) => ({
    user_id: userId,
    external_id: row.externalId,
    date: row.date,
    description: row.description,
    amount_cents: fromCents(row.amountCents),
    type: row.type,
    category_id: row.categoryId,
    installment_num: row.installmentNum,
    installment_total: row.installmentTotal,
    source: 'csv' as const,
  }));

  const BATCH_SIZE = 500;
  let inserted = 0;

  for (let start = 0; start < payload.length; start += BATCH_SIZE) {
    const { data, error } = await supabase
      .from('transactions')
      .upsert(payload.slice(start, start + BATCH_SIZE), {
        onConflict: 'user_id,external_id',
        ignoreDuplicates: true,
      })
      .select('id');

    if (error) throw new Error(`[db] import failed: ${error.message}`, { cause: error });
    inserted += data?.length ?? 0;
  }

  return { inserted, ignored: unique.length - inserted };
}
