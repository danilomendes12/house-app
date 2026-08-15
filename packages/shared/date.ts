/**
 * Business-date helpers.
 *
 * Transaction dates are calendar dates without time. They are represented as
 * `YYYY-MM-DD` strings and manipulated as strings or via UTC arithmetic — never through
 * `new Date('2026-08-01')` + local getters, which shifts the day in America/Sao_Paulo.
 */

/** Reference timezone for "today" and for anything user-facing. */
export const APP_TIME_ZONE = 'America/Sao_Paulo';

/** Calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;

/** Calendar month, `YYYY-MM`. */
export type IsoMonth = string;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH_RE = /^\d{4}-\d{2}$/;

export class InvalidDateError extends Error {
  constructor(input: string) {
    super(`Invalid ISO date: ${JSON.stringify(input)}`);
    this.name = 'InvalidDateError';
  }
}

export function isIsoDate(value: string): value is IsoDate {
  if (!ISO_DATE_RE.test(value)) return false;
  const { year, month, day } = splitIsoDate(value);
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

export function isIsoMonth(value: string): value is IsoMonth {
  if (!ISO_MONTH_RE.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

export function assertIsoDate(value: string): IsoDate {
  if (!isIsoDate(value)) throw new InvalidDateError(value);
  return value;
}

/**
 * The calendar date an instant falls on, in `timeZone`.
 *
 * The conversion has to go through `Intl`: a timestamp near midnight belongs to a different
 * day in São Paulo than in UTC, and reading it with `getUTCDate` is the off-day bug this
 * module exists to prevent.
 */
export function isoDateAt(instant: Date, timeZone: string = APP_TIME_ZONE): IsoDate {
  // 'en-CA' yields YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Today's calendar date in the app timezone. */
export function todayIso(timeZone: string = APP_TIME_ZONE): IsoDate {
  return isoDateAt(new Date(), timeZone);
}

/** Current month in the app timezone. */
export function currentIsoMonth(timeZone: string = APP_TIME_ZONE): IsoMonth {
  return monthOf(todayIso(timeZone));
}

export function toIsoDate(year: number, month: number, day: number): IsoDate {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

export function splitIsoDate(date: IsoDate): { year: number; month: number; day: number } {
  if (!ISO_DATE_RE.test(date)) throw new InvalidDateError(date);
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

/** `'2026-08-17'` → `'2026-08'`. */
export function monthOf(date: IsoDate): IsoMonth {
  assertIsoDate(date);
  return date.slice(0, 7);
}

/** `'2026-08'` (or any date in it) → `'2026-08-01'` — the shape stored in `budgets.month`. */
export function monthStart(monthOrDate: IsoMonth | IsoDate): IsoDate {
  return `${monthOrDate.slice(0, 7)}-01`;
}

export function monthEnd(monthOrDate: IsoMonth | IsoDate): IsoDate {
  const year = Number(monthOrDate.slice(0, 4));
  const month = Number(monthOrDate.slice(5, 7));
  return toIsoDate(year, month, daysInMonth(year, month));
}

/**
 * Half-open range `[start, endExclusive)` covering a month — the shape SQL queries want
 * (`date >= start and date < endExclusive`), which avoids month-length edge cases.
 */
export function monthRange(monthOrDate: IsoMonth | IsoDate): {
  start: IsoDate;
  endExclusive: IsoDate;
} {
  const start = monthStart(monthOrDate);
  return { start, endExclusive: monthStart(addMonths(monthOf(start), 1)) };
}

export function addMonths(month: IsoMonth, amount: number): IsoMonth {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1 + amount;
  return `${pad(year + Math.floor(monthIndex / 12), 4)}-${pad(mod(monthIndex, 12) + 1, 2)}`;
}

export function addDays(date: IsoDate, amount: number): IsoDate {
  const { year, month, day } = splitIsoDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + amount));
  return toIsoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** Whole days between two dates (`b - a`). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((utcMillis(b) - utcMillis(a)) / 86_400_000);
}

/** Sortable comparator — ISO dates compare correctly as plain strings. */
export function compareIsoDate(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The `amount` most recent months ending at `month`, oldest first. */
export function lastMonths(month: IsoMonth, amount: number): IsoMonth[] {
  return Array.from({ length: amount }, (_, index) => addMonths(month, index - amount + 1));
}

/** `'2026-08-17'` → `'17/08/2026'`. */
export function formatIsoDate(date: IsoDate): IsoDate {
  const { year, month, day } = splitIsoDate(date);
  return `${pad(day, 2)}/${pad(month, 2)}/${pad(year, 4)}`;
}

/** `'2026-08'` → `'agosto de 2026'`. */
export function formatIsoMonth(month: IsoMonth): string {
  return new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${monthStart(month)}T00:00:00Z`));
}

/** `'2026-08'` → `'ago/26'` — for chart axes. */
export function formatIsoMonthShort(month: IsoMonth): string {
  return new Intl.DateTimeFormat('pt-BR', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  })
    .format(new Date(`${monthStart(month)}T00:00:00Z`))
    .replace(/\.\s*(de\s*)?/i, '/');
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function utcMillis(date: IsoDate): number {
  const { year, month, day } = splitIsoDate(date);
  return Date.UTC(year, month - 1, day);
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0');
}

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
