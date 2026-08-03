import {
  currentIsoMonth,
  formatCents,
  formatIsoDate,
  formatIsoMonth,
  todayIso,
} from '@finance/shared';

export default function HomePage() {
  const today = todayIso();
  const month = currentIsoMonth();

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <p className="text-sm text-[var(--color-ink-muted)] capitalize">{formatIsoMonth(month)}</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">{formatCents(0n)}</p>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Gasto no mês</p>
      </div>

      <div className="rounded-2xl border border-dashed border-[var(--color-line)] p-5 text-sm text-[var(--color-ink-muted)]">
        <p>
          Nenhuma transação registrada. O lançamento de despesas e o orçamento por categoria chegam
          na próxima etapa.
        </p>
        <p className="mt-2">Hoje é {formatIsoDate(today)}.</p>
      </div>
    </section>
  );
}
