import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight, PackagePlus, Plus } from 'lucide-react';
import { ActionButton } from '@/components/forms/action-button';
import { PageHeader } from '@/components/layout/page-header';
import { MOVEMENT_LABEL, signedPackages } from '@/components/stock/format';
import { RotationList } from '@/components/stock/rotation-list';
import { StockSearchForm } from '@/components/stock/search-form';
import { StockCategoryIcon } from '@/components/stock/stock-icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db/client';
import {
  listStockCategories,
  recentMovements,
  rotationLots,
  stockOverview,
  type RotationLot,
} from '@/db/queries/stock';
import { formatDateBR, today } from '@/domain/dates';
import { SUGGESTED_CATEGORIES } from '@/domain/stock/catalog';
import { createSuggestedStockCategoriesAction } from './actions';

export const metadata: Metadata = { title: 'Casa' };

/** Quadro de alerta da Início: até 4 lotes e o resto no rodízio. */
function Board({
  title,
  description,
  lots,
  hoje,
}: {
  title: string;
  description: string;
  lots: RotationLot[];
  hoje: string;
}) {
  if (lots.length === 0) return null;
  return (
    <Card className="gap-0 border-warning/60 pb-0" role="region" aria-label={title}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle>
            {title} <span className="text-muted-foreground">({lots.length})</span>
          </CardTitle>
          {lots.length > 4 && (
            <Button asChild variant="ghost" size="sm">
              <Link href="/casa/rodizio">Ver todos</Link>
            </Button>
          )}
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="border-t px-0">
        <RotationList lots={lots.slice(0, 4)} today={hoje} />
      </CardContent>
    </Card>
  );
}

/**
 * Início da Casa (D81, D85): busca, os quadros do que pede atenção (vencidos e vencendo, conferências que chegaram),
 * as categorias do estoque (um toque abre a lista) e os últimos movimentos. Sem categoria ainda, oferece as sugeridas.
 */
export default async function CasaHomePage() {
  const db = getDb();
  const hoje = today();
  const [categories, products, recent, rotation] = await Promise.all([
    listStockCategories(db),
    stockOverview(db, hoje),
    recentMovements(db, 6),
    rotationLots(db, hoje),
  ]);
  const tops = categories.filter((c) => c.parentId === null);
  const expiring = rotation.filter((l) => l.expiry === 'expired' || l.expiry === 'soon');
  const toCheck = rotation.filter((l) => l.checkDue);

  return (
    <div className="mx-auto max-w-2xl space-y-4 lg:max-w-5xl">
      <PageHeader
        title="Casa"
        description="O estoque da casa: o que tem, quanto e onde."
        actions={
          tops.length > 0 && (
            <Button asChild className="max-sm:hidden">
              <Link href="/casa/entrada">
                <PackagePlus aria-hidden /> Dar entrada
              </Link>
            </Button>
          )
        }
      />

      {tops.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Comece pelas categorias</CardTitle>
            <CardDescription>
              Elas organizam o estoque. As sugeridas são {SUGGESTED_CATEGORIES.map((c) => c.name).join(', ')},
              e Alimentos já vem com Grãos, Massas, Enlatados, Café da manhã e Temperos. Dá para renomear,
              criar e arquivar depois.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 sm:flex-row">
            <ActionButton
              action={createSuggestedStockCategoriesAction}
              fields={{}}
              label="Usar categorias sugeridas"
              pendingLabel="Criando…"
              variant="default"
            />
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link href="/casa/categorias">Criar as minhas</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <StockSearchForm />
          {(expiring.length > 0 || toCheck.length > 0) && (
            <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
              <Board
                title="Vencidos e vencendo"
                description="Vencido ou vencendo nos próximos 30 dias: use primeiro ou troque."
                lots={expiring}
                hoje={hoje}
              />
              <Board
                title="Conferir"
                description="A conferência periódica chegou: veja umidade, bicho e vedação."
                lots={toCheck}
                hoje={hoje}
              />
            </div>
          )}
          <section aria-label="Categorias" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {tops.map((c) => {
              const mine = products.filter((p) => p.topCategoryId === c.id);
              const alerts = mine.filter(
                (p) => p.low || p.expiry === 'expired' || p.expiry === 'soon',
              ).length;
              return (
                <Link
                  key={c.id}
                  href={`/casa/estoque?categoria=${c.id}`}
                  className="flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-accent"
                >
                  <span className="flex size-10 items-center justify-center rounded-lg bg-primary/12 text-primary">
                    <StockCategoryIcon name={c.icon} className="size-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {mine.length === 0
                        ? 'Nenhum produto'
                        : `${mine.length} ${mine.length === 1 ? 'produto' : 'produtos'}`}
                      {alerts > 0 && (
                        <span className="text-warning-text">
                          {' '}
                          · {alerts} {alerts === 1 ? 'alerta' : 'alertas'}
                        </span>
                      )}
                    </span>
                  </span>
                </Link>
              );
            })}
          </section>

          <Card className="gap-0 pb-0">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle>Últimos movimentos</CardTitle>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/casa/produtos/novo">
                    <Plus aria-hidden /> Produto
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="border-t px-0">
              {recent.length === 0 ? (
                <p className="px-6 py-6 text-center text-sm text-muted-foreground">
                  Nada ainda. Cadastre um produto e dê a primeira entrada.
                </p>
              ) : (
                <ul className="divide-y">
                  {recent.map((m) => (
                    <li key={m.id}>
                      <Link
                        href={`/casa/produtos/${m.productId}`}
                        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 sm:px-6"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{m.productName}</p>
                          <p className="text-xs text-muted-foreground">
                            {MOVEMENT_LABEL[m.kind]} · {m.lotCode} · {formatDateBR(m.movementDate)} ·{' '}
                            {m.userName}
                            {m.cancelledAt && ' · desfeito'}
                          </p>
                        </div>
                        <span
                          className={
                            m.cancelledAt
                              ? 'text-sm text-muted-foreground tabular-nums line-through'
                              : 'text-sm font-medium tabular-nums'
                          }
                        >
                          {signedPackages(m.quantity)}
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
