import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { ImportForm } from './import-form';

export const metadata = { title: 'Importar CSV · Finanças' };

export default function ImportPage() {
  return (
    <section className="space-y-4">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1 text-sm text-[var(--color-ink-muted)]"
      >
        <ChevronLeft aria-hidden className="size-4" />
        Ajustes
      </Link>

      <div>
        <h2 className="text-xl font-semibold tracking-tight">Importar CSV</h2>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Importar o mesmo arquivo duas vezes nunca duplica lançamentos.
        </p>
      </div>

      <ImportForm />
    </section>
  );
}
