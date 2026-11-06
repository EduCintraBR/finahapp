import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MapPin, Printer, Undo2 } from 'lucide-react';
import { ActionButton } from '@/components/forms/action-button';
import { PageHeader } from '@/components/layout/page-header';
import {
  dateBR,
  entryLabel,
  lotContentText,
  MOVEMENT_LABEL,
  signedPackages,
} from '@/components/stock/format';
import { CheckBadge, ExpiryBadge } from '@/components/stock/stock-icons';
import { CheckForm } from '@/components/stock/stock-forms';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SheetAction } from '@/components/ui/sheet-action';
import { getDb } from '@/db/client';
import { lotDetail } from '@/db/queries/stock';
import { today } from '@/domain/dates';
import { ageText } from '@/domain/stock/rotation';
import { cn } from '@/lib/utils';
import { cancelStockMovementAction, openStockLotAction, useStockAction } from '../../actions';

export const metadata: Metadata = { title: 'Lote' };

/**
 * Um lote (D87): é o que o QR da etiqueta abre. "Abri 1" dá baixa de uma embalagem deste lote num toque; mostra a
 * selagem e a idade, a validade, a conferência periódica, de onde veio (envase) e o histórico.
 */
export default async function LotPage({ params }: PageProps<'/casa/lotes/[id]'>) {
  const { id } = await params;
  const hoje = today();
  const detail = await lotDetail(getDb(), id, hoje);
  if (!detail) notFound();
  const { lot, product, sources, repacks, checks, movements } = detail;
  const opened = lot.origin === 'OPENED';
  const canOpen = !opened && !!product.openShelfLifeDays;
  const active = !product.archivedAt;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title={<span className="font-mono">{lot.code}</span>}
        description={product.name}
        back={{ href: `/casa/produtos/${product.id}`, label: product.name }}
        actions={
          <Button asChild variant="outline" size="icon" aria-label="Imprimir etiquetas">
            <Link href={`/casa/etiquetas?lote=${lot.id}`}>
              <Printer aria-hidden />
            </Link>
          </Button>
        }
      />

      <Card className="gap-3">
        <CardContent className="space-y-3">
          <p className="text-2xl font-semibold tabular-nums" data-testid="lot-quantity">
            {lot.quantity > 0 ? lotContentText(lot, product.measure) : 'Lote zerado'}
          </p>
          <div className="flex flex-wrap gap-2">
            <ExpiryBadge date={lot.expiryDate} level={detail.expiry} kind={product.expiryKind} />
            <CheckBadge date={detail.nextCheck} due={detail.checkDue} />
          </div>
          <dl className="space-y-1 text-sm text-muted-foreground">
            <div className="flex gap-1">
              <dt>{entryLabel(lot.origin)} em</dt>
              <dd className="text-foreground">
                {dateBR(lot.entryDate)} ({ageText(lot.entryDate, hoje)})
              </dd>
            </div>
            {lot.locationName && (
              <div className="flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden />
                <dt className="sr-only">Local</dt>
                <dd>{lot.locationName}</dd>
              </div>
            )}
            {sources.length > 0 && (
              <div className="flex gap-1">
                <dt>{opened ? 'Aberto de' : 'Envasado de'}</dt>
                <dd className="text-foreground">
                  {sources.map((s, i) => (
                    <span key={s.lotId}>
                      {i > 0 && ', '}
                      <Link href={`/casa/lotes/${s.lotId}`} className="font-mono hover:underline">
                        {s.code}
                      </Link>{' '}
                      ({s.packages})
                    </span>
                  ))}
                </dd>
              </div>
            )}
            {repacks.length > 0 && (
              <div className="flex gap-1">
                <dt>{repacks.every((r) => r.opened) ? 'Aberto em' : 'Envasado em'}</dt>
                <dd className="text-foreground">
                  {repacks.map((r, i) => (
                    <span key={r.lotId}>
                      {i > 0 && ', '}
                      <Link href={`/casa/lotes/${r.lotId}`} className="font-mono hover:underline">
                        {r.code}
                      </Link>{' '}
                      ({r.packages})
                    </span>
                  ))}
                </dd>
              </div>
            )}
            {lot.notes && <p>{lot.notes}</p>}
          </dl>
          {active && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              {lot.quantity > 0 ? (
                canOpen ? (
                  <ActionButton
                    action={openStockLotAction}
                    fields={{ lotId: lot.id, date: hoje }}
                    label={`Abri 1 ${lot.packageName}`}
                    pendingLabel="Abrindo…"
                    variant="default"
                  />
                ) : (
                  <ActionButton
                    action={useStockAction}
                    fields={{ productId: product.id, kind: 'USE', packages: 1, lotId: lot.id, date: hoje }}
                    label={`${opened || product.openShelfLifeDays ? 'Usei' : 'Abri'} 1 ${lot.packageName}`}
                    pendingLabel="Salvando…"
                    variant="default"
                  />
                )
              ) : (
                <Button asChild variant="outline">
                  <Link href={`/casa/produtos/${product.id}`}>Ver o produto</Link>
                </Button>
              )}
              <SheetAction label="Conferi" title={`Conferi o ${lot.code}`}>
                <CheckForm lotId={lot.id} code={lot.code} today={hoje} />
              </SheetAction>
            </div>
          )}
        </CardContent>
      </Card>

      {checks.length > 0 && (
        <Card className="gap-0 pb-0">
          <CardHeader className="pb-3">
            <CardTitle>Conferências</CardTitle>
          </CardHeader>
          <CardContent className="border-t px-0">
            <ul className="divide-y" data-testid="lot-checks">
              {checks.map((c) => (
                <li key={c.id} className="px-4 py-3 sm:px-6">
                  <p className="text-sm font-medium">{dateBR(c.checkDate)}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.userName}
                    {c.notes && ` · ${c.notes}`}
                  </p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card className="gap-0 pb-0">
        <CardHeader className="pb-3">
          <CardTitle>Histórico do lote</CardTitle>
        </CardHeader>
        <CardContent className="border-t px-0">
          <ul className="divide-y" data-testid="lot-history">
            {movements.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3 sm:px-6">
                <div className={cn('min-w-0 flex-1', m.cancelledAt && 'text-muted-foreground')}>
                  <p className="text-sm font-medium">
                    {MOVEMENT_LABEL[m.kind]}
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
                {!m.cancelledAt && active && (
                  <ActionButton
                    action={cancelStockMovementAction}
                    fields={{ id: m.id }}
                    label="Desfazer"
                    icon={<Undo2 aria-hidden />}
                    confirm={{
                      title: `Desfazer “${MOVEMENT_LABEL[m.kind]}” do ${lot.code}?`,
                      description:
                        m.kind === 'OPEN_IN' || m.kind === 'OPEN_OUT'
                          ? 'Desfaz a abertura inteira: a embalagem volta fechada para o lote de origem e o lote aberto zera.'
                          : m.kind === 'REPACK_IN' || m.kind === 'REPACK_OUT'
                            ? 'Desfaz o envase inteiro: as embalagens voltam para os lotes de origem e o lote envasado zera.'
                            : 'O movimento sai da conta do estoque, mas continua no histórico como desfeito.',
                      confirmLabel: 'Desfazer',
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
