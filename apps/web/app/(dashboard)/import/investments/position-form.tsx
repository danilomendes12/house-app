'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { CircleAlert, FileUp, Info } from 'lucide-react';
import { Field, FormError, cardClass, inputClass } from '@/components/fields';
import { SubmitButton } from '@/components/submit-button';
import { runPositionImport, type PositionImportState, type PositionPreviewData } from './actions';

const INITIAL_STATE: PositionImportState = { status: 'idle' };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

const DATE_SOURCE_HINT: Record<PositionPreviewData['dateSource'], string> = {
  file: ' (data lida do arquivo)',
  export: ' (dia em que o arquivo foi exportado)',
  field: '',
};

function Preview({ preview }: { preview: PositionPreviewData }) {
  const { positions, errors, notes, reconciliation, createdCount } = preview;
  const updatedCount = positions.length - createdCount;
  const showsApplied = positions.some((position) => position.applied !== null);

  return (
    <div className="space-y-4">
      <div className={`${cardClass} p-4`}>
        <p className="text-sm font-medium">{preview.fileName}</p>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          {plural(positions.length, 'posição', 'posições')} · {preview.total} no total
        </p>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          {createdCount > 0
            ? `${plural(createdCount, 'ativo novo', 'ativos novos')}`
            : 'Nenhum ativo novo'}
          {updatedCount > 0 ? ` · ${plural(updatedCount, 'já cadastrado', 'já cadastrados')}` : ''}
        </p>
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
          Nada foi gravado ainda. O valor entra como snapshot de {preview.dateLabel}
          {DATE_SOURCE_HINT[preview.dateSource]}; reimportar sobrescreve o mesmo dia em vez de
          duplicar.
        </p>
      </div>

      {reconciliation !== null && reconciliation.gap !== null ? (
        <div className={`${cardClass} border-[var(--color-danger)]/40 p-4`}>
          <p className="flex items-center gap-2 text-sm font-medium text-[var(--color-danger)]">
            <CircleAlert aria-hidden className="size-4" />A soma não bate com o arquivo
          </p>
          <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
            O arquivo declara {reconciliation.stated} e esta prévia dá conta de{' '}
            {reconciliation.accounted} — faltam {reconciliation.gap}. Provavelmente há uma seção que
            o app ainda não sabe ler; confira antes de importar.
          </p>
        </div>
      ) : null}

      {notes.length > 0 ? (
        <div className={`${cardClass} p-4`}>
          <p className="flex items-center gap-2 text-sm font-medium">
            <Info aria-hidden className="size-4 text-[var(--color-ink-muted)]" />
            Fora da importação
          </p>
          <ul className="mt-2 space-y-1 text-xs text-[var(--color-ink-muted)]">
            {notes.map((note) => (
              <li key={note.message}>
                {note.message} <span className="tabular-nums">({note.amount})</span>
              </li>
            ))}
          </ul>
          {reconciliation !== null && reconciliation.gap === null ? (
            <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
              Com isso, o total do arquivo ({reconciliation.stated}) está todo explicado.
            </p>
          ) : null}
        </div>
      ) : null}

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
            As demais posições serão importadas normalmente.
          </p>
        </div>
      ) : null}

      <div className={`${cardClass} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-line)] text-left text-xs text-[var(--color-ink-muted)]">
              <th scope="col" className="px-3 py-2 font-medium">
                Ativo
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Tipo
              </th>
              {showsApplied ? (
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Aplicado
                </th>
              ) : null}
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Valor
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {positions.map((position) => (
              <tr key={position.line}>
                <td className="px-3 py-2">
                  <span className="block max-w-[16rem] truncate">{position.name}</span>
                  <span className="text-xs text-[var(--color-ink-muted)]">
                    {position.updatesAssetName === null
                      ? 'novo ativo'
                      : `atualiza ${position.updatesAssetName}`}
                    {position.institution ? ` · ${position.institution}` : ''}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs">{position.typeLabel}</td>
                {showsApplied ? (
                  <td className="px-3 py-2 text-right text-xs whitespace-nowrap tabular-nums text-[var(--color-ink-muted)]">
                    {position.applied ?? '—'}
                  </td>
                ) : null}
                <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                  {position.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PositionForm({ today }: { today: string }) {
  const [state, formAction] = useActionState<PositionImportState, FormData>(
    runPositionImport,
    INITIAL_STATE,
  );

  if (state.status === 'done') {
    return (
      <div className="space-y-4">
        <div className={`${cardClass} p-5`}>
          <p className="text-2xl font-semibold tabular-nums">
            {plural(state.snapshotsWritten, 'posição atualizada', 'posições atualizadas')}
          </p>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            {state.assetsCreated > 0
              ? `${plural(state.assetsCreated, 'ativo criado', 'ativos criados')}`
              : 'Nenhum ativo novo'}
            {state.assetsMatched > 0
              ? ` · ${plural(state.assetsMatched, 'já existente', 'já existentes')}`
              : ''}
            .
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            href="/assets"
            className="grid h-12 flex-1 place-items-center rounded-xl bg-[var(--color-brand)] px-4 text-base font-medium text-white"
          >
            Ver patrimônio
          </Link>
          <Link
            href="/import/investments"
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
        <input type="hidden" name="date" value={state.preview.date} />

        <Preview preview={state.preview} />

        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <SubmitButton className="flex-1" pendingLabel="Importando…">
            Importar {state.preview.positions.length}
          </SubmitButton>
          <Link
            href="/import/investments"
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
          Posição consolidada da XP
        </p>
        <p className="text-xs text-[var(--color-ink-muted)]">
          No portal da XP: <strong>Investimentos → Posição → Exportar</strong>. Vale a planilha{' '}
          <strong>.xlsx</strong> (posição detalhada) ou um <strong>.csv</strong>. Cada linha vira o
          valor atual de um ativo; aportes e resgates continuam sendo lançados à mão, mesmo quando o
          arquivo mostra o total aplicado — importá-los contaria em dobro com o que você já lançou.
        </p>

        <input
          id="file"
          name="file"
          type="file"
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          required
          className={`${inputClass} file:mr-3 file:h-8 file:rounded-lg file:border-0 file:bg-[var(--color-surface-muted)] file:px-3 file:text-sm py-2.5`}
        />

        <Field
          label="Data da posição"
          htmlFor="date"
          hint="Se o arquivo trouxer a data de referência (ou a data de exportação), ela tem prioridade."
        >
          <input id="date" name="date" type="date" defaultValue={today} className={inputClass} />
        </Field>
      </div>

      <SubmitButton className="w-full" pendingLabel="Lendo…">
        Ver prévia
      </SubmitButton>
    </form>
  );
}
