'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { CircleAlert, FileUp, Info } from 'lucide-react';
import { FormError, cardClass, inputClass } from '@/components/fields';
import { SubmitButton } from '@/components/submit-button';
import { runImport, type ImportState, type PreviewData } from './actions';

const INITIAL_STATE: ImportState = { status: 'idle' };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function Preview({ preview }: { preview: PreviewData }) {
  const { lines, skipped, errors, categorizedCount } = preview;
  const uncategorized = lines.length - categorizedCount;

  return (
    <div className="space-y-4">
      <div className={`${cardClass} p-4`}>
        <p className="text-sm font-medium">{preview.fileName}</p>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          {plural(lines.length, 'lançamento', 'lançamentos')} para importar · {categorizedCount} já
          categorizados
          {uncategorized > 0 ? ` · ${uncategorized} para a fila` : ''}
        </p>
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
          Nada foi gravado ainda. Reimportar o mesmo arquivo depois não duplica nada.
        </p>
      </div>

      {errors.length > 0 ? (
        <div className={`${cardClass} border-[var(--color-danger)]/40 p-4`}>
          <p className="flex items-center gap-2 text-sm font-medium text-[var(--color-danger)]">
            <CircleAlert aria-hidden className="size-4" />
            {plural(errors.length, 'linha ilegível', 'linhas ilegíveis')}
          </p>
          <ul className="mt-2 space-y-1 text-xs text-[var(--color-ink-muted)]">
            {errors.slice(0, 10).map((error) => (
              <li key={error.line}>
                Linha {error.line}: {error.message}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
            As demais linhas serão importadas normalmente.
          </p>
        </div>
      ) : null}

      {skipped.length > 0 ? (
        <div className={`${cardClass} p-4`}>
          <p className="flex items-center gap-2 text-sm font-medium">
            <Info aria-hidden className="size-4 text-[var(--color-ink-muted)]" />
            {plural(skipped.length, 'linha descartada', 'linhas descartadas')}
          </p>
          <ul className="mt-2 space-y-1 text-xs text-[var(--color-ink-muted)]">
            {skipped.slice(0, 10).map((row) => (
              <li key={row.line} className="truncate">
                {row.title} — {row.reason}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
            Pagamento de fatura é transferência interna, não despesa.
          </p>
        </div>
      ) : null}

      <div className={`${cardClass} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-line)] text-left text-xs text-[var(--color-ink-muted)]">
              <th scope="col" className="px-3 py-2 font-medium">
                Data
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Descrição
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Categoria
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Valor
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {lines.map((line) => (
              <tr key={line.line}>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">{line.date}</td>
                <td className="px-3 py-2">
                  <span className="block max-w-[16rem] truncate">{line.description}</span>
                  {line.installment ? (
                    <span className="text-xs text-[var(--color-ink-muted)]">
                      parcela {line.installment}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-xs">
                  {line.categoryName ?? (
                    <span className="text-[var(--color-ink-muted)]">a categorizar</span>
                  )}
                </td>
                <td
                  className={`px-3 py-2 text-right whitespace-nowrap tabular-nums ${
                    line.type === 'income' ? 'text-[var(--color-positive)]' : ''
                  }`}
                >
                  {line.type === 'income' ? '+' : '−'}
                  {line.amount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ImportForm() {
  const [state, formAction] = useActionState<ImportState, FormData>(runImport, INITIAL_STATE);

  if (state.status === 'done') {
    return (
      <div className="space-y-4">
        <div className={`${cardClass} p-5`}>
          <p className="text-2xl font-semibold tabular-nums">
            {plural(state.inserted, 'lançamento importado', 'lançamentos importados')}
          </p>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            {state.ignored > 0
              ? `${plural(state.ignored, 'ignorado', 'ignorados')} (já existentes).`
              : 'Nenhuma duplicata encontrada.'}
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            href="/uncategorized"
            className="grid h-12 flex-1 place-items-center rounded-xl bg-[var(--color-brand)] px-4 text-base font-medium text-white"
          >
            Categorizar pendentes
          </Link>
          <Link
            href="/import"
            className="grid h-12 place-items-center rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 text-base"
          >
            Importar outro
          </Link>
        </div>
      </div>
    );
  }

  if (state.status === 'preview') {
    return (
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="intent" value="confirm" />
        <input type="hidden" name="text" value={state.preview.text} />

        <Preview preview={state.preview} />

        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <SubmitButton className="flex-1" pendingLabel="Importando…">
            Importar {state.preview.lines.length}
          </SubmitButton>
          <Link
            href="/import"
            className="grid h-12 place-items-center rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 text-base"
          >
            Escolher outro arquivo
          </Link>
        </div>
      </form>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <FormError message={state.status === 'error' ? state.message : undefined} />

      <div className={`${cardClass} space-y-3 p-4`}>
        <p className="flex items-center gap-2 text-sm font-medium">
          <FileUp aria-hidden className="size-4 text-[var(--color-ink-muted)]" />
          Fatura do Nubank
        </p>
        <p className="text-xs text-[var(--color-ink-muted)]">
          No app do Nubank: <strong>Cartão de crédito → Faturas →</strong> escolha a fatura{' '}
          <strong>→ Exportar fatura → CSV</strong>. O arquivo vem com as colunas{' '}
          <code>date,title,amount</code>.
        </p>
        <p className="text-xs text-[var(--color-ink-muted)]">
          Pagamentos da fatura são descartados e cada parcela entra como um lançamento na data da
          compra.
        </p>

        <input
          id="file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          className={`${inputClass} file:mr-3 file:h-8 file:rounded-lg file:border-0 file:bg-[var(--color-surface-muted)] file:px-3 file:text-sm py-2.5`}
        />
      </div>

      <SubmitButton className="w-full" pendingLabel="Lendo…">
        Ver prévia
      </SubmitButton>
    </form>
  );
}
