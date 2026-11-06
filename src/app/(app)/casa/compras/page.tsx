import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { ShoppingList } from '@/components/stock/shopping-list';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { shoppingItems, stockOverview } from '@/db/queries/stock';
import { today } from '@/domain/dates';

export const metadata: Metadata = { title: 'Lista de compras' };

/**
 * Lista de compras (D86): gerada na hora a partir do estoque, nunca guardada. Mostra o que está acabando (abaixo do
 * mínimo) e o que ainda está abaixo da meta, com quanto falta; "Comprei" abre a entrada já preenchida.
 */
export default async function ShoppingPage() {
  const items = shoppingItems(await stockOverview(getDb(), today()));
  const low = items.filter((i) => i.need.belowMin);
  const rest = items.filter((i) => !i.need.belowMin);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title="Lista de compras"
        description="O que falta para chegar na meta de cada produto. Muda sozinha conforme você usa e dá entrada."
      />
      {items.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 py-2 text-center text-sm text-muted-foreground">
            <p>
              Nada para comprar agora. Defina o estoque mínimo e a meta no cadastro do produto para a lista
              aparecer.
            </p>
            <Button asChild variant="outline">
              <Link href="/casa/estoque">Ver o estoque</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {low.length > 0 && (
            <Card className="gap-0 pb-0">
              <CardHeader className="pb-3">
                <CardTitle>
                  Acabando <span className="text-muted-foreground">({low.length})</span>
                </CardTitle>
                <CardDescription>Abaixo do estoque mínimo.</CardDescription>
              </CardHeader>
              <CardContent className="border-t px-0">
                <ShoppingList items={low} />
              </CardContent>
            </Card>
          )}
          {rest.length > 0 && (
            <Card className="gap-0 pb-0">
              <CardHeader className="pb-3">
                <CardTitle>
                  Abaixo da meta <span className="text-muted-foreground">({rest.length})</span>
                </CardTitle>
                <CardDescription>Ainda acima do mínimo, mas fora da meta.</CardDescription>
              </CardHeader>
              <CardContent className="border-t px-0">
                <ShoppingList items={rest} />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
