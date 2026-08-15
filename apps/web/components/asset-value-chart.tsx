'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCents, toCents } from '@finance/shared';

export interface AssetValuePoint {
  /** `'2026-08-31'` — the key and the axis tick source. */
  date: string;
  /** `'31/08'` — the axis tick. */
  label: string;
  /** Full `'31/08/2026'`, for the tooltip. */
  fullLabel: string;
  /** Reais as a float: plotted, or fed back through {@link formatCents}. Never arithmetic. */
  value: number;
  /** Net money moved on that date, in reais. `0` on a plain snapshot day. */
  flow: number;
}

const compactFormatter = new Intl.NumberFormat('pt-BR', {
  notation: 'compact',
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 1,
});

function label(reais: number): string {
  return formatCents(toCents(Math.round(reais * 100)));
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean | undefined;
  payload?: { payload: AssetValuePoint }[] | undefined;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 shadow-lg">
      <p className="text-sm font-semibold tabular-nums">{label(point.value)}</p>
      <p className="text-xs text-[var(--color-ink-muted)]">{point.fullLabel}</p>

      {point.flow === 0 ? null : (
        <p className="mt-1 text-xs tabular-nums">
          {point.flow > 0 ? 'Aporte de ' : 'Resgate de '}
          {label(Math.abs(point.flow))}
        </p>
      )}
    </div>
  );
}

/**
 * One asset's value over the selected window, with the days money moved marked on it.
 *
 * The markers are what make the line honest: a step up on the day of a contribution is
 * not performance, and the eye reads it as one unless the deposit is drawn. They are all
 * one neutral colour — direction is carried by the tooltip and by the movement list below
 * the chart, never by hue alone.
 *
 * A single series, so no legend: the card heading names what is plotted.
 */
export function AssetValueChart({ points }: { points: AssetValuePoint[] }) {
  const lastIndex = points.length - 1;
  const flows = points.filter((point) => point.flow !== 0);

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
          interval="preserveStartEnd"
          minTickGap={24}
          className="fill-[var(--color-ink-muted)] text-xs"
          tick={{ fill: '' }}
        />

        <YAxis
          width={52}
          tickLine={false}
          axisLine={false}
          tickCount={4}
          domain={['auto', 'auto']}
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
            // Only the endpoint is labelled — a number on every point is noise.
            if (index !== lastIndex || cx === undefined || cy === undefined) return <g key={key} />;

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

        {/* Money in or out, marked where it happened. The 2px ring keeps it legible
            where it sits on the line. */}
        {flows.map((point) => (
          <ReferenceDot
            key={point.date}
            x={point.label}
            y={point.value}
            r={4}
            fill="var(--color-ink-muted)"
            stroke="var(--color-surface)"
            strokeWidth={2}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
