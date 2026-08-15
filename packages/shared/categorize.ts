/**
 * Automatic categorization by rule (SPEC §6.1, §7).
 *
 * A rule is a substring of the description and a category. Rules are tried in priority
 * order and the first hit wins; nothing matching leaves the transaction uncategorized, so
 * it lands in the "a categorizar" queue rather than in a wrong bucket.
 */

import { normalizeText } from './csv';

export interface CategoryRule {
  id: string;
  /** Case- and accent-insensitive substring of the description. */
  matcher: string;
  categoryId: string;
  /** Higher wins. Ties break toward the longer (more specific) matcher. */
  priority: number;
}

/**
 * Rule order: priority first, then matcher length.
 *
 * The length tie-break is what makes "uber eats" beat "uber" without the user having to
 * think about priorities — the specific rule is almost always the one they meant.
 * The final comparison on `id` only exists to keep the order stable.
 */
export function compareRules(a: CategoryRule, b: CategoryRule): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.matcher.length !== b.matcher.length) return b.matcher.length - a.matcher.length;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortRules<R extends CategoryRule>(rules: readonly R[]): R[] {
  return [...rules].sort(compareRules);
}

/**
 * The first rule matching `description`, or `null`.
 *
 * Matching is accent-insensitive on both sides: a statement writes "PADARIA SAO JOAO"
 * while the user types the rule as "São João", and those must be the same thing.
 * Pass rules already sorted (see {@link sortRules}) to avoid re-sorting per row.
 */
export function matchRule<R extends CategoryRule>(
  description: string,
  sortedRules: readonly R[],
): R | null {
  const haystack = normalizeText(description);
  if (haystack === '') return null;

  for (const rule of sortedRules) {
    const needle = normalizeText(rule.matcher);
    if (needle !== '' && haystack.includes(needle)) return rule;
  }

  return null;
}

/** Convenience wrapper for one-off calls: sorts, then matches. Returns the category id. */
export function categorize(description: string, rules: readonly CategoryRule[]): string | null {
  return matchRule(description, sortRules(rules))?.categoryId ?? null;
}

/**
 * The rows that a single rule — `ruleId`, already part of `rules` — would categorize.
 *
 * Used to apply a just-saved rule to the "a categorizar" queue. The whole rule set takes
 * part in the decision, not only the new matcher: creating "uber → Transporte" must not
 * steal the pending "UBER EATS" rows from a more specific rule that already existed. Rows
 * won by another rule are left alone; they were already in the queue before this rule.
 */
export function rowsMatchedByRule<R extends { id: string; description: string }>(
  rows: readonly R[],
  rules: readonly CategoryRule[],
  ruleId: string,
): R[] {
  const sorted = sortRules(rules);

  return rows.filter((row) => matchRule(row.description, sorted)?.id === ruleId);
}

/**
 * A matcher suggested from a description, for the "criar regra" checkbox in the queue.
 *
 * Statement titles carry noise that must not end up in the rule — an instalment suffix, a
 * trailing store number, a city. The first few significant words are a better guess than
 * the whole title, which would only ever match that one purchase again.
 */
export function suggestMatcher(description: string, wordCount = 2): string {
  const words = normalizeText(description)
    .replace(/\s*[-–—]\s*(?:parcela\s*)?\d{1,2}\s*\/\s*\d{1,2}\s*$/, '')
    .split(' ')
    // Acquirer markers (`Uber *do`, `PagSeguro *Loja`) are punctuation, not words.
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((word) => word.length > 2 && !/^\d+$/.test(word));

  return words.slice(0, wordCount).join(' ') || normalizeText(description);
}
