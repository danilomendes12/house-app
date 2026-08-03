import {
  ZERO_CENTS,
  addMonths,
  formatCents,
  formatCentsPlain,
  formatIsoMonth,
  summarizeMonth,
} from '@finance/shared';
import { EmptyState, cardClass } from '@/components/fields';
import { MonthNav } from '@/components/month-nav';
import { SubmitButton } from '@/components/submit-button';
import { listBudgetsForMonth } from '@/lib/db/budgets';
import { listCategories } from '@/lib/db/categories';
import { listTransactionsForMonth } from '@/lib/db/transactions';
import { resolveMonth } from '@/lib/month-param';
import { copyPreviousMonth } from './actions';
import { BudgetsForm, type BudgetRow } from './budgets-form';

export const metadata = { title: 'Orçamento · Finanças' };

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const month = resolveMonth((await searchParams).month);
  const [categories, budgets, transactions] = await Promise.all([
    listCategories(),
    listBudgetsForMonth(month),
    listTransactionsForMonth(month),
  ]);

  const totals = summarizeMonth(transactions);
  const budgetByCategory = new Map(
    budgets.map((budget) => [budget.categoryId, budget.amountCents]),
  );

  // Only expense categories get budgets — income is not something you cap.
  const rows: BudgetRow[] = categories
    .filter((category) => category.kind === 'expense')
    .map((category) => {
      const budgetCents = budgetByCategory.get(category.id);
      const spentCents = totals.byCategory.get(category.id)?.netCents ?? ZERO_CENTS;

      return {
        categoryId: category.id,
        name: category.name,
        icon: category.icon,
        color: category.color,
        amount: budgetCents === undefined ? '' : formatCentsPlain(budgetCents),
        spentLabel: formatCents(spentCents),
      };
    });

  const budgetedCents = budgets.reduce((total, budget) => total + budget.amountCents, ZERO_CENTS);
  const previous = addMonths(month, -1);

  return (
    <section className="space-y-4">
      <MonthNav month={month} basePath="/budgets" />

      <div className={`${cardClass} p-4`}>
        <p className="text-sm text-[var(--color-ink-muted)]">Total orçado</p>
        <p className="mt-0.5 text-2xl font-semibold tabular-nums">{formatCents(budgetedCents)}</p>
        <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
          Deixe um campo em branco para a categoria ficar sem orçamento.
        </p>
      </div>

      <form action={copyPreviousMonth}>
        <input type="hidden" name="month" value={month} />
        <SubmitButton variant="secondary" className="w-full" pendingLabel="Copiando…">
          Copiar orçamentos de {formatIsoMonth(previous)}
        </SubmitButton>
      </form>

      {rows.length === 0 ? (
        <EmptyState>Cadastre uma categoria de despesa para definir orçamentos.</EmptyState>
      ) : (
        <BudgetsForm month={month} rows={rows} />
      )}
    </section>
  );
}
