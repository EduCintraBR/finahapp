import type { Metadata } from 'next';
import { NewCategoryForm } from '@/components/categories/category-forms';
import { FormCard } from '@/components/forms/form-card';
import { PageHeader } from '@/components/layout/page-header';
import { CardContent, CardDescription, CardHeader } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Nova categoria' };

export default function NewCategoryPage() {
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <PageHeader title="Nova categoria" back={{ href: '/categorias', label: 'Categorias' }} />
      <FormCard>
        <CardHeader>
          <CardDescription>
            Aparece na hora nos lançamentos, nos fixos, na importação e no bot (pelos apelidos). As
            subcategorias são opcionais e se criam depois, na edição da categoria.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewCategoryForm />
        </CardContent>
      </FormCard>
    </div>
  );
}
