import type { Metadata } from 'next';
import Link from 'next/link';
import { FormCard } from '@/components/forms/form-card';
import { PageHeader } from '@/components/layout/page-header';
import { LotForm } from '@/components/stock/stock-forms';
import { Button } from '@/components/ui/button';
import { CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { listStockLocations, stockOverview } from '@/db/queries/stock';
import { today } from '@/domain/dates';

export const metadata: Metadata = { title: 'Dar entrada' };

/** Entrada no estoque (D83): escolhe o produto e registra o lote (embalagens, conteúdo, local e validade). */
export default async function StockEntryPage({ searchParams }: PageProps<'/casa/entrada'>) {
  const { produto } = await searchParams;
  const db = getDb();
  const hoje = today();
  const [products, locations] = await Promise.all([stockOverview(db, hoje), listStockLocations(db)]);
  const options = products.map((p) => ({
    id: p.id,
    name: p.name,
    categoryLabel: p.categoryLabel,
    measure: p.measure,
    defaultPackage: p.defaultPackage,
    defaultContent: p.defaultContent,
    defaultLocationId: p.defaultLocationId,
  }));
  const preselected =
    typeof produto === 'string' && options.some((o) => o.id === produto) ? produto : undefined;

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <PageHeader title="Dar entrada" back={{ href: '/casa', label: 'Casa' }} />
      <FormCard>
        <CardHeader>
          <CardDescription>
            Cada entrada vira um lote com código próprio (ex.: ARR-03) e a validade dele. Na hora de usar, o
            app sugere o que vence primeiro.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {options.length === 0 ? (
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>Cadastre o primeiro produto para dar entrada.</p>
              <Button asChild>
                <Link href="/casa/produtos/novo">Cadastrar produto</Link>
              </Button>
            </div>
          ) : (
            <LotForm products={options} locations={locations} today={hoje} defaultProductId={preselected} />
          )}
        </CardContent>
      </FormCard>
    </div>
  );
}
