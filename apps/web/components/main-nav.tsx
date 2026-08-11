'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutGrid, Receipt, Target, TrendingUp, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const items: {
  href: '/' | '/trends' | '/transactions' | '/budgets' | '/assets';
  label: string;
  icon: LucideIcon;
}[] = [
  { href: '/', label: 'Resumo', icon: LayoutGrid },
  { href: '/trends', label: 'Tendências', icon: TrendingUp },
  // "Extrato", not "Lançar": the tab leads to the month's list. Entry is the FAB.
  { href: '/transactions', label: 'Extrato', icon: Receipt },
  { href: '/budgets', label: 'Orçamento', icon: Target },
  { href: '/assets', label: 'Patrimônio', icon: Wallet },
];

/**
 * Bottom tab bar on the phone, inline row on the desktop. Fixed at the bottom because
 * that is where a thumb is — the whole mobile flow is one-handed.
 */
export function MainNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Seções"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-[var(--color-line)] bg-[var(--color-surface)]/95 backdrop-blur sm:static sm:border-t-0 sm:bg-transparent sm:backdrop-blur-none"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex w-full max-w-3xl items-stretch sm:gap-1 sm:px-4">
        {items.map(({ href, label, icon: Icon }) => {
          const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);

          return (
            <li key={href} className="flex-1 sm:flex-none">
              <Link
                href={href}
                aria-current={isActive ? 'page' : undefined}
                className={`flex flex-col items-center gap-1 py-2 text-xs sm:flex-row sm:gap-2 sm:rounded-full sm:px-3 sm:py-1.5 sm:text-sm ${
                  isActive
                    ? 'text-[var(--color-brand)] sm:bg-[var(--color-surface)]'
                    : 'text-[var(--color-ink-muted)]'
                }`}
              >
                <Icon aria-hidden className="size-5 sm:size-4" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
