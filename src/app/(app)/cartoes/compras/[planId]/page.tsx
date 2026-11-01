import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DetailColumns } from '@/components/layout/detail-columns';
import { AnticipationForm, PurchaseEditForm, RefundForm } from '@/components/cards/plan-forms';
import { ActionButton } from '@/components/forms/action-button';
import { PageHeader } from '@/components/layout/page-header';
import { Amount } from '@/components/money/amount';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SheetAction } from '@/components/ui/sheet-action';
import { getDb } from '@/db/client';
import { getPlanDetail } from '@/db/queries/cards';
import { listCategories, listUsers } from '@/db/queries/lookups';
import { INVOICE_STATE_LABEL } from '@/domain/card/invoices';
import { formatPercent } from '@/domain/card/store-credit';
import { compareDates, formatDateBR, formatMonthLabel, today } from '@/domain/dates';
import { formatBRL } from '@/domain/money';
import { cn } from '@/lib/utils';
import { deletePurchaseAction } from '../../actions';

export const metadata: Metadata = { title: 'Compra' };

const PLAN_STATUS: Record<string, string> = {
  ACTIVE: 'Ativa',
  FINISHED: 'Quitada',
  CANCELLED: 'Cancelada',
  FULLY_ANTICIPATED: 'Antecipada',
};
const ITEM_STATUS: Record<string, string> = { ANTICIPATED: 'antecipada', CANCELLED: 'cancelada' };

