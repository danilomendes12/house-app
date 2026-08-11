import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, Pencil } from 'lucide-react';
import {
  ASSET_INDEXER_LABELS,
  ASSET_TYPE_LABELS,
  formatCents,
  formatIsoDate,
  todayIso,
} from '@finance/shared';
import { EmptyState, cardClass } from '@/components/fields';
import { SubmitButton } from '@/components/submit-button';
import { YieldTag } from '@/components/yield-tag';
import { getAssetDetail } from '@/lib/db/net-worth';
import type { AssetEvent, AssetSnapshot } from '@/lib/db/types';
import { removeAsset, removeAssetEvent, removeAssetSnapshot, toggleAssetClosed } from '../actions';
import { AssetEventForm } from '../event-form';
import { AssetSnapshotForm } from '../snapshot-form';

export const metadata = { title: 'Ativo · Finanças' };

function EventRow({ event }: { event: AssetEvent }) {
  const isContribution = event.type === 'contribution';

  return (
    <li className="flex items-center gap-3 px-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {isContribution ? 'Aporte' : 'Resgate'}
          <span className="ml-2 text-xs font-normal text-[var(--color-ink-muted)]">
            {formatIsoDate(event.date)}
          </span>
        </p>
        {event.notes ? (
          <p className="truncate text-xs text-[var(--color-ink-muted)]">{event.notes}</p>
        ) : null}
      </div>

      <span
        className={`shrink-0 text-sm font-medium tabular-nums ${
          isContribution ? '' : 'text-[var(--color-ink-muted)]'
        }`}
      >
        {isContribution ? '+' : '−'}
        {formatCents(event.amountCents)}
      </span>

      <form action={removeAssetEvent}>
        <input type="hidden" name="id" value={event.id} />
        <SubmitButton variant="danger" className="h-9 px-3 text-sm" pendingLabel="…">
          Excluir
        </SubmitButton>
      </form>
    </li>
  );
}

function SnapshotRow({ snapshot }: { snapshot: AssetSnapshot }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span className="flex-1 text-sm">{formatIsoDate(snapshot.date)}</span>

      <span className="text-sm font-medium tabular-nums">
        {formatCents(snapshot.grossValueCents)}
      </span>

      <form action={removeAssetSnapshot}>
        <input type="hidden" name="id" value={snapshot.id} />
        <SubmitButton variant="danger" className="h-9 px-3 text-sm" pendingLabel="…">
          Excluir
        </SubmitButton>
      </form>
    </li>
  );
}

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getAssetDetail(id);
  if (!detail) notFound();

  const { asset, performance, events, snapshots } = detail;

  const subtitle = [
    ASSET_TYPE_LABELS[asset.type],
    asset.institution,
    asset.indexer === null
      ? null
      : `${asset.rate === null ? '' : `${String(asset.rate).replace('.', ',')}% `}${ASSET_INDEXER_LABELS[asset.indexer]}`,
    asset.maturityDate === null ? null : `vence ${formatIsoDate(asset.maturityDate)}`,
  ]
    .filter((part) => part)
    .join(' · ');

  // The last snapshot is a hint on the update form, so it never crosses as a bigint.
  const lastValue = snapshots[0] ? formatCents(snapshots[0].grossValueCents) : null;

  return (
    <section className="space-y-4">
      <Link
        href="/assets"
        className="inline-flex items-center gap-1 text-sm text-[var(--color-ink-muted)]"
      >
        <ChevronLeft aria-hidden className="size-4" />
        Patrimônio
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight">
            {asset.name}
            {asset.isClosed ? (
              <span className="ml-2 rounded-full bg-[var(--color-surface-muted)] px-2 py-0.5 align-middle text-[10px] font-normal text-[var(--color-ink-muted)]">
                encerrado
              </span>
            ) : null}
          </h2>
          <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{subtitle}</p>
        </div>

        <Link
          href={`/assets/${asset.id}/edit`}
          aria-label="Editar ativo"
          title="Editar ativo"
          className="grid size-10 shrink-0 place-items-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface)]"
        >
          <Pencil aria-hidden className="size-4" />
        </Link>
      </div>

      <div className={`${cardClass} p-5`}>
        <p className="text-sm text-[var(--color-ink-muted)]">
          {performance.snapshotDate === null
            ? 'Valor aportado'
            : `Valor em ${formatIsoDate(performance.snapshotDate)}`}
        </p>
        <p className="mt-1 text-3xl font-semibold">{formatCents(performance.currentCents)}</p>

        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-ink-muted)]">
          <span className="tabular-nums">{formatCents(performance.investedCents)} aportados</span>
          <YieldTag yieldCents={performance.yieldCents} yieldPercent={performance.yieldPercent} />
        </p>

        {performance.snapshotDate === null ? (
          <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
            Sem valor informado ainda — o rendimento aparece depois da primeira atualização.
          </p>
        ) : null}
      </div>

      <AssetSnapshotForm assetId={asset.id} today={todayIso()} lastValue={lastValue} />

      <AssetEventForm assetId={asset.id} today={todayIso()} />

      <div>
        <h3 className="mb-1.5 px-1 text-xs font-medium text-[var(--color-ink-muted)]">
          Movimentações
        </h3>

        {events.length === 0 ? (
          <EmptyState>Nenhum aporte ou resgate registrado.</EmptyState>
        ) : (
          <ul className={`${cardClass} divide-y divide-[var(--color-line)]`}>
            {events.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </ul>
        )}
      </div>

      {snapshots.length > 0 ? (
        <details>
          <summary className="cursor-pointer px-1 text-xs text-[var(--color-ink-muted)]">
            Histórico de valores ({snapshots.length})
          </summary>
          <ul className={`${cardClass} mt-1.5 divide-y divide-[var(--color-line)]`}>
            {snapshots.map((snapshot) => (
              <SnapshotRow key={snapshot.id} snapshot={snapshot} />
            ))}
          </ul>
        </details>
      ) : null}

      <div className="space-y-3 border-t border-[var(--color-line)] pt-4">
        <form action={toggleAssetClosed}>
          <input type="hidden" name="id" value={asset.id} />
          <input type="hidden" name="isClosed" value={String(asset.isClosed)} />
          <SubmitButton variant="secondary" className="w-full">
            {asset.isClosed ? 'Reabrir ativo' : 'Encerrar ativo'}
          </SubmitButton>
          <p className="mt-1.5 text-xs text-[var(--color-ink-muted)]">
            Encerrar tira o ativo do patrimônio de hoje e mantém os meses em que ele existiu no
            gráfico.
          </p>
        </form>

        <form action={removeAsset}>
          <input type="hidden" name="id" value={asset.id} />
          <SubmitButton variant="danger" className="w-full" pendingLabel="Excluindo…">
            Excluir ativo
          </SubmitButton>
          <p className="mt-1.5 text-xs text-[var(--color-ink-muted)]">
            Apaga também {events.length} {events.length === 1 ? 'movimentação' : 'movimentações'} e{' '}
            {snapshots.length} {snapshots.length === 1 ? 'valor informado' : 'valores informados'}.
            Para manter o histórico, encerre em vez de excluir.
          </p>
        </form>
      </div>
    </section>
  );
}
