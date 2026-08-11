'use client';

import { useActionState, useEffect, useRef } from 'react';
import type { IsoDate } from '@finance/shared';
import { Field, FormError, cardClass, inputClass } from '@/components/fields';
import { SubmitButton } from '@/components/submit-button';
import { saveAssetSnapshot, type AssetSnapshotFormState } from './actions';

const INITIAL_STATE: AssetSnapshotFormState = { status: 'idle' };

/**
 * "Atualizar valor atual" — what the broker says the asset is worth today.
 *
 * One value per asset per day (SPEC §12): saving twice on the same date overwrites, which
 * is why the field starts empty instead of pre-filled with the last value. Typing over a
 * stale number is how a wrong snapshot gets saved.
 */
export function AssetSnapshotForm({
  assetId,
  today,
  lastValue,
}: {
  assetId: string;
  today: IsoDate;
  /** Formatted last known value, shown as a hint. `null` before the first snapshot. */
  lastValue: string | null;
}) {
  const [state, formAction] = useActionState<AssetSnapshotFormState, FormData>(
    saveAssetSnapshot,
    INITIAL_STATE,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === 'done') formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className={`${cardClass} space-y-3 p-4`}>
      <input type="hidden" name="assetId" value={assetId} />

      <p className="text-sm font-medium">Atualizar valor atual</p>

      <FormError message={state.message} />

      <Field
        label="Valor bruto"
        htmlFor="snapshot-value"
        hint={lastValue === null ? 'Primeiro valor deste ativo.' : `Último informado: ${lastValue}`}
        error={state.fieldErrors?.amount}
      >
        <input
          id="snapshot-value"
          name="grossValue"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          required
          placeholder="0,00"
          className={`${inputClass} tabular-nums`}
        />
      </Field>

      <Field
        label="Data"
        htmlFor="snapshot-date"
        hint="Um valor por dia — salvar de novo na mesma data substitui o anterior."
        error={state.fieldErrors?.date}
      >
        <input
          id="snapshot-date"
          name="date"
          type="date"
          required
          defaultValue={today}
          className={inputClass}
        />
      </Field>

      <SubmitButton className="w-full" pendingLabel="Salvando…">
        Salvar valor
      </SubmitButton>
    </form>
  );
}
