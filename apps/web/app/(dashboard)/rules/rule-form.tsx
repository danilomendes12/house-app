'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Plus } from 'lucide-react';
import { Field, FormError, cardClass, inputClass, selectClass } from '@/components/fields';
import { SubmitButton } from '@/components/submit-button';
import { saveRule, type RuleFormState } from './actions';

const INITIAL_STATE: RuleFormState = { status: 'idle' };

export interface RuleCategoryOption {
  id: string;
  name: string;
}

export function RuleForm({ categories }: { categories: RuleCategoryOption[] }) {
  const [state, formAction] = useActionState<RuleFormState, FormData>(saveRule, INITIAL_STATE);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the fields after a save so the next rule can be typed straight away — this form
  // is used in bursts, right after looking at the queue.
  useEffect(() => {
    if (state.status === 'done') formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className={`${cardClass} space-y-3 p-4`}>
      <p className="flex items-center gap-2 text-sm font-medium">
        <Plus aria-hidden className="size-4 text-[var(--color-ink-muted)]" />
        Nova regra
      </p>

      <FormError message={state.status === 'error' ? state.message : undefined} />

      {state.status === 'done' ? (
        <p className="rounded-lg border border-[var(--color-positive)]/30 bg-[var(--color-positive)]/10 px-3 py-2 text-sm text-[var(--color-positive)]">
          Regra salva
          {state.applied > 0
            ? ` — ${state.applied} ${state.applied === 1 ? 'lançamento categorizado' : 'lançamentos categorizados'} na fila.`
            : '.'}
        </p>
      ) : null}

      <Field label="Se a descrição contiver" htmlFor="matcher" hint="Ignora maiúsculas e acentos.">
        <input
          id="matcher"
          name="matcher"
          type="text"
          required
          autoComplete="off"
          placeholder="Ex.: uber"
          className={inputClass}
        />
      </Field>

      <Field label="Categorizar como" htmlFor="categoryId">
        <select id="categoryId" name="categoryId" required className={selectClass}>
          <option value="">Escolher…</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Prioridade"
        htmlFor="priority"
        hint="Maior vence. Em caso de empate, o texto mais específico ganha."
      >
        <input
          id="priority"
          name="priority"
          type="number"
          step={1}
          defaultValue={0}
          className={inputClass}
        />
      </Field>

      <SubmitButton className="w-full" pendingLabel="Salvando…">
        Adicionar regra
      </SubmitButton>
    </form>
  );
}
