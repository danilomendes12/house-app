'use server';

import { revalidatePath } from 'next/cache';
import {
  StatementFormatError,
  formatCents,
  formatIsoDate,
  type TransactionType,
} from '@finance/shared';
import { listCategories } from '@/lib/db/categories';
import { importTransactions } from '@/lib/db/import';
import { prepareImport, toImportRows } from '@/lib/import/prepare';

/** A statement CSV is tens of kilobytes; anything this size is the wrong file. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface PreviewLine {
  line: number;
  date: string;
  description: string;
  /** Pre-formatted — `bigint` never crosses the server/client boundary. */
  amount: string;
  type: TransactionType;
  /** `"3/10"`, or `null` when the purchase is not an instalment. */
  installment: string | null;
  categoryName: string | null;
}

export interface PreviewData {
  fileName: string;
  /** The file text, echoed back so the confirmation re-parses exactly what was approved. */
  text: string;
  lines: PreviewLine[];
  categorizedCount: number;
  skipped: { line: number; title: string; reason: string }[];
  errors: { line: number; message: string }[];
}

export type ImportState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'preview'; preview: PreviewData }
  | { status: 'done'; inserted: number; ignored: number };

const SKIP_LABELS: Record<string, string> = {
  'invoice-payment': 'pagamento de fatura',
  'zero-amount': 'valor zerado',
};

/**
 * Single entry point for the two-step flow, so the screen needs one `useActionState` and
 * the transitions (idle → preview → done) stay in one place.
 */
export async function runImport(previous: ImportState, formData: FormData): Promise<ImportState> {
  return formData.get('intent') === 'confirm'
    ? confirmImport(previous, formData)
    : previewImport(previous, formData);
}

/** Step 1: parse and categorize, write nothing (SPEC §7). */
export async function previewImport(
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { status: 'error', message: 'Escolha o arquivo CSV da fatura.' };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { status: 'error', message: 'Arquivo muito grande (máximo 2 MB).' };
  }

  const text = await file.text();

  try {
    const [prepared, categories] = await Promise.all([prepareImport(text), listCategories()]);
    const categoryById = new Map(categories.map((category) => [category.id, category.name]));

    if (prepared.rows.length === 0 && prepared.errors.length === 0) {
      return { status: 'error', message: 'Nenhum lançamento para importar neste arquivo.' };
    }

    return {
      status: 'preview',
      preview: {
        fileName: file.name,
        text,
        categorizedCount: prepared.categorizedCount,
        lines: prepared.rows.map((row) => ({
          line: row.line,
          date: formatIsoDate(row.date),
          description: row.description,
          amount: formatCents(row.amountCents),
          type: row.type,
          installment:
            row.installmentNum && row.installmentTotal
              ? `${row.installmentNum}/${row.installmentTotal}`
              : null,
          categoryName: row.categoryId ? (categoryById.get(row.categoryId) ?? null) : null,
        })),
        skipped: prepared.skipped.map((row) => ({
          line: row.line,
          title: row.title,
          reason: SKIP_LABELS[row.reason] ?? row.reason,
        })),
        errors: prepared.errors.map(({ line, message }) => ({ line, message })),
      },
    };
  } catch (error) {
    if (error instanceof StatementFormatError) {
      return { status: 'error', message: error.message };
    }

    console.error('[import] preview failed', error);
    return { status: 'error', message: 'Não foi possível ler o arquivo. Tente de novo.' };
  }
}

/**
 * Step 2: write. Re-parses the approved text rather than trusting a payload round-tripped
 * through the browser — the rows are derived server-side both times, so a tampered or
 * stale preview cannot inject anything.
 */
export async function confirmImport(
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const text = String(formData.get('text') ?? '');
  if (text.trim() === '') {
    return { status: 'error', message: 'Nada para importar. Envie o arquivo de novo.' };
  }

  try {
    const prepared = await prepareImport(text);
    const result = await importTransactions(toImportRows(prepared.rows));

    revalidatePath('/', 'layout');
    return { status: 'done', ...result };
  } catch (error) {
    if (error instanceof StatementFormatError) {
      return { status: 'error', message: error.message };
    }

    console.error('[import] confirm failed', error);
    return { status: 'error', message: 'Não foi possível importar. Tente de novo.' };
  }
}
