import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Ellipsis, MapPin, PackagePlus, Pencil, Undo2 } from 'lucide-react';
import { ActionButton } from '@/components/forms/action-button';
import { PageHeader } from '@/components/layout/page-header';
import {
  dateBR,
  lotContentText,
  MOVEMENT_LABEL,
  quantityText,
  signedPackages,
} from '@/components/stock/format';
import { ExpiryBadge, LowBadge } from '@/components/stock/stock-icons';
import { CountForm, LotEditForm, LotForm, UseForm } from '@/components/stock/stock-forms';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SheetAction } from '@/components/ui/sheet-action';
import { getDb } from '@/db/client';
import { listStockLocations, productDetail } from '@/db/queries/stock';
import { today } from '@/domain/dates';
import { formatAmount } from '@/domain/stock/measure';
import { expiryLevel } from '@/domain/stock/quantity';
import { cn } from '@/lib/utils';
import { cancelStockMovementAction } from '../../actions';

export const metadata: Metadata = { title: 'Produto' };

/**
 * Produto da Casa (D82, D83): quanto tem (na medida e em embalagens), os lotes na ordem de uso (FEFO) com código e
 * validade, as ações (entrada, usei, descartei, contei) e o histórico, com desfazer.
 */
export default async function ProductPage({ params }: PageProps<'/casa/produtos/[id]'>) {
  const { id } = await params;
  const db = getDb();
  const hoje = today();
  const [detail, locations] = await Promise.all([productDetail(db, id, hoje), listStockLocations(db)]);
  if (!detail) notFound();
  const { product, lots, movements } = detail;
  const q = quantityText(product);
  const inStock = lots.filter((l) => l.quantity > 0);
  const empty = lots.filter((l) => l.quantity <= 0);
  const option = {
    id: product.id,
    name: product.name,
    categoryLabel: product.categoryLabel,
    measure: product.measure,
    defaultPackage: product.defaultPackage,
    defaultContent: product.defaultContent,
    defaultLocationId: product.defaultLocationId,
  };
  const lotChoices = inStock.map((l) => ({
    id: l.id,
    label: `${l.code} · ${lotContentText(l, product.measure)}${l.expiryDate ? ` · vence ${dateBR(l.expiryDate)}` : ''}`,
  }));
  const archived = product.archivedAt !== null;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title={product.name}
        description={product.categoryLabel}
        back={{ href: `/casa/estoque?categoria=${product.topCategoryId}`, label: 'Estoque' }}
        actions={
          !archived && (
            <Button asChild variant="outline" size="icon" aria-label="Editar produto">
              <Link href={`/casa/produtos/${id}/editar`}>
                <Pencil aria-hidden />
              </Link>
            </Button>
          )
        }
      />

      <Card className="gap-3">
        <CardContent className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-3xl font-semibold tabular-nums" data-testid="product-total">
                {q.main}
              </p>
              {q.packages && <p className="text-sm text-muted-foreground tabular-nums">{q.packages}</p>}
            </div>
            <div className="flex flex-col items-end gap-1">
              {product.low && <LowBadge />}
              <ExpiryBadge date={product.nextExpiry} level={product.expiry} />
            </div>
          </div>
          {(product.minQuantity !== null ||
            product.targetQuantity !== null ||
            product.locationNames.length > 0) && (
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {product.locationNames.length > 0 && (
                <div className="flex items-center gap-1">
                  <MapPin className="size-3.5" aria-hidden />
                  <dt className="sr-only">Local</dt>
                  <dd>{product.locationNames.join(', ')}</dd>
                </div>
              )}
              {product.minQuantity !== null && (
                <div className="flex gap-1">
                  <dt>Mínimo</dt>
                  <dd className="font-medium text-foreground">
                    {formatAmount(product.measure, product.minQuantity)}
                  </dd>
                </div>
              )}
              {product.targetQuantity !== null && (
                <div className="flex gap-1">
                  <dt>Meta</dt>
                  <dd className="font-medium text-foreground">
                    {formatAmount(product.measure, product.targetQuantity)}
                  </dd>
                </div>
              )}
            </dl>
          )}
          {archived ? (
            <p className="text-sm text-muted-foreground">Produto arquivado.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 pt-1">
              <SheetAction
                label="Entrada"
                title={`Entrada de ${product.name}`}
                icon={<PackagePlus aria-hidden />}
                variant="default"
              >
                <LotForm product={option} locations={locations} today={hoje} />
              </SheetAction>
              <SheetAction label="Usei" title={`Usei ${product.name}`} variant="outline">
                {inStock.length > 0 ? (
                  <UseForm productId={id} kind="USE" lots={lotChoices} today={hoje} />
                ) : (
                  <p className="text-sm text-muted-foreground">Sem estoque para dar baixa.</p>
                )}
              </SheetAction>
              <SheetAction label="Descartei" title={`Descartei ${product.name}`} variant="outline">
                {inStock.length > 0 ? (
                  <UseForm productId={id} kind="DISCARD" lots={lotChoices} today={hoje} />
                ) : (
                  <p className="text-sm text-muted-foreground">Sem estoque para descartar.</p>
                )}
              </SheetAction>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="gap-0 pb-0">
        <CardHeader className="pb-3">
          <CardTitle>Lotes</CardTitle>
          <CardDescription>Na ordem de uso: o que vence primeiro vem antes.</CardDescription>
        </CardHeader>
        <CardContent className="border-t px-0">
          {inStock.length === 0 ? (
            <p className="px-6 py-6 text-center text-sm text-muted-foreground">Nenhum lote com estoque.</p>
          ) : (
            <ul className="divide-y" data-testid="product-lots">
              {inStock.map((l, i) => (
                <li key={l.id} className="flex items-center gap-3 px-4 py-3 sm:px-6">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{l.code}</span>
                      {i === 0 && inStock.length > 1 && (
                        <span className="rounded-full bg-primary/12 px-2 py-0.5 text-xs font-medium text-primary">
                          Usar primeiro
                        </span>
                      )}
                      <ExpiryBadge date={l.expiryDate} level={expiryLevel(l.expiryDate, hoje)} />
                    </div>
                    <p className="text-sm tabular-nums">{lotContentText(l, product.measure)}</p>
                    <p className="text-xs text-muted-foreground">
                      Entrou em {dateBR(l.entryDate)}
                      {l.locationName && ` · ${l.locationName}`}
                      {l.notes && ` · ${l.notes}`}
                    </p>
                  </div>
                  {!archived && (
                    <SheetAction
                      label={`Lote ${l.code}`}
                      iconOnly
                      icon={<Ellipsis aria-hidden />}
                      variant="ghost"
                      description="Conte o que tem de verdade ou corrija os dados do lote."
                    >
                      <div className="space-y-6">
                        <section className="space-y-3">
                          <h3 className="text-sm font-semibold">Contei</h3>
                          <CountForm lotId={l.id} code={l.code} current={l.quantity} today={hoje} />
                        </section>
                        <section className="space-y-3 border-t pt-4">
                          <h3 className="text-sm font-semibold">Corrigir o lote</h3>
                          <LotEditForm lot={l} measure={product.measure} locations={locations} today={hoje} />
                        </section>
                      </div>
                    </SheetAction>
                  )}
                </li>
              ))}
            </ul>
          )}
          {empty.length > 0 && (
            <p className="border-t px-4 py-3 text-xs text-muted-foreground sm:px-6">
              Lotes zerados: {empty.map((l) => l.code).join(', ')}
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="gap-0 pb-0">
        <CardHeader className="pb-3">
          <CardTitle>Histórico</CardTitle>
          <CardDescription>Movimento errado? Desfaça: ele sai da conta, mas fica registrado.</CardDescription>
        </CardHeader>
        <CardContent className="border-t px-0">
          {movements.length === 0 ? (
            <p className="px-6 py-6 text-center text-sm text-muted-foreground">Nenhum movimento ainda.</p>
          ) : (
            <ul className="divide-y" data-testid="product-history">
              {movements.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-4 py-3 sm:px-6">
                  <div className={cn('min-w-0 flex-1', m.cancelledAt && 'text-muted-foreground')}>
                    <p className="text-sm font-medium">
                      {MOVEMENT_LABEL[m.kind]} · <span className="font-mono">{m.lotCode}</span>
                      {m.cancelledAt && <span className="font-normal"> · desfeito</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {dateBR(m.movementDate)} · {m.userName}
                      {m.notes && ` · ${m.notes}`}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'text-sm font-medium tabular-nums',
                      m.cancelledAt && 'line-through opacity-60',
                    )}
                  >
                    {signedPackages(m.quantity)}
                  </span>
                  {!m.cancelledAt && !archived && (
                    <ActionButton
                      action={cancelStockMovementAction}
                      fields={{ id: m.id }}
                      label="Desfazer"
                      icon={<Undo2 aria-hidden />}
                      confirm={{
                        title: `Desfazer “${MOVEMENT_LABEL[m.kind]}” do ${m.lotCode}?`,
                        description:
                          'O movimento sai da conta do estoque, mas continua no histórico como desfeito.',
                        confirmLabel: 'Desfazer',
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
