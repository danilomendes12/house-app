'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import type { CategoryKind, IsoDate, TransactionType } from '@finance/shared';
import { Field, FormError, cardClass, inputClass, selectClass } from '@/components/fields';
import { SubmitButton } from '@/components/submit-button';
import { saveTransaction, type TransactionFormState } from './actions';

const INITIAL_STATE: TransactionFormState = { status: 'idle' };

/** Only what the form needs — server models never cross this boundary. */
export interface CategoryOption {
  id: string;
  name: string;
  kind: CategoryKind;
}

export interface TransactionFormValues {
  id?: string;
  /** Pre-formatted for the input (`"42,90"`), so no `bigint` has to be serialized. */
  amount: string;
  date: IsoDate;
  description: string;
  notes: string;
  type: TransactionType;
  categoryId: string;
}

const typeOptions: { value: TransactionType; label: string }[] = [
  { value: 'expense', label: 'Despesa' },
  { value: 'income', label: 'Receita' },
];

export function TransactionForm({
  categories,
  values,
  cancelHref,
}: {
  categories: CategoryOption[];
  values: TransactionFormValues;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState<TransactionFormState, FormData>(
    saveTransaction,
    INITIAL_STATE,
  );
  const [type, setType] = useState<TransactionType>(values.type);
  const [categoryId, setCategoryId] = useState(values.categoryId);

  // Categories are filtered by direction: picking "Salário" for an expense makes no sense.
  const visibleCategories = categories.filter((category) => category.kind === type);
  const selectedName = categories.find((category) => category.id === categoryId)?.name ?? '';

  return (
    <form action={formAction} className="space-y-5">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <input type="hidden" name="categoryName" value={selectedName} />

      <FormError message={state.message} />

      <div className={`${cardClass} p-4`}>
        <label htmlFor="amount" className="block text-sm font-medium">
          Valor
        </label>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl text-[var(--color-ink-muted)]">R$</span>
          <input
            id="amount"
            name="amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            required
            // Quick entry: the amount keypad should already be up when the screen opens.
            autoFocus
            defaultValue={values.amount}
            placeholder="0,00"
            className="w-full bg-transparent text-3xl font-semibold tabular-nums outline-none"
          />
        </div>
        {state.fieldErrors?.amount ? (
          <p role="alert" className="mt-2 text-xs text-[var(--color-danger)]">
            {state.fieldErrors.amount}
          </p>
        ) : null}
      </div>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Tipo</legend>
        <div className="grid grid-cols-2 gap-2">
          {typeOptions.map((option) => (
            <label
              key={option.value}
              className={`flex h-12 cursor-pointer items-center justify-center rounded-xl border text-base transition ${
                type === option.value
                  ? 'border-[var(--color-brand)] bg-[var(--color-brand)]/10 font-medium text-[var(--color-brand)]'
                  : 'border-[var(--color-line)] bg-[var(--color-surface)]'
              }`}
            >
              <input
                type="radio"
                name="type"
                value={option.value}
                checked={type === option.value}
                onChange={() => {
                  setType(option.value);
                  setCategoryId('');
                }}
                className="sr-only"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <Field label="Categoria" htmlFor="categoryId">
        <select
          id="categoryId"
          name="categoryId"
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          className={selectClass}
        >
          <option value="">A categorizar</option>
          {visibleCategories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Data" htmlFor="date" error={state.fieldErrors?.date}>
        <input
          id="date"
          name="date"
          type="date"
          required
          defaultValue={values.date}
          className={inputClass}
        />
      </Field>

      <Field
        label="Descrição"
        htmlFor="description"
        hint="Opcional — em branco, usamos o nome da categoria."
      >
        <input
          id="description"
          name="description"
          type="text"
          autoComplete="off"
          defaultValue={values.description}
          placeholder="Ex.: Mercado da esquina"
          className={inputClass}
        />
      </Field>

      <Field label="Observações" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={2}
          defaultValue={values.notes}
          className={`${inputClass} h-auto py-2`}
        />
      </Field>

      <div className="flex gap-2">
        <SubmitButton className="flex-1" pendingLabel="Salvando…">
          Salvar
        </SubmitButton>
        <Link
          href={cancelHref}
          className="grid h-12 place-items-center rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 text-base"
        >
          Cancelar
        </Link>
      </div>
    </form>
  );
}
