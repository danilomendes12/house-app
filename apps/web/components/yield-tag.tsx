import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { ZERO_CENTS, absCents, formatCents, type Cents } from '@finance/shared';

/**
 * An asset's yield: how much more (or less) it is worth than what was put into it.
 *
 * Colour follows meaning, like {@link ChangeBadge} — but the meaning is inverted here.
 * Growing spending is bad and growing net worth is good, so up is green on this screen and
 * red on Tendências. The arrow and the sign carry the direction too; nothing is encoded by
 * colour alone.
 */

const percentFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero',
});

export function YieldTag({
  yieldCents,
  yieldPercent,
  className = '',
}: {
  yieldCents: Cents;
  yieldPercent: number | null;
  className?: string;
}) {
  const isUp = yieldCents > ZERO_CENTS;
  const isDown = yieldCents < ZERO_CENTS;

  const Icon = isUp ? ArrowUpRight : isDown ? ArrowDownRight : Minus;
  const tone = isUp
    ? 'text-[var(--color-positive)]'
    : isDown
      ? 'text-[var(--color-danger)]'
      : 'text-[var(--color-ink-muted)]';

  const amount = formatCents(absCents(yieldCents));
  const percent = yieldPercent === null ? '' : ` (${percentFormatter.format(yieldPercent / 100)})`;

  return (
    <span className={`flex items-center gap-1 text-xs ${tone} ${className}`}>
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span className="sr-only">
        {isUp ? `rendimento de ${amount}` : isDown ? `prejuízo de ${amount}` : 'sem rendimento'}
        {percent}
      </span>

      <span aria-hidden className="tabular-nums">
        {isUp ? '+' : isDown ? '−' : ''}
        {amount}
        {percent}
      </span>
    </span>
  );
}
