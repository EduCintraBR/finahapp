import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ActionButton } from '@/components/forms/action-button';
import { FormCard } from '@/components/forms/form-card';
import { PageHeader } from '@/components/layout/page-header';
import { ProductForm } from '@/components/stock/stock-forms';
import { CardContent } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { listStockCategories, listStockLocations, productDetail } from '@/db/queries/stock';
import { today } from '@/domain/dates';
import { archiveStockProductAction } from '../../../actions';

export const metadata: Metadata = { title: 'Editar produto' };

export default async function EditProductPage({ params }: PageProps<'/casa/produtos/[id]/editar'>) {
  const { id } = await params;
  const db = getDb();
  const [detail, categories, locations] = await Promise.all([
    productDetail(db, id, today()),
    listStockCategories(db),
    listStockLocations(db),
  ]);
  if (!detail || detail.product.archivedAt) notFound();
  const { product, lots } = detail;

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <PageHeader title="Editar produto" back={{ href: `/casa/produtos/${id}`, label: product.name }} />
      <FormCard>
        <CardContent>
          <ProductForm
            categories={categories}
            locations={locations}
            product={{ ...product, hasLots: lots.length > 0 }}
          />
        </CardContent>
      </FormCard>
      {product.packages === 0 && (
        <div className="max-md:pb-2">
          <ActionButton
            action={archiveStockProductAction}
            fields={{ id }}
            label="Arquivar produto"
            variant="destructive"
            confirm={{
              title: `Arquivar ${product.name}?`,
              description:
                'Sai das listas e da busca. Nada é apagado: o histórico e o código dos lotes continuam guardados.',
              confirmLabel: 'Arquivar',
            }}
          />
        </div>
      )}
    </div>
  );
}
