import 'server-only';

import { rowsMatchedByRule } from '@finance/shared';
import { listCategoryRules } from './db/category-rules';
import { listUncategorizedForMatching, setTransactionsCategory } from './db/transactions';

/**
 * Applies a rule that was just saved to the "a categorizar" queue (SPEC §9).
 *
 * A rule that only affected future imports would leave the user categorizing by hand the
 * very backlog that made them write it. Matching goes through the shared `matchRule`, so
 * the queue is swept with exactly the semantics the import uses — accent-insensitive, and
 * respecting priority, which a `ilike '%matcher%'` in SQL could do neither of.
 *
 * @param ruleId the rule to apply; it must already be persisted.
 * @returns how many transactions left the queue.
 */
export async function applyRuleToQueue(ruleId: string): Promise<number> {
  const [rules, pending] = await Promise.all([listCategoryRules(), listUncategorizedForMatching()]);

  const rule = rules.find((candidate) => candidate.id === ruleId);
  if (!rule) return 0;

  const matched = rowsMatchedByRule(pending, rules, ruleId);

  return setTransactionsCategory(
    matched.map((row) => row.id),
    rule.categoryId,
  );
}
