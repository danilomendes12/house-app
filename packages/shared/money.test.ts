import { describe, expect, it } from 'vitest';
import {
  InvalidAmountError,
  absCents,
  formatCents,
  formatCentsPlain,
  parseCents,
  parseCentsOrNull,
  percentOfCents,
  sumCents,
  toDecimalString,
  toReais,
} from './money';

describe('parseCents', () => {
  it('parses pt-BR formatted amounts', () => {
    expect(parseCents('1.234,56')).toBe(123456n);
    expect(parseCents('R$ 1.234,56')).toBe(123456n);
    expect(parseCents('r$1.234,56')).toBe(123456n);
    expect(parseCents('1234,56')).toBe(123456n);
    expect(parseCents('0,05')).toBe(5n);
    expect(parseCents('12,3')).toBe(1230n);
  });

  it('parses machine formatted amounts', () => {
    expect(parseCents('1234.56')).toBe(123456n);
    expect(parseCents('1234')).toBe(123400n);
    expect(parseCents('0')).toBe(0n);
  });

  it('treats a lone dot before three digits as a thousands separator', () => {
    expect(parseCents('1.234')).toBe(123400n);
    expect(parseCents('12.34')).toBe(1234n);
  });

  it('handles negative amounts (refunds)', () => {
    expect(parseCents('-12,30')).toBe(-1230n);
    expect(parseCents('-R$ 1.000,00')).toBe(-100000n);
  });

  it('handles multiple thousands separators', () => {
    expect(parseCents('1.234.567,89')).toBe(123456789n);
    expect(parseCents('1,234,567.89')).toBe(123456789n);
  });

  it('is lossless for values beyond float precision', () => {
    expect(parseCents('90071992547409.91')).toBe(9007199254740991n);
  });

  it('rejects garbage and silent rounding', () => {
    for (const input of ['', '   ', 'abc', '12,345', '1.2.3,45', 'R$', '--1', '12,3a']) {
      expect(() => parseCents(input), input).toThrow(InvalidAmountError);
      expect(parseCentsOrNull(input), input).toBeNull();
    }
  });
});

describe('formatting', () => {
  it('formats cents as BRL', () => {
    // Intl uses a non-breaking space after the symbol.
    expect(formatCents(123456n).replace(/\s/g, ' ')).toBe('R$ 1.234,56');
    expect(formatCents(0n).replace(/\s/g, ' ')).toBe('R$ 0,00');
    expect(formatCents(-500n).replace(/\s/g, ' ')).toBe('-R$ 5,00');
  });

  it('formats cents without the currency symbol', () => {
    expect(formatCentsPlain(123456n)).toBe('1.234,56');
    expect(formatCentsPlain(5n)).toBe('0,05');
  });

  it('round-trips through the machine representation', () => {
    for (const cents of [0n, 5n, 123456n, -1230n, 9007199254740991n]) {
      expect(parseCents(toDecimalString(cents))).toBe(cents);
    }
  });
});

describe('arithmetic', () => {
  it('sums without floating point drift', () => {
    const values = Array.from({ length: 10 }, () => 10n); // 10 × R$ 0,10
    expect(sumCents(values)).toBe(100n);
    expect(sumCents([])).toBe(0n);
  });

  it('computes percentages for progress bars', () => {
    expect(percentOfCents(60000n, 80000n)).toBe(75);
    expect(percentOfCents(90000n, 80000n)).toBe(112.5);
    expect(percentOfCents(1n, 0n)).toBe(0);
  });

  it('exposes absolute value and lossy reais conversion', () => {
    expect(absCents(-1230n)).toBe(1230n);
    expect(toReais(123456n)).toBe(1234.56);
  });
});
