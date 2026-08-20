import { notFound } from 'next/navigation';
import { formatCentsPlain } from '@finance/shared';
import { SubmitButton } from '@/components/submit-button';
import { listCategories } from '@/lib/db/categories';
import { getTransaction } from '@/lib/db/transactions';
import { resolveMonth } from '@/lib/month-param';
import { removeTransaction } from '../actions';
import { TransactionForm } from '../transaction-form';

export const metadata = { title: 'Editar transação · App da casa' };

export default async function EditTransactionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { id } = await params;
  const [transaction, allCategories] = await Promise.all([
    getTransaction(id),
    listCategories({ includeArchived: true }),
  ]);
  if (!transaction) notFound();

  const month = resolveMonth((await searchParams).month);

  // Archived categories are hidden from the picker, but one already in use must stay
  // selectable or saving the form would silently drop it.
  const categories = allCategories.filter(
    (category) => !category.isArchived || category.id === transaction.categoryId,
  );

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold tracking-tight">Editar transação</h2>

      <TransactionForm
        categories={categories.map(({ id: categoryId, name, kind }) => ({
          id: categoryId,
          name,
          kind,
        }))}
        values={{
          id: transaction.id,
          amount: formatCentsPlain(transaction.amountCents),
          date: transaction.date,
          description: transaction.description,
          notes: transaction.notes ?? '',
          type: transaction.type,
          categoryId: transaction.categoryId ?? '',
        }}
        cancelHref={`/transactions?month=${month}`}
      />

      <form action={removeTransaction} className="border-t border-[var(--color-line)] pt-4">
        <input type="hidden" name="id" value={transaction.id} />
        <input type="hidden" name="month" value={month} />
        <SubmitButton variant="danger" className="w-full" pendingLabel="Excluindo…">
          Excluir transação
        </SubmitButton>
      </form>
    </section>
  );
}
