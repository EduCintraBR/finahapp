import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { AnticipationForm, PurchaseEditForm, RefundForm } from '@/components/cards/plan-forms';
import { ActionButton } from '@/components/forms/action-button';
import { Amount } from '@/components/money/amount';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { getPlanDetail } from '@/db/queries/cards';
import { listCategories, listUsers } from '@/db/queries/lookups';
import { INVOICE_STATE_LABEL } from '@/domain/card/invoices';
import { compareDates, formatDateBR, formatMonthLabel, today } from '@/domain/dates';
import { formatBRL } from '@/domain/money';
import { cn } from '@/lib/utils';
import { deletePurchaseAction } from '../../actions';

export const metadata: Metadata = { title: 'Compra no cartão' };

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

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={`/cartoes/${card.id}`}>
          <ArrowLeft aria-hidden /> {card.name}
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={active ? 'secondary' : 'outline'}>{PLAN_STATUS[plan.status]}</Badge>
            {purchase.source === 'ONBOARDING' && (
              <Badge variant="outline">em andamento (cadastro inicial)</Badge>
            )}
            {purchase.source === 'RECURRING' && <Badge variant="outline">assinatura</Badge>}
            {purchase.source === 'BOT' && <Badge variant="outline">pelo Telegram</Badge>}
          </div>
          <CardTitle className="text-xl">{purchase.description}</CardTitle>
          <Amount cents={plan.totalAmountCents} className="text-3xl font-semibold" />
          <CardDescription>
            {plan.installmentCount === 1 ? 'À vista' : `${plan.installmentCount}x`} · comprado em{' '}
            {formatDateBR(plan.purchaseDate)} · {d.categoryName} · por {d.createdByName}
          </CardDescription>
        </CardHeader>
      </Card>

      <Card className="gap-0 pb-0">
        <CardHeader className="pb-3">
          <CardTitle>{plan.installmentCount === 1 ? 'Fatura' : 'Parcelas'}</CardTitle>
        </CardHeader>
        <CardContent className="divide-y border-t px-0">
          {[...installments, ...others].map((i) => (
            <Link
              key={i.id}
              href={`/cartoes/faturas/${i.invoiceId}`}
              className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50"
            >
              <div className="min-w-0 flex-1">
                <div className={cn('font-medium', i.status !== 'ACTIVE' && 'line-through opacity-60')}>
                  {i.kind === 'INSTALLMENT'
                    ? `${i.installmentNumber}/${plan.installmentCount}`
                    : i.description}
                </div>
                <div className="text-xs text-muted-foreground first-letter:uppercase">
                  fatura de {formatMonthLabel(i.referenceMonth)}
                  {ITEM_STATUS[i.status] && ` · ${ITEM_STATUS[i.status]}`}
                </div>
              </div>
              <Amount
                cents={Math.abs(i.amountCents)}
                direction={i.amountCents < 0 ? 'in' : undefined}
                className={cn('font-medium', i.status !== 'ACTIVE' && 'line-through opacity-50')}
              />
            </Link>
          ))}
        </CardContent>
      </Card>

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
                {formatDateBR(r.refundDate)} · {r.mode === 'CANCEL_PURCHASE' ? 'compra cancelada' : 'estorno'}{' '}
                de {formatBRL(r.amountCents)}
                {r.reason && ` · ${r.reason}`}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {active && plan.installmentCount > 1 && (
        <details className="rounded-xl border bg-card">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Antecipar parcelas</summary>
          <div className="px-4 pb-4">
            <AnticipationForm
              planId={planId}
              count={plan.installmentCount}
              options={anticipatable}
              invoices={invoiceOptions}
              today={hoje}
            />
          </div>
        </details>
      )}

      {plan.status !== 'CANCELLED' && (
        <details className="rounded-xl border bg-card">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Estorno / devolução</summary>
          <div className="px-4 pb-4">
            <RefundForm planId={planId} invoices={invoiceOptions} today={hoje} />
          </div>
        </details>
      )}

      <details className="rounded-xl border bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Editar</summary>
        <div className="space-y-4 px-4 pb-4">
          <PurchaseEditForm
            planId={planId}
            categories={categories}
            users={users}
            defaults={{
              description: purchase.description,
              categoryId: purchase.categoryId ?? '',
              beneficiaryUserId: purchase.beneficiaryUserId,
              notes: purchase.notes,
            }}
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
      </details>
    </div>
  );
}
