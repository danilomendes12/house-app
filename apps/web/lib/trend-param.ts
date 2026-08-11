import { TREND_WINDOWS, isTrendWindow, type TrendWindow } from '@finance/shared';

/** Default window on the trend screen: half a year reads well on a phone. */
export const DEFAULT_TREND_WINDOW: TrendWindow = 6;

/**
 * The `?window=3|6|12` search param. Anything else falls back to the default — a bad URL
 * should never break the page (same contract as `resolveMonth`).
 */
export function resolveTrendWindow(value: string | string[] | undefined): TrendWindow {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);

  return Number.isInteger(parsed) && isTrendWindow(parsed) ? parsed : DEFAULT_TREND_WINDOW;
}

export { TREND_WINDOWS };
