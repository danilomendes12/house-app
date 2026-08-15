'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCents, toCents } from '@finance/shared';

export interface FlowGainPoint {
  /** `'2026-08'` — the key, never displayed. */
  month: string;
  /** `'ago/26'` — the axis tick. */
  label: string;
  /** Full `'agosto de 2026'`, for the tooltip. */
  fullLabel: string;
  /**
   * Reais as floats. Recharts needs `number`s, and these are only plotted or fed back
   * through {@link formatCents} — never used for arithmetic.
   */
  flow: number;
  gain: number;
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
  payload?: { payload: FlowGainPoint }[] | undefined;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 shadow-lg">
      <p className="text-xs text-[var(--color-ink-muted)] capitalize">{point.fullLabel}</p>

      <p className="mt-1 text-sm tabular-nums">
        <span className="text-[var(--color-ink-muted)]">Aporte </span>
        {point.flow < 0 ? '−' : ''}
        {label(Math.abs(point.flow))}
      </p>

      <p className="text-sm tabular-nums">
        <span className="text-[var(--color-ink-muted)]">Valorização </span>
        {point.gain < 0 ? '−' : ''}
        {label(Math.abs(point.gain))}
      </p>
    </div>
  );
}

/**
 * Where each month's movement came from: new money or earnings.
 *
 * The two stack because they add up to something real — the change in net worth that
 * month — and the split is the whole point: a portfolio that only grows because it is
 * being fed looks identical to a profitable one on the net-worth line above.
 *
 * Two hues carry the two series (purple for money in, green/red for what it earned) and
 * both are named in the legend, so identity never rests on colour; the earnings hue flips
 * with the sign, which the bar's direction already shows. The pair was validated for
 * colour-vision separation against the surface — the failing pair in this palette is
 * green↔red, which never appears in the same column.
 */
export function FlowGainChart({ points }: { points: FlowGainPoint[] }) {
  return (
    <>
      <ul className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-ink-muted)]">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[2px] bg-[var(--color-brand)]" />
          Aporte líquido
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[2px] bg-[var(--color-positive)]" />
          Valorização
        </li>
      </ul>

      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={points} margin={{ top: 8, right: 4, bottom: 4, left: 4 }}>
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
            cursor={{ className: 'fill-[var(--color-line)]/40' }}
          />

          <ReferenceLine y={0} className="stroke-[var(--color-line)]" />

          {/* Fills are set as attributes rather than classes: a `Cell` forwards `fill` to
              the rect, and the token resolves per colour scheme either way. The 2px
              surface stroke is the gap between stacked segments, not an outline. */}
          <Bar
            dataKey="flow"
            stackId="movement"
            fill="var(--color-brand)"
            stroke="var(--color-surface)"
            strokeWidth={2}
            maxBarSize={24}
            radius={2}
            isAnimationActive={false}
          />

          <Bar
            dataKey="gain"
            stackId="movement"
            stroke="var(--color-surface)"
            strokeWidth={2}
            maxBarSize={24}
            radius={2}
            isAnimationActive={false}
          >
            {points.map((point) => (
              <Cell
                key={point.month}
                fill={point.gain < 0 ? 'var(--color-danger)' : 'var(--color-positive)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}
