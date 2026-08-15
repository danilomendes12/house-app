'use server';

import { revalidatePath } from 'next/cache';
import {
  ASSET_TYPE_LABELS,
  XpPositionFormatError,
  absCents,
  formatCents,
  formatIsoDate,
  isIsoDate,
  parseXpPosition,
  sumCents,
  todayIso,
  type Cents,
  type IsoDate,
} from '@finance/shared';
import { findAssetsByRef, importPositions } from '@/lib/db/assets-import';
import { XlsxFormatError, isXlsx, xlsxToDelimitedText } from '@/lib/import/xlsx';

/** A position export is a few tens of kilobytes; anything this size is the wrong file. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * How far the imported sum may sit from the total the file states before the preview calls it
 * out. XP rounds each section to the cent, so the last cent of a thirty-line portfolio is
 * arithmetic, not a missing asset; a real gap is a whole position.
 */
const RECONCILE_TOLERANCE_CENTS = 100n;

export interface PreviewPosition {
  line: number;
  name: string;
  /** pt-BR label of the guessed type (SPEC §6.2). */
  typeLabel: string;
  institution: string | null;
  /** Pre-formatted — `bigint` never crosses the server/client boundary. */
  value: string;
  /** "Total aplicado" as stated by the file, shown but never written (SPEC §7.1). */
  applied: string | null;
  /** Name of the asset this row will update, or `null` when it creates one. */
  updatesAssetName: string | null;
}

/** Where the snapshot date came from — the preview says which, so a wrong one is visible. */
export type DateSource = 'file' | 'export' | 'field';

/**
 * What the file accounts for and the import does not, so the two can be told apart from a
 * table that went missing.
 */
export interface PositionReconciliation {
  /** The file's own "Total investido". */
  stated: string;
  /** Imported + skipped, which should equal `stated`. */
  accounted: string;
  /** Unexplained difference, or `null` when everything adds up. */
  gap: string | null;
}

export interface PositionPreviewData {
  fileName: string;
  /**
   * The file as delimited text, echoed back so the confirmation re-parses exactly what was
   * approved. A spreadsheet is converted here, once, and travels as its text form.
   */
  text: string;
  /** The snapshot date, already resolved: read from the file or defaulted to today. */
  date: IsoDate;
  dateLabel: string;
  dateSource: DateSource;
  positions: PreviewPosition[];
  createdCount: number;
  total: string;
  /** Rows the file states but the import leaves out, each with the money involved. */
  notes: { message: string; amount: string }[];
  reconciliation: PositionReconciliation | null;
  errors: { line: number; message: string }[];
}

export type PositionImportState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'preview'; preview: PositionPreviewData }
  | { status: 'done'; assetsCreated: number; assetsMatched: number; snapshotsWritten: number };

/**
 * Single entry point for the two-step flow, so the screen needs one `useActionState` and the
 * transitions (idle → preview → done) stay in one place — same shape as the statement import.
 */
export async function runPositionImport(
  previous: PositionImportState,
  formData: FormData,
): Promise<PositionImportState> {
  return formData.get('intent') === 'confirm'
    ? confirmPositionImport(previous, formData)
    : previewPositionImport(previous, formData);
}

/** Step 1: parse and match against existing assets, write nothing (SPEC §7.1). */
async function previewPositionImport(
  _previous: PositionImportState,
  formData: FormData,
): Promise<PositionImportState> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { status: 'error', message: 'Escolha o arquivo da posição (.xlsx ou .csv).' };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { status: 'error', message: 'Arquivo muito grande (máximo 2 MB).' };
  }

  try {
    const { text, exportedOn } = await readPositionFile(file);
    const parsed = parseXpPosition(text);

    if (parsed.positions.length === 0) {
      return { status: 'error', message: 'Nenhuma posição encontrada neste arquivo.' };
    }

    const existing = await findAssetsByRef(
      parsed.positions.map((position) => position.externalRef),
    );
    const { date, source } = resolveDate(formData.get('date'), parsed.referenceDate, exportedOn);

    const positions = parsed.positions.map((position) => ({
      line: position.line,
      name: position.name,
      typeLabel: ASSET_TYPE_LABELS[position.type],
      institution: position.institution,
      value: formatCents(position.grossValueCents),
      applied: position.appliedValueCents === null ? null : formatCents(position.appliedValueCents),
      updatesAssetName: existing.get(position.externalRef) ?? null,
    }));

    const total = sumCents(parsed.positions.map((position) => position.grossValueCents));

    return {
      status: 'preview',
      preview: {
        fileName: file.name,
        text,
        date,
        dateLabel: formatIsoDate(date),
        dateSource: source,
        positions,
        createdCount: positions.filter((position) => position.updatesAssetName === null).length,
        total: formatCents(total),
        notes: parsed.notes.map((note) => ({
          message: note.message,
          amount: formatCents(note.amountCents),
        })),
        reconciliation: reconcile(total, parsed.skippedCents, parsed.statedTotalCents),
        errors: parsed.errors.map(({ line, message }) => ({ line, message })),
      },
    };
  } catch (error) {
    if (error instanceof XpPositionFormatError || error instanceof XlsxFormatError) {
      return { status: 'error', message: error.message };
    }

    console.error('[import/investments] preview failed', error);
    return { status: 'error', message: 'Não foi possível ler o arquivo. Tente de novo.' };
  }
}

