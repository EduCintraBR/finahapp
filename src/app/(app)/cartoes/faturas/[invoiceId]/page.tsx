import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { InvoiceStateBadge } from '@/components/cards/card-summary';
import { InvoiceDatesForm, PayInvoiceDialog } from '@/components/cards/invoice-forms';
import { UserBadge } from '@/components/entries/user-badge';
import { ActionButton } from '@/components/forms/action-button';
import { Amount } from '@/components/money/amount';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { getInvoiceDetail } from '@/db/queries/cards';
import { compareDates, formatDateBR, formatDayLabel, formatMonthLabel, today } from '@/domain/dates';
import { formatBRL, formatDecimalBR } from '@/domain/money';
import { PAYMENT_METHOD_LABEL } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { removePaymentAction } from '../../actions';

export const metadata: Metadata = { title: 'Fatura' };

const ITEM_KIND_LABEL: Record<string, string> = {
  ANTICIPATION: 'Antecipação',
  REFUND_CREDIT: 'Estorno',
  ADJUSTMENT: 'Ajuste',
};
const ITEM_STATUS_LABEL: Record<string, string> = { ANTICIPATED: 'Antecipada', CANCELLED: 'Cancelada' };

export default async function InvoicePage({ params }: PageProps<'/cartoes/faturas/[invoiceId]'>) {
  const { invoiceId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) notFound();
  const hoje = today();
  const d = await getInvoiceDetail(getDb(), invoiceId, hoje);
  if (!d) notFound();
  const { card, summary: inv, items, payments } = d;
  const label = `${card.name} · ${formatMonthLabel(inv.referenceMonth)}`;
  // do dia mais novo para o mais antigo, como a tela de lançamentos
  const byDay = new Map<string, typeof items>();
  for (const i of items) byDay.set(i.postingDate, [...(byDay.get(i.postingDate) ?? []), i]);
  const groups = [...byDay].sort(([a], [b]) => compareDates(b, a));
  const closingEditable = compareDates(hoje, inv.closingDate) < 0;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={`/cartoes/${card.id}`}>
          <ArrowLeft aria-hidden /> {card.name}
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <InvoiceStateBadge state={inv.state} />
          </div>
          <CardDescription className="first-letter:uppercase">
            Fatura de {formatMonthLabel(inv.referenceMonth)} · fecha {formatDateBR(inv.closingDate)} · vence{' '}
            {formatDateBR(inv.dueDate)}
          </CardDescription>
          <CardTitle>
            <Amount cents={inv.totalCents} className="text-3xl font-semibold" />
          </CardTitle>
          {inv.paidCents > 0 && (
            <CardDescription>
              Pago {formatBRL(inv.paidCents)}
              {inv.remainingCents > 0 && ` · falta ${formatBRL(inv.remainingCents)}`}
              {inv.paidCents > inv.totalCents &&
                inv.totalCents >= 0 &&
                ` · pago a mais: ${formatBRL(inv.paidCents - inv.totalCents)}`}
            </CardDescription>
          )}
          {inv.totalCents < 0 && <CardDescription>Fatura credora: nada a pagar.</CardDescription>}
        </CardHeader>
        {inv.remainingCents > 0 && (
          <CardContent>
            <PayInvoiceDialog
              invoiceId={invoiceId}
              label={label}
              amountText={formatDecimalBR(inv.remainingCents)}
              today={hoje}
              additionalHolder={card.isAdditional ? card.holderName : null}
            />
          </CardContent>
        )}
      </Card>

      <Card className="gap-0 pb-0">
        <CardHeader className="pb-3">
          <CardTitle>Itens</CardTitle>
        </CardHeader>
        <CardContent className="divide-y border-t px-0">
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhum item nesta fatura.</p>
          ) : (
            groups.flatMap(([date, dayItems]) => [
              // um cabeçalho por dia, como na tela de lançamentos; o total do dia só conta itens ativos
              <div
                key={`day-${date}`}
                className="flex items-center justify-between bg-muted/40 px-4 py-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase"
              >
                <h3>{formatDayLabel(date)}</h3>
                <span className="tabular-nums">
                  {formatBRL(
                    dayItems.reduce((sum, i) => sum + (i.status === 'ACTIVE' ? i.amountCents : 0), 0),
                  )}
                </span>
              </div>,
              ...dayItems.map((i) => {
                const inactive = i.status !== 'ACTIVE';
                const row = (
                  <>
                    {i.createdByName ? (
                      <UserBadge name={i.createdByName} color={i.createdByColor} />
                    ) : (
                      <span className="size-5" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className={cn('truncate font-medium', inactive && 'line-through opacity-60')}>
                        {i.description}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {i.categoryName && <span>{i.categoryName}</span>}
                        {ITEM_KIND_LABEL[i.kind] && (
                          <Badge variant="outline">{ITEM_KIND_LABEL[i.kind]}</Badge>
                        )}
                        {inactive && <Badge variant="secondary">{ITEM_STATUS_LABEL[i.status]}</Badge>}
                      </div>
                    </div>
                    <Amount
                      cents={Math.abs(i.amountCents)}
                      direction={i.amountCents < 0 ? 'in' : undefined}
                      className={cn('text-sm font-medium', inactive && 'line-through opacity-50')}
                    />
                  </>
                );
                return i.planId ? (
                  <Link
                    key={i.id}
                    href={`/cartoes/compras/${i.planId}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50"
                  >
                    {row}
                  </Link>
                ) : (
                  <div key={i.id} className="flex items-center gap-3 px-4 py-3">
                    {row}
                  </div>
                );
              }),
            ])
          )}
        </CardContent>
      </Card>

      {payments.length > 0 && (
        <Card className="gap-0 pb-0">
          <CardHeader className="pb-3">
            <CardTitle>Pagamentos</CardTitle>
          </CardHeader>
          <CardContent className="divide-y border-t px-0">
            {payments.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{formatDateBR(p.date!)}</div>
                  <div className="text-xs text-muted-foreground">
                    {PAYMENT_METHOD_LABEL[p.paymentMethod]} · por {p.createdByName}
                  </div>
                </div>
                <Amount cents={p.amountCents} className="font-medium" />
                <ActionButton
                  action={removePaymentAction}
                  fields={{ id: p.id }}
                  label="Desfazer"
                  confirm={{
                    title: 'Desfazer este pagamento?',
                    description: 'O valor volta para o saldo da conta e a fatura volta a ficar em aberto.',
                    confirmLabel: 'Desfazer pagamento',
                  }}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <details className="rounded-xl border bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          O banco mudou as datas desta fatura?
        </summary>
        <div className="px-4 pb-4">
          <InvoiceDatesForm
            invoiceId={invoiceId}
            closingDate={inv.closingDate}
            dueDate={inv.dueDate}
            closingEditable={closingEditable}
          />
        </div>
      </details>
    </div>
  );
}
