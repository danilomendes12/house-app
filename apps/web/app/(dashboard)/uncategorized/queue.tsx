'use client';

import { useActionState, useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { suggestMatcher } from '@finance/shared';
import { EmptyState, cardClass, inputClass, selectClass } from '@/components/fields';
import { SubmitButton } from '@/components/submit-button';
import { categorizeTransaction, type QueueState } from './actions';

const INITIAL_STATE: QueueState = { status: 'idle' };

export interface QueueItem {
  id: string;
  date: string;
  description: string;
  /** Pre-formatted — no `bigint` crosses the boundary. */
  amount: string;
  isIncome: boolean;
}

export interface CategoryOption {
  id: string;
  name: string;
  kind: 'expense' | 'income';
}

function QueueRow({
  item,
  categories,
  onResolved,
}: {
  item: QueueItem;
  categories: CategoryOption[];
  onResolved: (id: string, ruleApplied: number) => void;
}) {
  const [state, formAction] = useActionState<QueueState, FormData>(
    categorizeTransaction,
    INITIAL_STATE,
  );
  const [createRule, setCreateRule] = useState(false);

  useEffect(() => {
    if (state.status === 'done') onResolved(state.transactionId, state.ruleApplied);
  }, [state, onResolved]);

  const options = categories.filter((category) =>
    item.isIncome ? category.kind === 'income' : category.kind === 'expense',
  );

  return (
    <li className={`${cardClass} p-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{item.description}</p>
          <p className="text-xs text-[var(--color-ink-muted)]">{item.date}</p>
        </div>
        <span
          className={`shrink-0 text-sm font-medium tabular-nums ${
            item.isIncome ? 'text-[var(--color-positive)]' : ''
          }`}
        >
          {item.isIncome ? '+' : '−'}
          {item.amount}
        </span>
      </div>

      <form action={formAction} className="mt-3 space-y-2">
        <input type="hidden" name="transactionId" value={item.id} />

        <div className="flex gap-2">
          <label htmlFor={`category-${item.id}`} className="sr-only">
            Categoria de {item.description}
          </label>
          <select id={`category-${item.id}`} name="categoryId" required className={selectClass}>
            <option value="">Escolher categoria…</option>
            {options.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>

          <SubmitButton pendingLabel="…">Salvar</SubmitButton>
        </div>

        <label className="flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
          <input
            type="checkbox"
            name="createRule"
            checked={createRule}
            onChange={(event) => setCreateRule(event.target.checked)}
            className="size-4 accent-[var(--color-brand)]"
          />
          Criar regra para os próximos
        </label>

        {createRule ? (
          <div>
            <label htmlFor={`matcher-${item.id}`} className="sr-only">
              Texto da regra
            </label>
            <input
              id={`matcher-${item.id}`}
              name="matcher"
              type="text"
              autoComplete="off"
              defaultValue={suggestMatcher(item.description)}
              className={`${inputClass} h-10 text-sm`}
            />
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
              Qualquer lançamento cuja descrição contenha este texto entra nessa categoria.
            </p>
          </div>
        ) : null}

        {state.status === 'error' ? (
          <p role="alert" className="text-xs text-[var(--color-danger)]">
            {state.message}
          </p>
        ) : null}
      </form>
    </li>
  );
}

export function Queue({ items, categories }: { items: QueueItem[]; categories: CategoryOption[] }) {
  // Rows leave the list as soon as the action resolves, so the queue drains under the
  // thumb instead of the whole screen re-rendering after every pick (SPEC §9).
  const [resolved, setResolved] = useState<Record<string, number>>({});

  const remaining = items.filter((item) => !(item.id in resolved));
  const resolvedCount = Object.keys(resolved).length;
  const ruleApplied = Object.values(resolved).reduce((total, count) => total + count, 0);

  return (
    <div className="space-y-3">
      {resolvedCount > 0 ? (
        <p className="flex items-center gap-2 rounded-xl border border-[var(--color-positive)]/30 bg-[var(--color-positive)]/10 px-3 py-2 text-sm text-[var(--color-positive)]">
          <Check aria-hidden className="size-4" />
          {resolvedCount} categorizado{resolvedCount === 1 ? '' : 's'}
          {ruleApplied > 0 ? ` · ${ruleApplied} pelas regras criadas` : ''}
        </p>
      ) : null}

      {remaining.length === 0 ? (
        <EmptyState>
          {resolvedCount > 0 ? 'Fila zerada. 🎉' : 'Nada esperando categoria.'}
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {remaining.map((item) => (
            <QueueRow
              key={item.id}
              item={item}
              categories={categories}
              onResolved={(id, applied) =>
                setResolved((current) => ({ ...current, [id]: applied }))
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}
