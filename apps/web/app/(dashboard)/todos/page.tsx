import { Check, Trash2 } from 'lucide-react';
import { formatIsoDate, isoDateAt } from '@finance/shared';
import { EmptyState, cardClass } from '@/components/fields';
import { SubmitButton } from '@/components/submit-button';
import { listTodos } from '@/lib/db/todos';
import type { Todo } from '@/lib/db/types';
import { clearDoneTodos, removeTodo, toggleTodo } from './actions';
import { TodoForm } from './todo-form';

export const metadata = { title: 'Tarefas · Finanças' };

/**
 * A row is two forms side by side rather than a checkbox plus JavaScript: the whole label
 * is the toggle (a thumb-sized target), and both actions survive a page that has not
 * hydrated yet.
 */
function TodoItem({ todo }: { todo: Todo }) {
  const isDone = todo.doneAt !== null;

  return (
    <li className="flex items-center gap-1 pr-1">
      <form action={toggleTodo} className="min-w-0 flex-1">
        <input type="hidden" name="id" value={todo.id} />
        <input type="hidden" name="done" value={isDone ? 'false' : 'true'} />

        <SubmitButton
          variant="ghost"
          label={isDone ? `Reabrir: ${todo.title}` : `Concluir: ${todo.title}`}
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
              {todo.title}
            </span>
            {todo.doneAt ? (
              <span className="mt-0.5 block text-xs text-[var(--color-ink-muted)]">
                concluída em {formatIsoDate(isoDateAt(new Date(todo.doneAt)))}
              </span>
            ) : null}
          </span>
        </SubmitButton>
      </form>

      <form action={removeTodo}>
        <input type="hidden" name="id" value={todo.id} />
        <SubmitButton
          variant="ghost"
          label={`Excluir: ${todo.title}`}
          className="grid size-10 place-items-center rounded-full text-[var(--color-ink-muted)]"
        >
          <Trash2 aria-hidden className="size-4" />
        </SubmitButton>
      </form>
    </li>
  );
}

export default async function TodosPage() {
  const todos = await listTodos();
  const pending = todos.filter((todo) => todo.doneAt === null);
  const done = todos.filter((todo) => todo.doneAt !== null);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Tarefas</h2>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          A lista é da casa: as duas pessoas veem e marcam as mesmas tarefas.
        </p>
      </div>

      <TodoForm />

      {todos.length === 0 ? (
        <EmptyState>Nenhuma tarefa por aqui. Escreva a primeira acima.</EmptyState>
      ) : null}

      {pending.length > 0 ? (
        <div>
          <h3 className="mb-1.5 px-1 text-xs font-medium text-[var(--color-ink-muted)]">
            Pendentes ({pending.length})
          </h3>

          <ul className={`${cardClass} divide-y divide-[var(--color-line)]`}>
            {pending.map((todo) => (
              <TodoItem key={todo.id} todo={todo} />
            ))}
          </ul>
        </div>
      ) : null}

      {done.length > 0 ? (
        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2 px-1">
            <h3 className="text-xs font-medium text-[var(--color-ink-muted)]">
              Concluídas ({done.length})
            </h3>

            <form action={clearDoneTodos}>
              <SubmitButton
                variant="ghost"
                className="text-xs font-normal text-[var(--color-ink-muted)] underline-offset-2 hover:underline"
                pendingLabel="Limpando…"
              >
                Limpar concluídas
              </SubmitButton>
            </form>
          </div>

          <ul className={`${cardClass} divide-y divide-[var(--color-line)]`}>
            {done.map((todo) => (
              <TodoItem key={todo.id} todo={todo} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
