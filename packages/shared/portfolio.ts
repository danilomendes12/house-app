/**
 * Portfolio analysis (SPEC §6.2, Fase 8).
 *
 * `assets.ts` answers "how much do I have and how much did it yield since ever". This
 * module answers the three questions a portfolio screen exists for: how the money is
 * spread, how much it moved *in a window*, and whether the numbers are still fresh.
 *
 * The one rule everything here defends: **new money is not yield**. A contribution made
 * inside the window grows the balance without the portfolio having earned anything, so
 * the period return is Modified Dietz — the balance is weighted by how long each flow was
 * actually working — and never `final − initial`.
 */

import {
  addMonths,
  compareIsoDate,
  diffDays,
  monthEnd,
  monthOf,
  type IsoDate,
  type IsoMonth,
} from './date';
import { ZERO_CENTS, type Cents } from './money';
import {
  latestSnapshot,
  type AssetEventAmount,
  type AssetSnapshotValue,
  type AssetType,
} from './assets';

/* ------------------------------------------------------------------ asset class */

/**
 * Asset classes are **derived from `assets.type`**, never stored: the import already
 * guesses `type` and `/assets` already corrects it, so a second column would be a second
 * place to get it wrong (SPEC §12).
 */
export const ASSET_CLASSES = [
  'renda_fixa',
  'renda_variavel',
  'fundos',
  'cripto',
  'outros',
] as const;

export type AssetClass = (typeof ASSET_CLASSES)[number];

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  renda_fixa: 'Renda fixa',
  renda_variavel: 'Renda variável',
  fundos: 'Fundos',
  cripto: 'Cripto',
  outros: 'Outros',
};

const CLASS_BY_TYPE: Record<AssetType, AssetClass> = {
  cdb: 'renda_fixa',
  tesouro: 'renda_fixa',
  lci_lca: 'renda_fixa',
  poupanca: 'renda_fixa',
  acao: 'renda_variavel',
  fii: 'renda_variavel',
  etf: 'renda_variavel',
  fundo: 'fundos',
  cripto: 'cripto',
  outro: 'outros',
};

export function assetClassOf(type: AssetType): AssetClass {
  return CLASS_BY_TYPE[type];
}

/** Only fixed income matures, so only it appears under "vencimentos próximos". */
export function isFixedIncome(type: AssetType): boolean {
  return assetClassOf(type) === 'renda_fixa';
}

/** An open position whose latest snapshot is older than this is flagged as stale. */
export const STALE_SNAPSHOT_DAYS = 45;

/** How far ahead "vencimentos próximos" looks. */
export const MATURITY_HORIZON_DAYS = 90;

/* ---------------------------------------------------------------------- periods */

export const PORTFOLIO_PERIODS = ['1m', '6m', '12m', 'all'] as const;
export type PortfolioPeriod = (typeof PORTFOLIO_PERIODS)[number];

export const PORTFOLIO_PERIOD_LABELS: Record<PortfolioPeriod, string> = {
  '1m': '1M',
  '6m': '6M',
  '12m': '12M',
  all: 'Tudo',
};

export const DEFAULT_PORTFOLIO_PERIOD: PortfolioPeriod = '12m';

const PERIOD_MONTHS: Record<Exclude<PortfolioPeriod, 'all'>, number> = {
  '1m': 1,
  '6m': 6,
  '12m': 12,
};

export function isPortfolioPeriod(value: string): value is PortfolioPeriod {
  return (PORTFOLIO_PERIODS as readonly string[]).includes(value);
}

/**
 * A window as a half-open interval `(start, end]`.
 *
 * `start` is an *anchor*, not a member: it is the day the opening balance is read on, and
 * a flow dated exactly on it belongs to that balance rather than to the period. Otherwise
 * a contribution made on the first day would be counted twice — once inside the opening
 * snapshot and once as new money.
 */
export interface DateRange {
  start: IsoDate;
  end: IsoDate;
}

