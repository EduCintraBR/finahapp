import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { ProductList } from '@/components/stock/product-list';
import { StockSearchForm } from '@/components/stock/search-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { listStockCategories, stockOverview, type ProductSummary } from '@/db/queries/stock';
import { today } from '@/domain/dates';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Estoque' };

const CHIP =
  'inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-sm whitespace-nowrap transition-colors';

/**
 * Estoque por categoria (D81): chips das categorias no topo; a lista agrupa pela categoria (ou, dentro de uma
 * categoria, pelas subcategorias), com quanto tem, onde fica e a próxima validade.
 */
export default async function StockPage({ searchParams }: PageProps<'/casa/estoque'>) {
  const { categoria } = await searchParams;
  const db = getDb();
  const [categories, products] = await Promise.all([listStockCategories(db), stockOverview(db, today())]);
  const tops = categories.filter((c) => c.parentId === null);
  const selected = tops.find((c) => c.id === categoria);
  const shown = selected ? products.filter((p) => p.topCategoryId === selected.id) : products;

  // dentro de uma categoria, agrupa pela subcategoria ("geral" = direto na categoria); sem filtro, pela categoria
  const groups = new Map<string, ProductSummary[]>();
  for (const p of shown) {
    const key = selected
      ? p.categoryId === selected.id
        ? selected.name
        : p.categoryName
      : (tops.find((t) => t.id === p.topCategoryId)?.name ?? p.categoryLabel);
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) =>
    selected && a === selected.name ? -1 : selected && b === selected.name ? 1 : a.localeCompare(b, 'pt-BR'),
  );
  const newHref = selected ? `/casa/produtos/novo?categoria=${selected.id}` : '/casa/produtos/novo';

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title={selected?.name ?? 'Estoque'}
        description={`${shown.length} ${shown.length === 1 ? 'produto' : 'produtos'}`}
        actions={
          <Button asChild>
            <Link href={newHref}>
              <Plus aria-hidden /> Produto
            </Link>
          </Button>
        }
      />
      <StockSearchForm />
      {tops.length > 0 && (
        <nav aria-label="Categorias" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          <Link
            href="/casa/estoque"
            aria-current={!selected ? 'page' : undefined}
            className={cn(
              CHIP,
              !selected
                ? 'border-primary/60 bg-primary/10 font-medium text-primary'
                : 'text-muted-foreground hover:bg-accent',
            )}
          >
            Todas
          </Link>
          {tops.map((t) => (
            <Link
              key={t.id}
              href={`/casa/estoque?categoria=${t.id}`}
              aria-current={selected?.id === t.id ? 'page' : undefined}
              className={cn(
                CHIP,
                selected?.id === t.id
                  ? 'border-primary/60 bg-primary/10 font-medium text-primary'
                  : 'text-muted-foreground hover:bg-accent',
              )}
            >
              {t.name}
            </Link>
          ))}
        </nav>
      )}

      {shown.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 py-2 text-center text-sm text-muted-foreground">
            <p>
              {selected ? `Nenhum produto em ${selected.name} ainda.` : 'Nenhum produto cadastrado ainda.'}
            </p>
            <Button asChild variant="outline">
              <Link href={tops.length === 0 ? '/casa' : newHref}>
                {tops.length === 0 ? 'Começar pelas categorias' : 'Cadastrar produto'}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        ordered.map(([name, items]) => (
          <Card key={name} className="gap-0 py-0">
            <CardHeader className="py-3">
              <CardTitle className="text-sm font-semibold">{name}</CardTitle>
            </CardHeader>
            <CardContent className="border-t px-0">
              <ProductList products={items} />
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
