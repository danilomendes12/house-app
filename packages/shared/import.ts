/**
 * Credit-card statement CSV → transaction drafts (SPEC §7).
 *
 * Pure and runtime-free: this module turns file text into drafts and produces the *string*
 * each row's dedup key is derived from. The sha256 itself is computed by the caller with
 * `node:crypto`, because `packages/shared` is imported by client components (CLAUDE.md).
 *
 * Nothing here touches the database — the drafts are shown as a preview before a single
 * row is written, which is what makes re-importing safe to try.
 */

import { parseDelimited, normalizeText } from './csv';
import { isIsoDate, toIsoDate, type IsoDate } from './date';
import { ZERO_CENTS, parseCentsOrNull, toDecimalString, type Cents } from './money';
import type { TransactionType } from './budget';

/** Header aliases, normalized by {@link normalizeText}. Nubank's export plus pt-BR variants. */
const HEADER_ALIASES = {
  date: ['date', 'data'],
  title: ['title', 'titulo', 'descricao', 'description', 'estabelecimento', 'lancamento'],
  amount: ['amount', 'valor', 'value'],
} as const;

type Column = keyof typeof HEADER_ALIASES;

/**
 * Invoice payments are internal transfers, not spending (SPEC §6.1). Importing them would
 * book the whole month twice — once as purchases, once as the payment that settles them.
 */
const INVOICE_PAYMENT_RE = /^pagamento(\s+(recebido|efetuado|em)\b.*)?$/;

/** `"Loja - Parcela 3/10"` / `"Loja - 3/10"` — the suffix is stripped from the description. */
const INSTALMENT_RE = /\s*[-–—]\s*(?:parcela\s*)?(\d{1,2})\s*\/\s*(\d{1,2})\s*$/i;

export interface ImportedTransaction {
  /** 1-based line number in the source file, for the preview table. */
  line: number;
  date: IsoDate;
  /** Instalment suffix removed; otherwise the title as written. */
  description: string;
  /** Always positive — direction lives in {@link type} (SPEC §6.1). */
  amountCents: Cents;
  type: TransactionType;
  installmentNum: number | null;
  installmentTotal: number | null;
  /**
   * The exact string to sha256 into `transactions.external_id`. Stable across imports of
   * the same file and, by construction, distinct for legitimately identical rows.
   */
  dedupSource: string;
}

export type SkipReason = 'invoice-payment' | 'zero-amount';

export interface SkippedRow {
  line: number;
  title: string;
  reason: SkipReason;
}

export interface RowError {
  line: number;
  message: string;
  /** The raw cells, so the preview can show the user which line to fix. */
  cells: string[];
}

export interface ParsedStatement {
  transactions: ImportedTransaction[];
  /** Rows deliberately not imported (invoice payments, zero amounts). */
  skipped: SkippedRow[];
  /** Rows that could not be read. Everything else still imports. */
  errors: RowError[];
}

export class StatementFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StatementFormatError';
  }
}

/**
 * Parses statement text into drafts.
 *
 * Row-level problems are collected in `errors` rather than thrown: one unreadable line out
 * of two hundred should not cost the user the whole import. A missing or unrecognizable
 * header, on the other hand, means the wrong file was picked — that throws.
 *
 * @throws {StatementFormatError} when the required columns cannot be located.
 */
