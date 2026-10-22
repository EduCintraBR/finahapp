import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Plus } from 'lucide-react';
import { CardForm } from '@/components/cards/card-form';
import { InvoiceStateBadge, LimitBar } from '@/components/cards/card-summary';
import { ActionButton } from '@/components/forms/action-button';
import { Amount } from '@/components/money/amount';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { listCardInvoices, listCardPlans, listCardSummaries } from '@/db/queries/cards';
import { formatDateBR, formatMonthLabel, monthStart, today } from '@/domain/dates';
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

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/cartoes">
          <ArrowLeft aria-hidden /> Cartões
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardDescription>
            {c.issuer ?? 'Cartão'}
            {c.last4 && ` · final ${c.last4}`} · fecha dia {c.closingDay} · vence dia {c.dueDay}
            {c.isAdditional && ` · adicional de ${c.holderName}`}
          </CardDescription>
          <CardTitle className="text-xl">{c.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <LimitBar s={s} />
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href={`/lancamentos/novo?tipo=cartao&cartao=${c.id}`}>
                <Plus aria-hidden /> Nova compra
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`/cartoes/${c.id}/em-andamento`}>Parcelamento em andamento</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`/cartoes/${c.id}/importar`}>Importar fatura (OFX)</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {viewing && (
        <div
          className={cn(
            'rounded-xl border px-4 py-3 text-sm',
            monthInvoice?.id ? 'bg-card' : 'border-dashed text-muted-foreground',
          )}
        >
          {monthInvoice?.id ? (
            <Link
              href={`/cartoes/faturas/${monthInvoice.id}`}
              className="flex items-center justify-between gap-3"
            >
              <span>
                Fatura de <span className="font-medium">{formatMonthLabel(month)}</span> (mês escolhido)
              </span>
              <span className="flex items-center gap-2">
                <Amount cents={monthInvoice.totalCents} className="font-semibold" />
                <InvoiceStateBadge state={monthInvoice.state} />
              </span>
            </Link>
          ) : (
            <>Nenhuma fatura lançada para {formatMonthLabel(month)} neste cartão.</>
          )}
        </div>
      )}

      <Card className="gap-0 pb-0">
        <CardHeader className="pb-3">
          <CardTitle>Faturas</CardTitle>
        </CardHeader>
        <CardContent className="divide-y border-t px-0">
          {invoices.map((inv) => {
            const body = (
              <>
                <div className="min-w-0 flex-1">
                  <div className="font-medium first-letter:uppercase">
                    {formatMonthLabel(inv.referenceMonth)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    fecha {formatDateBR(inv.closingDate)} · vence {formatDateBR(inv.dueDate)}
                    {inv.paidCents > 0 &&
                      inv.remainingCents > 0 &&
                      ` · falta ${formatBRL(inv.remainingCents)}`}
                  </div>
                </div>
                <InvoiceStateBadge state={inv.state} />
                <Amount cents={inv.totalCents} className="w-28 text-right font-medium" />
              </>
            );
            return inv.id ? (
              <Link
                key={inv.referenceMonth}
                href={`/cartoes/faturas/${inv.id}`}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 hover:bg-muted/50',
                  inv.referenceMonth === month && viewing && 'bg-accent/60',
                )}
              >
                {body}
              </Link>
            ) : (
              <div key={inv.referenceMonth} className="flex items-center gap-3 px-4 py-3">
                {body}
              </div>
            );
          })}
        </CardContent>
      </Card>

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
                  <div className="truncate font-medium">{p.description}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatBRL(p.total)} em {p.count}x · faltam {p.remainingCount}
                    {p.lastMonth && ` · até ${formatMonthLabel(p.lastMonth)}`}
                    {p.source === 'ONBOARDING' && (
                      <Badge variant="outline" className="ml-1">
                        em andamento
                      </Badge>
                    )}
                  </div>
                </div>
                <Amount cents={p.remainingCents} className="text-sm font-medium" />
              </Link>
            ))
          )}
        </CardContent>
      </Card>

      <details className="rounded-xl border bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Editar cartão</summary>
        <div className="space-y-6 px-4 pb-4">
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
      </details>
    </div>
  );
}
