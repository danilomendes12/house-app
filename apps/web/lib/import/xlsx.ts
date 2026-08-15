/**
 * Minimal XLSX reader: workbook bytes → delimited text (SPEC §7.1).
 *
 * The XP "posição detalhada" export is a spreadsheet, not a CSV, so something has to open the
 * container before `parseXpPosition` can read the tables inside it. This file does only that:
 * it changes the container and keeps every cell as the text the sheet shows, so the business
 * rules stay in one place instead of being split between two parsers.
 *
 * It lives in `apps/web` rather than in `packages/shared` because an .xlsx is a ZIP of XML
 * parts and inflating it needs `node:zlib`, which that package must stay free of (CLAUDE.md) —
 * the same split as `external-id.ts`. Written by hand for the same reason `csv.ts` was: one
 * spreadsheet shape does not justify a dependency that reads every shape.
 *
 * Deliberately *not* marked `server-only`: it is a pure function over bytes with no access to
 * the request, and the marker would make it untestable under vitest. Importing `node:zlib`
 * already keeps it out of any client bundle.
 */

import { inflateRawSync } from 'node:zlib';
import { isoDateAt, toIsoDate, type IsoDate } from '@finance/shared';

export class XlsxFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XlsxFormatError';
  }
}

export interface XlsxText {
  /** Every sheet, in workbook order, as one CSV document. */
  text: string;
  /**
   * When the workbook was written, as a calendar date in the app timezone. XP's export states
   * no reference date anywhere in the sheet, and this is the closest thing the file has to one.
   */
  exportedOn: IsoDate | null;
}

/** ZIP local file header — every .xlsx starts with it, whatever the extension says. */
export function isXlsx(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * Reads a workbook into CSV text.
 *
 * Cells are emitted as the string the sheet displays, because that is what the position parser
 * already knows how to read: `"R$ 1.234,56"` goes to `parseCents`, `"15/08/2026"` to
 * `parseXpDate`. The one conversion done here is the one that cannot be done later — an Excel
 * date serial is a bare number by the time it reaches text, so date-formatted cells are
 * rendered as `DD/MM/YYYY` while they still carry their format.
 *
 * @throws {XlsxFormatError} when the container is not a readable workbook.
 */
export function xlsxToDelimitedText(bytes: Uint8Array): XlsxText {
  const entries = readZipEntries(bytes);

  const sharedStrings = readSharedStrings(entries);
  const dateStyles = readDateStyles(entries);

  const rows: string[][] = [];
  for (const path of sheetPaths(entries)) {
    const xml = readTextEntry(entries, path);
    if (xml !== null) rows.push(...readSheet(xml, sharedStrings, dateStyles));
  }

  if (rows.length === 0) throw new XlsxFormatError('A planilha está vazia.');

  return { text: toCsv(rows), exportedOn: readCreatedDate(entries) };
}

// ---------------------------------------------------------------------------- zip container

/**
 * Unpacks the archive via its central directory rather than by walking local headers: a local
 * header may declare zero sizes and defer them to a data descriptor, while the central
 * directory always has the real ones.
 */
function readZipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  if (!isXlsx(bytes)) throw new XlsxFormatError('O arquivo não é uma planilha .xlsx.');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEndOfCentralDirectory(view);
  const count = view.getUint16(endOffset + 10, true);

  let offset = view.getUint32(endOffset + 16, true);
  if (offset === 0xffff_ffff) throw new XlsxFormatError('Planilha em formato ZIP64.');

  const entries = new Map<string, Uint8Array>();

  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x0201_4b50) {
      throw new XlsxFormatError('Arquivo .xlsx corrompido (diretório central).');
    }

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);

    const name = decodeUtf8(bytes.subarray(offset + 46, offset + 46 + nameLength));
    entries.set(name, readEntryData(bytes, view, localOffset, method, compressedSize));

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(view: DataView): number {
  // The record is 22 bytes plus a comment of at most 64 KiB, so it lives near the end.
  const lowest = Math.max(0, view.byteLength - 22 - 0xffff);

  for (let offset = view.byteLength - 22; offset >= lowest; offset -= 1) {
    if (view.getUint32(offset, true) === 0x0605_4b50) return offset;
  }

  throw new XlsxFormatError('Arquivo .xlsx corrompido (fim do diretório).');
}

