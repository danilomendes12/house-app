import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { todayIso } from '@finance/shared';
import { PositionForm } from './position-form';

export const metadata = { title: 'Importar investimentos · Finanças' };

export default function ImportPositionsPage() {
  return (
    <section className="space-y-4">
      <Link
        href="/assets"
        className="inline-flex items-center gap-1 text-sm text-[var(--color-ink-muted)]"
      >
        <ChevronLeft aria-hidden className="size-4" />
        Patrimônio
      </Link>

      <div>
        <h2 className="text-xl font-semibold tracking-tight">Importar investimentos</h2>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          A posição da XP vira o valor atual de cada ativo. Reimportar o mesmo arquivo não cria
          ativos repetidos.
        </p>
      </div>

      {/* Resolved on the server: the browser's clock may be in another timezone (SPEC §6). */}
      <PositionForm today={todayIso()} />
    </section>
  );
}
