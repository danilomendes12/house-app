/**
 * XP "posição consolidada/detalhada" → asset snapshots (SPEC §7.1).
 *
 * Pure and runtime-free, like `import.ts`: this turns file text into drafts, and the caller
 * decides what to create and what to update. Nothing here touches the database — the drafts
 * are shown as a preview before a single row is written. A spreadsheet export is converted to
 * delimited text before it gets here (`lib/import/xlsx.ts`), so this file reads one shape.
 *
 * Three things make it different from the statement importer:
 *
 *   1. **A position file is a photograph, not a ledger.** Every row is "what this is worth
 *      today", so a row becomes an `asset_snapshots` value, never an `asset_events` one.
 *      The detailed export does state how much was put in, and that is read into
 *      `appliedValueCents` for the preview — but it stays out of the database, because
 *      turning it into contributions would double-count against the aportes the user already
 *      entered by hand and corrupt the yield calculation (SPEC §6.2).
 *   2. **One file holds several tables.** XP exports tesouro, renda fixa and renda variável as
 *      separate sections, each with its own header and a title line in between. So the parser
 *      re-reads the header whenever it meets one instead of assuming row 1 describes the file.
 *   3. **Not every table is a position.** The same file also lists provisioned dividends, which
 *      are money not yet paid on an asset already counted — importing them would invent an
 *      asset and inflate net worth. Those tables are recognized and skipped, and what was
 *      skipped is reported in `notes` rather than dropped in silence.
 */

import { parseDelimited, normalizeText } from './csv';
import { isIsoDate, toIsoDate, type IsoDate } from './date';
import { ZERO_CENTS, parseCentsOrNull, type Cents } from './money';
import { ASSET_INDEXERS, type AssetIndexer, type AssetType } from './assets';

/**
 * Header aliases, normalized by {@link normalizeText}. Matching is by *prefix* on the
 * normalized cell, because XP suffixes units and qualifiers onto labels ("Valor bruto (R$)",
 * "Posição a mercado").
 *
 * `product` and `grossValue` are required; the rest enrich the asset when present. Within
 * `grossValue` the order is a preference order — gross before net, since SPEC §6.2 defines a
 * snapshot as the gross value, and the detailed export offers both ("Posição a mercado" next
 * to "Valor Líquido", which is already net of income tax).
 */
const HEADER_ALIASES = {
  product: [
    'produto',
    'ativo',
    'papel',
    'ticker',
    'nome do fundo',
    'fundo',
    'descricao',
    'especificacao',
  ],
  grossValue: [
    'valor bruto',
    'saldo bruto',
    'posicao',
    'valor atual',
    'valor de mercado',
    'financeiro',
    'saldo',
    'valor liquido',
  ],
  appliedValue: ['total aplicado', 'valor aplicado'],
  institution: ['instituicao', 'emissor', 'custodiante', 'corretora'],
  indexer: ['indexador', 'index'],
  rate: ['taxa', 'rentabilidade contratada', 'juros'],
  maturity: ['vencimento', 'data de vencimento', 'data vencimento'],
} as const;

type Column = keyof typeof HEADER_ALIASES;

const REQUIRED_COLUMNS: readonly Column[] = ['product', 'grossValue'];

/**
 * Tables XP prints alongside the positions that are *not* positions. Matched on the header,
 * because that is what states what the numbers mean: a "Valor provisionado bruto" column is a
 * dividend that has not been paid yet, on shares whose market value is already in the file.
 */
const NON_POSITION_COLUMNS: readonly string[] = [
  'provisionado',
  'valor provisionado',
  'previsao pagamento',
];

/** Where the money sits in one of those tables, so the preview can say what it skipped. */
const NON_POSITION_VALUE_COLUMNS: readonly string[] = [
  'valor provisionado bruto',
  'valor provisionado',
  'provisionado',
];

