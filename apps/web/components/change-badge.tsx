import { ArrowDownRight, ArrowUpRight, Minus, Plus, X } from 'lucide-react';
import { absCents, formatCents, type Change } from '@finance/shared';

/**
 * Month-over-month movement, as an amount and (when it means anything) a percentage.
 *
 * Colour follows the *meaning*, not the sign: spending more is the bad direction, so a
 * rise is red and a fall is green — the same convention the budget bar already uses. The
 * arrow icon and the sign carry the direction too, so nothing is encoded by colour alone.
 */

const percentFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero',
});

const presentation = {
  up: { icon: ArrowUpRight, tone: 'text-[var(--color-danger)]', word: 'aumento de' },
  down: { icon: ArrowDownRight, tone: 'text-[var(--color-positive)]', word: 'queda de' },
  flat: { icon: Minus, tone: 'text-[var(--color-ink-muted)]', word: 'sem variação' },
  new: { icon: Plus, tone: 'text-[var(--color-danger)]', word: 'novo neste mês:' },
  gone: { icon: X, tone: 'text-[var(--color-positive)]', word: 'zerado, era' },
} as const;

export function ChangeBadge({ change, className = '' }: { change: Change; className?: string }) {
  const { icon: Icon, tone, word } = presentation[change.direction];
  const amount = formatCents(absCents(change.deltaCents));

  const description =
    change.direction === 'flat'
      ? 'Sem variação em relação ao mês anterior'
      : `${word} ${amount} em relação ao mês anterior`;

  return (
    <span className={`flex items-center gap-1 text-xs ${tone} ${className}`}>
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span className="sr-only">{description}</span>

      <span aria-hidden className="tabular-nums">
        {change.direction === 'flat' ? '—' : amount}
        {change.percentChange === null
          ? ''
          : ` (${percentFormatter.format(change.percentChange / 100)})`}
      </span>
    </span>
  );
}
