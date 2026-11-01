import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Plus } from 'lucide-react';
import { CardForm } from '@/components/cards/card-form';
import { InvoiceStateBadge, LimitBar } from '@/components/cards/card-summary';
import { ActionButton } from '@/components/forms/action-button';
import { PageHeader } from '@/components/layout/page-header';
import { Amount } from '@/components/money/amount';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollStrip } from '@/components/ui/scroll-strip';
import { SheetAction } from '@/components/ui/sheet-action';
import { getDb } from '@/db/client';
import { listCardInvoices, listCardPlans, listCardSummaries } from '@/db/queries/cards';
import {
  compareDates,
  formatDateBR,
  formatMonthLabel,
  formatMonthShort,
  monthStart,
  today,
} from '@/domain/dates';
import { resolveMonth } from '@/lib/month';
import { cn } from '@/lib/utils';
import { formatBRL, formatDecimalBR } from '@/domain/money';
import { archiveCardAction } from '../actions';

export const metadata: Metadata = { title: 'Cartão' };

export default async function CardPage({ params, searchParams }: PageProps<'/cartoes/[id]'>) {
  const { id } = await params;
  const month = await resolveMonth(searchParams);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = getDb();
  const hoje = today();
  const [[s], invoices, plans] = await Promise.all([
    listCardSummaries(db, hoje, { cardId: id }),
    listCardInvoices(db, id, hoje),
    listCardPlans(db, id, hoje),
  ]);
  if (!s) notFound();
  const c = s.card;
  const viewing = month !== monthStart(hoje); // o mês do seletor, quando não é o atual
  const monthInvoice = invoices.find((i) => i.referenceMonth === month);
  const activePlans = plans.filter((p) => p.status === 'ACTIVE' && p.remainingCount > 0 && p.count > 1);
  // faixa de faturas: passadas à esquerda, a atual no meio (em destaque), futuras à direita
  const timeline = [...invoices].sort((a, b) => compareDates(a.referenceMonth, b.referenceMonth));
  const currentRef = s.currentInvoice.referenceMonth;
  const focusRef = viewing && monthInvoice ? month : currentRef;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title={c.name}
        description={
          <>
            {c.issuer ?? 'Cartão'}
            {c.last4 && ` · final ${c.last4}`} · fecha dia {c.closingDay} · vence dia {c.dueDay}
            {c.isAdditional && ` · adicional de ${c.holderName}`}
          </>
        }
        back={{ href: '/cartoes', label: 'Cartões' }}
      />

      <Card className="py-4">
        <CardContent className="space-y-4 px-4 sm:px-6">
          <LimitBar s={s} />
          {/* ações do cartão em barra: a principal cheia, as outras lado a lado */}
          <div className="space-y-2">
            <Button asChild className="w-full">
              <Link href={`/lancamentos/novo?tipo=cartao&cartao=${c.id}`}>
                <Plus aria-hidden /> Nova compra
              </Link>
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button
                asChild
                variant="outline"
                size="sm"
                className="h-auto min-h-9 py-2 text-xs leading-tight whitespace-normal"
              >
                <Link href={`/cartoes/${c.id}/em-andamento`}>Parcelamento em andamento</Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="h-auto min-h-9 py-2 text-xs leading-tight whitespace-normal"
              >
                <Link href={`/cartoes/${c.id}/importar`}>Importar fatura (OFX)</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {viewing && !monthInvoice?.id && (
        <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
          Nenhuma fatura lançada para {formatMonthLabel(month)} neste cartão.
        </p>
      )}

      <section aria-label="Faturas" className="space-y-2">
        <h2 className="font-semibold">Faturas</h2>
        <ScrollStrip className="-mx-4 scroll-px-4 px-4 pb-1">
          {timeline.map((inv) => {
            const isCurrent = inv.referenceMonth === currentRef;
            const isChosen = viewing && inv.referenceMonth === month;
            const body = (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium first-letter:uppercase">
                    {formatMonthShort(inv.referenceMonth)}
                  </span>
                  <InvoiceStateBadge state={inv.state} />
                </div>
                <Amount cents={inv.totalCents} className="block text-lg font-semibold" />
                <div className="text-xs text-muted-foreground">
                  vence {formatDateBR(inv.dueDate).slice(0, 5)}
                  {inv.paidCents > 0 && inv.remainingCents > 0 && ` · falta ${formatBRL(inv.remainingCents)}`}
                </div>
                {isCurrent && <div className="text-xs font-medium text-primary">Fatura atual</div>}
                {isChosen && !isCurrent && (
                  <div className="text-xs font-medium text-primary">Mês escolhido</div>
                )}
              </>
            );
            const tile = cn(
              'block w-40 shrink-0 snap-center space-y-1 rounded-xl border bg-card p-3 transition-colors',
              (isCurrent || isChosen) && 'border-primary/60 bg-primary/5 ring-2 ring-primary/20',
            );
            const focus = inv.referenceMonth === focusRef ? { 'data-current': true } : {};
            return inv.id ? (
              <Link
                key={inv.referenceMonth}
                href={`/cartoes/faturas/${inv.id}`}
                aria-label={`Fatura de ${formatMonthLabel(inv.referenceMonth)}`}
                className={cn(tile, 'hover:bg-muted/50')}
                {...focus}
              >
                {body}
              </Link>
            ) : (
              <div key={inv.referenceMonth} className={tile} {...focus}>
                {body}
              </div>
            );
          })}
        </ScrollStrip>
      </section>

      <Card className="gap-0 pb-0">
        <CardHeader className="pb-3">
          <CardTitle>Parcelamentos ativos</CardTitle>
        </CardHeader>
        <CardContent className="divide-y border-t px-0">
          {activePlans.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Nenhum parcelamento em andamento.
            </p>
          ) : (
            activePlans.map((p) => (
              <Link
                key={p.planId}
                href={`/cartoes/compras/${p.planId}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium break-words">{p.description}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatBRL(p.total)} em {p.count}x · faltam {p.remainingCount}
                    {p.lastMonth && ` · até ${formatMonthShort(p.lastMonth)}`}
                    {p.source === 'ONBOARDING' && (
                      <Badge variant="outline" className="ml-1">
                        em andamento
                      </Badge>
                    )}
                  </div>
                </div>
                <Amount cents={p.remainingCents} className="shrink-0 text-sm font-medium" />
              </Link>
            ))
          )}
        </CardContent>
      </Card>

      <SheetAction label="Editar cartão" variant="ghost" className="text-muted-foreground">
        <div className="space-y-6">
          <CardForm
            defaults={{
              id: c.id,
              name: c.name,
              issuer: c.issuer,
              last4: c.last4,
              isAdditional: c.isAdditional,
              holderName: c.holderName,
              limitText: c.limitTotalCents !== null ? formatDecimalBR(c.limitTotalCents) : '',
              closingDay: c.closingDay,
              dueDay: c.dueDay,
              botAliases: c.botAliases,
            }}
          />
          <ActionButton
            action={archiveCardAction}
            fields={{ id: c.id }}
            variant="destructive"
            label="Arquivar cartão"
            confirm={{
              title: 'Arquivar este cartão?',
              description:
                'Ele some das listas e do bot. Só é possível sem parcelas em faturas abertas ou futuras.',
              confirmLabel: 'Arquivar',
            }}
          />
        </div>
      </SheetAction>
    </div>
  );
}