/**
 * The first cell of every table header in the detailed export: `"22,7% | Prefixado"` — the
 * share of the portfolio and the sub-class, where a plain export writes "Produto".
 *
 * It is what makes the header recognizable in a file that never names its product column, and
 * the label it carries is the only statement of whether a bond is indexed to inflation, to the
 * CDI or fixed — the rows themselves do not say.
 */
const ALLOCATION_HEADER_RE = /^\d{1,3}(?:[.,]\d+)?\s*%\s*\|\s*(.+)$/;

/** "Posição em 31/07/2026", "Data base: 31/07/2026" — the date the photograph was taken. */
const REFERENCE_DATE_RE =
  /(?:posicao|data\s*(?:base|de\s*referencia|da\s*posicao))\s*(?:em|:)?\s*(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})/;

/**
 * Figures the export prints in the summary block above the tables. Only ever looked for in
 * that preamble: "Total aplicado" is also a *column* inside the tesouro table, and reading a
 * summary label off a table header would report one bond's cost as the portfolio total.
 */
const STATED_TOTAL_LABELS: readonly string[] = ['total investido', 'total da carteira'];
const CASH_BALANCE_LABELS: readonly string[] = ['saldo disponivel', 'saldo em conta'];

/** Tickers ending in 11 are FIIs *or* ETFs; the common ETFs are few enough to just name. */
const KNOWN_ETF_TICKERS = new Set([
  'bova11',
  'ivvb11',
  'smal11',
  'hash11',
  'xina11',
  'spxi11',
  'boví11',
  'divo11',
  'goll11',
]);

export interface XpPosition {
  /** 1-based line number in the source file, for the preview table. */
  line: number;
  /** Product name as written, whitespace collapsed. */
  name: string;
  /** Guessed from the name — the preview shows it and `/assets` can correct it. */
  type: AssetType;
  institution: string | null;
  indexer: AssetIndexer | null;
  rate: number | null;
  maturityDate: IsoDate | null;
  /** The snapshot value (SPEC §6.2): what the broker says it is worth. */
  grossValueCents: Cents;
  /**
   * What the export says was put in ("Total aplicado"), when it says. Shown in the preview so
   * the number is not lost from view, and deliberately **not** written as an `asset_event`:
   * aportes are entered by hand, and importing them too would count every contribution twice.
   */
  appliedValueCents: Cents | null;
  /**
   * Stable identity for this product, used to match an asset across imports so a second
   * file updates the asset instead of creating a twin. Written to `assets.external_ref`.
   */
  externalRef: string;
}

export interface XpRowError {
  line: number;
  message: string;
  cells: string[];
}

/** Something the file states that the import deliberately does not write. */
export interface XpNote {
  line: number;
  message: string;
  /** The money involved, so the preview can reconcile against the file's own total. */
  amountCents: Cents;
}

export interface ParsedXpPosition {
  positions: XpPosition[];
  errors: XpRowError[];
  notes: XpNote[];
  /** Date read from the file's preamble, when it has one. The UI defaults to today. */
  referenceDate: IsoDate | null;
  /**
   * The portfolio total the file prints for itself ("Total investido"). The preview checks the
   * imported sum against it: a gap that {@link skippedCents} does not explain means a table
   * was missed, which is the one failure a position import must never hide.
   */
  statedTotalCents: Cents | null;
  /**
   * Money the file's tables hold that is deliberately not imported — the provisioned
   * dividends. Counted towards the stated total, because XP counts it there too.
   */
  skippedCents: Cents;
}

export class XpPositionFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XpPositionFormatError';
  }
}

/** A table header, and what the rows under it mean. */
interface PositionTable {
  columns: Partial<Record<Column, number>>;
  /** Filled cells in the header row — see {@link isSectionTitleRow}. */
  width: number;
  /** Label after the `%` marker ("Pós-Fixado"), which indexes every row of the table. */
  subclass: string | null;
}

interface SkippedTable {
  line: number;
  label: string;
  valueColumn: number | null;
  width: number;
  rows: number;
  totalCents: Cents;
}

