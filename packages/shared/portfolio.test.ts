import { describe, expect, it } from 'vitest';
import type { AssetEventAmount, AssetSnapshotValue } from './assets';
import {
  aggregatePeriodPerformance,
  allocate,
  assetClassOf,
  concentrationOf,
  investedUpTo,
  monthlyMovement,
  monthsInPeriod,
  netFlowCents,
  periodPerformance,
  periodRange,
  sumMonthlyMovements,
  valueAt,
  type DateRange,
} from './portfolio';

const CDB = 'asset-cdb';
const FII = 'asset-fii';

function contribution(date: string, amountCents: bigint, assetId = CDB): AssetEventAmount {
  return { assetId, date, type: 'contribution', amountCents };
}

function withdrawal(date: string, amountCents: bigint, assetId = CDB): AssetEventAmount {
  return { assetId, date, type: 'withdrawal', amountCents };
}

function snapshot(date: string, grossValueCents: bigint, assetId = CDB): AssetSnapshotValue {
  return { assetId, date, grossValueCents };
}

function slice(key: string, cents: bigint) {
  return { key, label: key, cents };
}

/** Percentages are tenths; summing them as floats needs the last decimal snapped back. */
function sumPercents(slices: readonly { percent: number }[]): number {
  return Math.round(slices.reduce((total, item) => total + item.percent, 0) * 10) / 10;
}

describe('assetClassOf', () => {
  it('maps every fixed-income type to renda fixa', () => {
    expect(['cdb', 'tesouro', 'lci_lca', 'poupanca'].map((type) => assetClassOf(type as 'cdb'))).toEqual(
      ['renda_fixa', 'renda_fixa', 'renda_fixa', 'renda_fixa'],
    );
  });

  it('separates equities, funds and crypto', () => {
    expect(assetClassOf('acao')).toBe('renda_variavel');
    expect(assetClassOf('fii')).toBe('renda_variavel');
    expect(assetClassOf('etf')).toBe('renda_variavel');
    expect(assetClassOf('fundo')).toBe('fundos');
    expect(assetClassOf('cripto')).toBe('cripto');
    expect(assetClassOf('outro')).toBe('outros');
  });
});

describe('periodRange', () => {
  it('anchors the start at a month end', () => {
    expect(periodRange('1m', '2026-08-14')).toEqual({ start: '2026-07-31', end: '2026-08-14' });
    expect(periodRange('6m', '2026-08-14')).toEqual({ start: '2026-02-28', end: '2026-08-14' });
    expect(periodRange('12m', '2026-08-14')).toEqual({ start: '2025-08-31', end: '2026-08-14' });
  });

  it('starts "tudo" one month before the oldest movement, so the opening balance is zero', () => {
    expect(periodRange('all', '2026-08-14', '2025-03-09')).toEqual({
      start: '2025-02-28',
      end: '2026-08-14',
    });
  });

  it('falls back to the current month when there is no history at all', () => {
    expect(periodRange('all', '2026-08-14')).toEqual({ start: '2026-07-31', end: '2026-08-14' });
  });
});

describe('monthsInPeriod', () => {
  it('returns one whole bucket per month in the window', () => {
    expect(monthsInPeriod({ start: '2026-05-31', end: '2026-08-14' })).toEqual([
      '2026-06',
      '2026-07',
      '2026-08',
    ]);
  });

  it('gives twelve months for the 12M window', () => {
    expect(monthsInPeriod(periodRange('12m', '2026-08-14'))).toHaveLength(12);
  });
});

describe('valueAt', () => {
  const events = [contribution('2026-01-10', 1_000_000n)];
  const snapshots = [snapshot('2026-06-30', 1_040_000n), snapshot('2026-07-31', 1_060_000n)];

  it('carries the last snapshot forward', () => {
    expect(valueAt(events, snapshots, '2026-07-15')).toBe(1_040_000n);
    expect(valueAt(events, snapshots, '2026-12-31')).toBe(1_060_000n);
  });

  it('falls back to what was invested before the first snapshot', () => {
    expect(valueAt(events, snapshots, '2026-03-01')).toBe(1_000_000n);
  });

  it('is zero before the asset received anything', () => {
    expect(valueAt(events, snapshots, '2025-12-31')).toBe(0n);
  });
});

describe('investedUpTo', () => {
  it('nets withdrawals against contributions up to the date', () => {
    const events = [
      contribution('2026-01-10', 1_000_000n),
      withdrawal('2026-05-10', 200_000n),
      contribution('2026-09-10', 500_000n),
    ];

    expect(investedUpTo(events, '2026-06-30')).toBe(800_000n);
  });
});

describe('netFlowCents', () => {
  const range: DateRange = { start: '2026-06-30', end: '2026-07-31' };

  it('counts contributions minus withdrawals inside the window', () => {
    expect(
      netFlowCents([contribution('2026-07-01', 1_000_000n), withdrawal('2026-07-20', 300_000n)], range),
    ).toBe(700_000n);
  });

  it('excludes a flow dated on the anchor — it belongs to the opening balance', () => {
    expect(netFlowCents([contribution('2026-06-30', 1_000_000n)], range)).toBe(0n);
  });

  it('excludes flows after the window', () => {
    expect(netFlowCents([contribution('2026-08-01', 1_000_000n)], range)).toBe(0n);
  });
});

