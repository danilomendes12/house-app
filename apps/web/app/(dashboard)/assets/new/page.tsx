import { AssetForm } from '../asset-form';

export const metadata = { title: 'Novo ativo · Finanças' };

export default function NewAssetPage() {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold tracking-tight">Novo ativo</h2>

      <AssetForm
        values={{ name: '', type: 'cdb', institution: '', indexer: '', rate: '', maturityDate: '' }}
        cancelHref="/assets"
      />
    </section>
  );
}
