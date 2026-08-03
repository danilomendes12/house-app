/**
 * Money helpers.
 *
 * Every monetary value in this codebase is an integer number of cents stored in a
 * `bigint`. Never use `number` for money arithmetic — floats silently lose cents.
 */

/** Integer amount in BRL cents. */
export type Cents = bigint;

export const ZERO_CENTS: Cents = 0n;

export class InvalidAmountError extends Error {
  constructor(input: string) {
    super(`Invalid monetary amount: ${JSON.stringify(input)}`);
    this.name = 'InvalidAmountError';
  }
}

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const decimalFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * `Intl.NumberFormat` v3 accepts decimal strings for arbitrary precision, which is how we
 * format cents without ever converting them to a lossy `number`. The TS `lib` we target
 * still types `format` as number-only, hence the cast.
 */
function formatDecimalString(formatter: Intl.NumberFormat, decimal: string): string {
  return (formatter.format as unknown as (value: string) => string)(decimal);
}

/** `123456n` → `"R$ 1.234,56"`. */
export function formatCents(cents: Cents): string {
  return formatDecimalString(currencyFormatter, toDecimalString(cents));
}

/** `123456n` → `"1.234,56"` (no currency symbol — use in inputs and tight table cells). */
export function formatCentsPlain(cents: Cents): string {
  return formatDecimalString(decimalFormatter, toDecimalString(cents));
}

/**
 * `123456n` → `"1234.56"`. Machine-readable, always 2 decimals, dot separator.
 * Use for CSV export, API payloads and hashing — never for display.
 */
export function toDecimalString(cents: Cents): string {
  const negative = cents < ZERO_CENTS;
  const absolute = negative ? -cents : cents;
  const units = absolute / 100n;
  const fraction = absolute % 100n;
  return `${negative ? '-' : ''}${units}.${fraction.toString().padStart(2, '0')}`;
}

/**
 * Parses a human-typed BRL amount into cents.
 *
 * Accepts `"1.234,56"`, `"1234,56"`, `"1234.56"`, `"R$ 1.234,56"`, `"-12,30"`, `"1234"`.
 * Separator rules: when both `.` and `,` appear, the last one is the decimal separator.
 * When only `.` appears, it is the decimal separator unless it is followed by exactly
 * three digits (`"1.234"` → `1234` reais, thousands separator).
 *
 * @throws {InvalidAmountError} on garbage input or more than two decimal places
 *   (rounding money silently is a bug, not a convenience).
 */
export function parseCents(input: string): Cents {
  const cleaned = input.replace(/R\$/gi, '').replace(/\s/g, '');
  if (cleaned === '') throw new InvalidAmountError(input);

  const negative = cleaned.startsWith('-');
  const unsigned = negative ? cleaned.slice(1) : cleaned;
  if (!/^[\d.,]+$/.test(unsigned)) throw new InvalidAmountError(input);

  const lastComma = unsigned.lastIndexOf(',');
  const lastDot = unsigned.lastIndexOf('.');

  let decimalSeparatorIndex = -1;
  if (lastComma >= 0 && lastDot >= 0) {
    decimalSeparatorIndex = Math.max(lastComma, lastDot);
  } else if (lastComma >= 0) {
    decimalSeparatorIndex = lastComma;
  } else if (lastDot >= 0 && unsigned.length - lastDot - 1 !== 3) {
    decimalSeparatorIndex = lastDot;
  }

  const rawUnits = decimalSeparatorIndex >= 0 ? unsigned.slice(0, decimalSeparatorIndex) : unsigned;
  const rawFraction = decimalSeparatorIndex >= 0 ? unsigned.slice(decimalSeparatorIndex + 1) : '';

  // Thousands separators, when present, must group digits by three ("1.2.3,45" is garbage).
  if (/[.,]/.test(rawUnits) && !/^\d{1,3}(?:[.,]\d{3})*$/.test(rawUnits)) {
    throw new InvalidAmountError(input);
  }

  const units = rawUnits.replace(/[.,]/g, '');
  if (!/^\d*$/.test(units) || !/^\d*$/.test(rawFraction)) throw new InvalidAmountError(input);
  if (units === '' && rawFraction === '') throw new InvalidAmountError(input);
  if (rawFraction.length > 2) throw new InvalidAmountError(input);

  const fraction = rawFraction.padEnd(2, '0');
  const value =
    BigInt(units === '' ? '0' : units) * 100n + BigInt(fraction === '' ? '0' : fraction);
  return negative ? -value : value;
}

/** Same as {@link parseCents} but returns `null` instead of throwing. For form validation. */
export function parseCentsOrNull(input: string): Cents | null {
  try {
    return parseCents(input);
  } catch {
    return null;
  }
}

/**
 * Serialization boundary: a `bigint` column arrives from PostgREST as a JSON number.
 * Converts it back to {@link Cents} without ever doing arithmetic on the `number`.
 *
 * @throws {InvalidAmountError} if the value is not an exact integer — anything that lost
 *   precision on the way here is a bug we want to hear about, not to round away.
 */
export function toCents(value: bigint | number | string): Cents {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new InvalidAmountError(String(value));
    return BigInt(value);
  }
  if (!/^-?\d+$/.test(value)) throw new InvalidAmountError(value);
  return BigInt(value);
}

/**
 * The other half of {@link toCents}: cents as a JSON-safe integer, for writes.
 * Serialization only — never feed the result into money arithmetic.
 *
 * @throws {InvalidAmountError} above `Number.MAX_SAFE_INTEGER` cents (~R$ 90 trilhões).
 */
export function fromCents(cents: Cents): number {
  const value = Number(cents);
  if (!Number.isSafeInteger(value)) throw new InvalidAmountError(cents.toString());
  return value;
}

export function sumCents(values: Iterable<Cents>): Cents {
  let total = ZERO_CENTS;
  for (const value of values) total += value;
  return total;
}

export function absCents(cents: Cents): Cents {
  return cents < ZERO_CENTS ? -cents : cents;
}

/**
 * `part / whole` as a percentage (`0`–`100+`, not clamped). Returns `0` when `whole`
 * is zero. Lossy by design — for progress bars and labels only, never for stored values.
 */
export function percentOfCents(part: Cents, whole: Cents): number {
  if (whole === ZERO_CENTS) return 0;
  return Number((part * 10000n) / whole) / 100;
}

/**
 * Cents as a floating-point number of reais. Lossy — charts and Intl only.
 * Never feed the result back into money arithmetic.
 */
export function toReais(cents: Cents): number {
  return Number(cents) / 100;
}
