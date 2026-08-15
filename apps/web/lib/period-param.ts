import {
  ALLOCATION_DIMENSIONS,
  ALLOCATION_DIMENSION_LABELS,
  ASSET_SORTS,
  ASSET_SORT_LABELS,
  DEFAULT_PORTFOLIO_PERIOD,
  PORTFOLIO_PERIODS,
  PORTFOLIO_PERIOD_LABELS,
  isAllocationDimension,
  isAssetSort,
  isPortfolioPeriod,
  type AllocationDimension,
  type AssetSort,
  type PortfolioPeriod,
} from '@finance/shared';

/**
 * The search params the portfolio screens share.
 *
 * Anything unrecognised falls back to the default — a bad URL should never break the page
 * (same contract as `resolveMonth` and `resolveTrendWindow`). Keeping the window, the
 * allocation view and the ordering in the URL is what lets both screens stay Server
 * Components: switching any of them is a navigation, not client state.
 */
export function resolvePeriod(value: string | string[] | undefined): PortfolioPeriod {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw !== undefined && isPortfolioPeriod(raw) ? raw : DEFAULT_PORTFOLIO_PERIOD;
}

/** The `?alloc=class|indexer|institution` param: which allocation view is open. */
export function resolveAllocationDimension(
  value: string | string[] | undefined,
): AllocationDimension {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw !== undefined && isAllocationDimension(raw) ? raw : 'class';
}

/** The `?sort=value|return` param: how the asset list is ordered. */
export function resolveAssetSort(value: string | string[] | undefined): AssetSort {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw !== undefined && isAssetSort(raw) ? raw : 'value';
}

export {
  ALLOCATION_DIMENSIONS,
  ALLOCATION_DIMENSION_LABELS,
  ASSET_SORTS,
  ASSET_SORT_LABELS,
  DEFAULT_PORTFOLIO_PERIOD,
  PORTFOLIO_PERIODS,
  PORTFOLIO_PERIOD_LABELS,
};
