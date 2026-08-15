import 'server-only';

import {
  ASSET_CLASSES,
  ASSET_CLASS_LABELS,
  ASSET_INDEXER_LABELS,
  DEFAULT_PORTFOLIO_PERIOD,
  MATURITY_HORIZON_DAYS,
  STALE_SNAPSHOT_DAYS,
  ZERO_CENTS,
  aggregatePeriodPerformance,
  allocate,
  assetClassOf,
  assetPerformance,
  compareIsoDate,
  concentrationOf,
  diffDays,
  isFixedIncome,
  monthlyNetWorthSeries,
  monthsInPeriod,
  monthlyMovement,
  percentOfCents,
  periodPerformance,
  periodRange,
  sumMonthlyMovements,
  todayIso,
  type AllocationDimension,
  type AllocationSlice,
  type AssetClass,
  type AssetPerformance,
  type AssetSort,
  type Cents,
  type Concentration,
  type DateRange,
  type IsoDate,
  type IsoMonth,
  type MonthMovement,
  type NetWorthPoint,
  type PeriodPerformance,
  type PortfolioPeriod,
} from '@finance/shared';
import { getAsset, listAssetEvents, listAssetSnapshots, listAssets } from './assets';
import type { Asset, AssetEvent, AssetSnapshot } from './types';

/** One asset with its lifetime yield and its return over the selected period. */
export interface AssetLine {
  asset: Asset;
  performance: AssetPerformance;
  period: PeriodPerformance;
}

/** An open position whose value has not been refreshed in a while. */
export interface StalePosition {
  asset: Asset;
  currentCents: Cents;
  /** `null` when the asset has never been valued. */
  snapshotDate: IsoDate | null;
  /** Days since the last snapshot; `null` when there has never been one. */
  ageDays: number | null;
}

/** A fixed-income position coming due inside {@link MATURITY_HORIZON_DAYS}. */
export interface UpcomingMaturity {
  asset: Asset;
  maturityDate: IsoDate;
  daysAhead: number;
  currentCents: Cents;
}

/** Assets of one class, with the subtotal the group header shows. */
export interface AssetGroup {
  assetClass: AssetClass;
  label: string;
  lines: AssetLine[];
  totalCents: Cents;
  percent: number;
}

export interface NetWorthOverview {
  period: PortfolioPeriod;
  range: DateRange;
  /** Oldest first — the x-axis. */
  months: IsoMonth[];
  series: NetWorthPoint[];
  /** Σ of the open assets' current values. */
  totalCents: Cents;
  investedCents: Cents;
  yieldCents: Cents;
  /** `null` when nothing was contributed — there is no base to measure growth against. */
  yieldPercent: number | null;
  /** New money vs. earnings over the selected window. */
  periodPerformance: PeriodPerformance;
  movements: MonthMovement[];
  allocation: Record<AllocationDimension, AllocationSlice[]>;
  concentration: Concentration;
  groups: AssetGroup[];
  open: AssetLine[];
  closed: AssetLine[];
  stale: StalePosition[];
  maturities: UpcomingMaturity[];
}

