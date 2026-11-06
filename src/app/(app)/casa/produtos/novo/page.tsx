import type { Metadata } from 'next';
import Link from 'next/link';
import { FormCard } from '@/components/forms/form-card';
import { PageHeader } from '@/components/layout/page-header';
import { ProductForm } from '@/components/stock/stock-forms';
import { Button } from '@/components/ui/button';
import { CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { listStockCategories, listStockLocations, listStockPeople } from '@/db/queries/stock';
import { medicineCategoryIds } from '@/domain/stock/catalog';

export const metadata: Metadata = { title: 'Novo produto' };

/** Cadastro de produto (D82); ao salvar, segue para a 1ª entrada dele. */
export default async function NewProductPage({ searchParams }: PageProps<'/casa/produtos/novo'>) {
  const { categoria, nome } = await searchParams;
  const db = getDb();
  const [categories, locations, people] = await Promise.all([
    listStockCategories(db),
    listStockLocations(db),
    listStockPeople(db),
  ]);

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <PageHeader title="Novo produto" back={{ href: '/casa/estoque', label: 'Estoque' }} />
      <FormCard>
        <CardHeader>
          <CardDescription>
            O produto é o item do catálogo (Arroz branco, Água mineral). O que entra em casa fica nos lotes,
            cada um com a sua validade.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {categories.length === 0 ? (
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>Antes, crie as categorias da Casa.</p>
              <Button asChild>
                <Link href="/casa">Começar pelas categorias</Link>
              </Button>
            </div>
          ) : (
            <ProductForm
              categories={categories}
              locations={locations}
              people={people}
              medicineCategoryIds={medicineCategoryIds(categories)}
              defaultCategoryId={typeof categoria === 'string' ? categoria : undefined}
              defaultName={typeof nome === 'string' ? nome : undefined}
            />
          )}
        </CardContent>
      </FormCard>
    </div>
  );
}
