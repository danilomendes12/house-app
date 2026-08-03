/**
 * Form primitives. Controls are 48px tall and use `text-base` so iOS does not zoom the
 * viewport on focus — entering an expense on the phone is the number one use case.
 */

export const inputClass =
  'h-12 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-base outline-none focus:border-[var(--color-brand)]';

/** Native select chrome is kept on purpose: iOS renders it as a proper picker wheel. */
export const selectClass = `${inputClass} pr-2`;

export const cardClass = 'rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)]';

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-[var(--color-ink-muted)]">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-xs text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function FormError({ message }: { message: string | undefined }) {
  if (!message) return null;

  return (
    <p
      role="alert"
      className="rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]"
    >
      {message}
    </p>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-[var(--color-line)] px-4 py-8 text-center text-sm text-[var(--color-ink-muted)]">
      {children}
    </p>
  );
}