export interface AssetDetail extends AssetLine {
  events: AssetEvent[];
  snapshots: AssetSnapshot[];
  range: DateRange;
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

/** The oldest movement of any kind — where the "Tudo" window starts. */
function earliestDate(events: AssetEvent[], snapshots: AssetSnapshot[]): IsoDate | null {
  let earliest: IsoDate | null = null;

  for (const { date } of [...events, ...snapshots]) {
    if (earliest === null || compareIsoDate(date, earliest) < 0) earliest = date;
  }

  return earliest;
}

/** The value an asset carries into the allocation: the same one the headline total sums. */
function allocationItemsBy(lines: AssetLine[], dimension: AllocationDimension) {
  return lines.map((line) => {
    const { asset, performance } = line;

    if (dimension === 'class') {
      const assetClass = assetClassOf(asset.type);
      return {
        key: assetClass,
        label: ASSET_CLASS_LABELS[assetClass],
        cents: performance.currentCents,
      };
    }

    if (dimension === 'indexer') {
      return {
        key: asset.indexer ?? 'none',
        label: asset.indexer === null ? 'Sem indexador' : ASSET_INDEXER_LABELS[asset.indexer],
        cents: performance.currentCents,
      };
    }

    const institution = asset.institution?.trim();
    return {
      key: institution ? institution.toLocaleLowerCase('pt-BR') : 'none',
      label: institution ? institution : 'Sem instituição',
      cents: performance.currentCents,
    };
  });
}

function groupByClass(lines: AssetLine[], totalCents: Cents, sort: AssetSort): AssetGroup[] {
  const byClass = new Map<AssetClass, AssetLine[]>();

  for (const line of lines) {
    const assetClass = assetClassOf(line.asset.type);
    const bucket = byClass.get(assetClass);
    if (bucket) bucket.push(line);
    else byClass.set(assetClass, [line]);
  }

  const groups: AssetGroup[] = [];

  for (const assetClass of ASSET_CLASSES) {
    const bucket = byClass.get(assetClass);
    if (!bucket) continue;

    let groupTotal = ZERO_CENTS;
    for (const line of bucket) groupTotal += line.performance.currentCents;

    groups.push({
      assetClass,
      label: ASSET_CLASS_LABELS[assetClass],
      lines: [...bucket].sort(sortLines(sort)),
      totalCents: groupTotal,
      percent: totalCents > ZERO_CENTS ? percentOfCents(groupTotal, totalCents) : 0,
    });
  }

  return groups.sort((a, b) =>
    a.totalCents === b.totalCents ? 0 : a.totalCents > b.totalCents ? -1 : 1,
  );
}

/**
 * By value, or by how well the position did in the window. Sorting by return puts the
 * ones with no measurable return (`null`) last — they are not a 0%.
 */
function sortLines(sort: AssetSort): (a: AssetLine, b: AssetLine) => number {
  if (sort === 'value') {
    return (a, b) =>
      a.performance.currentCents === b.performance.currentCents
        ? a.asset.name.localeCompare(b.asset.name, 'pt-BR')
        : a.performance.currentCents > b.performance.currentCents
          ? -1
          : 1;
  }

  return (a, b) => {
    const left = a.period.returnPercent;
    const right = b.period.returnPercent;

    if (left === null && right === null) return a.asset.name.localeCompare(b.asset.name, 'pt-BR');
    if (left === null) return 1;
    if (right === null) return -1;

    return right - left;
  };
}

/**
 * Everything the net-worth screen shows, in one pass.
 *
 * The whole history is read rather than a window of it: a single household's snapshots and
 * contributions are a few hundred rows, and the carry-forward in the chart, the per-asset
 * yield and the period maths all need every row anyway. Every view below — allocation,
 * concentration, staleness, maturities, the monthly split — is derived from that same
 * read, never from a second query per asset.
 *
 * The headline total sums each open asset's *current* value, which for an asset with no
 * snapshot yet is what was put into it (see `assetPerformance`). SPEC §6.2 defines the
 * total from snapshots alone; taken literally, a freshly registered asset would show up as
 * R$ 0 right below a list that shows its real balance. Allocation uses that same value, so
 * the slices always add up to the number printed above them.
 */
export async function getNetWorthOverview(
  period: PortfolioPeriod = DEFAULT_PORTFOLIO_PERIOD,
  sort: AssetSort = 'value',
): Promise<NetWorthOverview> {
  const [assets, events, snapshots] = await Promise.all([
    listAssets(),
    listAssetEvents(),
    listAssetSnapshots(),
  ]);

  const eventsByAsset = groupByAsset(events);
  const snapshotsByAsset = groupByAsset(snapshots);

  const today = todayIso();
  const range = periodRange(period, today, earliestDate(events, snapshots));

  const lines: AssetLine[] = assets.map((asset) => {
    const assetEvents = eventsByAsset.get(asset.id) ?? [];
    const assetSnapshots = snapshotsByAsset.get(asset.id) ?? [];

    return {
      asset,
      performance: assetPerformance(assetEvents, assetSnapshots),
      period: periodPerformance(assetEvents, assetSnapshots, range),
    };
  });

  const open = lines.filter((line) => !line.asset.isClosed);
  const closed = lines.filter((line) => line.asset.isClosed);

  let totalCents = ZERO_CENTS;
  let investedCents = ZERO_CENTS;
  for (const { performance } of open) {
    totalCents += performance.currentCents;
    investedCents += performance.investedCents;
  }

  const yieldCents = totalCents - investedCents;
  const months = monthsInPeriod(range);

  // Closed assets are outside the current total, the allocation and the period maths —
  // they only survive in the history the chart draws (SPEC §12).
  const movements = sumMonthlyMovements(
    open.map((line) =>
      monthlyMovement(
        eventsByAsset.get(line.asset.id) ?? [],
        snapshotsByAsset.get(line.asset.id) ?? [],
        range,
      ),
    ),
    months,
  );

  return {
    period,
    range,
    months,
    series: monthlyNetWorthSeries(snapshots, months, new Set(closed.map((line) => line.asset.id))),
    totalCents,
    investedCents,
    yieldCents,
    yieldPercent: investedCents > ZERO_CENTS ? percentOfCents(yieldCents, investedCents) : null,
    periodPerformance: aggregatePeriodPerformance(
      open.map((line) => line.period),
      range,
    ),
    movements,
    allocation: {
      class: allocate(allocationItemsBy(open, 'class')),
      indexer: allocate(allocationItemsBy(open, 'indexer')),
      institution: allocate(allocationItemsBy(open, 'institution')),
    },
    concentration: concentrationOf(
      open.map((line) => ({
        key: line.asset.id,
        label: line.asset.name,
        cents: line.performance.currentCents,
      })),
    ),
    groups: groupByClass(open, totalCents, sort),
    open: [...open].sort(sortLines(sort)),
    closed,
    stale: stalePositions(open, today),
    maturities: upcomingMaturities(open, today),
  };
}

/**
 * Open positions nobody has refreshed lately, newest gap last.
 *
 * Assets that have never been valued belong here too: they enter the total at their
 * contributed amount, which is exactly the number that needs confirming.
 */
function stalePositions(open: AssetLine[], today: IsoDate): StalePosition[] {
  const stale: StalePosition[] = [];

  for (const { asset, performance } of open) {
    const snapshotDate = performance.snapshotDate;
    const ageDays = snapshotDate === null ? null : diffDays(snapshotDate, today);

    if (ageDays !== null && ageDays <= STALE_SNAPSHOT_DAYS) continue;

    stale.push({ asset, currentCents: performance.currentCents, snapshotDate, ageDays });
  }

  // Never valued first, then the longest silence.
  return stale.sort(
    (a, b) => (b.ageDays ?? Number.MAX_SAFE_INTEGER) - (a.ageDays ?? Number.MAX_SAFE_INTEGER),
  );
}

/** Fixed income coming due soon — the one thing this app knows that a broker app buries. */
function upcomingMaturities(open: AssetLine[], today: IsoDate): UpcomingMaturity[] {
  const maturities: UpcomingMaturity[] = [];

  for (const { asset, performance } of open) {
    if (asset.maturityDate === null || !isFixedIncome(asset.type)) continue;

    const daysAhead = diffDays(today, asset.maturityDate);
    if (daysAhead < 0 || daysAhead > MATURITY_HORIZON_DAYS) continue;

    maturities.push({
      asset,
      maturityDate: asset.maturityDate,
      daysAhead,
      currentCents: performance.currentCents,
    });
  }

  return maturities.sort((a, b) => a.daysAhead - b.daysAhead);
}

/** One asset with its full history — the detail screen. */
export async function getAssetDetail(
  id: string,
  period: PortfolioPeriod = DEFAULT_PORTFOLIO_PERIOD,
): Promise<AssetDetail | null> {
  const [asset, events, snapshots] = await Promise.all([
    getAsset(id),
    listAssetEvents(id),
    listAssetSnapshots(id),
  ]);

  if (!asset) return null;

  const range = periodRange(period, todayIso(), earliestDate(events, snapshots));

  return {
    asset,
    events,
    snapshots,
    range,
    performance: assetPerformance(events, snapshots),
    period: periodPerformance(events, snapshots, range),
  };
}
