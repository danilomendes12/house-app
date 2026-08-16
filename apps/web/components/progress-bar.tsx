/**
 * How much of the month a category takes — the bar under each row of the breakdown
 * (SPEC §9). Tinted with the category's own colour so the list reads as a donut unrolled.
 */
export function ProgressBar({
  percent,
  color,
  label,
}: {
  percent: number;
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
      aria-label={label ?? 'Participação no mês'}
      className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-muted)]"
    >
      <div
        className="h-full rounded-full transition-[width]"
        style={{
          width: `${width}%`,
          backgroundColor: color ?? 'var(--color-brand)',
        }}
      />
    </div>
  );
}
