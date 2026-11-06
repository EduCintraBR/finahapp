import type { Metadata } from 'next';
import { Ellipsis, MapPin, Trash2 } from 'lucide-react';
import { ActionButton } from '@/components/forms/action-button';
import { PageHeader } from '@/components/layout/page-header';
import { NewStockLocationForm, RenameForm } from '@/components/stock/catalog-forms';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SheetAction } from '@/components/ui/sheet-action';
import { getDb } from '@/db/client';
import { listStockLocations } from '@/db/queries/stock';
import { archiveStockLocationAction } from '../actions';

export const metadata: Metadata = { title: 'Locais' };

/** Locais da Casa (D81): onde as coisas ficam. Remover arquiva; os lotes que estão lá continuam com o nome. */
export default async function StockLocationsPage() {
  const locations = await listStockLocations(getDb());
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title="Locais"
        description="Onde as coisas ficam, para saber onde procurar."
        back={{ href: '/casa/mais', label: 'Mais' }}
      />
      <Card>
        <CardHeader>
          <CardTitle>Novo local</CardTitle>
          <CardDescription>
            Despensa, Área de serviço, Armário do banheiro, Caixa de remédios…
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewStockLocationForm />
        </CardContent>
      </Card>
      {locations.length > 0 && (
        <Card className="py-0">
          <CardContent className="px-0">
            <ul className="divide-y" data-testid="stock-locations">
              {locations.map((l) => (
                <li key={l.id} className="flex items-center gap-3 px-4 py-3">
                  <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium">{l.name}</span>
                  <SheetAction
                    label={`Renomear ${l.name}`}
                    title="Renomear"
                    iconOnly
                    icon={<Ellipsis aria-hidden />}
                    variant="ghost"
                  >
                    <RenameForm kind="location" id={l.id} name={l.name} />
                  </SheetAction>
                  <ActionButton
                    action={archiveStockLocationAction}
                    fields={{ id: l.id }}
                    label={`Remover ${l.name}`}
                    variant="destructive"
                    icon={<Trash2 aria-hidden />}
                    confirm={{
                      title: `Remover ${l.name}?`,
                      description: 'Sai das escolhas. Os lotes que estão lá continuam mostrando o nome.',
                      confirmLabel: 'Remover',
                    }}
                  />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
