'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  ZERO_CENTS,
  isAssetIndexer,
  isAssetType,
  isIsoDate,
  parseCentsOrNull,
} from '@finance/shared';
import {
  createAsset,
  createAssetEvent,
  deleteAsset,
  deleteAssetEvent,
  deleteAssetSnapshot,
  setAssetClosed,
  updateAsset,
  upsertAssetSnapshot,
  type AssetInput,
} from '@/lib/db/assets';

export type AssetFormState = {
  status: 'idle' | 'error';
  message?: string;
  fieldErrors?: Partial<Record<'name' | 'rate' | 'maturityDate', string>>;
};

/** `'done'` is what tells the inline forms to clear themselves for the next entry. */
export type AssetEventFormState = {
  status: 'idle' | 'error' | 'done';
  message?: string;
  fieldErrors?: Partial<Record<'amount' | 'date', string>>;
};

export type AssetSnapshotFormState = AssetEventFormState;

/**
 * The rate is documentation, not maths (SPEC §6.2) — but it is still a `numeric` column
 * with a 0–1000 CHECK, so garbage is rejected here rather than at the database.
 * Accepts the comma the pt-BR keyboard produces: `"6,5"` → `6.5`.
 */
function parseRate(raw: string): { ok: true; value: number | null } | { ok: false } {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, value: null };

  const value = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(value) || value < 0 || value > 1000) return { ok: false };

  return { ok: true, value };
}

function parseAssetForm(
  formData: FormData,
): { ok: true; input: AssetInput } | { ok: false; state: AssetFormState } {
  const fieldErrors: NonNullable<AssetFormState['fieldErrors']> = {};

  const name = String(formData.get('name') ?? '').trim();
  if (name === '') fieldErrors.name = 'Informe um nome para o ativo.';

  const rate = parseRate(String(formData.get('rate') ?? ''));
  if (!rate.ok) fieldErrors.rate = 'Informe uma taxa entre 0 e 1000, ex.: 110.';

  const rawMaturity = String(formData.get('maturityDate') ?? '').trim();
  if (rawMaturity !== '' && !isIsoDate(rawMaturity)) {
    fieldErrors.maturityDate = 'Informe uma data válida.';
  }

  if (Object.keys(fieldErrors).length > 0 || !rate.ok) {
    return { ok: false, state: { status: 'error', fieldErrors } };
  }

  const rawType = String(formData.get('type') ?? '');
  const rawIndexer = String(formData.get('indexer') ?? '');

  return {
    ok: true,
    input: {
      name,
      type: isAssetType(rawType) ? rawType : 'outro',
      institution: String(formData.get('institution') ?? '').trim() || null,
      indexer: isAssetIndexer(rawIndexer) ? rawIndexer : null,
      rate: rate.value,
      maturityDate: rawMaturity === '' ? null : rawMaturity,
    },
  };
}

/** Creates or updates an asset and lands on its page — where the money is entered. */
export async function saveAsset(
  _previous: AssetFormState,
  formData: FormData,
): Promise<AssetFormState> {
  const parsed = parseAssetForm(formData);
  if (!parsed.ok) return parsed.state;

  const id = String(formData.get('id') ?? '');
  let assetId = id;

  try {
    if (id) await updateAsset(id, parsed.input);
    else assetId = await createAsset(parsed.input);
  } catch (error) {
    console.error('[assets] save failed', error);
    return { status: 'error', message: 'Não foi possível salvar. Tente de novo.' };
  }

  revalidatePath('/', 'layout');
  redirect(`/assets/${assetId}`);
}

export async function saveAssetEvent(
  _previous: AssetEventFormState,
  formData: FormData,
): Promise<AssetEventFormState> {
  const assetId = String(formData.get('assetId') ?? '');
  if (!assetId) return { status: 'error', message: 'Ativo não encontrado.' };

  const fieldErrors: NonNullable<AssetEventFormState['fieldErrors']> = {};

  const amountCents = parseCentsOrNull(String(formData.get('amount') ?? ''));
  if (amountCents === null) fieldErrors.amount = 'Informe um valor válido, ex.: 1.000,00.';
  else if (amountCents <= ZERO_CENTS) fieldErrors.amount = 'O valor precisa ser maior que zero.';

  const date = String(formData.get('date') ?? '');
  if (!isIsoDate(date)) fieldErrors.date = 'Informe uma data válida.';

  if (Object.keys(fieldErrors).length > 0 || amountCents === null) {
    return { status: 'error', fieldErrors };
  }

  try {
    await createAssetEvent({
      assetId,
      date,
      type: formData.get('type') === 'withdrawal' ? 'withdrawal' : 'contribution',
      amountCents,
      notes: String(formData.get('notes') ?? '').trim() || null,
    });
  } catch (error) {
    console.error('[assets] event save failed', error);
    return { status: 'error', message: 'Não foi possível salvar a movimentação.' };
  }

  revalidatePath('/', 'layout');
  return { status: 'done' };
}

/**
 * "Atualizar valor atual". Zero is accepted — an asset really can be worth nothing — but
 * negative is not, matching the CHECK on the column.
 */
export async function saveAssetSnapshot(
  _previous: AssetSnapshotFormState,
  formData: FormData,
): Promise<AssetSnapshotFormState> {
  const assetId = String(formData.get('assetId') ?? '');
  if (!assetId) return { status: 'error', message: 'Ativo não encontrado.' };

  const fieldErrors: NonNullable<AssetSnapshotFormState['fieldErrors']> = {};

  const grossValueCents = parseCentsOrNull(String(formData.get('grossValue') ?? ''));
  if (grossValueCents === null) fieldErrors.amount = 'Informe um valor válido, ex.: 10.480,00.';
  else if (grossValueCents < ZERO_CENTS) fieldErrors.amount = 'O valor não pode ser negativo.';

  const date = String(formData.get('date') ?? '');
  if (!isIsoDate(date)) fieldErrors.date = 'Informe uma data válida.';

  if (Object.keys(fieldErrors).length > 0 || grossValueCents === null) {
    return { status: 'error', fieldErrors };
  }

  try {
    await upsertAssetSnapshot({ assetId, date, grossValueCents });
  } catch (error) {
    console.error('[assets] snapshot save failed', error);
    return { status: 'error', message: 'Não foi possível salvar o valor.' };
  }

  revalidatePath('/', 'layout');
  return { status: 'done' };
}

export async function removeAssetEvent(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await deleteAssetEvent(id);
  revalidatePath('/', 'layout');
}

export async function removeAssetSnapshot(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await deleteAssetSnapshot(id);
  revalidatePath('/', 'layout');
}

/** Closing keeps the history and drops the asset from the current total (SPEC §12). */
export async function toggleAssetClosed(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await setAssetClosed(id, formData.get('isClosed') !== 'true');
  revalidatePath('/', 'layout');
}

export async function removeAsset(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await deleteAsset(id);

  revalidatePath('/', 'layout');
  redirect('/assets');
}
