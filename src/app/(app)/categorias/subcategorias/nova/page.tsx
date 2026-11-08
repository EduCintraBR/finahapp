import type { Metadata } from 'next';
import { NewSubcategoryForm } from '@/components/categories/category-forms';
import { FormCard } from '@/components/forms/form-card';
import { PageHeader } from '@/components/layout/page-header';
import { CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { listManagedCategories } from '@/db/queries/lookups';

export const metadata: Metadata = { title: 'Nova subcategoria' };

/** `?categoria=<id>`: vem do "+" na edição da categoria, que já fica escolhida (e é para onde volta). */
export default async function NewSubcategoryPage({
  searchParams,
}: PageProps<'/categorias/subcategorias/nova'>) {
  const { categoria } = await searchParams;
  const all = await listManagedCategories(getDb());
  const parents = all
    .filter((c) => c.parentId === null && !c.archived)
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind, icon: c.icon }));
  const from = parents.find((p) => p.id === categoria) ?? null;
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <PageHeader
        title="Nova subcategoria"
        back={
          from
            ? { href: `/categorias/${from.id}`, label: from.name }
            : { href: '/categorias/subcategorias', label: 'Subcategorias' }
        }
      />
      <FormCard>
        <CardHeader>
          <CardDescription>
            Toda subcategoria fica dentro de uma categoria (ex.: Hortifruti dentro de Mercado) e tem o tipo
            dela. Os relatórios somam tudo na categoria.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewSubcategoryForm
            parents={parents}
            parentId={from?.id ?? null}
            back={from ? 'categoria' : 'lista'}
          />
        </CardContent>
      </FormCard>
    </div>
  );
}
