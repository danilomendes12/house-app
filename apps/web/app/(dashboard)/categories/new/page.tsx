import { CategoryForm } from '../category-form';

export const metadata = { title: 'Nova categoria · Finanças' };

export default function NewCategoryPage() {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold tracking-tight">Nova categoria</h2>
      <CategoryForm values={{ name: '', kind: 'expense', color: '', icon: '' }} />
    </section>
  );
}
