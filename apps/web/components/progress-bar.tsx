/**
 * Budget progress. Turns red past 100% — the one visual signal the dashboard owes the
 * user (SPEC §9).
 */
export function ProgressBar({
  percent,
  isOver,
  color,
  label,
}: {
  percent: number;
  isOver?: boolean;
  color?: string | null;
  label?: string;
}) {
  const width = Math.max(0, Math.min(100, percent));

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(width)}
      aria-label={label ?? 'Uso do orçamento'}
      className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-muted)]"
    >
      <div
        className="h-full rounded-full transition-[width]"
        style={{
          width: `${width}%`,
          backgroundColor: isOver ? 'var(--color-danger)' : (color ?? 'var(--color-brand)'),
        }}
      />
    </div>
  );
}
