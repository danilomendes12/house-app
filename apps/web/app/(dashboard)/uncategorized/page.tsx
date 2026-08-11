import Link from 'next/link';
import { formatCents, formatIsoDate } from '@finance/shared';
import { EmptyState } from '@/components/fields';
import { listCategories } from '@/lib/db/categories';
import { listUncategorizedTransactions } from '@/lib/db/transactions';
import { Queue } from './queue';

export const metadata = { title: 'A categorizar · Finanças' };

export default async function UncategorizedPage() {
  const [transactions, categories] = await Promise.all([
    listUncategorizedTransactions(),
    listCategories(),
  ]);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">A categorizar</h2>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          {transactions.length === 0
            ? 'Tudo categorizado.'
            : `${transactions.length} ${transactions.length === 1 ? 'lançamento esperando' : 'lançamentos esperando'} uma categoria.`}
        </p>
      </div>

      {transactions.length === 0 ? (
        <EmptyState>
          Nada na fila. Lançamentos sem categoria aparecem aqui depois de um{' '}
          <Link href="/import" className="text-[var(--color-brand)] underline-offset-2">
            import
          </Link>
          .
        </EmptyState>
      ) : (
        <Queue
          items={transactions.map((transaction) => ({
            id: transaction.id,
            date: formatIsoDate(transaction.date),
            description: transaction.description,
            amount: formatCents(transaction.amountCents),
            isIncome: transaction.type === 'income',
          }))}
          categories={categories.map(({ id, name, kind }) => ({ id, name, kind }))}
        />
      )}
    </section>
  );
}
