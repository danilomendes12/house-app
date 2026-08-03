import { describe, expect, it } from 'vitest';
import { budgetStatus, summarizeMonth, type CategorizedAmount } from './budget';

const MERCADO = 'cat-mercado';
const LAZER = 'cat-lazer';

function expense(categoryId: string | null, amountCents: bigint): CategorizedAmount {
  return { categoryId, type: 'expense', amountCents };
}

function income(categoryId: string | null, amountCents: bigint): CategorizedAmount {
  return { categoryId, type: 'income', amountCents };
}

describe('summarizeMonth', () => {
  it('totals expenses and income separately', () => {
    const totals = summarizeMonth([
      expense(MERCADO, 30000n),
      expense(LAZER, 5000n),
      income(MERCADO, 1000n),
    ]);

    expect(totals.expenseCents).toBe(35000n);
    expect(totals.incomeCents).toBe(1000n);
  });

  it('nets refunds against spending in the same category', () => {
    const totals = summarizeMonth([expense(MERCADO, 30000n), income(MERCADO, 1250n)]);
    const mercado = totals.byCategory.get(MERCADO);

    expect(mercado?.expenseCents).toBe(30000n);
    expect(mercado?.incomeCents).toBe(1250n);
    expect(mercado?.netCents).toBe(28750n);
  });

  it('keeps a category net negative when refunds outweigh spending', () => {
    const totals = summarizeMonth([expense(LAZER, 1000n), income(LAZER, 4000n)]);

    expect(totals.byCategory.get(LAZER)?.netCents).toBe(-3000n);
  });

  it('groups uncategorized transactions under the null key', () => {
    const totals = summarizeMonth([expense(null, 900n), expense(null, 100n)]);

    expect(totals.byCategory.get(null)?.netCents).toBe(1000n);
    expect(totals.byCategory.size).toBe(1);
  });

  it('returns zeroed totals for an empty month', () => {
    const totals = summarizeMonth([]);

    expect(totals.expenseCents).toBe(0n);
    expect(totals.incomeCents).toBe(0n);
    expect(totals.byCategory.size).toBe(0);
  });
});

describe('budgetStatus', () => {
  it('reports what is left of the budget (SPEC §9)', () => {
    // R$ 800 budgeted, R$ 600 spent → R$ 200 left, bar at 75%.
    const status = budgetStatus(60000n, 80000n);

    expect(status.remainingCents).toBe(20000n);
    expect(status.percentUsed).toBe(75);
    expect(status.overCents).toBe(0n);
    expect(status.state).toBe('within');
  });

  it('reports the overspend once the budget is blown', () => {
    const status = budgetStatus(90000n, 80000n);

    expect(status.remainingCents).toBe(-10000n);
    expect(status.overCents).toBe(10000n);
    expect(status.percentUsed).toBeCloseTo(112.5);
    expect(status.state).toBe('over');
  });

  it('treats an exactly spent budget as still within it', () => {
    const status = budgetStatus(80000n, 80000n);

    expect(status.remainingCents).toBe(0n);
    expect(status.percentUsed).toBe(100);
    expect(status.state).toBe('within');
  });

  it('has no progress bar without a budget', () => {
    const status = budgetStatus(60000n, null);

    expect(status.budgetCents).toBeNull();
    expect(status.remainingCents).toBeNull();
    expect(status.percentUsed).toBe(0);
    expect(status.state).toBe('no-budget');
  });

  it('handles a zero budget without dividing by zero', () => {
    expect(budgetStatus(0n, 0n)).toMatchObject({ percentUsed: 0, state: 'within' });
    expect(budgetStatus(500n, 0n)).toMatchObject({
      percentUsed: 100,
      overCents: 500n,
      state: 'over',
    });
  });

  it('never reports negative progress when refunds outweigh spending', () => {
    const status = budgetStatus(-3000n, 80000n);

    expect(status.percentUsed).toBe(0);
    expect(status.remainingCents).toBe(83000n);
    expect(status.state).toBe('within');
  });
});
