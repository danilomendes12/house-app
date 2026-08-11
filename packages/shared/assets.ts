/**
 * Net-worth arithmetic (SPEC §6.2).
 *
 * Two kinds of number meet here and must not be confused: *events* are money the user
 * moved, so they are exact and additive; *snapshots* are what an institution says the
 * asset is worth, so they are only true on their own date. Yield is the gap between them.
 */

import { compareIsoDate, monthOf, type IsoDate, type IsoMonth } from './date';
import { ZERO_CENTS, percentOfCents, type Cents } from './money';

export const ASSET_TYPES = [
  'cdb',
  'tesouro',
  'lci_lca',
  'fundo',
  'acao',
  'fii',
  'etf',
  'cripto',
  'poupanca',
  'outro',
] as const;

export type AssetType = (typeof ASSET_TYPES)[number];

export const ASSET_INDEXERS = ['cdi', 'ipca', 'prefixado', 'selic'] as const;
export type AssetIndexer = (typeof ASSET_INDEXERS)[number];

export type AssetEventType = 'contribution' | 'withdrawal';

/** UI labels (pt-BR) — the list the asset form offers, in the order it offers them. */
export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  cdb: 'CDB',
  tesouro: 'Tesouro Direto',
  lci_lca: 'LCI/LCA',
  fundo: 'Fundo',
  acao: 'Ação',
  fii: 'FII',
  etf: 'ETF',
  cripto: 'Cripto',
  poupanca: 'Poupança',
  outro: 'Outro',
};

export const ASSET_INDEXER_LABELS: Record<AssetIndexer, string> = {
  cdi: 'CDI',
  ipca: 'IPCA',
  prefixado: 'Prefixado',
  selic: 'Selic',
};

export function isAssetType(value: string): value is AssetType {
  return (ASSET_TYPES as readonly string[]).includes(value);
}

export function isAssetIndexer(value: string): value is AssetIndexer {
  return (ASSET_INDEXERS as readonly string[]).includes(value);
}

/** Minimal shapes the maths needs; the real rows carry more. */
export interface AssetEventAmount {
  assetId: string;
  date: IsoDate;
  type: AssetEventType;
  amountCents: Cents;
}

export interface AssetSnapshotValue {
  assetId: string;
  date: IsoDate;
  grossValueCents: Cents;
}

/**
 * Money actually put in: `Σ aportes − Σ resgates` (SPEC §6.2).
 *
 * Can go negative once withdrawals exceed contributions — an asset that has returned more
 * than it received. That is real, not an error, and the yield percentage handles it.
 */
export function investedCents(events: Iterable<AssetEventAmount>): Cents {
  let total = ZERO_CENTS;
  for (const { type, amountCents } of events) {
    total += type === 'contribution' ? amountCents : -amountCents;
  }
  return total;
}

/** The most recent snapshot on or before `date`, or `null` if there is none yet. */
export function latestSnapshot(
  snapshots: Iterable<AssetSnapshotValue>,
  date?: IsoDate,
): AssetSnapshotValue | null {
  let latest: AssetSnapshotValue | null = null;

  for (const snapshot of snapshots) {
    if (date !== undefined && compareIsoDate(snapshot.date, date) > 0) continue;
    if (latest === null || compareIsoDate(snapshot.date, latest.date) > 0) latest = snapshot;
  }

  return latest;
}

export interface AssetPerformance {
  investedCents: Cents;
  /** Latest snapshot value, or the invested amount when nothing has been snapshotted. */
  currentCents: Cents;
  /** `current − invested` (SPEC §6.2). Negative when the asset is under water. */
  yieldCents: Cents;
  /** `null` when there is no positive base to measure growth against. */
  yieldPercent: number | null;
  /** `null` until the first snapshot — the UI prompts for one instead of showing 0%. */
  snapshotDate: IsoDate | null;
}

/**
 * Yield of one asset: last snapshot minus what was put in.
 *
 * With no snapshot yet the asset is worth exactly what was contributed, so it shows a
 * yield of zero rather than a loss of the full invested amount.
 */
