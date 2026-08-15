import { formatCents, type AllocationSlice } from '@finance/shared';

/**
 * How the portfolio is split, as a 100% stacked bar plus the list that spells it out.
 *
 * Deliberately not a pie or eight coloured slices: the app's palette already fails
 * colour-vision separation past a few hues (SPEC §12), and a share is read from a label
 * far more reliably than from an angle. The bar carries the *shape* of the split; the list
 * below it carries every number as text, so the colour is redundant by construction —
 * which is also why the ramp is a single hue stepped by size rather than a set of
 * categorical hues.
 *
 * Slices are apportioned by largest remainder upstream, so the listed percentages add up
 * to exactly 100 (SPEC §9).
 */

/** Darkest first: the biggest slice gets the most contrast. */
const RAMP = [
  'bg-[var(--color-alloc-1)]',
  'bg-[var(--color-alloc-2)]',
  'bg-[var(--color-alloc-3)]',
  'bg-[var(--color-alloc-4)]',
  'bg-[var(--color-alloc-5)]',
] as const;

const percentFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  maximumFractionDigits: 1,
});

function toneOf(index: number): string {
  return RAMP[Math.min(index, RAMP.length - 1)] as string;
}

export function AllocationBar({ slices }: { slices: AllocationSlice[] }) {
  if (slices.length === 0) return null;

  return (
    <div className="space-y-3">
      {/* Decorative: every value below is text. The 2px gaps are the surface showing
          through, not a stroke around each segment. */}
      <div aria-hidden className="flex h-3 gap-[2px] overflow-hidden rounded-full">
        {slices.map((slice, index) => (
          <div
            key={slice.key}
            className={toneOf(index)}
            style={{ width: `${Math.max(slice.percent, 1)}%` }}
          />
        ))}
      </div>

      <ul className="space-y-1.5">
        {slices.map((slice, index) => (
          <li key={slice.key} className="flex items-center gap-2 text-sm">
            <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${toneOf(index)}`} />

            <span className="min-w-0 flex-1 truncate">{slice.label}</span>

            <span className="shrink-0 tabular-nums">{formatCents(slice.cents)}</span>

            <span className="w-14 shrink-0 text-right text-[var(--color-ink-muted)] tabular-nums">
              {percentFormatter.format(slice.percent / 100)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
