import { notFound } from 'next/navigation';
import { Check, Trash2 } from 'lucide-react';
import {
  SHOPPING_LIST_HINTS,
  SHOPPING_LIST_LABELS,
  formatIsoDate,
  isShoppingList,
  isoDateAt,
  type ShoppingList,
} from '@finance/shared';
import { EmptyState, cardClass } from '@/components/fields';
import { SubmitButton } from '@/components/submit-button';
import { countPendingByList, listShoppingItems } from '@/lib/db/shopping';
import type { ShoppingItem } from '@/lib/db/types';
import { clearDoneShoppingItems, removeShoppingItem, toggleShoppingItem } from '../actions';
import { ShoppingListTabs } from '../list-tabs';
import { ShoppingForm } from '../shopping-form';

export async function generateMetadata({ params }: { params: Promise<{ list: string }> }) {
  const { list } = await params;
  if (!isShoppingList(list)) return { title: 'Compras · App da casa' };

  return { title: `Compras · ${SHOPPING_LIST_LABELS[list]} · App da casa` };
}

/**
 * A row is two forms side by side rather than a checkbox plus JavaScript: the whole label
 * is the toggle (a thumb-sized target), and both actions survive a page that has not
 * hydrated yet — which, pushing a cart on a bad connection, is the normal case.
 */
function ShoppingRow({ item, list }: { item: ShoppingItem; list: ShoppingList }) {
  const isDone = item.doneAt !== null;

  return (
    <li className="flex items-center gap-1 pr-1">
      <form action={toggleShoppingItem} className="min-w-0 flex-1">
        <input type="hidden" name="id" value={item.id} />
        <input type="hidden" name="list" value={list} />
        <input type="hidden" name="done" value={isDone ? 'false' : 'true'} />

        <SubmitButton
          variant="ghost"
          label={isDone ? `Desmarcar: ${item.title}` : `Comprei: ${item.title}`}
          className="flex w-full items-start gap-3 px-3 py-3 text-left"
        >
          <span
            aria-hidden
            className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border ${
              isDone
                ? 'border-[var(--color-brand)] bg-[var(--color-brand)] text-white'
                : 'border-[var(--color-line)]'
            }`}
          >
            {isDone ? <Check className="size-3.5" /> : null}
          </span>

          <span className="min-w-0 flex-1">
            <span
              className={`block text-sm font-normal break-words ${
                isDone ? 'text-[var(--color-ink-muted)] line-through' : ''
              }`}
            >
              {item.title}
            </span>
            {item.doneAt ? (
              <span className="mt-0.5 block text-xs text-[var(--color-ink-muted)]">
                comprado em {formatIsoDate(isoDateAt(new Date(item.doneAt)))}
              </span>
            ) : null}
          </span>
        </SubmitButton>
      </form>

      <form action={removeShoppingItem}>
        <input type="hidden" name="id" value={item.id} />
        <input type="hidden" name="list" value={list} />
        <SubmitButton
          variant="ghost"
          label={`Excluir: ${item.title}`}
          className="grid size-10 place-items-center rounded-full text-[var(--color-ink-muted)]"
        >
          <Trash2 aria-hidden className="size-4" />
        </SubmitButton>
      </form>
    </li>
  );
}

export default async function ShoppingListPage({ params }: { params: Promise<{ list: string }> }) {
  const { list } = await params;
  if (!isShoppingList(list)) notFound();

  const [items, pendingByList] = await Promise.all([listShoppingItems(list), countPendingByList()]);

  const pending = items.filter((item) => item.doneAt === null);
  const bought = items.filter((item) => item.doneAt !== null);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Compras</h2>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{SHOPPING_LIST_HINTS[list]}</p>
      </div>

      <ShoppingListTabs active={list} pending={pendingByList} />

      <ShoppingForm list={list} />

      {items.length === 0 ? (
        <EmptyState>
          {list === 'market'
            ? 'Lista do mercado vazia. Escreva o primeiro item acima.'
            : 'Nada faltando por aqui. Escreva o primeiro item acima.'}
        </EmptyState>
      ) : null}

      {pending.length > 0 ? (
        <div>
          <h3 className="mb-1.5 px-1 text-xs font-medium text-[var(--color-ink-muted)]">
            Faltando ({pending.length})
          </h3>

          <ul className={`${cardClass} divide-y divide-[var(--color-line)]`}>
            {pending.map((item) => (
              <ShoppingRow key={item.id} item={item} list={list} />
            ))}
          </ul>
        </div>
      ) : null}

      {bought.length > 0 ? (
        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2 px-1">
            <h3 className="text-xs font-medium text-[var(--color-ink-muted)]">
              Comprados ({bought.length})
            </h3>

            <form action={clearDoneShoppingItems}>
              <input type="hidden" name="list" value={list} />
              <SubmitButton
                variant="ghost"
                className="text-xs font-normal text-[var(--color-ink-muted)] underline-offset-2 hover:underline"
                pendingLabel="Limpando…"
              >
                Limpar comprados
              </SubmitButton>
            </form>
          </div>

          <ul className={`${cardClass} divide-y divide-[var(--color-line)]`}>
            {bought.map((item) => (
              <ShoppingRow key={item.id} item={item} list={list} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
