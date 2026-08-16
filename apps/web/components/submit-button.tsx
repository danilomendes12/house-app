'use client';

import { useFormStatus } from 'react-dom';

/**
 * Sizing lives here rather than in the shared base so `ghost` can start from nothing:
 * `h-12` in the base would fight a list row that has to grow with wrapped text, and which
 * of the two heights wins is a matter of Tailwind's output order, not of this string.
 */
const variants = {
  primary: 'h-12 px-4 bg-[var(--color-brand)] text-white',
  secondary: 'h-12 px-4 border border-[var(--color-line)] bg-[var(--color-surface)]',
  danger: 'h-12 px-4 border border-[var(--color-danger)]/40 text-[var(--color-danger)]',
  /** No chrome and no size of its own — for an icon or a whole list row that submits. */
  ghost: '',
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
  label,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: keyof typeof variants;
  className?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
  name?: string;
  value?: string;
  /** Accessible name, for buttons whose content is an icon or is ambiguous out of context. */
  label?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      formAction={formAction}
      name={name}
      value={value}
      aria-label={label}
      className={`rounded-xl text-base font-medium transition active:scale-[0.99] disabled:opacity-60 ${variants[variant]} ${className}`}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
