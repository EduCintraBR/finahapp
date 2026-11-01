import Link from 'next/link';
import { CreditCard, ShoppingBag } from 'lucide-react';
import { Amount } from '@/components/money/amount';
import { Badge } from '@/components/ui/badge';
import type { CardMonthView, CardSummary, InvoiceSummary } from '@/db/queries/cards';
import { INVOICE_STATE_LABEL } from '@/domain/card/invoices';
import { formatDateBR, formatMonthLabel } from '@/domain/dates';
import { formatBRL } from '@/domain/money';
import { cn } from '@/lib/utils';

export function InvoiceStateBadge({ state }: { state: InvoiceSummary['state'] }) {
  return (
    <Badge
      variant={state === 'OVERDUE' ? 'destructive' : state === 'PAID' ? 'secondary' : 'outline'}
      className={cn(state === 'CLOSED' && 'border-warning text-warning-text')}
    >
      {INVOICE_STATE_LABEL[state]}
    </Badge>
  );
}

/** Barra de limite: total / comprometido / disponível. No adicional sem limite, só o comprometido. */
export function LimitBar({ s }: { s: CardSummary }) {
  if (s.limitTotalCents === null || s.availableCents === null) {
    return (
      <div className="text-sm">
        <span className="text-muted-foreground">Comprometido </span>
        <Amount cents={s.committedCents} className="font-medium" />
        <span className="block text-xs text-muted-foreground">
          Limite compartilhado com {s.card.holderName ?? 'o titular'}
        </span>
      </div>
    );
  }
  const used = Math.max(0, Math.min(s.limitTotalCents, s.committedCents));
  const pct = s.limitTotalCents > 0 ? Math.round((used * 100) / s.limitTotalCents) : 0;
  const credit = s.availableCents > s.limitTotalCents;
  return (
    <div className="space-y-1">
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label="Limite usado"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div
          className={cn('h-full rounded-full', pct > 90 ? 'bg-expense' : 'bg-primary')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground">
        <span>
          Disponível <Amount cents={s.availableCents} className="font-medium text-foreground" />
          {credit && <span className="ml-1 text-income">(crédito na fatura)</span>}
        </span>
        <span>de {formatBRL(s.limitTotalCents)}</span>
      </div>
    </div>
  );
}

/**
 * Cartão no mês escolhido no seletor. No mês atual mostra a fatura aberta (a que está acumulando compras) e, se
 * houver, a do próprio mês logo abaixo; em outro mês mostra a fatura daquele mês, ou "sem fatura lançada" com
 * o valor zerado quando o cartão não tem fatura nele. O limite é sempre o de agora.
 */
export function CardSummaryCard({ s, href }: { s: CardMonthView; href: string }) {
  const open = s.currentInvoice;
  const store = s.card.kind === 'STORE_CREDIT';
  // crediário sem ciclo ativo (D73): a "fatura atual" é só a que uma compra de hoje abriria
  const idle = store && s.isCurrentMonth && !open.id;
  const shown = idle ? null : s.isCurrentMonth ? open : s.monthInvoice;
  const Icon = store ? ShoppingBag : CreditCard;
  const alsoThisMonth =
    s.isCurrentMonth && s.monthInvoice && s.monthInvoice.referenceMonth !== open.referenceMonth
      ? s.monthInvoice
      : null;
  const unpaid = s.isCurrentMonth ? s.unpaidClosed[0] : undefined;
  return (
    <Link
      href={href}
      className="block space-y-3 rounded-xl border bg-card p-4 shadow-xs transition-colors hover:bg-muted/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-medium">
            <Icon className="size-4 shrink-0 text-primary" aria-hidden />
            <span className="truncate">{s.card.name}</span>
          </div>
          {s.card.isAdditional && (
            <div className="text-xs text-muted-foreground">Adicional · titular {s.card.holderName}</div>
          )}
        </div>
        {shown ? <InvoiceStateBadge state={shown.state} /> : <Badge variant="outline">Sem fatura</Badge>}
      </div>

      {shown ? (
        <div>
          <div className="text-xs text-muted-foreground">
            Fatura de {formatMonthLabel(shown.referenceMonth)} · fecha{' '}
            {formatDateBR(shown.closingDate).slice(0, 5)} · vence {formatDateBR(shown.dueDate).slice(0, 5)}
          </div>
          <Amount cents={shown.totalCents} className="text-2xl font-semibold" />
          {shown.paidCents > 0 && (
            <div className="text-xs text-muted-foreground">
              Pago {formatBRL(shown.paidCents)} · falta {formatBRL(shown.remainingCents)}
            </div>
          )}
        </div>
      ) : idle ? (
        <div>
          <div className="text-xs text-muted-foreground">Nenhuma fatura em aberto</div>
          <Amount cents={0} className="text-2xl font-semibold text-muted-foreground" />
          <div className="text-xs text-muted-foreground">
            Comprando hoje, a fatura vence em {formatDateBR(open.dueDate)}.
          </div>
        </div>
      ) : (
        <div>
          <div className="text-xs text-muted-foreground">Fatura de {formatMonthLabel(s.viewMonth)}</div>
          <Amount cents={0} className="text-2xl font-semibold text-muted-foreground" />
          <div className="text-xs text-muted-foreground">
            Nenhuma fatura lançada para {formatMonthLabel(s.viewMonth)} neste cartão.
          </div>
        </div>
      )}

      {alsoThisMonth && (
        <div className="flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-xs">
          <span>Fatura de {formatMonthLabel(alsoThisMonth.referenceMonth)}</span>
          <span className="flex items-center gap-2">
            <span className="font-semibold">{formatBRL(alsoThisMonth.totalCents)}</span>
            <InvoiceStateBadge state={alsoThisMonth.state} />
          </span>
        </div>
      )}

      {unpaid && (
        <div className="rounded-md bg-warning/10 px-3 py-2 text-xs">
          Fatura de {formatMonthLabel(unpaid.referenceMonth)}{' '}
          {unpaid.state === 'OVERDUE' ? 'atrasada' : 'fechada'}: falta pagar{' '}
          <span className="font-semibold">{formatBRL(unpaid.remainingCents)}</span>
        </div>
      )}

      <LimitBar s={s} />

      {s.activeInstallmentPlans > 0 && (
        <div className="text-xs text-muted-foreground">
          {s.activeInstallmentPlans} parcelamento{s.activeInstallmentPlans > 1 ? 's' : ''} ativo
          {s.activeInstallmentPlans > 1 ? 's' : ''}
          {s.lastInstallmentMonth && <> · última parcela em {formatMonthLabel(s.lastInstallmentMonth)}</>}
        </div>
      )}
    </Link>
  );
}