type HeaderMatch =
  | { kind: 'position'; table: PositionTable }
  | { kind: 'skip'; label: string; valueColumn: number | null; width: number };

/**
 * Parses a position export into snapshot drafts.
 *
 * Row-level problems land in `errors` rather than throwing — one unreadable line should not
 * cost the whole import. Not finding a single usable header, on the other hand, means the
 * wrong file was picked, and that throws with the headers it *did* see, which is the only
 * useful thing to say when a broker changes its export.
 *
 * @throws {XpPositionFormatError} when no section header can be located.
 */
export function parseXpPosition(text: string): ParsedXpPosition {
  if (text.trim() === '') throw new XpPositionFormatError('O arquivo está vazio.');

  // The delimiter cannot be sniffed from line 1 the way a statement's can: an XP export
  // opens with prose ("Posição consolidada", the account number), so the first line usually
  // contains no delimiter at all. Instead, try each candidate and keep the one that yields a
  // header — being able to read the file is the only definition of "right delimiter" here.
  let rows: string[][] = [];

  for (const delimiter of [',', ';', '\t']) {
    const candidate = parseDelimited(text, delimiter);
    if (candidate.some((cells) => readHeader(cells)?.kind === 'position')) {
      rows = candidate;
      break;
    }
  }

  if (rows.length === 0) {
    throw new XpPositionFormatError(
      'Não reconheci o cabeçalho deste arquivo. Esperado ao menos uma coluna de produto ' +
        '(produto, ativo, papel…) e uma de valor (valor bruto, saldo bruto, posição…). ' +
        `Colunas encontradas: ${describeColumns(parseDelimited(text))}.`,
    );
  }

  const positions: XpPosition[] = [];
  const errors: XpRowError[] = [];
  const skipped: SkippedTable[] = [];

  let table: PositionTable | null = null;
  let skipping: SkippedTable | null = null;
  let preambleEnd = rows.length;
  const seenRefs = new Map<string, number>();

  for (const [index, cells] of rows.entries()) {
    const line = index + 1;

    // A header can appear anywhere: each product class is its own table in the same file.
    const header = readHeader(cells);
    if (header) {
      preambleEnd = Math.min(preambleEnd, index);

      if (header.kind === 'position') {
        table = header.table;
        skipping = null;
      } else {
        // Whatever follows belongs to a table we do not import, so the previous mapping must
        // stop applying: reading dividend rows with the last position header is how a
        // "quantity" column silently becomes somebody's net worth.
        table = null;
        skipping = {
          line,
          label: header.label,
          valueColumn: header.valueColumn,
          width: header.width,
          rows: 0,
          totalCents: ZERO_CENTS,
        };
        skipped.push(skipping);
      }
      continue;
    }

    if (skipping) {
      tallySkippedRow(skipping, cells);
      continue;
    }

    // Everything before the first header is preamble ("Posição em ...", account number).
    if (!table) continue;

    const { columns } = table;
    const name = collapse(cells[columns.product as number] ?? '');
    const rawValue = (cells[columns.grossValue as number] ?? '').trim();

    // Section titles and totals: a row with a name and no value, or a value and no name, is
    // structure rather than a position. Reporting them would make the user dismiss the same
    // noise on every import.
    if (name === '' || rawValue === '') continue;
    if (isTotalRow(name)) continue;
    if (isSectionTitleRow(cells, table.width)) continue;

    const grossValueCents = parseCentsOrNull(rawValue);
    if (grossValueCents === null) {
      errors.push({ line, message: `Valor inválido: ${rawValue}`, cells });
      continue;
    }

    if (grossValueCents < ZERO_CENTS) {
      errors.push({ line, message: `Valor negativo: ${rawValue}`, cells });
      continue;
    }

    const institution = optional(cells, columns.institution) ?? null;
    const appliedValueCents = parseCentsOrNull(optional(cells, columns.appliedValue) ?? '');

    // The same product can be listed twice (two purchases of one bond, each its own row with
    // its own application date). They are one asset worth the sum, not two — the file already
    // aggregated everything else.
    const externalRef = positionKey(name, institution);
    const existing = seenRefs.get(externalRef);
    if (existing !== undefined) {
      const previous = positions[existing] as XpPosition;
      positions[existing] = {
        ...previous,
        grossValueCents: previous.grossValueCents + grossValueCents,
        appliedValueCents: addOptionalCents(previous.appliedValueCents, appliedValueCents),
      };
      continue;
    }

    const type = inferAssetType(name);

    seenRefs.set(externalRef, positions.length);
    positions.push({
      line,
      name,
      type,
      institution,
      indexer:
        parseIndexer(optional(cells, columns.indexer)) ??
        parseIndexer(optional(cells, columns.rate)) ??
        indexerFromSubclass(table.subclass, type),
      rate: parseRate(optional(cells, columns.rate)),
      maturityDate: parseXpDate(optional(cells, columns.maturity) ?? ''),
      grossValueCents,
      appliedValueCents,
      externalRef,
    });
  }

  const preamble = rows.slice(0, preambleEnd);

  return {
    positions,
    errors,
    notes: buildNotes(preamble, skipped),
    referenceDate: findReferenceDate(text),
    statedTotalCents: findSummaryValue(preamble, STATED_TOTAL_LABELS),
    skippedCents: skipped.reduce((total, section) => total + section.totalCents, ZERO_CENTS),
  };
}

