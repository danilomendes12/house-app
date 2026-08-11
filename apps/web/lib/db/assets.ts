import 'server-only';

import {
  fromCents,
  type AssetEventType,
  type AssetIndexer,
  type AssetType,
  type Cents,
  type IsoDate,
} from '@finance/shared';
import { authedClient, unwrap } from './client';
import {
  toAsset,
  toAssetEvent,
  toAssetSnapshot,
  type Asset,
  type AssetEvent,
  type AssetSnapshot,
} from './types';

export interface AssetInput {
  name: string;
  type: AssetType;
  institution: string | null;
  indexer: AssetIndexer | null;
  rate: number | null;
  maturityDate: IsoDate | null;
}

export interface AssetEventInput {
  assetId: string;
  date: IsoDate;
  type: AssetEventType;
  /** Always positive — the direction lives in `type` (SPEC §6.2). */
  amountCents: Cents;
  notes: string | null;
}

export interface AssetSnapshotInput {
  assetId: string;
  date: IsoDate;
  grossValueCents: Cents;
}

/** Every asset, open ones first, then alphabetically. */
export async function listAssets(): Promise<Asset[]> {
  const { supabase } = await authedClient();

  const rows = unwrap(await supabase.from('assets').select('*').order('is_closed').order('name'));
  return rows.map(toAsset);
}

export async function getAsset(id: string): Promise<Asset | null> {
  const { supabase } = await authedClient();

  const { data, error } = await supabase.from('assets').select('*').eq('id', id).maybeSingle();
  if (error) throw error;

  return data ? toAsset(data) : null;
}

/** @returns the new asset's id, so the caller can send the user straight to it. */
export async function createAsset(input: AssetInput): Promise<string> {
  const { supabase, userId } = await authedClient();

  const { data, error } = await supabase
    .from('assets')
    .insert({
      user_id: userId,
      name: input.name,
      type: input.type,
      institution: input.institution,
      indexer: input.indexer,
      rate: input.rate,
      maturity_date: input.maturityDate,
    })
    .select('id')
    .single();
  if (error) throw error;

  return data.id;
}

export async function updateAsset(id: string, input: AssetInput): Promise<void> {
  const { supabase } = await authedClient();

  const { error } = await supabase
    .from('assets')
    .update({
      name: input.name,
      type: input.type,
      institution: input.institution,
      indexer: input.indexer,
      rate: input.rate,
      maturity_date: input.maturityDate,
    })
    .eq('id', id);
  if (error) throw error;
}

/**
 * Closing an asset (redeemed or matured) keeps its history but drops it from the current
 * total — see `monthlyNetWorthSeries`, which stops carrying its value forward.
 */
export async function setAssetClosed(id: string, isClosed: boolean): Promise<void> {
  const { supabase } = await authedClient();

  const { error } = await supabase.from('assets').update({ is_closed: isClosed }).eq('id', id);
  if (error) throw error;
}

/** Deletes the asset and, by `on delete cascade`, its events and snapshots. */
export async function deleteAsset(id: string): Promise<void> {
  const { supabase } = await authedClient();

  const { error } = await supabase.from('assets').delete().eq('id', id);
  if (error) throw error;
}

/** Events, newest first. Without `assetId`, every asset's — the net-worth page reads all. */
export async function listAssetEvents(assetId?: string): Promise<AssetEvent[]> {
  const { supabase } = await authedClient();

  let query = supabase.from('asset_events').select('*');
  if (assetId) query = query.eq('asset_id', assetId);

  const rows = unwrap(
    await query.order('date', { ascending: false }).order('created_at', { ascending: false }),
  );
  return rows.map(toAssetEvent);
}

export async function createAssetEvent(input: AssetEventInput): Promise<void> {
  const { supabase, userId } = await authedClient();

  const { error } = await supabase.from('asset_events').insert({
    user_id: userId,
    asset_id: input.assetId,
    date: input.date,
    type: input.type,
    amount_cents: fromCents(input.amountCents),
    notes: input.notes,
  });
  if (error) throw error;
}

export async function deleteAssetEvent(id: string): Promise<void> {
  const { supabase } = await authedClient();

  const { error } = await supabase.from('asset_events').delete().eq('id', id);
  if (error) throw error;
}

/** Snapshots, newest first. Without `assetId`, every asset's — the chart reads all. */
export async function listAssetSnapshots(assetId?: string): Promise<AssetSnapshot[]> {
  const { supabase } = await authedClient();

  let query = supabase.from('asset_snapshots').select('*');
  if (assetId) query = query.eq('asset_id', assetId);

  const rows = unwrap(await query.order('date', { ascending: false }));
  return rows.map(toAssetSnapshot);
}

/**
 * Writes "what it is worth today". One value per asset per day (SPEC §12): updating twice
 * on the same date overwrites instead of leaving two truths for one day.
 */
export async function upsertAssetSnapshot(input: AssetSnapshotInput): Promise<void> {
  const { supabase, userId } = await authedClient();

  const { error } = await supabase.from('asset_snapshots').upsert(
    {
      user_id: userId,
      asset_id: input.assetId,
      date: input.date,
      gross_value_cents: fromCents(input.grossValueCents),
    },
    { onConflict: 'asset_id,date' },
  );
  if (error) throw error;
}

export async function deleteAssetSnapshot(id: string): Promise<void> {
  const { supabase } = await authedClient();

  const { error } = await supabase.from('asset_snapshots').delete().eq('id', id);
  if (error) throw error;
}
