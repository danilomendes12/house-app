import 'server-only';

import { createHash } from 'node:crypto';
import type { ImportedTransaction } from '@finance/shared';

/**
 * The server half of the dedup key (SPEC §7).
 *
 * `packages/shared` builds the string to hash but cannot hash it — it is imported by
 * client components and must stay free of `node:*` (CLAUDE.md). The sha256 lives here.
 *
 * Changing this function silently breaks idempotency: every already-imported row would
 * hash differently and import again as a duplicate.
 */
export function externalIdFor(dedupSource: string): string {
  return createHash('sha256').update(dedupSource, 'utf8').digest('hex');
}

export function withExternalId<T extends Pick<ImportedTransaction, 'dedupSource'>>(
  draft: T,
): T & { externalId: string } {
  return { ...draft, externalId: externalIdFor(draft.dedupSource) };
}