function readEntryData(
  bytes: Uint8Array,
  view: DataView,
  localOffset: number,
  method: number,
  compressedSize: number,
): Uint8Array {
  if (view.getUint32(localOffset, true) !== 0x0403_4b50) {
    throw new XlsxFormatError('Arquivo .xlsx corrompido (cabeçalho local).');
  }

  const nameLength = view.getUint16(localOffset + 26, true);
  const extraLength = view.getUint16(localOffset + 28, true);
  const start = localOffset + 30 + nameLength + extraLength;
  const raw = bytes.subarray(start, start + compressedSize);

  if (method === 0) return raw;
  if (method !== 8) throw new XlsxFormatError(`Compressão .xlsx não suportada (${method}).`);

  try {
    return inflateRawSync(raw);
  } catch {
    throw new XlsxFormatError('Não foi possível descompactar a planilha.');
  }
}

function readTextEntry(entries: Map<string, Uint8Array>, path: string): string | null {
  const data = entries.get(path);
  return data === undefined ? null : decodeUtf8(data);
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

// ------------------------------------------------------------------------------- xml parts

/**
 * Sheets in workbook order, resolved through the relationship ids — the order in
 * `workbook.xml` is the order the user sees, which `sheet1.xml, sheet2.xml…` need not match.
 */
function sheetPaths(entries: Map<string, Uint8Array>): string[] {
  const workbook = readTextEntry(entries, 'xl/workbook.xml');
  const rels = readTextEntry(entries, 'xl/_rels/workbook.xml.rels');

  if (workbook !== null && rels !== null) {
    const targets = new Map<string, string>();
    for (const match of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const id = attribute(match[1] as string, 'Id');
      const target = attribute(match[1] as string, 'Target');
      if (id && target) targets.set(id, resolveTarget(target));
    }

    const paths = [...workbook.matchAll(/<sheet\b([^>]*)\/?>/g)]
      .map((match) => attribute(match[1] as string, 'r:id'))
      .map((id) => (id === null ? undefined : targets.get(id)))
      .filter((path): path is string => path !== undefined && entries.has(path));

    if (paths.length > 0) return paths;
  }

  // Malformed relationships should not cost the whole import: read whatever sheets exist.
  return [...entries.keys()].filter((path) => path.startsWith('xl/worksheets/')).sort();
}

function resolveTarget(target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  return target.startsWith('xl/') ? target : `xl/${target.replace(/^\.\//, '')}`;
}

/**
 * The shared string table. Every text cell in the XP export is an index into it, and a single
 * string may be split across styled runs, so all the `<t>` of an `<si>` are concatenated.
 */
function readSharedStrings(entries: Map<string, Uint8Array>): string[] {
  const xml = readTextEntry(entries, 'xl/sharedStrings.xml');
  if (xml === null) return [];

  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    textOf(match[1] as string),
  );
}

/**
 * Which cell styles mean "this number is a date".
 *
 * `s="12"` on a cell indexes `cellXfs`, whose `numFmtId` is either one of Excel's built-in
 * formats or a custom one declared in the same file.
 */
function readDateStyles(entries: Map<string, Uint8Array>): Set<number> {
  const xml = readTextEntry(entries, 'xl/styles.xml');
  if (xml === null) return new Set();

  const customDateFormats = new Set<number>();
  for (const match of xml.matchAll(/<numFmt\b([^>]*)\/?>/g)) {
    const id = Number(attribute(match[1] as string, 'numFmtId') ?? NaN);
    const code = attribute(match[1] as string, 'formatCode') ?? '';
    if (Number.isFinite(id) && isDateFormatCode(code)) customDateFormats.add(id);
  }

  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? '';
  const dateStyles = new Set<number>();

  for (const [index, match] of [...cellXfs.matchAll(/<xf\b([^>]*?)(?:\/>|>)/g)].entries()) {
    const id = Number(attribute(match[1] as string, 'numFmtId') ?? 0);
    if (BUILTIN_DATE_FORMATS.has(id) || customDateFormats.has(id)) dateStyles.add(index);
  }

  return dateStyles;
}

/** Excel's built-in date and date-time formats. */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** A format is a date format when it positions day/month/year fields; `#,##0.00` does not. */
function isDateFormatCode(code: string): boolean {
  return /[dmy]/i.test(code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, ''));
}

