import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { ProductList } from '@/components/stock/product-list';
import { StockSearchForm } from '@/components/stock/search-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { listLots, stockOverview } from '@/db/queries/stock';
import { today } from '@/domain/dates';
import { matchesSearch, normalizeText } from '@/domain/stock/catalog';

export const metadata: Metadata = { title: 'Buscar no estoque' };

/**
 * Busca única (D86): nome, categoria, local, observações e o código do lote ("ARR-03" acha o arroz), sem acento.
 * Para a farmácia e o mercado: "já tenho isso?".
 */
export default async function StockSearchPage({ searchParams }: PageProps<'/casa/buscar'>) {
  const { q } = await searchParams;
  const query = typeof q === 'string' ? q.trim() : '';
  const db = getDb();
  const [products, lots] = query ? await Promise.all([stockOverview(db, today()), listLots(db)]) : [[], []];
  const codes = new Map<string, string[]>();
  for (const l of lots) codes.set(l.productId, [...(codes.get(l.productId) ?? []), l.code]);
  const code = normalizeText(query).replace(/\s/g, '');
  const found = products.filter(
    (p) =>
      matchesSearch(query, [p.name, p.categoryLabel, p.notes, p.prefix, ...p.locationNames]) ||
      (codes.get(p.id) ?? []).some((c) => normalizeText(c) === code),
  );
  // quem tem estoque primeiro: é o que interessa na hora de não comprar repetido
  found.sort((a, b) => Number(b.packages > 0) - Number(a.packages > 0));

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title="Buscar"
        description="Já tem em casa? Procure pelo nome, categoria, local ou código."
      />
      <StockSearchForm defaultValue={query} autoFocus={!query} />
      {query &&
        (found.length === 0 ? (
          <Card>
            <CardContent className="space-y-3 py-2 text-center text-sm text-muted-foreground">
              <p>Nada no estoque com &ldquo;{query}&rdquo;.</p>
              <Button asChild variant="outline">
                <Link href={`/casa/produtos/novo?nome=${encodeURIComponent(query)}`}>
                  Cadastrar &ldquo;{query}&rdquo;
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="gap-0 py-0">
            <CardContent className="px-0">
              <p className="px-4 py-3 text-sm text-muted-foreground sm:px-6">
                {found.length} {found.length === 1 ? 'produto' : 'produtos'}
              </p>
              <ProductList products={found} showCategory className="border-t" />
            </CardContent>
          </Card>
        ))}
    </div>
  );
}
