import { describe, expect, it } from 'vitest';
import { lastMonths } from './date';
import {
  changeOf,
  compareMonths,
  isTrendWindow,
  monthlySpendSeries,
  topCategories,
  type DatedAmount,
  type MonthPoint,
} from './trend';

const MERCADO = 'cat-mercado';
const LAZER = 'cat-lazer';
const SALARIO = 'cat-salario';

function expense(date: string, categoryId: string | null, amountCents: bigint): DatedAmount {
  return { date, categoryId, type: 'expense', amountCents };
}

function income(date: string, categoryId: string | null, amountCents: bigint): DatedAmount {
  return { date, categoryId, type: 'income', amountCents };
}

/** Builds a point directly, for the comparison tests that do not need a series. */
function point(month: string, byCategory: Record<string, bigint>): MonthPoint {
  const entries = Object.entries(byCategory).map(([key, cents]) => [key, cents] as const);
  return {
    month,
    totalCents: entries.reduce((total, [, cents]) => total + cents, 0n),
    byCategory: new Map(entries),
  };
}

describe('monthlySpendSeries', () => {
  const months = lastMonths('2026-08', 3); // 2026-06, 2026-07, 2026-08

  it('totals net spending per month', () => {
    const series = monthlySpendSeries(
      [
        expense('2026-06-10', MERCADO, 30000n),
        expense('2026-07-02', MERCADO, 40000n),
        expense('2026-07-20', LAZER, 5000n),
        expense('2026-08-01', LAZER, 2500n),
      ],
      months,
    );

    expect(series.map((p) => p.month)).toEqual(['2026-06', '2026-07', '2026-08']);
    expect(series.map((p) => p.totalCents)).toEqual([30000n, 45000n, 2500n]);
  });

  it('emits a zeroed point for a month with no movement', () => {
    const series = monthlySpendSeries([expense('2026-08-01', MERCADO, 1000n)], months);

    expect(series[0]).toMatchObject({ month: '2026-06', totalCents: 0n });
    expect(series[0]?.byCategory.size).toBe(0);
    expect(series).toHaveLength(3);
  });

  it('nets a refund against the category that took the hit', () => {
    const series = monthlySpendSeries(
      [expense('2026-08-05', MERCADO, 30000n), income('2026-08-09', MERCADO, 1250n)],
      months,
    );

    expect(series[2]?.totalCents).toBe(28750n);
    expect(series[2]?.byCategory.get(MERCADO)).toBe(28750n);
  });

  it('excludes income categories entirely (SPEC §12)', () => {
    const series = monthlySpendSeries(
      [expense('2026-08-05', MERCADO, 30000n), income('2026-08-05', SALARIO, 900000n)],
      months,
      new Set([SALARIO]),
    );

    expect(series[2]?.totalCents).toBe(30000n);
    expect(series[2]?.byCategory.has(SALARIO)).toBe(false);
  });

  it('keeps uncategorized spending under the null key', () => {
    const series = monthlySpendSeries([expense('2026-08-05', null, 700n)], months);

    expect(series[2]?.byCategory.get(null)).toBe(700n);
  });

  it('ignores transactions outside the window', () => {
    const series = monthlySpendSeries(
      [expense('2026-01-05', MERCADO, 99999n), expense('2026-08-05', MERCADO, 100n)],
      months,
    );

    expect(series.reduce((total, p) => total + p.totalCents, 0n)).toBe(100n);
  });
});

describe('changeOf', () => {
  it('reports growth as an amount and a percentage', () => {
    expect(changeOf(60000n, 50000n)).toMatchObject({
      deltaCents: 10000n,
      percentChange: 20,
      direction: 'up',
    });
  });

  it('reports a drop', () => {
    expect(changeOf(40000n, 50000n)).toMatchObject({
      deltaCents: -10000n,
      percentChange: -20,
      direction: 'down',
    });
  });

  it('calls a category that appeared "new" instead of an infinite percentage', () => {
    expect(changeOf(30000n, 0n)).toMatchObject({
      deltaCents: 30000n,
      percentChange: null,
      direction: 'new',
    });
  });

  it('calls a category that stopped "gone", at -100%', () => {
    expect(changeOf(0n, 30000n)).toMatchObject({
      deltaCents: -30000n,
      percentChange: -100,
      direction: 'gone',
    });
  });

  it('reports no change as flat', () => {
    expect(changeOf(30000n, 30000n)).toMatchObject({ deltaCents: 0n, direction: 'flat' });
    expect(changeOf(0n, 0n)).toMatchObject({ percentChange: null, direction: 'flat' });
  });

  it('refuses a percentage anchored on a negative month', () => {
    // Refunds outweighed spending last month; "+X%" against that is meaningless.
    expect(changeOf(1000n, -500n)).toMatchObject({ percentChange: null, direction: 'new' });
  });

  it('stays exact for amounts beyond float precision', () => {
    expect(changeOf(9007199254740991n, 9007199254740991n).deltaCents).toBe(0n);
  });
});

describe('compareMonths', () => {
  const current = point('2026-08', { [MERCADO]: 60000n, [LAZER]: 2000n, novo: 15000n });
  const previous = point('2026-07', { [MERCADO]: 50000n, [LAZER]: 9000n, antigo: 3000n });

  it('ranks by amount moved, biggest increase first and biggest drop last', () => {
    const changes = compareMonths(current, previous);

    // novo +150,00 · mercado +100,00 · antigo −30,00 · lazer −70,00
    expect(changes.map((c) => c.categoryId)).toEqual(['novo', MERCADO, 'antigo', LAZER]);
  });

  it('carries the amount and percentage per category', () => {
    const [, mercado] = compareMonths(current, previous);

    expect(mercado).toMatchObject({
      categoryId: MERCADO,
      currentCents: 60000n,
      previousCents: 50000n,
      deltaCents: 10000n,
      percentChange: 20,
      direction: 'up',
    });
  });

  it('includes categories present in only one of the months', () => {
    const changes = compareMonths(current, previous);

    expect(changes.find((c) => c.categoryId === 'novo')).toMatchObject({ direction: 'new' });
    expect(changes.find((c) => c.categoryId === 'antigo')).toMatchObject({ direction: 'gone' });
  });

  it('drops categories that were zero in both months', () => {
    const changes = compareMonths(point('2026-08', { [MERCADO]: 0n }), point('2026-07', {}));

    expect(changes).toEqual([]);
  });
});

describe('topCategories', () => {
  it('picks the biggest spenders across the whole window', () => {
    const points = [
      point('2026-06', { [MERCADO]: 10000n, [LAZER]: 30000n }),
      point('2026-07', { [MERCADO]: 90000n, [LAZER]: 1000n }),
    ];

    expect(topCategories(points, 2)).toEqual([MERCADO, LAZER]);
    expect(topCategories(points, 1)).toEqual([MERCADO]);
  });

  it('skips categories that net to zero or less', () => {
    const points = [point('2026-06', { [MERCADO]: 5000n, [LAZER]: -100n, zerado: 0n })];

    expect(topCategories(points, 5)).toEqual([MERCADO]);
  });
});

describe('isTrendWindow', () => {
  it('accepts only the offered windows', () => {
    expect(isTrendWindow(6)).toBe(true);
    expect(isTrendWindow(5)).toBe(false);
  });
});