/**
 * File → the delimited text the parser reads.
 *
 * The container is sniffed from the bytes rather than trusted from the extension: the browser
 * reports no useful type for a spreadsheet on iOS, and a renamed file is the user's mistake,
 * not a reason to fail.
 */
async function readPositionFile(file: File): Promise<{ text: string; exportedOn: IsoDate | null }> {
  const bytes = new Uint8Array(await file.arrayBuffer());

  return isXlsx(bytes)
    ? xlsxToDelimitedText(bytes)
    : { text: new TextDecoder('utf-8').decode(bytes), exportedOn: null };
}

/**
 * Checks the import against the total the file states about itself.
 *
 * This is the guard against a silent partial import: if XP adds a section, or renames the
 * column a table's value lives in, the positions simply stop being found — no error, no empty
 * preview, just a smaller number. Comparing against the file's own total makes that visible
 * before anything is written.
 */
function reconcile(
  total: Cents,
  skipped: Cents,
  stated: Cents | null,
): PositionReconciliation | null {
  if (stated === null) return null;

  const accounted = total + skipped;
  const gap = stated - accounted;

  return {
    stated: formatCents(stated),
    accounted: formatCents(accounted),
    gap: absCents(gap) > RECONCILE_TOLERANCE_CENTS ? formatCents(gap) : null,
  };
}

/**
 * Step 2: write. Re-parses the approved text rather than trusting a payload round-tripped
 * through the browser — the rows are derived server-side both times, so a tampered or stale
 * preview cannot inject anything.
 */
async function confirmPositionImport(
  _previous: PositionImportState,
  formData: FormData,
): Promise<PositionImportState> {
  const text = String(formData.get('text') ?? '');
  if (text.trim() === '') {
    return { status: 'error', message: 'Nada para importar. Envie o arquivo de novo.' };
  }

  try {
    const parsed = parseXpPosition(text);
    // No export date to pass: the preview already resolved one and posts it back as the field.
    const { date } = resolveDate(formData.get('date'), parsed.referenceDate, null);
    const result = await importPositions(parsed.positions, date);

    revalidatePath('/', 'layout');
    return { status: 'done', ...result };
  } catch (error) {
    if (error instanceof XpPositionFormatError) {
      return { status: 'error', message: error.message };
    }

    console.error('[import/investments] confirm failed', error);
    return { status: 'error', message: 'Não foi possível importar. Tente de novo.' };
  }
}

/**
 * The date the snapshots are filed under: the reference date printed in the file, else the day
 * the workbook was exported, else what the user chose, else today.
 *
 * The file wins over the field on purpose. A position export is a photograph with a date on
 * it, and the field is pre-filled with today — so honouring the field first would quietly file
 * July's position under August for anyone who did not notice the mismatch. The detailed .xlsx
 * prints no reference date at all, so its export timestamp stands in: it is still the file
 * talking about itself, it is the same day for anyone importing what they just downloaded, and
 * the preview names the source before anything is written.
 *
 * Anything unparseable falls through rather than failing the import: the field is a date
 * input, so a bad value means a hand-crafted request.
 */
function resolveDate(
  chosen: FormDataEntryValue | null,
  fromFile: IsoDate | null,
  exportedOn: IsoDate | null,
): { date: IsoDate; source: DateSource } {
  if (fromFile !== null) return { date: fromFile, source: 'file' };
  if (exportedOn !== null) return { date: exportedOn, source: 'export' };

  const value = String(chosen ?? '');
  return { date: isIsoDate(value) ? value : todayIso(), source: 'field' };
}
