import { notFound } from 'next/navigation';
import { getAsset } from '@/lib/db/assets';
import { AssetForm } from '../../asset-form';

export const metadata = { title: 'Editar ativo · App da casa' };

export default async function EditAssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await getAsset(id);
  if (!asset) notFound();

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold tracking-tight">Editar ativo</h2>

      <AssetForm
        values={{
          id: asset.id,
          name: asset.name,
          type: asset.type,
          institution: asset.institution ?? '',
          indexer: asset.indexer ?? '',
          // pt-BR decimal separator, the same one the field accepts back.
          rate: asset.rate === null ? '' : String(asset.rate).replace('.', ','),
          maturityDate: asset.maturityDate ?? '',
        }}
        cancelHref={`/assets/${asset.id}`}
      />
    </section>
  );
}
