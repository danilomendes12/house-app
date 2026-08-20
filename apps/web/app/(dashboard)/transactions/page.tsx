import Link from 'next/link';
import { FileUp, Plus } from 'lucide-react';
import { ZERO_CENTS, formatCents } from '@finance/shared';
import { EmptyState } from '@/components/fields';
import { MonthNav } from '@/components/month-nav';
import { listCategories } from '@/lib/db/categories';
import { listTransactionsForMonth } from '@/lib/db/transactions';
import { resolveMonth } from '@/lib/month-param';
import { TransactionList } from './transaction-list';

export const metadata = { title: 'Extrato mensal · App da casa' };

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const month = resolveMonth((await searchParams).month);
  const [transactions, categories] = await Promise.all([
    listTransactionsForMonth(month),
    listCategories({ includeArchived: true }),
  ]);

  const expenseCents = transactions
    .filter((transaction) => transaction.type === 'expense')
    .reduce((total, transaction) => total + transaction.amountCents, ZERO_CENTS);

  return (
    <section className="space-y-4">
      <MonthNav month={month} basePath="/transactions" />

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--color-ink-muted)]">
          {transactions.length === 0
            ? 'Nenhum lançamento'
            : `${transactions.length} ${transactions.length === 1 ? 'lançamento' : 'lançamentos'} · ${formatCents(expenseCents)} em despesas`}
        </p>

        {/* Importing a statement belongs to the statement, not to a settings screen. */}
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/import"
            className="flex h-10 items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] pr-4 pl-3 text-sm font-medium"
          >
            <FileUp aria-hidden className="size-4" />
            Importar
          </Link>

          <Link
            href={{ pathname: '/transactions/new', query: { month } }}
            className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] pr-4 pl-3 text-sm font-medium text-white"
          >
            <Plus aria-hidden className="size-4" />
            Nova
          </Link>
        </div>
      </div>

      {transactions.length === 0 ? (
        <EmptyState>
          Nada lançado neste mês. Toque em “Nova” para registrar uma despesa, ou em “Importar” para
          subir o CSV da fatura.
        </EmptyState>
      ) : (
        <TransactionList transactions={transactions} categories={categories} month={month} />
      )}
    </section>
  );
}
