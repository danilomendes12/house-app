'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCents, toCents } from '@finance/shared';

export interface MonthLinePoint {
  /** `'2026-08'` — the key, never displayed. */
  month: string;
  /** `'ago/26'` — the axis tick. */
  label: string;
  /** Full `'agosto de 2026'`, for the tooltip. */
  fullLabel: string;
  /**
   * Reais as a float. Recharts needs a `number`, and this value is only ever plotted or
   * fed back through {@link formatCents} — it is never used for arithmetic.
   */
  value: number;
}

const compactFormatter = new Intl.NumberFormat('pt-BR', {
  notation: 'compact',
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 1,
});

/** Reais back to cents for display, so the tooltip never shows a rounded float. */
function label(reais: number): string {
  return formatCents(toCents(Math.round(reais * 100)));
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean | undefined;
  payload?: { payload: MonthLinePoint }[] | undefined;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 shadow-lg">
      {/* Values lead, labels follow: the reader already knows the month they aimed at. */}
      <p className="text-sm font-semibold tabular-nums">{label(point.value)}</p>
      <p className="text-xs text-[var(--color-ink-muted)] capitalize">{point.fullLabel}</p>
    </div>
  );
}

/**
 * One monetary series over months — monthly spending on Tendências, net worth on
 * Patrimônio. Both are a single quantity moving through time, which is what a plain line
 * is for; the per-category comparison on Tendências is small multiples (`Sparkline`)
 * precisely because *that* one is many series and colour alone could not separate them.
 *
 * One series, so no legend: the card's heading already says what is plotted. The last
 * point is direct-labelled and the rest are carried by the axis and the tooltip, which
 * never gates a value — the same numbers are in the table below the chart.
 */
export function MonthLineChart({ points }: { points: MonthLinePoint[] }) {
  const lastIndex = points.length - 1;

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={points} margin={{ top: 20, right: 56, bottom: 4, left: 4 }}>
        <CartesianGrid
          vertical={false}
          className="stroke-[var(--color-line)]"
          strokeDasharray="0"
        />

        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          className="fill-[var(--color-ink-muted)] text-xs"
          // Recharts renders ticks as SVG <text>; the className above carries the fill.
          tick={{ fill: '' }}
        />

        <YAxis
          width={52}
          tickLine={false}
          axisLine={false}
          tickCount={4}
          tickFormatter={(value: number) => compactFormatter.format(value)}
          className="fill-[var(--color-ink-muted)] text-xs tabular-nums"
          tick={{ fill: '' }}
        />

        <Tooltip
          content={<ChartTooltip />}
          cursor={{ strokeWidth: 1, className: 'stroke-[var(--color-line)]' }}
        />

        <Line
          type="monotone"
          dataKey="value"
          className="stroke-[var(--color-brand)]"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          isAnimationActive={false}
          // Recharts types `key` as React's `Key | null | undefined`, which under
          // `exactOptionalPropertyTypes` does not fit a narrower literal shape — so the
          // prop type is taken from Recharts and the fields are narrowed in the body.
          dot={(props) => {
            const { cx, cy, index } = props;
            const key = typeof props.key === 'string' ? props.key : undefined;
            // Only the endpoint is marked and labelled — a number on every point is noise.
            if (index !== lastIndex || cx === undefined || cy === undefined) {
              return <g key={key} />;
            }

            return (
              <g key={key}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={4.5}
                  className="fill-[var(--color-brand)]"
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                />
                <text
                  x={cx + 10}
                  y={cy}
                  dominantBaseline="middle"
                  className="fill-[var(--color-ink)] text-xs font-medium tabular-nums"
                >
                  {compactFormatter.format(points[lastIndex]?.value ?? 0)}
                </text>
              </g>
            );
          }}
          activeDot={{ r: 5, stroke: 'var(--color-surface)', strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
