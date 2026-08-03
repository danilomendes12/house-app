'use client';

import { useActionState } from 'react';
import type { IsoMonth } from '@finance/shared';
import { CategoryIcon } from '@/components/category-icon';
import { FormError, cardClass, inputClass } from '@/components/fields';
import { SubmitButton } from '@/components/submit-button';
import { saveBudgets, type BudgetsFormState } from './actions';

const INITIAL_STATE: BudgetsFormState = { status: 'idle' };

export interface BudgetRow {
  categoryId: string;
  name: string;
  icon: string | null;
  color: string | null;
  /** Pre-formatted amount (`"800,00"`), empty when the category has no budget. */
  amount: string;
  /** Net spending so far this month, pre-formatted for the hint line. */
  spentLabel: string;
}

export function BudgetsForm({ month, rows }: { month: IsoMonth; rows: BudgetRow[] }) {
  const [state, formAction] = useActionState<BudgetsFormState, FormData>(
    saveBudgets,
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="month" value={month} />

      <FormError message={state.status === 'error' ? state.message : undefined} />
      {state.status === 'saved' ? (
        <p
          role="status"
          className="rounded-lg border border-[var(--color-positive)]/30 bg-[var(--color-positive)]/10 px-3 py-2 text-sm text-[var(--color-positive)]"
        >
          {state.message}
        </p>
      ) : null}

      <ul className={`${cardClass} divide-y divide-[var(--color-line)]`}>
        {rows.map((row) => (
          <li key={row.categoryId} className="flex items-center gap-3 px-3 py-2.5">
            <CategoryIcon icon={row.icon} color={row.color} />

            <div className="min-w-0 flex-1">
              <label htmlFor={`amount:${row.categoryId}`} className="block truncate text-sm">
                {row.name}
              </label>
              <span className="text-xs text-[var(--color-ink-muted)]">gasto: {row.spentLabel}</span>
            </div>

            <div className="flex w-32 shrink-0 items-center gap-1.5">
              <span className="text-sm text-[var(--color-ink-muted)]">R$</span>
              <input
                id={`amount:${row.categoryId}`}
                name={`amount:${row.categoryId}`}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                defaultValue={row.amount}
                placeholder="—"
                className={`${inputClass} h-10 px-2 text-right tabular-nums`}
              />
            </div>
          </li>
        ))}
      </ul>

      <SubmitButton className="w-full" pendingLabel="Salvando…">
        Salvar orçamentos
      </SubmitButton>
    </form>
  );
}
