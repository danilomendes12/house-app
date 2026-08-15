'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { signIn, type LoginState } from './actions';

const initialState: LoginState = { status: 'idle' };

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="h-12 w-full rounded-xl bg-[var(--color-brand)] text-base font-medium text-white transition disabled:opacity-60"
    >
      {pending ? 'Entrando…' : 'Entrar'}
    </button>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState(signIn, initialState);

  return (
    <form action={formAction} className="mt-6 space-y-3">
      <label htmlFor="email" className="block text-sm font-medium">
        E-mail
      </label>
      <input
        id="email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        placeholder="voce@exemplo.com"
        className="h-12 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-base outline-none focus:border-[var(--color-brand)]"
      />

      <label htmlFor="password" className="block text-sm font-medium">
        Senha
      </label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        className="h-12 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-base outline-none focus:border-[var(--color-brand)]"
      />

      {state.status === 'error' ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.message}
        </p>
      ) : null}
      <SubmitButton />
    </form>
  );
}
