'use client';

import { useActionState, useEffect, useRef } from 'react';
import type { AssetEventType, IsoDate } from '@finance/shared';
import { Field, FormError, cardClass, inputClass } from '@/components/fields';
import { SubmitButton } from '@/components/submit-button';
import { saveAssetEvent, type AssetEventFormState } from './actions';

const INITIAL_STATE: AssetEventFormState = { status: 'idle' };

const typeOptions: { value: AssetEventType; label: string }[] = [
  { value: 'contribution', label: 'Aporte' },
  { value: 'withdrawal', label: 'Resgate' },
];

/**
 * Registers money moving in or out. Contributions and withdrawals are the exact half of
 * the arithmetic (SPEC §6.2) — the snapshot below is the estimated half.
 */
export function AssetEventForm({ assetId, today }: { assetId: string; today: IsoDate }) {
  const [state, formAction] = useActionState<AssetEventFormState, FormData>(
    saveAssetEvent,
    INITIAL_STATE,
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Cleared after each save: aportes come in bursts, one per month or one per purchase.
  useEffect(() => {
    if (state.status === 'done') formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className={`${cardClass} space-y-3 p-4`}>
      <input type="hidden" name="assetId" value={assetId} />

      <p className="text-sm font-medium">Nova movimentação</p>

      <FormError message={state.message} />

      <fieldset>
        <legend className="sr-only">Tipo de movimentação</legend>
        {/* Uncontrolled: nothing else depends on the choice, and `form.reset()` puts the
            toggle back on "Aporte" for free after a save. */}
        <div className="grid grid-cols-2 gap-2">
          {typeOptions.map((option, index) => (
            <label
              key={option.value}
              className="flex h-12 cursor-pointer items-center justify-center rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] text-base transition has-[:checked]:border-[var(--color-brand)] has-[:checked]:bg-[var(--color-brand)]/10 has-[:checked]:font-medium has-[:checked]:text-[var(--color-brand)]"
            >
              <input
                type="radio"
                name="type"
                value={option.value}
                defaultChecked={index === 0}
                className="sr-only"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <Field label="Valor" htmlFor="event-amount" error={state.fieldErrors?.amount}>
        <input
          id="event-amount"
          name="amount"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          required
          placeholder="0,00"
          className={`${inputClass} tabular-nums`}
        />
      </Field>

      <Field label="Data" htmlFor="event-date" error={state.fieldErrors?.date}>
        <input
          id="event-date"
          name="date"
          type="date"
          required
          defaultValue={today}
          className={inputClass}
        />
      </Field>

      <Field label="Observações" htmlFor="event-notes">
        <input
          id="event-notes"
          name="notes"
          type="text"
          autoComplete="off"
          className={inputClass}
        />
      </Field>

      <SubmitButton className="w-full" pendingLabel="Salvando…">
        Registrar movimentação
      </SubmitButton>
    </form>
  );
}