/**
 * The window a period selector means, anchored to month ends.
 *
 * "1M" is the last day of the previous month up to today, not "today minus 30 days".
 * Snapshots land on month ends (the XP position is a month-end photograph), so a
 * day-aligned start would silently carry forward to the same month-end value anyway while
 * the label claimed a different window. Month anchoring also makes every bucket of
 * {@link monthlyMovement} a whole calendar month.
 *
 * `all` starts one month before the oldest movement, so the first month is a full bucket
 * and the opening balance is genuinely zero.
 */
export function periodRange(
  period: PortfolioPeriod,
  today: IsoDate,
  earliest: IsoDate | null = null,
): DateRange {
  const currentMonth = monthOf(today);

  if (period === 'all') {
    const firstMonth = earliest === null ? currentMonth : monthOf(earliest);
    return { start: monthEnd(addMonths(firstMonth, -1)), end: today };
  }

  return { start: monthEnd(addMonths(currentMonth, -PERIOD_MONTHS[period])), end: today };
}

/** The calendar months the window covers, oldest first — one bucket each. */
export function monthsInPeriod(range: DateRange): IsoMonth[] {
  const months: IsoMonth[] = [];
  const last = monthOf(range.end);

  for (let month = addMonths(monthOf(range.start), 1); month <= last; month = addMonths(month, 1)) {
    months.push(month);
  }

  return months;
}

/* ---------------------------------------------------------------- screen views */

/** The dimensions the allocation block can be read by — one at a time. */
export const ALLOCATION_DIMENSIONS = ['class', 'indexer', 'institution'] as const;
export type AllocationDimension = (typeof ALLOCATION_DIMENSIONS)[number];

export const ALLOCATION_DIMENSION_LABELS: Record<AllocationDimension, string> = {
  class: 'Classe',
  indexer: 'Indexador',
  institution: 'Instituição',
};

/** How the asset list can be ordered. Value first — it is the question being asked. */
export const ASSET_SORTS = ['value', 'return'] as const;
export type AssetSort = (typeof ASSET_SORTS)[number];

export const ASSET_SORT_LABELS: Record<AssetSort, string> = {
  value: 'Valor',
  return: 'Rentabilidade',
};

export function isAllocationDimension(value: string): value is AllocationDimension {
  return (ALLOCATION_DIMENSIONS as readonly string[]).includes(value);
}

