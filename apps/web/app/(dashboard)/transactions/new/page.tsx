import { currentIsoMonth, monthStart, todayIso } from '@finance/shared';
import { listCategories } from '@/lib/db/categories';
import { resolveMonth } from '@/lib/month-param';
import { TransactionForm } from '../transaction-form';

export const metadata = { title: 'Nova transação · App da casa' };

export default async function NewTransactionPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const month = resolveMonth((await searchParams).month);
  const categories = await listCategories();

  // Today when browsing the current month, otherwise the first day of the month being
  // looked at — never a date outside the month the user is in.
  const date = month === currentIsoMonth() ? todayIso() : monthStart(month);

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold tracking-tight">Nova transação</h2>

      <TransactionForm
        categories={categories.map(({ id, name, kind }) => ({ id, name, kind }))}
        values={{
          amount: '',
          date,
          description: '',
          notes: '',
          type: 'expense',
          categoryId: '',
        }}
        cancelHref={`/transactions?month=${month}`}
      />
    </section>
  );
}