describe('periodPerformance', () => {
  // SPEC §9 (Fase 8): R$ 10.000 aportados em janeiro, snapshot de R$ 10.000 em 30/06,
  // aporte de R$ 10.000 em 01/07 e snapshot de R$ 20.400 em 31/07. No período "1M" a
  // valorização é R$ 400 — e não ~104%, que é o aporte contado como rendimento.
  it('does not read a mid-period contribution as yield', () => {
    const performance = periodPerformance(
      [contribution('2026-01-05', 1_000_000n), contribution('2026-07-01', 1_000_000n)],
      [snapshot('2026-06-30', 1_000_000n), snapshot('2026-07-31', 2_040_000n)],
      { start: '2026-06-30', end: '2026-07-31' },
    );

    expect(performance.startCents).toBe(1_000_000n);
    expect(performance.endCents).toBe(2_040_000n);
    expect(performance.flowCents).toBe(1_000_000n);
    expect(performance.gainCents).toBe(40_000n);

    // Vi + w×F = 1.000.000 + (30/31)×1.000.000 ≈ 1.967.742 cents.
    expect(performance.returnPercent).toBeCloseTo(2.03, 2);
    // The number the naive "final − inicial" would have produced.
    expect(performance.returnPercent).not.toBeCloseTo(104, 0);
  });

  it('is exactly the difference between the two values when nothing moved', () => {
    const performance = periodPerformance(
      [contribution('2026-01-05', 1_000_000n)],
      [snapshot('2026-06-30', 1_000_000n), snapshot('2026-07-31', 1_050_000n)],
      { start: '2026-06-30', end: '2026-07-31' },
    );

    expect(performance.flowCents).toBe(0n);
    expect(performance.gainCents).toBe(50_000n);
    expect(performance.returnPercent).toBeCloseTo(5, 6);
  });

  it('handles a full redemption', () => {
    const performance = periodPerformance(
      [contribution('2026-01-05', 1_000_000n), withdrawal('2026-07-15', 1_020_000n)],
      [snapshot('2026-06-30', 1_000_000n), snapshot('2026-07-31', 0n)],
      { start: '2026-06-30', end: '2026-07-31' },
    );

    expect(performance.endCents).toBe(0n);
    expect(performance.flowCents).toBe(-1_020_000n);
    expect(performance.gainCents).toBe(20_000n);
    expect(performance.returnPercent).not.toBeNull();
  });

  it('has no percentage without a positive base', () => {
    const performance = periodPerformance([], [], { start: '2026-06-30', end: '2026-07-31' });

    expect(performance.startCents).toBe(0n);
    expect(performance.gainCents).toBe(0n);
    expect(performance.returnPercent).toBeNull();
  });

  it('measures from the first snapshot when the series starts inside the window', () => {
    const performance = periodPerformance(
      [contribution('2026-01-05', 1_000_000n)],
      [snapshot('2026-07-15', 1_100_000n), snapshot('2026-08-31', 1_133_000n)],
      { start: '2025-08-31', end: '2026-08-31' },
    );

    expect(performance.partial).toBe(true);
    expect(performance.start).toBe('2026-07-15');
    expect(performance.startCents).toBe(1_100_000n);
    expect(performance.gainCents).toBe(33_000n);
    expect(performance.returnPercent).toBeCloseTo(3, 6);
  });

  it('reports no gain for an asset that has never been valued', () => {
    const performance = periodPerformance(
      [contribution('2026-01-05', 500_000n), contribution('2026-07-10', 200_000n)],
      [],
      { start: '2026-06-30', end: '2026-07-31' },
    );

    expect(performance.startCents).toBe(500_000n);
    expect(performance.endCents).toBe(700_000n);
    expect(performance.flowCents).toBe(200_000n);
    expect(performance.gainCents).toBe(0n);
    expect(performance.partial).toBe(false);
  });
});

describe('aggregatePeriodPerformance', () => {
  const range: DateRange = { start: '2026-06-30', end: '2026-07-31' };

  it('weights each asset by its size instead of averaging percentages', () => {
    const big = periodPerformance(
      [],
      [snapshot('2026-06-30', 10_000_000n), snapshot('2026-07-31', 10_100_000n)],
      range,
    );
    const small = periodPerformance(
      [],
      [snapshot('2026-06-30', 100_000n, FII), snapshot('2026-07-31', 110_000n, FII)],
      range,
    );

    const total = aggregatePeriodPerformance([big, small], range);

    expect(total.gainCents).toBe(110_000n);
    expect(total.startCents).toBe(10_100_000n);
    // 1% and 10% averaged would be 5,5%; weighted it is ~1,09%.
    expect(total.returnPercent).toBeCloseTo(1.089, 2);
  });
});