export function isAssetSort(value: string): value is AssetSort {
  return (ASSET_SORTS as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------- valuation */

/** `Σ aportes − Σ resgates` up to and including `date`. */
export function investedUpTo(events: Iterable<AssetEventAmount>, date: IsoDate): Cents {
  let total = ZERO_CENTS;

  for (const event of events) {
    if (compareIsoDate(event.date, date) > 0) continue;
    total += event.type === 'contribution' ? event.amountCents : -event.amountCents;
  }

  return total;
}

/**
 * What one asset was worth on `date`: the latest snapshot on or before it, carried
 * forward — and, with no snapshot yet, what had been put in by then.
 *
 * The carry-forward is the rule `monthlyNetWorthSeries` and `assetPerformance` already
 * apply; it lives here so period maths and allocation read the same value the headline
 * total does (SPEC §12, "ativo sem snapshot entra no total pelo valor aportado").
 */
export function valueAt(
  events: Iterable<AssetEventAmount>,
  snapshots: Iterable<AssetSnapshotValue>,
  date: IsoDate,
): Cents {
  const snapshot = latestSnapshot(snapshots, date);
  return snapshot ? snapshot.grossValueCents : investedUpTo(events, date);
}

/** Net money that entered in `(start, end]` — contributions minus withdrawals. */
export function netFlowCents(events: Iterable<AssetEventAmount>, range: DateRange): Cents {
  let total = ZERO_CENTS;

  for (const event of events) {
    if (compareIsoDate(event.date, range.start) <= 0) continue;
    if (compareIsoDate(event.date, range.end) > 0) continue;
    total += event.type === 'contribution' ? event.amountCents : -event.amountCents;
  }

  return total;
}

/* ------------------------------------------------------- period profitability */

export interface PeriodPerformance {
  /** Effective start — later than the requested one when the series begins inside it. */
  start: IsoDate;
  end: IsoDate;
  startCents: Cents;
  endCents: Cents;
  /** Net new money in the window. */
  flowCents: Cents;
  /** `end − start − flow`: what the money earned, with deposits taken out. */
  gainCents: Cents;
  /** Modified Dietz. `null` when there is no positive base to measure against. */
  returnPercent: number | null;
  /**
   * The Modified Dietz denominator, in cents as a float. Not a {@link Cents} on purpose:
   * it is a *weighted* average balance, so it is not an integer number of cents. Kept on
   * the result so several assets can be combined into one portfolio return
   * ({@link aggregatePeriodPerformance}) instead of averaging percentages, which is wrong.
   */
  weightedBase: number;
  /** The series starts inside the window — the UI says "desde DD/MM" instead of "12M". */
  partial: boolean;
}

interface PeriodStart {
  date: IsoDate;
  cents: Cents;
  partial: boolean;
}

/**
 * Where the measurement actually begins.
 *
 * With a snapshot on or before the window's start, it is the window's start. Without one,
 * the period is measured from the first snapshot *inside* the window (SPEC §12): claiming
 * the whole window would credit growth that happened before anyone knew the value. With
 * no snapshot at all the asset is valued at what was put in, which yields a gain of zero
 * rather than an invented one.
 */
function resolvePeriodStart(
  events: readonly AssetEventAmount[],
  snapshots: readonly AssetSnapshotValue[],
  range: DateRange,
): PeriodStart {
  const opening = latestSnapshot(snapshots, range.start);
  if (opening) return { date: range.start, cents: opening.grossValueCents, partial: false };

  let firstInside: AssetSnapshotValue | null = null;
  for (const snapshot of snapshots) {
    if (compareIsoDate(snapshot.date, range.end) > 0) continue;
    if (firstInside === null || compareIsoDate(snapshot.date, firstInside.date) < 0) {
      firstInside = snapshot;
    }
  }

  if (firstInside)
    return { date: firstInside.date, cents: firstInside.grossValueCents, partial: true };

  return { date: range.start, cents: investedUpTo(events, range.start), partial: false };
}

/**
 * Modified Dietz return over a window (SPEC §12).
 *
 * ```
 * R = (Vf − Vi − F) / (Vi + Σ wi × Fi)      wi = (T − ti) / T
 * ```
 *
 * The numerator is exact `bigint` arithmetic. The denominator cannot be: it weights each
 * flow by the fraction of the window it was invested for, which is not a whole number of
 * cents — so it, and only it, crosses into `number` (the same concession
 * `percentOfCents` makes). The loss is in the last decimals of a percentage that is
 * displayed with one.
 */
export function periodPerformance(
  events: Iterable<AssetEventAmount>,
  snapshots: Iterable<AssetSnapshotValue>,
  range: DateRange,
): PeriodPerformance {
  const eventList = [...events];
  const snapshotList = [...snapshots];

  const start = resolvePeriodStart(eventList, snapshotList, range);
  const window: DateRange = { start: start.date, end: range.end };

  const endCents = valueAt(eventList, snapshotList, range.end);
  const flowCents = netFlowCents(eventList, window);
  const gainCents = endCents - start.cents - flowCents;

  const totalDays = diffDays(window.start, window.end);

  // A window with no days in it — the asset's first snapshot is today — has no base and
  // no return. Reporting 0% would claim the position stood still through a year nobody
  // measured it in; the UI shows "—" instead.
  let weightedBase = totalDays > 0 ? Number(start.cents) : 0;

  if (totalDays > 0) {
    for (const event of eventList) {
      if (compareIsoDate(event.date, window.start) <= 0) continue;
      if (compareIsoDate(event.date, window.end) > 0) continue;

      const signed = event.type === 'contribution' ? event.amountCents : -event.amountCents;
      const weight = (totalDays - diffDays(window.start, event.date)) / totalDays;
      weightedBase += Number(signed) * weight;
    }
  }

  return {
    start: window.start,
    end: window.end,
    startCents: start.cents,
    endCents,
    flowCents,
    gainCents,
    returnPercent: weightedBase > 0 ? (Number(gainCents) / weightedBase) * 100 : null,
    weightedBase,
    partial: start.partial,
  };
}

/**
 * One portfolio return out of several assets'.
 *
 * Percentages are not averaged — the weighted bases are added and the gains are added,
 * which is the same Modified Dietz applied to the whole portfolio. Averaging the
 * percentages would give a R$ 100 position the same say as a R$ 100.000 one.
 */
export function aggregatePeriodPerformance(
  parts: Iterable<PeriodPerformance>,
  range: DateRange,
): PeriodPerformance {
  let startCents = ZERO_CENTS;
  let endCents = ZERO_CENTS;
  let flowCents = ZERO_CENTS;
  let gainCents = ZERO_CENTS;
  let weightedBase = 0;

  for (const part of parts) {
    startCents += part.startCents;
    endCents += part.endCents;
    flowCents += part.flowCents;
    gainCents += part.gainCents;
    weightedBase += part.weightedBase;
  }

  return {
    start: range.start,
    end: range.end,
    startCents,
    endCents,
    flowCents,
    gainCents,
    returnPercent: weightedBase > 0 ? (Number(gainCents) / weightedBase) * 100 : null,
    weightedBase,
    partial: false,
  };
}

/* ------------------------------------------------------- monthly decomposition */

export interface MonthMovement {
  month: IsoMonth;
  /** Net new money in the month. */
  flowCents: Cents;
  /** What the month earned: the change in value with the flow taken out. */
  gainCents: Cents;
  /** Value at the end of the month (or at the end of the window, in the last one). */
  endCents: Cents;
}

/**
 * The window split month by month into "money I put in" and "money it earned" — the
 * chart that answers whether the portfolio is growing or just being fed.
 *
 * Buckets share {@link periodPerformance}'s opening balance and boundaries, so the gains
 * telescope: `Σ gain = Vf − Vi − F` exactly. Months before the asset's series starts get
 * zeroes rather than an invented gain.
 */
export function monthlyMovement(
  events: Iterable<AssetEventAmount>,
  snapshots: Iterable<AssetSnapshotValue>,
  range: DateRange,
): MonthMovement[] {
  const eventList = [...events];
  const snapshotList = [...snapshots];

  const start = resolvePeriodStart(eventList, snapshotList, range);

  let boundary = start.date;
  let previousCents = start.cents;

  return monthsInPeriod(range).map((month) => {
    const bucketEnd = minDate(monthEnd(month), range.end);
    const endCents = valueAt(eventList, snapshotList, bucketEnd);

    if (compareIsoDate(bucketEnd, start.date) <= 0) {
      return { month, flowCents: ZERO_CENTS, gainCents: ZERO_CENTS, endCents };
    }

    const flowCents = netFlowCents(eventList, { start: boundary, end: bucketEnd });
    const gainCents = endCents - previousCents - flowCents;

    boundary = bucketEnd;
    previousCents = endCents;

    return { month, flowCents, gainCents, endCents };
  });
}

/** Adds several assets' monthly decompositions into the portfolio's. */
export function sumMonthlyMovements(
  series: Iterable<readonly MonthMovement[]>,
  months: readonly IsoMonth[],
): MonthMovement[] {
  const totals = new Map<IsoMonth, MonthMovement>(
    months.map((month) => [
      month,
      { month, flowCents: ZERO_CENTS, gainCents: ZERO_CENTS, endCents: ZERO_CENTS },
    ]),
  );

  for (const movements of series) {
    for (const movement of movements) {
      const total = totals.get(movement.month);
      if (!total) continue;

      total.flowCents += movement.flowCents;
      total.gainCents += movement.gainCents;
      total.endCents += movement.endCents;
    }
  }

  return months.map((month) => totals.get(month) as MonthMovement);
}

/* ------------------------------------------------------------------ allocation */

export interface AllocationItem {
  key: string;
  label: string;
  cents: Cents;
}

export interface AllocationSlice extends AllocationItem {
  /** Share of the total. Slices always add up to exactly 100 (see below). */
  percent: number;
}

/** Above this, the tail is folded into a single "Outros" slice. */
export const MAX_ALLOCATION_SLICES = 5;

const TAIL_KEY = 'tail';

/**
 * Share of the whole per key, biggest first, with the long tail folded into "Outros".
 *
 * Non-positive amounts are dropped: a position worth nothing has no share of anything,
 * and a negative one (more withdrawn than contributed, no snapshot yet) would make the
 * percentages meaningless.
 */
export function allocate(
  items: Iterable<AllocationItem>,
  maxSlices: number = MAX_ALLOCATION_SLICES,
): AllocationSlice[] {
  const merged = new Map<string, AllocationItem>();

  for (const item of items) {
    if (item.cents <= ZERO_CENTS) continue;

    const current = merged.get(item.key);
    if (current) current.cents += item.cents;
    else merged.set(item.key, { ...item });
  }

  const sorted = [...merged.values()].sort(byCentsDesc);

  const head = sorted.length > maxSlices ? sorted.slice(0, maxSlices - 1) : sorted;
  const tail = sorted.length > maxSlices ? sorted.slice(maxSlices - 1) : [];

  if (tail.length > 0) {
    let cents = ZERO_CENTS;
    for (const item of tail) cents += item.cents;
    head.push({ key: TAIL_KEY, label: `Outros (${tail.length})`, cents });
  }

  const percents = apportionPercents(head.map((item) => item.cents));
  return head.map((item, index) => ({ ...item, percent: percents[index] ?? 0 }));
}

export interface Concentration {
  /** The biggest positions, biggest first. Percentages are of the whole portfolio. */
  top: AllocationSlice[];
  /** What the listed positions add up to. */
  topPercent: number;
}

/**
 * How much of the portfolio sits in its biggest positions.
 *
 * Descriptive, never prescriptive (SPEC §3): the screen states the fact and stops there —
 * no threshold, no warning colour, no "considere diversificar".
 */
export function concentrationOf(items: Iterable<AllocationItem>, limit = 5): Concentration {
  const positive = [...items].filter((item) => item.cents > ZERO_CENTS).sort(byCentsDesc);

  let total = ZERO_CENTS;
  for (const item of positive) total += item.cents;
  if (total <= ZERO_CENTS) return { top: [], topPercent: 0 };

  const top = positive.slice(0, limit).map((item) => ({
    ...item,
    percent: round1((Number(item.cents) / Number(total)) * 100),
  }));

  let topCents = ZERO_CENTS;
  for (const item of top) topCents += item.cents;

  return { top, topPercent: round1((Number(topCents) / Number(total)) * 100) };
}

/**
 * Percentages to one decimal that add up to exactly 100.
 *
 * Rounding each share independently is what produces a list of slices summing to 99,9%
 * or 100,1% right under a total that claims to be everything (SPEC §9). Largest
 * remainder: floor every share to a tenth of a percent, then hand the leftover tenths to
 * whoever was cut the most.
 */
function apportionPercents(values: readonly Cents[]): number[] {
  let total = ZERO_CENTS;
  for (const value of values) total += value;
  if (total <= ZERO_CENTS) return values.map(() => 0);

  // Tenths of a percent, so the whole is 1000 units.
  const units = values.map((value) => (value * 1000n) / total);

  let assigned = 0n;
  for (const value of units) assigned += value;

  // Whoever was cut the most gets the leftover tenths, one each — there are always
  // fewer leftovers than slices, so a single pass hands out all of them.
  const byRemainder = values
    .map((value, index) => ({ index, remainder: (value * 1000n) % total }))
    .sort((a, b) =>
      a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
    );

  let leftover = 1000n - assigned;
  for (const { index } of byRemainder) {
    if (leftover <= 0n) break;
    units[index] = (units[index] ?? 0n) + 1n;
    leftover -= 1n;
  }

  return units.map((value) => Number(value) / 10);
}

function byCentsDesc(a: AllocationItem, b: AllocationItem): number {
  if (a.cents === b.cents) return a.label.localeCompare(b.label, 'pt-BR');
  return a.cents > b.cents ? -1 : 1;
}

function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return compareIsoDate(a, b) <= 0 ? a : b;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
