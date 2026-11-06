import type { Metadata } from 'next';
import { Ellipsis, Trash2, User } from 'lucide-react';
import { ActionButton } from '@/components/forms/action-button';
import { PageHeader } from '@/components/layout/page-header';
import { NewStockPersonForm, RenameForm } from '@/components/stock/catalog-forms';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SheetAction } from '@/components/ui/sheet-action';
import { getDb } from '@/db/client';
import { listStockPeople } from '@/db/queries/stock';
import { SUGGESTED_PEOPLE } from '@/domain/stock/catalog';
import { archiveStockPersonAction, createSuggestedStockPeopleAction } from '../actions';

export const metadata: Metadata = { title: 'Pessoas' };

/**
 * Pessoas e bichos da casa (D89): servem só para dizer "para quem" é um produto (ex.: o remédio da Liz). Não são
 * usuários do app. Remover arquiva; os produtos que já eram dela continuam mostrando o nome.
 */
export default async function StockPeoplePage() {
  const people = await listStockPeople(getDb());
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title="Pessoas"
        description="Para quem são os produtos: vocês, a filha e os bichos."
        back={{ href: '/casa/mais', label: 'Mais' }}
      />
      {people.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Começar pelos sugeridos</CardTitle>
            <CardDescription>
              Cria vocês dois ({SUGGESTED_PEOPLE.join(' e ')} entram também). Dá para mudar depois.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActionButton
              action={createSuggestedStockPeopleAction}
              fields={{}}
              label="Usar os sugeridos"
              pendingLabel="Criando…"
              variant="default"
            />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Nova pessoa ou bicho</CardTitle>
          <CardDescription>Nome como você chama: Eduardo, Viviane, Liz, Molly…</CardDescription>
        </CardHeader>
        <CardContent>
          <NewStockPersonForm />
        </CardContent>
      </Card>
      {people.length > 0 && (
        <Card className="py-0">
          <CardContent className="px-0">
            <ul className="divide-y" data-testid="stock-people">
              {people.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                  <User className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                  <SheetAction
                    label={`Renomear ${p.name}`}
                    title="Renomear"
                    iconOnly
                    icon={<Ellipsis aria-hidden />}
                    variant="ghost"
                  >
                    <RenameForm kind="person" id={p.id} name={p.name} />
                  </SheetAction>
                  <ActionButton
                    action={archiveStockPersonAction}
                    fields={{ id: p.id }}
                    label={`Remover ${p.name}`}
                    variant="destructive"
                    icon={<Trash2 aria-hidden />}
                    confirm={{
                      title: `Remover ${p.name}?`,
                      description:
                        'Sai das escolhas. Os produtos que já eram dela deixam de mostrar o nome quando você os editar.',
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