describe('monthlyMovement', () => {
  const range: DateRange = { start: '2026-05-31', end: '2026-08-31' };

  const events = [contribution('2026-06-10', 500_000n), withdrawal('2026-08-05', 100_000n)];
  const snapshots = [
    snapshot('2026-05-31', 1_000_000n),
    snapshot('2026-06-30', 1_520_000n),
    snapshot('2026-07-31', 1_540_000n),
    snapshot('2026-08-31', 1_450_000n),
  ];

  it('splits each month into new money and earnings', () => {
    expect(monthlyMovement(events, snapshots, range)).toEqual([
      { month: '2026-06', flowCents: 500_000n, gainCents: 20_000n, endCents: 1_520_000n },
      { month: '2026-07', flowCents: 0n, gainCents: 20_000n, endCents: 1_540_000n },
      { month: '2026-08', flowCents: -100_000n, gainCents: 10_000n, endCents: 1_450_000n },
    ]);
  });

  it('adds up to the period performance it decomposes', () => {
    const performance = periodPerformance(events, snapshots, range);

    const gain = monthlyMovement(events, snapshots, range).reduce(
      (total, month) => total + month.gainCents,
      0n,
    );
    const flow = monthlyMovement(events, snapshots, range).reduce(
      (total, month) => total + month.flowCents,
      0n,
    );

    expect(gain).toBe(performance.endCents - performance.startCents - performance.flowCents);
    expect(gain).toBe(performance.gainCents);
    expect(flow).toBe(performance.flowCents);
  });

  it('stays coherent when the series starts inside the window', () => {
    const late = [snapshot('2026-07-31', 1_000_000n), snapshot('2026-08-31', 1_030_000n)];
    const performance = periodPerformance([], late, range);

    const gain = monthlyMovement([], late, range).reduce(
      (total, month) => total + month.gainCents,
      0n,
    );

    expect(gain).toBe(performance.gainCents);
    expect(gain).toBe(30_000n);
  });
});

describe('sumMonthlyMovements', () => {
  it('adds several assets month by month', () => {
    const months = ['2026-07', '2026-08'];

    expect(
      sumMonthlyMovements(
        [
          [
            { month: '2026-07', flowCents: 100n, gainCents: 10n, endCents: 1000n },
            { month: '2026-08', flowCents: 0n, gainCents: -5n, endCents: 995n },
          ],
          [{ month: '2026-08', flowCents: 50n, gainCents: 2n, endCents: 52n }],
        ],
        months,
      ),
    ).toEqual([
      { month: '2026-07', flowCents: 100n, gainCents: 10n, endCents: 1000n },
      { month: '2026-08', flowCents: 50n, gainCents: -3n, endCents: 1047n },
    ]);
  });
});

describe('allocate', () => {
  it('orders by value and always adds up to 100%', () => {
    const slices = allocate([slice('rv', 400_000n), slice('rf', 600_000n)]);

    expect(slices.map((item) => item.key)).toEqual(['rf', 'rv']);
    expect(slices.map((item) => item.percent)).toEqual([60, 40]);
  });

  it('never shows 99,9% or 100,1% from independent rounding', () => {
    const slices = allocate([slice('a', 1n), slice('b', 1n), slice('c', 1n)]);

    expect(sumPercents(slices)).toBe(100);
    expect(slices.map((item) => item.percent)).toEqual([33.4, 33.3, 33.3]);
  });

  it('folds the long tail into a single slice', () => {
    const slices = allocate(
      [
        slice('a', 500n),
        slice('b', 300n),
        slice('c', 100n),
        slice('d', 50n),
        slice('e', 30n),
        slice('f', 20n),
      ],
      5,
    );

    expect(slices).toHaveLength(5);
    expect(slices.slice(0, 4).map((item) => item.key)).toEqual(['a', 'b', 'c', 'd']);
    expect(slices[4]?.key).toBe('tail');
    expect(slices[4]?.label).toBe('Outros (2)');
    expect(slices[4]?.cents).toBe(50n);
    expect(sumPercents(slices)).toBe(100);
  });

  it('merges items sharing a key and drops the non-positive ones', () => {
    const slices = allocate([slice('rf', 100n), slice('rf', 300n), slice('rv', 0n), slice('x', -50n)]);

    expect(slices).toEqual([{ key: 'rf', label: 'rf', cents: 400n, percent: 100 }]);
  });

  it('is empty when there is nothing to allocate', () => {
    expect(allocate([])).toEqual([]);
  });
});

describe('concentrationOf', () => {
  it('reports the biggest positions and what they add up to', () => {
    const { top, topPercent } = concentrationOf(
      [slice('a', 3_100n), slice('b', 2_000n), slice('c', 1_900n), slice('d', 3_000n)],
      2,
    );

    expect(top.map((item) => item.key)).toEqual(['a', 'd']);
    expect(top[0]?.percent).toBe(31);
    expect(topPercent).toBe(61);
  });

  it('is empty for an empty portfolio', () => {
    expect(concentrationOf([])).toEqual({ top: [], topPercent: 0 });
  });
});
