'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import type { CategoryKind } from '@finance/shared';
import { CATEGORY_ICONS, CATEGORY_ICON_NAMES, CategoryIcon } from '@/components/category-icon';
import { Field, FormError, inputClass, selectClass } from '@/components/fields';
import { SubmitButton } from '@/components/submit-button';
import { saveCategory, type CategoryFormState } from './actions';

const INITIAL_STATE: CategoryFormState = { status: 'idle' };

export interface CategoryFormValues {
  id?: string;
  name: string;
  kind: CategoryKind;
  color: string;
  icon: string;
}

const DEFAULT_COLOR = '#8b5cf6';

export function CategoryForm({ values }: { values: CategoryFormValues }) {
  const [state, formAction] = useActionState<CategoryFormState, FormData>(
    saveCategory,
    INITIAL_STATE,
  );
  const [icon, setIcon] = useState(values.icon || 'circle-dashed');
  const [color, setColor] = useState(values.color || DEFAULT_COLOR);

  return (
    <form action={formAction} className="space-y-5">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <input type="hidden" name="icon" value={icon} />

      <FormError message={state.message} />

      <Field label="Nome" htmlFor="name">
        <input
          id="name"
          name="name"
          type="text"
          required
          maxLength={40}
          defaultValue={values.name}
          className={inputClass}
        />
      </Field>

      <Field label="Tipo" htmlFor="kind" hint="Receitas aparecem em uma seção separada do Resumo.">
        <select id="kind" name="kind" defaultValue={values.kind} className={selectClass}>
          <option value="expense">Despesa</option>
          <option value="income">Receita</option>
        </select>
      </Field>

      <Field label="Cor" htmlFor="color">
        <div className="flex items-center gap-3">
          <input
            id="color"
            name="color"
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            className="h-12 w-16 cursor-pointer rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-1"
          />
          <CategoryIcon icon={icon} color={color} className="size-12" />
        </div>
      </Field>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Ícone</legend>
        <div className="grid grid-cols-6 gap-2 sm:grid-cols-8">
          {CATEGORY_ICON_NAMES.map((name) => {
            const Icon = CATEGORY_ICONS[name]!;
            const isSelected = icon === name;

            return (
              <button
                key={name}
                type="button"
                onClick={() => setIcon(name)}
                aria-pressed={isSelected}
                aria-label={name}
                className={`grid aspect-square place-items-center rounded-xl border transition ${
                  isSelected
                    ? 'border-[var(--color-brand)] bg-[var(--color-brand)]/10'
                    : 'border-[var(--color-line)] bg-[var(--color-surface)]'
                }`}
              >
                <Icon aria-hidden className="size-5" />
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="flex gap-2">
        <SubmitButton className="flex-1" pendingLabel="Salvando…">
          Salvar
        </SubmitButton>
        <Link
          href="/categories"
          className="grid h-12 place-items-center rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 text-base"
        >
          Cancelar
        </Link>
      </div>
    </form>
  );
}