/**
 * The stable identity of a position across imports (`assets.external_ref`).
 *
 * Normalized so that casing and spacing drift in the export does not create a twin asset,
 * and scoped by institution because "CDB 110% CDI" from two banks are two different things.
 */
export function positionKey(name: string, institution: string | null): string {
  const normalizedName = normalizeText(name);
  const normalizedInstitution = normalizeText(institution ?? '');
  return normalizedInstitution === ''
    ? `xp:${normalizedName}`
    : `xp:${normalizedInstitution}:${normalizedName}`;
}

/**
 * Guesses the asset type from the product name (SPEC §6.2 enum).
 *
 * A guess is enough: the preview shows it and `/assets` edits it. Getting it roughly right
 * beats dumping everything into "outro" and making the user retype thirty products.
 */
export function inferAssetType(name: string): AssetType {
  const value = normalizeText(name);
  const ticker = /^([a-z]{4}\d{1,2})\b/.exec(value)?.[1];

  if (/\b(lci|lca)\b/.test(value)) return 'lci_lca';
  if (/\bcdb\b/.test(value)) return 'cdb';
  if (/\b(tesouro|ltn|ntn|lft)\b/.test(value)) return 'tesouro';
  if (/\bpoupanca\b/.test(value)) return 'poupanca';
  if (/\b(bitcoin|btc|ethereum|eth|cripto|crypto)\b/.test(value)) return 'cripto';
  if (/\betf\b/.test(value)) return 'etf';
  if (/\b(fii|imobiliario)\b/.test(value)) return 'fii';

  if (ticker) {
    if (KNOWN_ETF_TICKERS.has(ticker)) return 'etf';
    if (ticker.endsWith('11')) return 'fii';
    if (/[3456]$/.test(ticker)) return 'acao';
  }

  // Checked last: "fundo" appears inside "fundo imobiliário" and inside fund names that are
  // really something else, so the specific patterns above get first refusal.
  if (/\b(fundo|fic|fim|fia|fidc)\b/.test(value)) return 'fundo';

  return 'outro';
}

/** `DD/MM/YYYY` or `YYYY-MM-DD`, the two shapes XP mixes. `null` on anything else. */
export function parseXpDate(value: string): IsoDate | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (isIsoDate(trimmed)) return trimmed;

  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (!match) return null;

  const candidate = toIsoDate(Number(match[3]), Number(match[2]), Number(match[1]));
  return isIsoDate(candidate) ? candidate : null;
}

