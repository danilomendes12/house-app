import { notFound } from 'next/navigation';
import { SubmitButton } from '@/components/submit-button';
import { countTransactionsByCategory, listCategories } from '@/lib/db/categories';
import { removeCategory, toggleCategoryArchived } from '../actions';
import { CategoryForm } from '../category-form';

export const metadata = { title: 'Editar categoria · Finanças' };

export default async function EditCategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [categories, counts] = await Promise.all([
    listCategories({ includeArchived: true }),
    countTransactionsByCategory(),
  ]);

  const category = categories.find((candidate) => candidate.id === id);
  if (!category) notFound();

  const usage = counts.get(category.id) ?? 0;

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold tracking-tight">Editar categoria</h2>

      <CategoryForm
        values={{
          id: category.id,
          name: category.name,
          kind: category.kind,
          color: category.color ?? '',
          icon: category.icon ?? '',
        }}
      />

      <div className="space-y-3 border-t border-[var(--color-line)] pt-4">
        <form action={toggleCategoryArchived}>
          <input type="hidden" name="id" value={category.id} />
          <input type="hidden" name="isArchived" value={String(category.isArchived)} />
          <SubmitButton variant="secondary" className="w-full">
            {category.isArchived ? 'Desarquivar categoria' : 'Arquivar categoria'}
          </SubmitButton>
          <p className="mt-1.5 text-xs text-[var(--color-ink-muted)]">
            Arquivar esconde a categoria dos formulários sem mexer no histórico.
          </p>
        </form>

        <form action={removeCategory}>
          <input type="hidden" name="id" value={category.id} />
          <SubmitButton variant="danger" className="w-full" pendingLabel="Excluindo…">
            Excluir categoria
          </SubmitButton>
          <p className="mt-1.5 text-xs text-[var(--color-ink-muted)]">
            {usage === 0
              ? 'Nenhum lançamento usa esta categoria.'
              : `${usage} ${usage === 1 ? 'lançamento passa' : 'lançamentos passam'} para “a categorizar”, e os orçamentos da categoria são apagados.`}
          </p>
        </form>
      </div>
    </section>
  );
}
