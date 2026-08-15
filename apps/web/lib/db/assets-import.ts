import 'server-only';

import { fromCents, type IsoDate, type XpPosition } from '@finance/shared';
import { authedClient, unwrap } from './client';

export interface PositionImportResult {
  /** Products that had no asset yet. */
  assetsCreated: number;
  /** Products already in `/assets`, matched by `external_ref` — updated, not duplicated. */
  assetsMatched: number;
  /** Snapshots written for `date`, one per position. */
  snapshotsWritten: number;
}

/**
 * Writes a parsed position file as assets + snapshots (SPEC §7.1).
 *
 * Idempotence comes from two unique keys rather than from a hash of the file:
 * `(household_id, external_ref)` decides whether a product is new, and `(asset_id, date)`
 * means a second import for the same date overwrites the value instead of adding a second
 * truth for one day (SPEC §12). Importing the same file twice therefore creates nothing and
 * changes nothing.
 *
 * Existing assets are deliberately **not** updated with the file's name, type or rate: the
 * inferred type is a guess (`inferAssetType`) and `/assets` is where it gets corrected. An
 * import that overwrote those fields would undo that correction on every run.
 */
export async function importPositions(
  positions: XpPosition[],
  date: IsoDate,
): Promise<PositionImportResult> {
  if (positions.length === 0) {
    return { assetsCreated: 0, assetsMatched: 0, snapshotsWritten: 0 };
  }

  const { supabase, userId, householdId } = await authedClient();

  // `ignoreDuplicates` makes this "insert what is missing": PostgREST returns only the rows
  // it actually wrote, so the response is exactly the list of newly created assets.
  const created = unwrap(
    await supabase
      .from('assets')
      .upsert(
        positions.map((position) => ({
          household_id: householdId,
          user_id: userId,
          external_ref: position.externalRef,
          name: position.name,
          type: position.type,
          institution: position.institution,
          indexer: position.indexer,
          rate: position.rate,
          maturity_date: position.maturityDate,
        })),
        { onConflict: 'household_id,external_ref', ignoreDuplicates: true },
      )
      .select('id'),
  );

  // Re-read instead of trusting the upsert response: it holds only the new rows, and the
  // snapshots need the ids of the pre-existing ones too.
  const assets = unwrap(
    await supabase
      .from('assets')
      .select('id, external_ref')
      .in(
        'external_ref',
        positions.map((position) => position.externalRef),
      ),
  );

  const idByRef = new Map(assets.map((asset) => [asset.external_ref, asset.id]));

  const snapshots = positions.flatMap((position) => {
    const assetId = idByRef.get(position.externalRef);
    // Unreachable in practice: every ref was just upserted. Skipping beats writing a
    // snapshot with a null asset_id and failing the whole import for one bad row.
    if (!assetId) return [];

    return [
      {
        household_id: householdId,
        user_id: userId,
        asset_id: assetId,
        date,
        gross_value_cents: fromCents(position.grossValueCents),
      },
    ];
  });

  const written = unwrap(
    await supabase
      .from('asset_snapshots')
      .upsert(snapshots, { onConflict: 'asset_id,date' })
      .select('id'),
  );

  return {
    assetsCreated: created.length,
    assetsMatched: positions.length - created.length,
    snapshotsWritten: written.length,
  };
}

/**
 * The assets a parsed file would touch, keyed by `external_ref` — what the preview needs to
 * say "novo ativo" or "atualiza «Nome»" before anything is written.
 */
export async function findAssetsByRef(refs: string[]): Promise<Map<string, string>> {
  if (refs.length === 0) return new Map();

  const { supabase } = await authedClient();
  const rows = unwrap(
    await supabase.from('assets').select('external_ref, name').in('external_ref', refs),
  );

  return new Map(
    rows.flatMap((row) => (row.external_ref === null ? [] : [[row.external_ref, row.name]])),
  );
}
