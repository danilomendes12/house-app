import Link from 'next/link';
import { Plus } from 'lucide-react';
import { ZERO_CENTS, formatCents, percentOfCents } from '@finance/shared';
import { CategoryIcon } from '@/components/category-icon';
import { EmptyState, cardClass } from '@/components/fields';
import { MonthNav } from '@/components/month-nav';
import { ProgressBar } from '@/components/progress-bar';
import { YieldTag } from '@/components/yield-tag';
import { getMonthOverview, type CategoryLine } from '@/lib/db/month-overview';
import { getNetWorthOverview } from '@/lib/db/net-worth';
import { resolveMonth } from '@/lib/month-param';

export const metadata = { title: 'Resumo · Finanças' };

/**
 * Without a budget the bar shows the category's share of the month, which is the
 * "donut/lista" breakdown; with one it shows how much of the budget is gone.
 */
function ExpenseLine({ line }: { line: CategoryLine }) {
  const { budget } = line;
  const name = line.category?.name ?? 'A categorizar';

  return (
    <li className="px-3 py-3">
      <div className="flex items-center gap-3">
        <CategoryIcon icon={line.category?.icon ?? null} color={line.category?.color ?? null} />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="text-xs text-[var(--color-ink-muted)]">
            {line.transactionCount} {line.transactionCount === 1 ? 'lançamento' : 'lançamentos'}
          </p>
        </div>

        <span className="shrink-0 text-sm font-medium tabular-nums">
          {formatCents(line.netCents)}
        </span>
      </div>

      <div className="mt-2">
        <ProgressBar
          percent={budget.state === 'no-budget' ? line.sharePercent : budget.percentUsed}
          isOver={budget.state === 'over'}
          color={budget.state === 'no-budget' ? (line.category?.color ?? null) : null}
          label={`${name}: ${budget.state === 'no-budget' ? 'participação no mês' : 'uso do orçamento'}`}
        />

        {budget.state !== 'no-budget' && budget.remainingCents !== null ? (
          <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
            {budget.state === 'over' ? (
              <span className="text-[var(--color-danger)]">
                {formatCents(budget.overCents)} acima
              </span>
            ) : (
              <span className="text-[var(--color-positive)]">
                {formatCents(budget.remainingCents)} restantes
              </span>
            )}{' '}
            de {formatCents(budget.budgetCents ?? ZERO_CENTS)}
          </p>
        ) : null}
      </div>
    </li>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const month = resolveMonth((await searchParams).month);
  const [overview, netWorth] = await Promise.all([getMonthOverview(month), getNetWorthOverview()]);

  const hasBudgets = overview.budgetedCents > ZERO_CENTS;
  const isOverBudget = overview.budgetRemainingCents < ZERO_CENTS;
  const budgetUsedPercent = percentOfCents(
    overview.budgetedCents - overview.budgetRemainingCents,
    overview.budgetedCents,
  );

  return (
    <section className="space-y-4">
      <MonthNav month={month} basePath="/" />

      <div className={`${cardClass} p-5`}>
        <p className="text-sm text-[var(--color-ink-muted)]">Gasto no mês</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">
          {formatCents(overview.expenseCents)}
        </p>

        {overview.incomeCents > ZERO_CENTS ? (
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            Receitas:{' '}
            <span className="text-[var(--color-positive)] tabular-nums">
              {formatCents(overview.incomeCents)}
            </span>
          </p>
        ) : null}

        {hasBudgets ? (
          <div className="mt-4 space-y-1.5">
            <ProgressBar
              percent={budgetUsedPercent}
              isOver={isOverBudget}
              label="Uso do orçamento total"
            />
            <p className="text-xs text-[var(--color-ink-muted)]">
              {isOverBudget ? (
                <span className="text-[var(--color-danger)]">
                  {formatCents(-overview.budgetRemainingCents)} acima
                </span>
              ) : (
                <span className="text-[var(--color-positive)]">
                  {formatCents(overview.budgetRemainingCents)} restantes
                </span>
              )}{' '}
              de {formatCents(overview.budgetedCents)} orçados
            </p>
          </div>
        ) : (
          <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
            Nenhum orçamento definido para este mês.{' '}
            <Link
              href={{ pathname: '/budgets', query: { month } }}
              className="text-[var(--color-brand)] underline-offset-2 hover:underline"
            >
              Definir agora
            </Link>
          </p>
        )}
      </div>

      {/* Patrimônio in one line — the headline of the Patrimônio tab, no chart, no per-asset
          breakdown. Tapping the card is how you get the full screen. */}
      {netWorth.open.length > 0 ? (
        <Link href="/assets" className={`${cardClass} block p-5`}>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm text-[var(--color-ink-muted)]">Patrimônio</p>
            <span className="text-xs text-[var(--color-brand)]">Ver tudo →</span>
          </div>

          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {formatCents(netWorth.totalCents)}
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-ink-muted)]">
            <span className="tabular-nums">{formatCents(netWorth.investedCents)} aportados</span>
            <YieldTag yieldCents={netWorth.yieldCents} yieldPercent={netWorth.yieldPercent} />
            <span>
              · {netWorth.open.length} {netWorth.open.length === 1 ? 'ativo' : 'ativos'}
            </span>
          </div>
        </Link>
      ) : null}

      {overview.uncategorizedCount > 0 ? (
        <Link href="/uncategorized" className={`${cardClass} block px-4 py-3 text-sm`}>
          {overview.uncategorizedCount}{' '}
          {overview.uncategorizedCount === 1 ? 'lançamento' : 'lançamentos'} sem categoria →
        </Link>
      ) : null}

      <div>
        <h3 className="mb-1.5 px-1 text-xs font-medium text-[var(--color-ink-muted)]">
          Por categoria
        </h3>

        {overview.expenseLines.length === 0 ? (
          <EmptyState>Nenhuma despesa neste mês. Toque em “Nova despesa” para começar.</EmptyState>
        ) : (
          <ul className={`${cardClass} divide-y divide-[var(--color-line)]`}>
            {overview.expenseLines.map((line) => (
              <ExpenseLine key={line.key} line={line} />
            ))}
          </ul>
        )}
      </div>

      {overview.incomeLines.length > 0 ? (
        <div>
          <h3 className="mb-1.5 px-1 text-xs font-medium text-[var(--color-ink-muted)]">
            Receitas
          </h3>

          <ul className={`${cardClass} divide-y divide-[var(--color-line)]`}>
            {overview.incomeLines.map((line) => (
              <li key={line.key} className="flex items-center gap-3 px-3 py-3">
                <CategoryIcon
                  icon={line.category?.icon ?? null}
                  color={line.category?.color ?? null}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {line.category?.name}
                </span>
                <span className="shrink-0 text-sm font-medium text-[var(--color-positive)] tabular-nums">
                  {formatCents(line.incomeCents)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Quick entry is use case number one: one thumb, one tap, always reachable. */}
      <Link
        href={{ pathname: '/transactions/new', query: { month } }}
        className="fixed right-4 bottom-20 z-20 flex h-14 items-center gap-2 rounded-full bg-[var(--color-brand)] pr-5 pl-4 text-base font-medium text-white shadow-lg sm:right-[max(1rem,calc(50%-22rem))] sm:bottom-8"
      >
        <Plus aria-hidden className="size-5" />
        Nova despesa
      </Link>
    </section>
  );
}