export function parseStatement(text: string): ParsedStatement {
  const rows = parseDelimited(text);
  if (rows.length === 0) throw new StatementFormatError('O arquivo está vazio.');

  const columns = mapHeader(rows[0] as string[]);

  const transactions: ImportedTransaction[] = [];
  const skipped: SkippedRow[] = [];
  const errors: RowError[] = [];

  // Occurrence counter per identical (date, title, amount) triple — the last component of
  // the dedup key. Two genuinely identical purchases on the same day get 0 and 1 and both
  // survive; re-importing the file recomputes the same pair (SPEC §7).
  const occurrences = new Map<string, number>();

  for (let index = 1; index < rows.length; index += 1) {
    const cells = rows[index] as string[];
    const line = index + 1;

    const rawDate = (cells[columns.date] ?? '').trim();
    const rawTitle = (cells[columns.title] ?? '').trim();
    const rawAmount = (cells[columns.amount] ?? '').trim();

    const date = parseStatementDate(rawDate);
    if (date === null) {
      errors.push({ line, message: `Data inválida: ${rawDate || '(vazia)'}`, cells });
      continue;
    }

    if (rawTitle === '') {
      errors.push({ line, message: 'Descrição vazia.', cells });
      continue;
    }

    // Checked before the amount: a payment line is discarded whatever it holds, and
    // reporting it as a broken row would be noise the user has to dismiss every import.
    if (isInvoicePayment(rawTitle)) {
      skipped.push({ line, title: rawTitle, reason: 'invoice-payment' });
      continue;
    }

    const signedCents = parseCentsOrNull(rawAmount);
    if (signedCents === null) {
      errors.push({ line, message: `Valor inválido: ${rawAmount || '(vazio)'}`, cells });
      continue;
    }

    if (signedCents === ZERO_CENTS) {
      skipped.push({ line, title: rawTitle, reason: 'zero-amount' });
      continue;
    }

    // On a statement a positive amount is a purchase and a negative one is a refund; the
    // model stores a positive amount plus a direction (SPEC §7).
    const isExpense = signedCents > ZERO_CENTS;
    const { description, installmentNum, installmentTotal } = splitInstalment(rawTitle);

    const identity = `${date}|${normalizeText(rawTitle)}|${toDecimalString(signedCents)}`;
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);

    transactions.push({
      line,
      date,
      description,
      amountCents: isExpense ? signedCents : -signedCents,
      type: isExpense ? 'expense' : 'income',
      installmentNum,
      installmentTotal,
      dedupSource: `${identity}|${occurrence}`,
    });
  }

  return { transactions, skipped, errors };
}

/** `YYYY-MM-DD` or `DD/MM/YYYY` (SPEC §7). Returns `null` on anything else. */
export function parseStatementDate(value: string): IsoDate | null {
  const trimmed = value.trim();

  if (isIsoDate(trimmed)) return trimmed;

  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (!match) return null;

  const candidate = toIsoDate(Number(match[3]), Number(match[2]), Number(match[1]));
  return isIsoDate(candidate) ? candidate : null;
}

export function isInvoicePayment(title: string): boolean {
  return INVOICE_PAYMENT_RE.test(normalizeText(title));
}

/**
 * Pulls `3/10` off the end of a title. Each instalment is its own transaction on the date
 * of the statement it falls into (SPEC §12), so this only records which one it is.
 */
export function splitInstalment(title: string): {
  description: string;
  installmentNum: number | null;
  installmentTotal: number | null;
} {
  const match = INSTALMENT_RE.exec(title);
  if (!match) return { description: title.trim(), installmentNum: null, installmentTotal: null };

  const installmentNum = Number(match[1]);
  const installmentTotal = Number(match[2]);

  // `1/2` at the end of a title that is not an instalment (a date, a fraction) would fail
  // this; so would a malformed `0/3`. Keep the title whole when the pair makes no sense.
  if (installmentNum < 1 || installmentTotal < 1 || installmentNum > installmentTotal) {
    return { description: title.trim(), installmentNum: null, installmentTotal: null };
  }

  return {
    description: title.slice(0, match.index).trim() || title.trim(),
    installmentNum,
    installmentTotal,
  };
}

function mapHeader(header: string[]): Record<Column, number> {
  const normalized = header.map(normalizeText);
  const columns: Partial<Record<Column, number>> = {};

  for (const [column, aliases] of Object.entries(HEADER_ALIASES) as [Column, readonly string[]][]) {
    const index = normalized.findIndex((cell) => aliases.includes(cell));
    if (index >= 0) columns[column] = index;
  }

  const missing = (Object.keys(HEADER_ALIASES) as Column[]).filter(
    (column) => columns[column] === undefined,
  );

  if (missing.length > 0) {
    throw new StatementFormatError(
      `Não encontrei as colunas ${missing.join(', ')} no cabeçalho. ` +
        'Esperado: date,title,amount (ou data,título,valor).',
    );
  }

  return columns as Record<Column, number>;
}