/** The date the position refers to, when the file states it. */
export function findReferenceDate(text: string): IsoDate | null {
  const match = REFERENCE_DATE_RE.exec(normalizeText(text));
  return match ? parseXpDate(match[1] as string) : null;
}

/**
 * `"110% do CDI"` → `110`, `"IPCA + 6,2%"` → `6.2`. Documentation only: nothing is projected
 * from it (SPEC §6.2), so an unreadable rate is simply dropped rather than reported.
 */
function parseRate(value: string | undefined): number | null {
  if (!value) return null;

  const match = /(\d+(?:[.,]\d+)?)/.exec(value);
  if (!match) return null;

  const rate = Number((match[1] as string).replace(',', '.'));
  // Mirrors the assets_rate_sane constraint; out of range means we read the wrong number.
  return Number.isFinite(rate) && rate >= 0 && rate <= 1000 ? rate : null;
}

/**
 * The indexer named in a cell, from either an "Indexador" column or the rate itself
 * ("114,00% CDI", "IPC-A +13,37%").
 *
 * Punctuation is dropped before matching so that XP's "IPC-A" and the enum's "ipca" are the
 * same word.
 */
function parseIndexer(value: string | undefined): AssetIndexer | null {
  if (!value) return null;

  const normalized = normalizeText(value).replace(/[^a-z0-9]/g, '');
  return ASSET_INDEXERS.find((indexer) => normalized.includes(indexer)) ?? null;
}

/**
 * The indexer implied by the table's sub-class, for the rows that carry no rate of their own —
 * in the detailed export, "Prefixado" and "Inflação" are stated once per table and never
 * repeated on the row.
 *
 * "Pós-fixado" means the CDI for bank paper and the Selic for treasury bonds; they track each
 * other closely, and either way this is a guess the preview shows and `/assets` corrects.
 */
function indexerFromSubclass(subclass: string | null, type: AssetType): AssetIndexer | null {
  if (subclass === null) return null;

  const value = normalizeText(subclass).replace(/[^a-z0-9]/g, '');
  if (value.includes('inflacao')) return 'ipca';
  if (value.includes('posfixado')) return type === 'tesouro' ? 'selic' : 'cdi';
  if (value.includes('prefixado')) return 'prefixado';
  return null;
}

/**
 * Reads a row as a table header, or returns `null` when it is not one.
 *
 * A header is recognized either by naming its product column ("Produto", "Ativo"…) or by the
 * allocation marker the detailed export puts in its place. Requiring the columns the import
 * cannot work without keeps a stray line that happens to hold the word "produto" from
 * silently replacing a valid mapping.
 */
function readHeader(cells: string[]): HeaderMatch | null {
  const normalized = cells.map(normalizeText);
  const width = normalized.filter((cell) => cell !== '').length;

  const allocation = ALLOCATION_HEADER_RE.exec(collapse(cells[0] ?? ''));
  const label = allocation?.[1]?.trim() ?? null;

  if (allocation && normalized.some((cell) => matchesAny(cell, NON_POSITION_COLUMNS))) {
    return {
      kind: 'skip',
      label: label ?? 'sem título',
      valueColumn: findColumn(normalized, NON_POSITION_VALUE_COLUMNS),
      width,
    };
  }

  const columns: Partial<Record<Column, number>> = {};
  for (const [column, aliases] of Object.entries(HEADER_ALIASES) as [Column, readonly string[]][]) {
    const index = findColumn(normalized, aliases);
    if (index !== null) columns[column] = index;
  }

  // The allocation marker stands where the product name is; it is only the product column when
  // the header does not name one itself.
  if (allocation && columns.product === undefined) columns.product = 0;

  if (!REQUIRED_COLUMNS.every((column) => columns[column] !== undefined)) {
    // An allocation header without a value column is one of XP's other tables (provisioned
    // dividends, custódia remunerada). Reporting it beats parsing its rows as positions.
    return allocation
      ? { kind: 'skip', label: label ?? 'sem título', valueColumn: null, width }
      : null;
  }

  return { kind: 'position', table: { columns, width, subclass: label } };
}