export function assetPerformance(
  events: Iterable<AssetEventAmount>,
  snapshots: Iterable<AssetSnapshotValue>,
  date?: IsoDate,
): AssetPerformance {
  const invested = investedCents(events);
  const snapshot = latestSnapshot(snapshots, date);
  const currentCents = snapshot?.grossValueCents ?? invested;
  const yieldCents = currentCents - invested;

  return {
    investedCents: invested,
    currentCents,
    yieldCents,
    yieldPercent: invested > ZERO_CENTS ? percentOfCents(yieldCents, invested) : null,
    snapshotDate: snapshot?.date ?? null,
  };
}

export interface NetWorthPoint {
  month: IsoMonth;
  totalCents: Cents;
}

/**
 * Net worth per month, one point per month in `months` (SPEC §6.2).
 *
 * Each asset contributes the last snapshot taken in that month or, when the month has
 * none, the last known value carried forward — otherwise the total would collapse in every
 * month the user simply did not update anything.
 *
 * Carrying forward starts at an asset's first snapshot (nothing is invented for months
 * before it existed) and, for a closed asset, stops after its last one: a redeemed
 * position must leave the current total without erasing the months it was really held.
 */
export function monthlyNetWorthSeries(
  snapshots: Iterable<AssetSnapshotValue>,
  months: readonly IsoMonth[],
  closedAssetIds: ReadonlySet<string> = new Set(),
): NetWorthPoint[] {
  // Last snapshot per asset per month — `unique (asset_id, date)` makes ties impossible
  // within a day, so ordering by date alone is enough.
  const byAsset = new Map<string, Map<IsoMonth, AssetSnapshotValue>>();

  for (const snapshot of snapshots) {
    const month = monthOf(snapshot.date);
    const months = byAsset.get(snapshot.assetId) ?? new Map<IsoMonth, AssetSnapshotValue>();

    const existing = months.get(month);
    if (!existing || compareIsoDate(snapshot.date, existing.date) > 0) months.set(month, snapshot);

    byAsset.set(snapshot.assetId, months);
  }

  return months.map((month) => {
    let totalCents = ZERO_CENTS;

    for (const [assetId, monthValues] of byAsset) {
      const value = valueAtMonth(monthValues, month, closedAssetIds.has(assetId));
      totalCents += value;
    }

    return { month, totalCents };
  });
}

function valueAtMonth(
  monthValues: Map<IsoMonth, AssetSnapshotValue>,
  month: IsoMonth,
  isClosed: boolean,
): Cents {
  const exact = monthValues.get(month);
  if (exact) return exact.grossValueCents;

  let carried: AssetSnapshotValue | null = null;
  let hasLaterSnapshot = false;

  for (const snapshot of monthValues.values()) {
    if (monthOf(snapshot.date) > month) {
      hasLaterSnapshot = true;
      continue;
    }
    if (carried === null || compareIsoDate(snapshot.date, carried.date) > 0) carried = snapshot;
  }

  // Before the asset's first snapshot it contributes nothing.
  if (carried === null) return ZERO_CENTS;

  // A closed asset stops contributing once its history ends.
  if (isClosed && !hasLaterSnapshot) return ZERO_CENTS;

  return carried.grossValueCents;
}

/**
 * Total net worth on a date: the latest snapshot of every open asset (SPEC §6.2).
 * Assets without any snapshot contribute nothing — there is no value to claim yet.
 */
export function netWorthAt(
  snapshots: Iterable<AssetSnapshotValue>,
  openAssetIds: ReadonlySet<string>,
  date?: IsoDate,
): Cents {
  const latestByAsset = new Map<string, AssetSnapshotValue>();

  for (const snapshot of snapshots) {
    if (!openAssetIds.has(snapshot.assetId)) continue;
    if (date !== undefined && compareIsoDate(snapshot.date, date) > 0) continue;

    const current = latestByAsset.get(snapshot.assetId);
    if (!current || compareIsoDate(snapshot.date, current.date) > 0) {
      latestByAsset.set(snapshot.assetId, snapshot);
    }
  }

  let total = ZERO_CENTS;
  for (const snapshot of latestByAsset.values()) total += snapshot.grossValueCents;

  return total;
}
