import type { Metadata } from 'next';
import { Ellipsis, Plus, Trash2 } from 'lucide-react';
import { ActionButton } from '@/components/forms/action-button';
import { PageHeader } from '@/components/layout/page-header';
import { NewStockCategoryForm, RenameForm } from '@/components/stock/catalog-forms';
import { StockCategoryIcon } from '@/components/stock/stock-icons';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SheetAction } from '@/components/ui/sheet-action';
import { getDb } from '@/db/client';
import { listStockCategories, type StockCategoryRow } from '@/db/queries/stock';
import { archiveStockCategoryAction, createSuggestedStockCategoriesAction } from '../actions';

export const metadata: Metadata = { title: 'Categorias da Casa' };

function Row({ c, sub = false }: { c: StockCategoryRow; sub?: boolean }) {
  return (
    <li className={sub ? 'flex items-center gap-2 py-2 pr-2 pl-14' : 'flex items-center gap-3 px-4 py-3'}>
      {!sub && (
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
          <StockCategoryIcon name={c.icon} className="size-4" />
        </span>
      )}
      <span className={sub ? 'min-w-0 flex-1 truncate text-sm' : 'min-w-0 flex-1 truncate font-medium'}>
        {c.name}
      </span>
      <SheetAction
        label={`Renomear ${c.name}`}
        title="Renomear"
        iconOnly
        icon={<Ellipsis aria-hidden />}
        variant="ghost"
      >
        <RenameForm kind="category" id={c.id} name={c.name} />
      </SheetAction>
      <ActionButton
        action={archiveStockCategoryAction}
        fields={{ id: c.id }}
        label={`Remover ${c.name}`}
        variant="destructive"
        icon={<Trash2 aria-hidden />}
        confirm={{
          title: `Remover ${c.name}?`,
          description: 'Sai das escolhas. Só dá para remover sem produtos e sem subcategorias dentro.',
          confirmLabel: 'Remover',
        }}
      />
    </li>
  );
}

/** Categorias da Casa (D81): 2 níveis, independentes das financeiras. Remover arquiva; nada é apagado. */
export default async function StockCategoriesPage() {
  const categories = await listStockCategories(getDb());
  const tops = categories.filter((c) => c.parentId === null);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title="Categorias"
        description="Da Casa: separadas das categorias de gastos."
        back={{ href: '/casa/mais', label: 'Mais' }}
        actions={
          <SheetAction label="Nova" title="Nova categoria" icon={<Plus aria-hidden />} variant="default">
            <NewStockCategoryForm parents={tops} />
          </SheetAction>
        }
      />
      {tops.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nenhuma categoria ainda</CardTitle>
            <CardDescription>Use as sugeridas ou crie as suas pelo botão Nova.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionButton
              action={createSuggestedStockCategoriesAction}
              fields={{}}
              label="Usar categorias sugeridas"
              pendingLabel="Criando…"
              variant="default"
            />
          </CardContent>
        </Card>
      ) : (
        <Card className="py-0">
          <CardContent className="px-0">
            <ul className="divide-y" data-testid="stock-categories">
              {tops.map((t) => {
                const children = categories.filter((c) => c.parentId === t.id);
                return (
                  <li key={t.id}>
                    <ul>
                      <Row c={t} />
                      {children.map((c) => (
                        <Row key={c.id} c={c} sub />
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