export default async function PlanPage({ params }: PageProps<'/cartoes/compras/[planId]'>) {
  const { planId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(planId)) notFound();
  const db = getDb();
  const hoje = today();
  const [d, users] = await Promise.all([getPlanDetail(db, planId, hoje), listUsers(db)]);
  if (!d) notFound();
  const { plan, purchase, card } = d;
  const categories = await listCategories(db, { alsoIds: [purchase.categoryId] });
  const installments = d.items.filter((i) => i.kind === 'INSTALLMENT');
  const others = d.items.filter((i) => i.kind !== 'INSTALLMENT');
  const active = plan.status === 'ACTIVE';
  const invoiceOptions = d.invoices
    .filter((i) => i.id)
    .map((i) => ({
      id: i.id!,
      label: `${formatMonthLabel(i.referenceMonth)} (${INVOICE_STATE_LABEL[i.state].toLowerCase()})`,
      open: compareDates(hoje, i.closingDate) < 0,
    })); // em ordem: a 1ª aberta é a fatura atual (padrão do crédito/antecipação)
  const anticipatable = installments
    .filter((i) => i.status === 'ACTIVE' && !i.invoiceClosed)
    .map((i) => ({
      id: i.id,
      number: i.installmentNumber!,
      amountCents: i.amountCents,
      monthLabel: formatMonthLabel(i.referenceMonth),
    }));
  const deletable =
    d.anticipations.length === 0 &&
    d.refunds.length === 0 &&
    d.items.every((i) => i.kind === 'INSTALLMENT' && i.status === 'ACTIVE' && !i.invoiceClosed);

  // linha do tempo: a fatura de cada parcela já paga, fechada (a pagar), a atual (aberta) ou uma futura
  const stateOf = new Map(d.invoices.filter((i) => i.id).map((i) => [i.id!, i.state]));
  const currentInvoiceId = invoiceOptions.find((i) => i.open)?.id;
  const step = (i: (typeof d.items)[number]) => {
    if (i.status !== 'ACTIVE') return { tone: 'muted', label: ITEM_STATUS[i.status] ?? '' } as const;
    const st = stateOf.get(i.invoiceId);
    if (st === 'PAID') return { tone: 'done', label: 'paga' } as const;
    if (st === 'OVERDUE') return { tone: 'late', label: 'fatura atrasada' } as const;
    if (st === 'CLOSED') return { tone: 'due', label: 'fatura fechada, a pagar' } as const;
    if (i.invoiceId === currentInvoiceId) return { tone: 'now', label: 'fatura atual' } as const;
    return { tone: 'next', label: 'futura' } as const;
  };
  const DOT = {
    done: 'border-income bg-income',
    late: 'border-expense bg-expense',
    due: 'border-warning bg-warning',
    now: 'border-primary bg-background ring-4 ring-primary/20',
    next: 'border-muted-foreground/40 bg-background',
    muted: 'border-muted-foreground/30 bg-muted',
  } as const;
  const actionClass = 'h-auto min-h-10 px-2 py-2 text-xs leading-tight whitespace-normal';

  return (
    <div className="mx-auto max-w-2xl space-y-4 lg:max-w-5xl">
      <PageHeader title={purchase.description} back={{ href: `/cartoes/${card.id}`, label: card.name }} />

      <DetailColumns
        aside={
          <>
            <Card className="gap-3 py-4">
              <CardContent className="space-y-2 px-4 sm:px-6">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={active ? 'secondary' : 'outline'}>{PLAN_STATUS[plan.status]}</Badge>
                  {purchase.source === 'ONBOARDING' && (
                    <Badge variant="outline">em andamento (cadastro inicial)</Badge>
                  )}
                  {purchase.source === 'RECURRING' && <Badge variant="outline">assinatura</Badge>}
                  {purchase.source === 'BOT' && <Badge variant="outline">pelo bot</Badge>}
                </div>
                <Amount
                  cents={plan.totalAmountCents}
                  className="block text-3xl font-semibold tracking-tight"
                />
                <p className="text-sm text-muted-foreground">
                  {plan.installmentCount === 1 ? 'À vista' : `${plan.installmentCount}x`} · comprado em{' '}
                  {formatDateBR(plan.purchaseDate)} · {d.categoryName} · por {d.createdByName}
                </p>
                {d.interest && plan.originalAmountCents !== null && (
                  <dl
                    data-testid="purchase-interest"
                    className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t pt-2 text-sm"
                  >
                    <dt className="text-muted-foreground">Valor da compra</dt>
                    <dd className="text-right tabular-nums">{formatBRL(plan.originalAmountCents)}</dd>
                    <dt className="text-muted-foreground">Acréscimo (juros)</dt>
                    <dd className="text-right tabular-nums">
                      {formatBRL(d.interest.extraCents)} · {formatPercent(d.interest.percent)}
                    </dd>
                    {d.interest.monthlyRate !== null && (
                      <>
                        <dt className="text-muted-foreground">Taxa equivalente</dt>
                        <dd className="text-right tabular-nums">
                          ~{formatPercent(d.interest.monthlyRate)} ao mês
                        </dd>
                      </>
                    )}
                  </dl>
                )}
              </CardContent>
            </Card>

            {/* ações em botões que abrem painel (antes eram blocos <details>) */}
            <div className="grid grid-cols-3 gap-2">
              {active && plan.installmentCount > 1 && (
                <SheetAction label="Antecipar parcelas" className={actionClass}>
                  <AnticipationForm
                    planId={planId}
                    count={plan.installmentCount}
                    options={anticipatable}
                    invoices={invoiceOptions}
                    today={hoje}
                  />
                </SheetAction>
              )}
              {plan.status !== 'CANCELLED' && (
                <SheetAction label="Estorno / devolução" className={actionClass}>
                  <RefundForm planId={planId} invoices={invoiceOptions} today={hoje} />
                </SheetAction>
              )}
              <SheetAction label="Editar" title="Editar compra" className={actionClass}>
                <div className="space-y-4">
                  <PurchaseEditForm
                    planId={planId}
                    categories={categories}
                    users={users}
                    defaults={{
                      description: purchase.description,
                      categoryId: purchase.categoryId ?? '',
                      beneficiaryUserId: purchase.beneficiaryUserId,
                      notes: purchase.notes,
                      amountCents: plan.totalAmountCents,
                      ...(card.kind === 'STORE_CREDIT' ? { originalCents: plan.originalAmountCents } : {}),
                    }}
                    amountEditable={deletable}
                  />
                  {deletable ? (
                    <ActionButton
                      action={deletePurchaseAction}
                      fields={{ id: planId, cardId: card.id }}
                      variant="destructive"
                      label="Excluir compra"
                      confirm={{
                        title: 'Excluir esta compra?',
                        description:
                          'Todas as parcelas saem das faturas e o limite é liberado. Fica registrado no histórico.',
                        confirmLabel: 'Excluir',
                      }}
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Valor e parcelas não mudam depois de cobrados: para desfazer, use Estorno.
                    </p>
                  )}
                </div>
              </SheetAction>
            </div>

            {(d.anticipations.length > 0 || d.refunds.length > 0) && (
              <Card>
                <CardHeader>
                  <CardTitle>Histórico</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  {d.anticipations.map((a) => (
                    <p key={a.id}>
                      {formatDateBR(a.anticipationDate)} · antecipou {a.installmentsCount} parcela(s): bruto{' '}
                      {formatBRL(a.grossAmountCents)}, pago {formatBRL(a.paidAmountCents)} (
                      {a.settlement === 'ON_INVOICE' ? 'na fatura' : 'avulso'}) · economia{' '}
                      <span className="text-income">{formatBRL(a.discountCents)}</span>
                    </p>
                  ))}
                  {d.refunds.map((r) => (
                    <p key={r.id}>
                      {formatDateBR(r.refundDate)} ·{' '}
                      {r.mode === 'CANCEL_PURCHASE' ? 'compra cancelada' : 'estorno'} de{' '}
                      {formatBRL(r.amountCents)}
                      {r.reason && ` · ${r.reason}`}
                    </p>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        }
      >
        <Card className="gap-0 pb-0">
          <CardHeader className="pb-3">
            <CardTitle>{plan.installmentCount === 1 ? 'Fatura' : 'Parcelas'}</CardTitle>
          </CardHeader>
          <CardContent className="border-t px-0">
            <ol aria-label={plan.installmentCount === 1 ? 'Fatura' : 'Parcelas'}>
              {[...installments, ...others].map((i, idx, all) => {
                const st = step(i);
                return (
                  <li key={i.id} className="relative">
                    {/* trilho da linha do tempo */}
                    {idx < all.length - 1 && (
                      <span aria-hidden className="absolute top-8 bottom-0 left-[1.35rem] w-px bg-border" />
                    )}
                    <Link
                      href={`/cartoes/faturas/${i.invoiceId}`}
                      className="relative flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50"
                    >
                      <span
                        aria-hidden
                        className={cn('size-3 shrink-0 rounded-full border-2', DOT[st.tone])}
                      />
                      <div className="min-w-0 flex-1">
                        <div
                          className={cn('font-medium', i.status !== 'ACTIVE' && 'line-through opacity-60')}
                        >
                          {i.kind === 'INSTALLMENT'
                            ? `${i.installmentNumber}/${plan.installmentCount}`
                            : i.description}
                        </div>
                        <div className="text-xs text-muted-foreground first-letter:uppercase">
                          fatura de {formatMonthLabel(i.referenceMonth)}
                          {st.label && (
                            <span
                              className={cn(
                                st.tone === 'now' && 'font-medium text-primary',
                                st.tone === 'late' && 'font-medium text-expense',
                              )}
                            >
                              {' '}
                              · {st.label}
                            </span>
                          )}
                        </div>
                      </div>
                      <Amount
                        cents={Math.abs(i.amountCents)}
                        direction={i.amountCents < 0 ? 'in' : undefined}
                        className={cn('font-medium', i.status !== 'ACTIVE' && 'line-through opacity-50')}
                      />
                    </Link>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      </DetailColumns>
    </div>
  );
}
