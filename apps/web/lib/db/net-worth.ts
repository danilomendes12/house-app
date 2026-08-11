import 'server-only';

import {
  ZERO_CENTS,
  assetPerformance,
  currentIsoMonth,
  lastMonths,
  monthlyNetWorthSeries,
  percentOfCents,
  type AssetPerformance,
  type Cents,
  type IsoMonth,
  type NetWorthPoint,
} from '@finance/shared';
import { getAsset, listAssetEvents, listAssetSnapshots, listAssets } from './assets';
import type { Asset, AssetEvent, AssetSnapshot } from './types';

/** Months drawn on the evolution chart. A year is what makes seasonality visible. */
export const NET_WORTH_WINDOW = 12;

/** One asset with its yield already worked out. */
export interface AssetLine {
  asset: Asset;
  performance: AssetPerformance;
}

export interface NetWorthOverview {
  /** Oldest first — the x-axis. */
  months: IsoMonth[];
  series: NetWorthPoint[];
  /** Σ of the open assets' current values. */
  totalCents: Cents;
  investedCents: Cents;
  yieldCents: Cents;
  /** `null` when nothing was contributed — there is no base to measure growth against. */
  yieldPercent: number | null;
  open: AssetLine[];
  closed: AssetLine[];
  /** Open assets still without a snapshot; they enter the total at their invested amount. */
  pendingSnapshotCount: number;
}

export interface AssetDetail extends AssetLine {
  events: AssetEvent[];
  snapshots: AssetSnapshot[];
}

function groupByAsset<T extends { assetId: string }>(rows: T[]): Map<string, T[]> {
  const byAsset = new Map<string, T[]>();

  for (const row of rows) {
    const bucket = byAsset.get(row.assetId);
    if (bucket) bucket.push(row);
    else byAsset.set(row.assetId, [row]);
  }

  return byAsset;
}

/**
 * Everything the net-worth screen shows, in one pass.
 *
 * The whole history is read rather than a window of it: a single user's snapshots and
 * contributions are a few hundred rows, and both the carry-forward in the chart and the
 * per-asset yield need every row anyway.
 *
 * The headline total sums each open asset's *current* value, which for an asset with no
 * snapshot yet is what was put into it (see `assetPerformance`). SPEC §6.2 defines the
 * total from snapshots alone; taken literally, a freshly registered asset would show up as
 * R$ 0 right below a list that shows its real balance. The chart still plots snapshots
 * only, so its last point can sit below this total — `pendingSnapshotCount` is what the UI
 * uses to say so.
 */
export async function getNetWorthOverview(window = NET_WORTH_WINDOW): Promise<NetWorthOverview> {
  const [assets, events, snapshots] = await Promise.all([
    listAssets(),
    listAssetEvents(),
    listAssetSnapshots(),
  ]);

  const eventsByAsset = groupByAsset(events);
  const snapshotsByAsset = groupByAsset(snapshots);

  const lines: AssetLine[] = assets.map((asset) => ({
    asset,
    performance: assetPerformance(
      eventsByAsset.get(asset.id) ?? [],
      snapshotsByAsset.get(asset.id) ?? [],
    ),
  }));

  const open = lines.filter((line) => !line.asset.isClosed);
  const closed = lines.filter((line) => line.asset.isClosed);

  let totalCents = ZERO_CENTS;
  let investedCents = ZERO_CENTS;
  for (const { performance } of open) {
    totalCents += performance.currentCents;
    investedCents += performance.investedCents;
  }

  const yieldCents = totalCents - investedCents;
  const months = lastMonths(currentIsoMonth(), window);

  return {
    months,
    series: monthlyNetWorthSeries(snapshots, months, new Set(closed.map((line) => line.asset.id))),
    totalCents,
    investedCents,
    yieldCents,
    yieldPercent: investedCents > ZERO_CENTS ? percentOfCents(yieldCents, investedCents) : null,
    open,
    closed,
    pendingSnapshotCount: open.filter((line) => line.performance.snapshotDate === null).length,
  };
}

/** One asset with its full history — the detail screen. */
export async function getAssetDetail(id: string): Promise<AssetDetail | null> {
  const [asset, events, snapshots] = await Promise.all([
    getAsset(id),
    listAssetEvents(id),
    listAssetSnapshots(id),
  ]);

  if (!asset) return null;

  return { asset, events, snapshots, performance: assetPerformance(events, snapshots) };
}
