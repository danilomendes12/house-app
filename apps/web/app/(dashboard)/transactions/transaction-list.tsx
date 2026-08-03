import Link from 'next/link';
import { formatCents, formatIsoDate, type IsoMonth } from '@finance/shared';
import { CategoryIcon } from '@/components/category-icon';
import { cardClass } from '@/components/fields';
import type { Category, Transaction } from '@/lib/db/types';

/** Groups transactions by day, preserving the incoming (newest first) order. */
function groupByDate(transactions: Transaction[]): [string, Transaction[]][] {
  const groups = new Map<string, Transaction[]>();

  for (const transaction of transactions) {
    const group = groups.get(transaction.date);
    if (group) group.push(transaction);
    else groups.set(transaction.date, [transaction]);
  }

  return [...groups];
}

export function TransactionList({
  transactions,
  categories,
  month,
}: {
  transactions: Transaction[];
  categories: Category[];
  month: IsoMonth;
}) {
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  return (
    <div className="space-y-5">
      {groupByDate(transactions).map(([date, group]) => (
        <section key={date}>
          <h3 className="mb-1.5 px-1 text-xs font-medium text-[var(--color-ink-muted)]">
            {formatIsoDate(date)}
          </h3>

          <ul className={`${cardClass} divide-y divide-[var(--color-line)]`}>
            {group.map((transaction) => {
              const category = transaction.categoryId
                ? categoryById.get(transaction.categoryId)
                : undefined;

              return (
                <li key={transaction.id}>
                  <Link
                    href={{
                      pathname: `/transactions/${transaction.id}`,
                      query: { month },
                    }}
                    className="flex items-center gap-3 px-3 py-3 transition active:bg-[var(--color-surface-muted)]"
                  >
                    <CategoryIcon
                      icon={category?.icon ?? null}
                      color={category?.color ?? null}
                      className="size-9"
                    />

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{transaction.description}</p>
                      <p className="truncate text-xs text-[var(--color-ink-muted)]">
                        {category?.name ?? 'A categorizar'}
                      </p>
                    </div>

                    <span
                      className={`shrink-0 text-sm font-medium tabular-nums ${
                        transaction.type === 'income' ? 'text-[var(--color-positive)]' : ''
                      }`}
                    >
                      {transaction.type === 'income' ? '+' : '−'}
                      {formatCents(transaction.amountCents)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
