import Link from 'next/link';
import { SHOPPING_LISTS, SHOPPING_LIST_LABELS, type ShoppingList } from '@finance/shared';

/**
 * The switch between the two lists. Two real routes rather than client state: each list is
 * a place you land on (from the tab bar, from a bookmark, from the back button), and the
 * pending count of the *other* one is half the reason to look at this strip at all.
 */
export function ShoppingListTabs({
  active,
  pending,
}: {
  active: ShoppingList;
  pending: Record<ShoppingList, number>;
}) {
  return (
    <nav aria-label="Listas de compras">
      <ul className="flex items-center gap-1 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-1">
        {SHOPPING_LISTS.map((list) => {
          const isActive = list === active;

          return (
            <li key={list} className="flex-1">
              <Link
                href={`/shopping/${list}`}
                aria-current={isActive ? 'page' : undefined}
                className={`flex h-10 items-center justify-center gap-1.5 rounded-xl text-sm font-medium ${
                  isActive ? 'bg-[var(--color-brand)] text-white' : 'text-[var(--color-ink-muted)]'
                }`}
              >
                {SHOPPING_LIST_LABELS[list]}
                {pending[list] > 0 ? (
                  <span
                    className={`rounded-full px-1.5 text-xs tabular-nums ${
                      isActive ? 'bg-white/20' : 'bg-[var(--color-line)]'
                    }`}
                  >
                    {pending[list]}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
