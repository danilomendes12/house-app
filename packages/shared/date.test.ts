import { describe, expect, it } from 'vitest';
import {
  InvalidDateError,
  addDays,
  addMonths,
  compareIsoDate,
  diffDays,
  formatIsoDate,
  formatIsoMonth,
  isIsoDate,
  isIsoMonth,
  lastMonths,
  monthEnd,
  monthOf,
  monthRange,
  monthStart,
  splitIsoDate,
  todayIso,
} from './date';

describe('validation', () => {
  it('accepts real calendar dates', () => {
    expect(isIsoDate('2026-08-02')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true);
  });

  it('rejects malformed or impossible dates', () => {
    for (const value of ['2026-8-2', '2026-02-30', '2023-02-29', '2026-13-01', 'hoje', '']) {
      expect(isIsoDate(value), value).toBe(false);
    }
    expect(() => splitIsoDate('2026-8-2')).toThrow(InvalidDateError);
  });

  it('validates months', () => {
    expect(isIsoMonth('2026-08')).toBe(true);
    expect(isIsoMonth('2026-00')).toBe(false);
    expect(isIsoMonth('2026-08-01')).toBe(false);
  });
});

describe('month math', () => {
  it('derives month boundaries', () => {
    expect(monthOf('2026-08-17')).toBe('2026-08');
    expect(monthStart('2026-08-17')).toBe('2026-08-01');
    expect(monthStart('2026-08')).toBe('2026-08-01');
    expect(monthEnd('2026-02')).toBe('2026-02-28');
    expect(monthEnd('2024-02')).toBe('2024-02-29');
    expect(monthEnd('2026-12')).toBe('2026-12-31');
  });

  it('produces a half-open range for SQL queries', () => {
    expect(monthRange('2026-08')).toEqual({ start: '2026-08-01', endExclusive: '2026-09-01' });
    expect(monthRange('2026-12-31')).toEqual({ start: '2026-12-01', endExclusive: '2027-01-01' });
  });

  it('adds months across year boundaries', () => {
    expect(addMonths('2026-08', 1)).toBe('2026-09');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-08', -14)).toBe('2025-06');
    expect(addMonths('2026-08', 0)).toBe('2026-08');
  });

  it('builds trailing month windows for trend charts', () => {
    expect(lastMonths('2026-03', 6)).toEqual([
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
    ]);
  });
});

describe('day math', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-03-03', -7)).toBe('2026-02-24');
  });

  it('does not shift days across DST or timezone offsets', () => {
    // Brazil abolished DST in 2019, but the helper must be immune regardless:
    // a naive local-time implementation drifts on these dates.
    expect(addDays('2018-11-04', 0)).toBe('2018-11-04');
    expect(addDays('2018-02-17', 1)).toBe('2018-02-18');
    expect(diffDays('2018-11-03', '2018-11-05')).toBe(2);
  });

  it('counts days between dates', () => {
    expect(diffDays('2026-08-01', '2026-08-31')).toBe(30);
    expect(diffDays('2026-08-31', '2026-08-01')).toBe(-30);
  });

  it('sorts chronologically as plain strings', () => {
    expect(['2026-08-10', '2026-01-02', '2025-12-31'].sort(compareIsoDate)).toEqual([
      '2025-12-31',
      '2026-01-02',
      '2026-08-10',
    ]);
  });
});

describe('formatting', () => {
  it('formats dates and months in pt-BR', () => {
    expect(formatIsoDate('2026-08-02')).toBe('02/08/2026');
    expect(formatIsoMonth('2026-08')).toBe('agosto de 2026');
  });
});

describe('todayIso', () => {
  it('returns a valid date in the reference timezone', () => {
    expect(isIsoDate(todayIso())).toBe(true);
  });

  it('uses São Paulo, not UTC, to decide the day', () => {
    // 2026-08-03T02:00Z is still 2026-08-02 in São Paulo (UTC-3).
    const utcMidnightish = new Date('2026-08-03T02:00:00Z');
    const inSaoPaulo = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(utcMidnightish);
    expect(inSaoPaulo).toBe('2026-08-02');
  });
});
