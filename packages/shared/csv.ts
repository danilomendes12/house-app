/**
 * A small RFC 4180 reader, enough for a bank statement export.
 *
 * Written by hand rather than pulled in as a dependency: this package is imported by
 * client components and must stay free of runtime dependencies (CLAUDE.md), and the file
 * shape we accept is one screen of rules. It handles quoted fields, doubled quotes,
 * embedded delimiters and newlines, CRLF, and a UTF-8 BOM.
 */

/** Delimiters we sniff for, in preference order. pt-BR exports often use `;`. */
const CANDIDATE_DELIMITERS = [',', ';', '\t'] as const;

export type Delimiter = (typeof CANDIDATE_DELIMITERS)[number];

/**
 * Picks the delimiter by counting occurrences outside quotes in the header line. Ties go
 * to the earlier candidate, so a plain `date,title,amount` header stays a comma file.
 */
export function detectDelimiter(text: string): Delimiter {
  const header = stripBom(text).split(/\r?\n/, 1)[0] ?? '';

  let best: Delimiter = ',';
  let bestCount = 0;

  for (const candidate of CANDIDATE_DELIMITERS) {
    const count = countOutsideQuotes(header, candidate);
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }

  return best;
}

/**
 * Splits delimited text into rows of raw string cells. Cells are returned verbatim except
 * for quote unwrapping — trimming and type coercion are the caller's business.
 *
 * Blank lines are dropped: a trailing newline is normal, and a run of empty cells carries
 * no meaning in a statement.
 */
export function parseDelimited(
  text: string,
  delimiter: string = detectDelimiter(text),
): string[][] {
  const source = stripBom(text);
  const rows: string[][] = [];

  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  const endCell = () => {
    row.push(cell);
    cell = '';
  };

  const endRow = () => {
    endCell();
    if (row.some((value) => value.trim() !== '')) rows.push(row);
    row = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inQuotes) {
      if (char !== '"') {
        cell += char;
      } else if (source[index + 1] === '"') {
        // "" inside a quoted field is a literal quote.
        cell += '"';
        index += 1;
      } else {
        inQuotes = false;
      }
      continue;
    }

    if (char === '"' && cell.trim() === '') {
      // A quote only opens a field at its start; mid-cell it is just a character.
      cell = '';
      inQuotes = true;
    } else if (char === delimiter) {
      endCell();
    } else if (char === '\n') {
      endRow();
    } else if (char !== '\r') {
      cell += char;
    }
  }

  // Whatever is buffered when the text runs out is the last row.
  if (cell !== '' || row.length > 0) endRow();

  return rows;
}

/**
 * Lowercases, strips accents and collapses whitespace — the form header names and matcher
 * comparisons are done in, so `"Título"`, `"titulo"` and `" TITULO "` are one key.
 */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') inQuotes = !inQuotes;
    else if (char === delimiter && !inQuotes) count += 1;
  }

  return count;
}
