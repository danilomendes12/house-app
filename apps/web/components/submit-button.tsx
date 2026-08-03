'use client';

import { useFormStatus } from 'react-dom';

const variants = {
  primary: 'bg-[var(--color-brand)] text-white',
  secondary: 'border border-[var(--color-line)] bg-[var(--color-surface)]',
  danger: 'border border-[var(--color-danger)]/40 text-[var(--color-danger)]',
} as const;

/**
 * Submit button wired to the enclosing form's pending state. Server Actions are the only
 * way this app mutates data, so every form gets one of these.
 */
export function SubmitButton({
  children,
  pendingLabel,
  variant = 'primary',
  className = '',
  formAction,
  name,
  value,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: keyof typeof variants;
  className?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      formAction={formAction}
      name={name}
      value={value}
      className={`h-12 rounded-xl px-4 text-base font-medium transition active:scale-[0.99] disabled:opacity-60 ${variants[variant]} ${className}`}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
