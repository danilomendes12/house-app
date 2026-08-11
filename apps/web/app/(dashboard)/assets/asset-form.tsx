'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import {
  ASSET_INDEXERS,
  ASSET_INDEXER_LABELS,
  ASSET_TYPES,
  ASSET_TYPE_LABELS,
  type AssetIndexer,
  type AssetType,
  type IsoDate,
} from '@finance/shared';
import { Field, FormError, inputClass, selectClass } from '@/components/fields';
import { SubmitButton } from '@/components/submit-button';
import { saveAsset, type AssetFormState } from './actions';

const INITIAL_STATE: AssetFormState = { status: 'idle' };

/** Where the money actually is. A suggestion list, not a closed set — the field is free. */
const INSTITUTIONS = ['XP', 'Santander'];

export interface AssetFormValues {
  id?: string;
  name: string;
  type: AssetType;
  institution: string;
  indexer: AssetIndexer | '';
  /** Pre-formatted for the input (`"110"`) — no `numeric` crosses the boundary as a number. */
  rate: string;
  maturityDate: IsoDate | '';
}

export function AssetForm({ values, cancelHref }: { values: AssetFormValues; cancelHref: string }) {
  const [state, formAction] = useActionState<AssetFormState, FormData>(saveAsset, INITIAL_STATE);

  return (
    <form action={formAction} className="space-y-5">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

      <FormError message={state.message} />

      <Field label="Nome" htmlFor="name" error={state.fieldErrors?.name}>
        <input
          id="name"
          name="name"
          type="text"
          required
          autoComplete="off"
          autoFocus
          defaultValue={values.name}
          placeholder="Ex.: CDB Banco X 110% CDI"
          className={inputClass}
        />
      </Field>

      <Field label="Tipo" htmlFor="type">
        <select id="type" name="type" defaultValue={values.type} className={selectClass}>
          {ASSET_TYPES.map((type) => (
            <option key={type} value={type}>
              {ASSET_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Instituição"
        htmlFor="institution"
        hint="Opcional. Sugestões, não uma lista fechada."
      >
        <input
          id="institution"
          name="institution"
          type="text"
          list="institutions"
          autoComplete="off"
          defaultValue={values.institution}
          placeholder="Ex.: XP"
          className={inputClass}
        />
        <datalist id="institutions">
          {INSTITUTIONS.map((institution) => (
            <option key={institution} value={institution} />
          ))}
        </datalist>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Indexador" htmlFor="indexer">
          <select id="indexer" name="indexer" defaultValue={values.indexer} className={selectClass}>
            <option value="">—</option>
            {ASSET_INDEXERS.map((indexer) => (
              <option key={indexer} value={indexer}>
                {ASSET_INDEXER_LABELS[indexer]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Taxa" htmlFor="rate" error={state.fieldErrors?.rate}>
          <input
            id="rate"
            name="rate"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={values.rate}
            placeholder="110"
            className={inputClass}
          />
        </Field>
      </div>

      {/* The rate is a note to self: nothing in the app projects a value from it (SPEC §3). */}
      <p className="-mt-3 text-xs text-[var(--color-ink-muted)]">
        % do indexador (110 = 110% do CDI) ou % a.a. no prefixado. Só para consulta.
      </p>

      <Field
        label="Vencimento"
        htmlFor="maturityDate"
        hint="Opcional — para ativos com data de resgate."
        error={state.fieldErrors?.maturityDate}
      >
        <input
          id="maturityDate"
          name="maturityDate"
          type="date"
          defaultValue={values.maturityDate}
          className={inputClass}
        />
      </Field>

      <div className="flex gap-2">
        <SubmitButton className="flex-1" pendingLabel="Salvando…">
          Salvar
        </SubmitButton>
        <Link
          href={cancelHref}
          className="grid h-12 place-items-center rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 text-base"
        >
          Cancelar
        </Link>
      </div>
    </form>
  );
}
