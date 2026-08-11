import { ZERO_CENTS, toReais, type Cents } from '@finance/shared';

/**
 * A category's spending across the trend window, as one small multiple.
 *
 * Per-category *lines on a shared plot* were the obvious alternative and are the wrong
 * call here: the category palette is user-editable and already fails colour-vision
 * separation (the seeded orange and green sit at ΔE 4.8 for protanopia). One series per
 * chart sidesteps the problem entirely — nothing has to be told apart by hue.
 *
 * Decorative by design: every number it draws is also printed in the row beside it.
 */
export function Sparkline({
  values,
  color,
  className = '',
}: {
  values: Cents[];
  color: string | null;
  className?: string;
}) {
  if (values.length < 2) return null;

  const width = 100;
  const height = 28;
  const padding = 3;

  // Spending is measured from zero, so the baseline is zero — not the series minimum,
  // which would turn a steady month into a dramatic slope.
  const peak = values.reduce((max, value) => (value > max ? value : max), ZERO_CENTS);
  const scale = peak > ZERO_CENTS ? toReais(peak) : 1;

  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - padding - (Math.max(0, toReais(value)) / scale) * (height - padding * 2);
    return [x, y] as const;
  });

  const path = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
  const [lastX, lastY] = points[points.length - 1] as readonly [number, number];

  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={`overflow-visible ${className}`}
      style={{ color: color ?? 'var(--color-ink-muted)' }}
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        // Keeps the 2px stroke honest under the non-uniform viewBox scaling.
        vectorEffect="non-scaling-stroke"
      />
      {/* End marker with the 2px surface ring, so it stays legible over the line. */}
      <circle
        cx={lastX}
        cy={lastY}
        r={3}
        fill="currentColor"
        stroke="var(--color-surface)"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