/**
 * Reads one sheet into rows of cell text.
 *
 * Cells are placed by the column in their reference (`r="D7"`), never by their order in the
 * XML: a row omits empty cells, so appending would slide every value one column left and hand
 * the parser a product name where it expects a price.
 */
function readSheet(xml: string, sharedStrings: string[], dateStyles: Set<number>): string[][] {
  const rows: string[][] = [];

  for (const rowMatch of xml.matchAll(/<row\b[^>]*(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const body = rowMatch[1];
    if (body === undefined) continue;

    const cells: string[] = [];
    let nextColumn = 0;

    for (const cellMatch of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cellMatch[1] as string;
      const reference = attribute(attributes, 'r');
      const column = reference === null ? nextColumn : columnIndex(reference);

      while (cells.length < column) cells.push('');
      cells[column] = cellText(attributes, cellMatch[2] ?? '', sharedStrings, dateStyles);
      nextColumn = column + 1;
    }

    if (cells.some((cell) => cell.trim() !== '')) rows.push(cells);
  }

  return rows;
}

function cellText(
  attributes: string,
  body: string,
  sharedStrings: string[],
  dateStyles: Set<number>,
): string {
  const type = attribute(attributes, 't') ?? 'n';
  const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];

  switch (type) {
    case 's':
      return sharedStrings[Number(value ?? -1)] ?? '';
    case 'inlineStr':
      return textOf(body);
    case 'str':
      return decodeEntities(value ?? '');
    case 'e':
      // A formula error (#N/A) has no value to import; an empty cell is the honest reading.
      return '';
    default:
      break;
  }

  if (value === undefined) return '';

  const style = Number(attribute(attributes, 's') ?? -1);
  const serial = Number(value);
  if (dateStyles.has(style) && Number.isFinite(serial)) return formatSerialDate(serial);

  return value;
}

/**
 * Excel serial → `DD/MM/YYYY`, the shape `parseXpDate` reads.
 *
 * Day 1 is 1900-01-01 counted from an epoch of 1899-12-30, which absorbs the phantom
 * 1900-02-29 that Excel keeps for Lotus compatibility.
 */
function formatSerialDate(serial: number): string {
  const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
  if (Number.isNaN(date.getTime())) return String(serial);

  const iso = toIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** `"C7"` → `2`. */
function columnIndex(reference: string): number {
  let index = 0;
  for (const char of reference) {
    const code = char.charCodeAt(0);
    if (code < 65 || code > 90) break;
    index = index * 26 + (code - 64);
  }
  return Math.max(0, index - 1);
}

function readCreatedDate(entries: Map<string, Uint8Array>): IsoDate | null {
  const xml = readTextEntry(entries, 'docProps/core.xml');
  const created = xml === null ? null : /<dcterms:created[^>]*>([^<]+)</.exec(xml)?.[1];
  if (!created) return null;

  const instant = new Date(created);
  return Number.isNaN(instant.getTime()) ? null : isoDateAt(instant);
}

/** All the text of an element, ignoring phonetic runs Excel may attach to it. */
function textOf(xml: string): string {
  const withoutPhonetics = xml.replace(/<rPh[\s\S]*?<\/rPh>/g, '');
  return [...withoutPhonetics.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
    .map((match) => decodeEntities(match[1] as string))
    .join('');
}

function attribute(attributes: string, name: string): string | null {
  const match = new RegExp(`\\b${name.replace(':', '\\:')}="([^"]*)"`).exec(attributes);
  return match ? decodeEntities(match[1] as string) : null;
}

function decodeEntities(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi,
    (match, dec, hex, name) => {
      if (dec) return String.fromCodePoint(Number(dec));
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));

      switch (String(name).toLowerCase()) {
        case 'amp':
          return '&';
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'quot':
          return '"';
        case 'apos':
          return "'";
        default:
          return match;
      }
    },
  );
}

/**
 * RFC 4180 text, which `parseDelimited` reads back without loss — including the commas and
 * line breaks a cell may contain, since both survive inside a quoted field.
 */
function toCsv(rows: string[][]): string {
  return rows.map((cells) => cells.map(escapeCsv).join(',')).join('\n');
}

function escapeCsv(cell: string): string {
  return /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}
