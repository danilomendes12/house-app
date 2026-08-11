import { describe, expect, it } from 'vitest';
import {
  assetPerformance,
  investedCents,
  latestSnapshot,
  monthlyNetWorthSeries,
  netWorthAt,
  type AssetEventAmount,
  type AssetSnapshotValue,
} from './assets';

const CDB = 'asset-cdb';
const FII = 'asset-fii';

function contribution(assetId: string, date: string, amountCents: bigint): AssetEventAmount {
  return { assetId, date, type: 'contribution', amountCents };
}

function withdrawal(assetId: string, date: string, amountCents: bigint): AssetEventAmount {
  return { assetId, date, type: 'withdrawal', amountCents };
}

function snapshot(assetId: string, date: string, grossValueCents: bigint): AssetSnapshotValue {
  return { assetId, date, grossValueCents };
}

describe('investedCents', () => {
  it('nets withdrawals against contributions', () => {
    expect(
      investedCents([
        contribution(CDB, '2026-01-10', 1_000_000n),
        contribution(CDB, '2026-02-10', 500_000n),
        withdrawal(CDB, '2026-03-10', 200_000n),
      ]),
    ).toBe(1_300_000n);
  });

  it('is zero for an asset with no events', () => {
    expect(investedCents([])).toBe(0n);
  });

  it('goes negative when more came out than went in', () => {
    expect(
      investedCents([contribution(CDB, '2026-01-10', 100n), withdrawal(CDB, '2026-06-10', 500n)]),
    ).toBe(-400n);
  });
});

describe('latestSnapshot', () => {
  const snapshots = [
    snapshot(CDB, '2026-03-31', 300n),
    snapshot(CDB, '2026-01-31', 100n),
    snapshot(CDB, '2026-02-28', 200n),
  ];

  it('finds the most recent one regardless of input order', () => {
    expect(latestSnapshot(snapshots)?.grossValueCents).toBe(300n);
  });

  it('respects an as-of date', () => {
    expect(latestSnapshot(snapshots, '2026-02-28')?.grossValueCents).toBe(200n);
  });

  it('returns null when nothing is on or before the date', () => {
    expect(latestSnapshot(snapshots, '2025-12-31')).toBeNull();
  });
});

describe('assetPerformance', () => {
  // SPEC §9: aportes de R$ 10.000 e snapshot de R$ 10.480 → rendimento de R$ 480 (+4,8%).
  it('matches the acceptance criterion', () => {
    const performance = assetPerformance(
      [contribution(CDB, '2026-01-10', 1_000_000n)],
      [snapshot(CDB, '2026-08-01', 1_048_000n)],
    );

    expect(performance.investedCents).toBe(1_000_000n);
    expect(performance.currentCents).toBe(1_048_000n);
    expect(performance.yieldCents).toBe(48_000n);
    expect(performance.yieldPercent).toBe(4.8);
  });

  it('reports a loss when the snapshot is below what was put in', () => {
    const performance = assetPerformance(
      [contribution(FII, '2026-01-10', 1_000_000n)],
      [snapshot(FII, '2026-08-01', 920_000n)],
    );

    expect(performance.yieldCents).toBe(-80_000n);
    expect(performance.yieldPercent).toBe(-8);
  });

  it('treats an asset with no snapshot as worth what was contributed', () => {
    const performance = assetPerformance([contribution(CDB, '2026-01-10', 1_000_000n)], []);

    expect(performance.currentCents).toBe(1_000_000n);
    expect(performance.yieldCents).toBe(0n);
    expect(performance.snapshotDate).toBeNull();
  });

  it('accounts for a withdrawal in the invested base', () => {
    const performance = assetPerformance(
      [contribution(CDB, '2026-01-10', 1_000_000n), withdrawal(CDB, '2026-05-10', 400_000n)],
      [snapshot(CDB, '2026-08-01', 630_000n)],
    );

    expect(performance.investedCents).toBe(600_000n);
    expect(performance.yieldCents).toBe(30_000n);
    expect(performance.yieldPercent).toBe(5);
  });

  it('has no percentage without a positive base', () => {
    expect(assetPerformance([], [snapshot(CDB, '2026-08-01', 500n)]).yieldPercent).toBeNull();
  });
});

describe('netWorthAt', () => {
  const snapshots = [
    snapshot(CDB, '2026-07-31', 1_000_000n),
    snapshot(CDB, '2026-08-31', 1_010_000n),
    snapshot(FII, '2026-08-15', 500_000n),
  ];

  it('sums the latest snapshot of each open asset', () => {
    expect(netWorthAt(snapshots, new Set([CDB, FII]))).toBe(1_510_000n);
  });

  it('uses the value as of a past date', () => {
    expect(netWorthAt(snapshots, new Set([CDB, FII]), '2026-08-01')).toBe(1_000_000n);
  });

  it('excludes closed assets', () => {
    expect(netWorthAt(snapshots, new Set([CDB]))).toBe(1_010_000n);
  });
});

describe('monthlyNetWorthSeries', () => {
  const months = ['2026-06', '2026-07', '2026-08'];

  it('uses the last snapshot of each month', () => {
    const series = monthlyNetWorthSeries(
      [
        snapshot(CDB, '2026-06-10', 100n),
        snapshot(CDB, '2026-06-30', 130n),
        snapshot(CDB, '2026-07-31', 200n),
        snapshot(CDB, '2026-08-31', 300n),
      ],
      months,
    );

    expect(series.map((point) => point.totalCents)).toEqual([130n, 200n, 300n]);
  });

  it('carries the last known value into a month with no snapshot', () => {
    const series = monthlyNetWorthSeries([snapshot(CDB, '2026-06-30', 1000n)], months);

    expect(series.map((point) => point.totalCents)).toEqual([1000n, 1000n, 1000n]);
  });

  it('contributes nothing before an asset has its first snapshot', () => {
    const series = monthlyNetWorthSeries([snapshot(FII, '2026-08-15', 500n)], months);

    expect(series.map((point) => point.totalCents)).toEqual([0n, 0n, 500n]);
  });

  it('adds assets together across months', () => {
    const series = monthlyNetWorthSeries(
      [snapshot(CDB, '2026-06-30', 1000n), snapshot(FII, '2026-07-31', 500n)],
      months,
    );

    expect(series.map((point) => point.totalCents)).toEqual([1000n, 1500n, 1500n]);
  });

  it('keeps a closed asset in the months it was held but drops it afterwards', () => {
    const series = monthlyNetWorthSeries(
      [snapshot(CDB, '2026-06-30', 1000n), snapshot(FII, '2026-06-30', 400n)],
      months,
      new Set([FII]),
    );

    expect(series.map((point) => point.totalCents)).toEqual([1400n, 1000n, 1000n]);
  });

  it('returns a point per requested month even with no snapshots at all', () => {
    expect(monthlyNetWorthSeries([], months)).toEqual([
      { month: '2026-06', totalCents: 0n },
      { month: '2026-07', totalCents: 0n },
      { month: '2026-08', totalCents: 0n },
    ]);
  });
});
