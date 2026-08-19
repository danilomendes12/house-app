'use client';

import { useActionState, useEffect, useRef } from 'react';
import type { ShoppingList } from '@finance/shared';
import { FormError, inputClass } from '@/components/fields';
import { SubmitButton } from '@/components/submit-button';
import { addShoppingItem, type ShoppingFormState } from './actions';

const INITIAL_STATE: ShoppingFormState = { status: 'idle' };

const PLACEHOLDERS: Record<ShoppingList, string> = {
  home: 'O que falta em casa?',
  market: 'O que falta no mercado?',
};

/**
 * One line at the top of the list. Adding happens in bursts — you open the fridge and empty
 * your head — so the field clears and keeps focus instead of navigating anywhere.
 */
export function ShoppingForm({ list }: { list: ShoppingList }) {
  const [state, formAction] = useActionState<ShoppingFormState, FormData>(
    addShoppingItem,
    INITIAL_STATE,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.status !== 'added') return;

    const input = inputRef.current;
    if (!input) return;

    input.value = '';
    input.focus();
  }, [state]);

  return (
    <form action={formAction} className="space-y-2">
      {/* The actions serve both lists; this is what tells them which one was submitted. */}
      <input type="hidden" name="list" value={list} />

      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          name="title"
          type="text"
          required
          autoComplete="off"
          maxLength={200}
          aria-label="Novo item"
          placeholder={PLACEHOLDERS[list]}
          className={inputClass}
        />
        <SubmitButton className="shrink-0 px-5" pendingLabel="…">
          Add
        </SubmitButton>
      </div>

      <FormError message={state.status === 'error' ? state.message : undefined} />
    </form>
  );
}
