import Link from 'next/link';
import { Plus } from 'lucide-react';
import { CategoryIcon } from '@/components/category-icon';
import { EmptyState, cardClass } from '@/components/fields';
import { countTransactionsByCategory, listCategories } from '@/lib/db/categories';
import type { Category } from '@/lib/db/types';

export const metadata = { title: 'Categorias · Finanças' };

function CategoryGroup({
  title,
  categories,
  counts,
}: {
  title: string;
  categories: Category[];
  counts: Map<string, number>;
}) {
  if (categories.length === 0) return null;

  return (
    <section>
      <h3 className="mb-1.5 px-1 text-xs font-medium text-[var(--color-ink-muted)]">{title}</h3>

      <ul className={`${cardClass} divide-y divide-[var(--color-line)]`}>
        {categories.map((category) => {
          const count = counts.get(category.id) ?? 0;

          return (
            <li key={category.id}>
              <Link
                href={`/categories/${category.id}`}
                className="flex items-center gap-3 px-3 py-3 transition active:bg-[var(--color-surface-muted)]"
              >
                <CategoryIcon icon={category.icon} color={category.color} />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {category.name}
                    {category.isArchived ? (
                      <span className="ml-2 rounded-full bg-[var(--color-surface-muted)] px-2 py-0.5 text-[10px] font-normal text-[var(--color-ink-muted)]">
                        arquivada
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-[var(--color-ink-muted)]">
                    {count === 0
                      ? 'sem lançamentos'
                      : `${count} ${count === 1 ? 'lançamento' : 'lançamentos'}`}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default async function CategoriesPage() {
  const [categories, counts] = await Promise.all([
    listCategories({ includeArchived: true }),
    countTransactionsByCategory(),
  ]);

  const active = categories.filter((category) => !category.isArchived);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Categorias</h2>
        <Link
          href="/categories/new"
          className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] pr-4 pl-3 text-sm font-medium text-white"
        >
          <Plus aria-hidden className="size-4" />
          Nova
        </Link>
      </div>

      {categories.length === 0 ? <EmptyState>Nenhuma categoria cadastrada.</EmptyState> : null}

      <CategoryGroup
        title="Despesas"
        categories={active.filter((category) => category.kind === 'expense')}
        counts={counts}
      />
      <CategoryGroup
        title="Receitas"
        categories={active.filter((category) => category.kind === 'income')}
        counts={counts}
      />
      <CategoryGroup
        title="Arquivadas"
        categories={categories.filter((category) => category.isArchived)}
        counts={counts}
      />
    </section>
  );
}
