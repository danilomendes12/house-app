import { redirect } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { getUser } from '@/lib/supabase/server';
import { signOut } from './actions';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col">
      <header className="flex items-center justify-between gap-3 px-4 py-4">
        <span className="text-lg font-semibold tracking-tight">Finanças</span>
        <div className="flex items-center gap-2">
          <span className="hidden text-sm text-[var(--color-ink-muted)] sm:inline">
            {user.email}
          </span>
          <form action={signOut}>
            <button
              type="submit"
              aria-label="Sair"
              title="Sair"
              className="grid size-10 place-items-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface)]"
            >
              <LogOut aria-hidden className="size-4" />
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 px-4 pb-10">{children}</main>
    </div>
  );
}
