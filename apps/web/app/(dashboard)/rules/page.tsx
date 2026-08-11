import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { CategoryIcon } from '@/components/category-icon';
import { EmptyState, cardClass } from '@/components/fields';
import { SubmitButton } from '@/components/submit-button';
import { listCategories } from '@/lib/db/categories';
import { listCategoryRules } from '@/lib/db/category-rules';
import { removeRule } from './actions';
import { RuleForm } from './rule-form';

export const metadata = { title: 'Regras · Finanças' };

export default async function RulesPage() {
  const [rules, categories] = await Promise.all([listCategoryRules(), listCategories()]);
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  return (
    <section className="space-y-4">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1 text-sm text-[var(--color-ink-muted)]"
      >
        <ChevronLeft aria-hidden className="size-4" />
        Ajustes
      </Link>

      <div>
        <h2 className="text-xl font-semibold tracking-tight">Regras de categorização</h2>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Aplicadas na ordem abaixo durante o import. A primeira que casar define a categoria.
        </p>
      </div>

      <RuleForm categories={categories.map(({ id, name }) => ({ id, name }))} />

      {rules.length === 0 ? (
        <EmptyState>
          Nenhuma regra ainda. Crie uma aqui ou marque “criar regra” ao categorizar na{' '}
          <Link href="/uncategorized" className="text-[var(--color-brand)] underline-offset-2">
            fila
          </Link>
          .
        </EmptyState>
      ) : (
        <ul className={`${cardClass} divide-y divide-[var(--color-line)]`}>
          {rules.map((rule) => {
            const category = categoryById.get(rule.categoryId);

            return (
              <li key={rule.id} className="flex items-center gap-3 px-3 py-3">
                <CategoryIcon
                  icon={category?.icon ?? null}
                  color={category?.color ?? null}
                  className="size-9"
                />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    <span className="font-medium">{rule.matcher}</span>
                    <span className="text-[var(--color-ink-muted)]">
                      {' → '}
                      {category?.name ?? 'categoria removida'}
                    </span>
                  </p>
                  {rule.priority !== 0 ? (
                    <p className="text-xs text-[var(--color-ink-muted)]">
                      prioridade {rule.priority}
                    </p>
                  ) : null}
                </div>

                <form action={removeRule}>
                  <input type="hidden" name="id" value={rule.id} />
                  <SubmitButton variant="danger" className="h-9 px-3 text-sm" pendingLabel="…">
                    Excluir
                  </SubmitButton>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
