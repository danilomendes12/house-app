'use client';

import { useActionState, useEffect, useRef } from 'react';
import { FormError, inputClass } from '@/components/fields';
import { SubmitButton } from '@/components/submit-button';
import { addTodo, type TodoFormState } from './actions';

const INITIAL_STATE: TodoFormState = { status: 'idle' };

/**
 * One line at the top of the list. Adding is done in bursts — you sit down and empty your
 * head — so the field clears and keeps focus instead of navigating anywhere.
 */
export function TodoForm() {
  const [state, formAction] = useActionState<TodoFormState, FormData>(addTodo, INITIAL_STATE);
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
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          name="title"
          type="text"
          required
          autoComplete="off"
          maxLength={200}
          aria-label="Nova tarefa"
          placeholder="O que precisa ser feito?"
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