/**
 * The class titles between tables — `Renda Fixa` on the left, `R$ 61.340,71` in the far right
 * column: the name of an asset class and the sum of the table that follows.
 *
 * They have to go, and not only as noise: that sum is every position of the section added up,
 * so importing the row would create an asset called "Renda Fixa" and count the whole class
 * twice. A row with the name filled and at most one other cell, inside a table four or more
 * columns wide, is the shape a real position never has — every position fills its row.
 */
function isSectionTitleRow(cells: string[], headerWidth: number): boolean {
  if (headerWidth < 4) return false;
  return cells.filter((cell) => cell.trim() !== '').length <= 2;
}

/** Accumulates a row of a table we are not importing, so the preview can account for it. */
function tallySkippedRow(section: SkippedTable, cells: string[]): void {
  if (isSectionTitleRow(cells, section.width)) return;

  const raw = section.valueColumn === null ? '' : (cells[section.valueColumn] ?? '').trim();
  const cents = raw === '' ? null : parseCentsOrNull(raw);

  section.rows += 1;
  if (cents !== null) section.totalCents += cents;
}

function buildNotes(preamble: string[][], skipped: SkippedTable[]): XpNote[] {
  const notes: XpNote[] = skipped
    .filter((section) => section.rows > 0)
    .map((section) => ({
      line: section.line,
      message:
        `${section.rows === 1 ? '1 linha' : `${section.rows} linhas`} de proventos provisionados ` +
        `(${section.label}) não entram como posição.`,
      amountCents: section.totalCents,
    }));

  const cash = findSummaryValue(preamble, CASH_BALANCE_LABELS);
  if (cash !== null && cash > ZERO_CENTS) {
    notes.push({
      line: 1,
      message: 'Saldo disponível na corretora não entra como ativo.',
      amountCents: cash,
    });
  }

  return notes;
}

/**
 * A figure from the summary block above the tables, addressed by its label.
 *
 * The export writes labels and values as two aligned rows rather than as pairs, so the value
 * is looked for under the label as well as beside it.
 */
function findSummaryValue(rows: string[][], labels: readonly string[]): Cents | null {
  for (const [index, cells] of rows.entries()) {
    for (const [column, cell] of cells.entries()) {
      if (!matchesAny(normalizeText(cell), labels)) continue;

      const candidates = [rows[index + 1]?.[column], cells[column + 1]];
      for (const candidate of candidates) {
        const cents = candidate === undefined ? null : parseCentsOrNull(candidate.trim());
        if (cents !== null && cents > ZERO_CENTS) return cents;
      }
    }
  }

  return null;
}

/** First column whose label matches one of `aliases`, in the aliases' preference order. */
function findColumn(normalized: string[], aliases: readonly string[]): number | null {
  for (const alias of aliases) {
    const index = normalized.findIndex((cell) => cell === alias || cell.startsWith(`${alias} `));
    if (index >= 0) return index;
  }
  return null;
}

function matchesAny(normalized: string, aliases: readonly string[]): boolean {
  return aliases.some((alias) => normalized === alias || normalized.startsWith(`${alias} `));
}

function addOptionalCents(a: Cents | null, b: Cents | null): Cents | null {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
}

function optional(cells: string[], index: number | undefined): string | undefined {
  if (index === undefined) return undefined;
  const value = collapse(cells[index] ?? '');
  return value === '' ? undefined : value;
}

function isTotalRow(name: string): boolean {
  return /^(total|subtotal|saldo total)\b/.test(normalizeText(name));
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Best-effort echo of the file's shape, to make a format error actionable. */
function describeColumns(rows: string[][]): string {
  const widest = rows.reduce(
    (best, row) => (row.filter((cell) => cell.trim() !== '').length > best.length ? row : best),
    [] as string[],
  );

  const labels = widest.map((cell) => collapse(cell)).filter((cell) => cell !== '');
  return labels.length > 0 ? labels.join(', ') : '(nenhuma)';
}
