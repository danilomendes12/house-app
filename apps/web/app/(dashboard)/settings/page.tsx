import Link from 'next/link';
import { ChevronRight, FileUp, Inbox, Landmark, Shapes, Wand2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cardClass } from '@/components/fields';
import { countUncategorizedTransactions } from '@/lib/db/transactions';

export const metadata = { title: 'Ajustes · Finanças' };

export default async function SettingsPage() {
  const pending = await countUncategorizedTransactions();

  const items: { href: string; label: string; hint: string; icon: LucideIcon; badge?: number }[] = [
    {
      href: '/import',
      label: 'Importar fatura',
      hint: 'CSV do Nubank, sem duplicar nada',
      icon: FileUp,
    },
    {
      href: '/import/investments',
      label: 'Importar investimentos',
      hint: 'Posição consolidada da XP',
      icon: Landmark,
    },
    {
      href: '/uncategorized',
      label: 'A categorizar',
      hint: 'Lançamentos esperando uma categoria',
      icon: Inbox,
      badge: pending,
    },
    {
      href: '/rules',
      label: 'Regras de categorização',
      hint: 'Categoriza os próximos imports sozinho',
      icon: Wand2,
    },
    {
      href: '/categories',
      label: 'Categorias',
      hint: 'Nomes, ícones e cores',
      icon: Shapes,
    },
  ];

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold tracking-tight">Ajustes</h2>

      <ul className={`${cardClass} divide-y divide-[var(--color-line)]`}>
        {items.map(({ href, label, hint, icon: Icon, badge }) => (
          <li key={href}>
            <Link
              href={href}
              className="flex items-center gap-3 px-4 py-3.5 transition active:bg-[var(--color-surface-muted)]"
            >
              <Icon aria-hidden className="size-5 shrink-0 text-[var(--color-ink-muted)]" />

              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{label}</p>
                <p className="truncate text-xs text-[var(--color-ink-muted)]">{hint}</p>
              </div>

              {badge ? (
                <span className="shrink-0 rounded-full bg-[var(--color-brand)] px-2 py-0.5 text-xs font-medium text-white tabular-nums">
                  {badge}
                </span>
              ) : null}

              <ChevronRight aria-hidden className="size-4 shrink-0 text-[var(--color-ink-muted)]" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
