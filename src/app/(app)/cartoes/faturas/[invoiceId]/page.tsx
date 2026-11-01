import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { DetailColumns } from '@/components/layout/detail-columns';
import { InvoiceStateBadge } from '@/components/cards/card-summary';
import { InvoiceDatesForm, PayInvoiceDialog } from '@/components/cards/invoice-forms';
import { CategoryIcon } from '@/components/categories/category-icon';
import { ActionButton } from '@/components/forms/action-button';
import { PageHeader } from '@/components/layout/page-header';
import { Amount } from '@/components/money/amount';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SheetAction } from '@/components/ui/sheet-action';
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
  const [d, session] = await Promise.all([getInvoiceDetail(getDb(), invoiceId, hoje), auth()]);
  if (!d) notFound();
  const { card, summary: inv, items, payments } = d;
  const viewerId = session?.user?.id;
  const label = `${card.name} · ${formatMonthLabel(inv.referenceMonth)}`;
  // do dia mais novo para o mais antigo, como a tela de lançamentos
  const byDay = new Map<string, typeof items>();
  for (const i of items) byDay.set(i.postingDate, [...(byDay.get(i.postingDate) ?? []), i]);
  const groups = [...byDay].sort(([a], [b]) => compareDates(b, a));
  const closingEditable = compareDates(hoje, inv.closingDate) < 0;

  return (
    <div className="mx-auto max-w-2xl space-y-4 lg:max-w-5xl">
      <PageHeader
        title={
          <span className="first-letter:uppercase">Fatura de {formatMonthLabel(inv.referenceMonth)}</span>
        }
        back={{ href: `/cartoes/${card.id}`, label: card.name }}
      />

      <DetailColumns
        aside={
          <>
            <Card className="gap-0 py-0">
              <CardContent className="space-y-1 px-4 pt-4 pb-3 sm:px-6">
                <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                  <span>
                    fecha {formatDateBR(inv.closingDate)} · vence {formatDateBR(inv.dueDate)}
                  </span>
                  <InvoiceStateBadge state={inv.state} />
                </div>
                <Amount cents={inv.totalCents} className="block text-3xl font-semibold tracking-tight" />
                {inv.totalCents < 0 && (
                  <p className="text-sm text-muted-foreground">Fatura credora: nada a pagar.</p>
                )}
              </CardContent>
              {/* total, pago e quanto falta lado a lado */}
              <div className="grid grid-cols-2 gap-4 border-t px-4 py-3 text-sm sm:px-6">
                <div>
                  <div className="text-xs text-muted-foreground">Pago</div>
                  <Amount cents={inv.paidCents} className="font-semibold" data-testid="invoice-paid" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">
                    {inv.paidCents > inv.totalCents && inv.totalCents >= 0 ? 'Pago a mais' : 'Falta pagar'}
                  </div>
                  <Amount
                    cents={
                      inv.paidCents > inv.totalCents && inv.totalCents >= 0
                        ? inv.paidCents - inv.totalCents
                        : inv.remainingCents
                    }
                    className={cn(
                      'font-semibold',
                      inv.remainingCents > 0 && inv.state === 'OVERDUE' && 'text-expense',
                    )}
                    data-testid="invoice-remaining"
                  />
                </div>
              </div>
              {inv.remainingCents > 0 && (
                <div className="border-t px-4 py-3 sm:px-6">
                  <PayInvoiceDialog
                    invoiceId={invoiceId}
                    label={label}
                    amountText={formatDecimalBR(inv.remainingCents)}
                    today={hoje}
                    additionalHolder={card.isAdditional ? card.holderName : null}
                  />
                </div>
              )}
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
                          description:
                            'O valor volta para o saldo da conta e a fatura volta a ficar em aberto.',
                          confirmLabel: 'Desfazer pagamento',
                        }}
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            <SheetAction
              label="O banco mudou as datas desta fatura?"
              title="Datas da fatura"
              description="Mudar o fechamento realoca as compras afetadas."
              variant="ghost"
              className="text-muted-foreground"
            >
              <InvoiceDatesForm
                invoiceId={invoiceId}
                closingDate={inv.closingDate}
                dueDate={inv.dueDate}
                closingEditable={closingEditable}
              />
            </SheetAction>
          </>
        }
      >
        <Card className="gap-0 pb-0">
          <CardHeader className="pb-3">
            <CardTitle>Itens</CardTitle>
          </CardHeader>
          <CardContent className="border-t px-0">
            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhum item nesta fatura.</p>
            ) : (
              groups.map(([date, dayItems]) => {
                const active = dayItems.filter((i) => i.status === 'ACTIVE');
                return (
                  <section key={date} aria-label={formatDayLabel(date)}>
                    {/* o total do dia só quando há mais de um item (com um só, repetiria o valor da linha) */}
                    <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      <h3>{formatDayLabel(date)}</h3>
                      {dayItems.length > 1 && (
                        <span className="tabular-nums">
                          {formatBRL(active.reduce((sum, i) => sum + i.amountCents, 0))}
                        </span>
                      )}
                    </div>
                    <div className="divide-y border-b last:border-b-0">
                      {dayItems.map((i) => {
                        const inactive = i.status !== 'ACTIVE';
                        const parcel =
                          i.installmentNumber && i.installmentCount && i.installmentCount > 1
                            ? `${i.installmentNumber}/${i.installmentCount}`
                            : null;
                        const details = [
                          i.categoryName,
                          viewerId &&
                            i.createdById &&
                            i.createdById !== viewerId &&
                            `lançado por ${i.createdByName}`,
                        ].filter(Boolean);
                        const row = (
                          <>
                            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                              <CategoryIcon name={i.categoryIcon} className="size-4" />
                            </span>
                            <div className="min-w-0 flex-1 space-y-0.5">
                              <div className="flex items-center gap-2">
                                <span
                                  className={cn(
                                    'truncate font-medium',
                                    inactive && 'line-through opacity-60',
                                  )}
                                >
                                  {i.description}
                                </span>
                                {/* a parcela sempre à vista, mesmo com a descrição cortada */}
                                {parcel && (
                                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums">
                                    {parcel}
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                {details.length > 0 && <span>{details.join(' · ')}</span>}
                                {ITEM_KIND_LABEL[i.kind] && (
                                  <Badge variant="outline">{ITEM_KIND_LABEL[i.kind]}</Badge>
                                )}
                                {inactive && <Badge variant="secondary">{ITEM_STATUS_LABEL[i.status]}</Badge>}
                              </div>
                            </div>
                            <Amount
                              cents={Math.abs(i.amountCents)}
                              direction={i.amountCents < 0 ? 'in' : undefined}
                              className={cn(
                                'shrink-0 text-sm font-medium',
                                inactive && 'line-through opacity-50',
                              )}
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
                      })}
                    </div>
                  </section>
                );
              })
            )}
          </CardContent>
        </Card>
      </DetailColumns>
    </div>
  );
}
