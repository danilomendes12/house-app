import { describe, expect, it } from 'vitest';
import { summarizeMonth, type CategorizedAmount } from './summary';

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
