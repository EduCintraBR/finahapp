import Link from 'next/link';
import { CreditCard, Landmark, ShoppingBag, Utensils } from 'lucide-react';
import { InvoiceStateBadge, LimitBar } from '@/components/cards/card-summary';
import { Amount } from '@/components/money/amount';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { BenefitCardView } from '@/db/queries/benefits';
import type { CardMonthView } from '@/db/queries/cards';
import type { LoanView } from '@/db/queries/loans';
import { INVOICE_STATE_LABEL } from '@/domain/card/invoices';
import { formatDateBR, formatMonthShort } from '@/domain/dates';
import { formatBRL } from '@/domain/money';
import { cn } from '@/lib/utils';

/**
 * Painel da Home: título, um atalho ("Ver todos") e o conteúdo logo abaixo, sem cards dentro de cards.
 * Com `region`, vira uma região nomeada (leitor de tela e testes acham pelo nome).
 */
export function Panel({
  title,
  description,
  action,
  region,
  className,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  action?: { href: string; label: string };
  region?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const card = (
    <Card className={cn('min-w-0 gap-0 overflow-hidden py-0', className)}>
      <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className="min-w-0">
          <h2 className="font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {action && (
          <Button asChild variant="ghost" size="sm" className="-mt-1 -mr-2 shrink-0 text-primary">
            <Link href={action.href}>{action.label}</Link>
          </Button>
        )}
      </div>
      {children}
    </Card>
  );
  return region ? <section aria-label={title}>{card}</section> : card;
}

const rowLink =
  'block px-5 py-3.5 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 outline-none';
const iconBox = 'grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary';

/**
 * Cartões da Início: no celular, uma faixa horizontal que rola de lado (um cartão por vez, sem empurrar o resto da
 * tela para baixo); no desktop, uma lista dentro do card da coluna lateral.
 */
export function CardStrip({
  title,
  action,
  children,
}: {
  title: string;
  action: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="min-w-0 lg:overflow-hidden lg:rounded-xl lg:border lg:bg-card lg:shadow-sm"
    >
      <div className="flex items-center justify-between gap-3 pb-2 lg:px-5 lg:pt-4 lg:pb-3">
        <h2 className="font-semibold">{title}</h2>
        <Button asChild variant="ghost" size="sm" className="-mr-2 shrink-0 text-primary">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      </div>
      <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 [scrollbar-width:none] gap-3 overflow-x-auto px-4 pb-1 lg:mx-0 lg:block lg:divide-y lg:overflow-visible lg:border-t lg:px-0 lg:pb-0">
        {children}
      </div>
    </section>
  );
}

/** Um cartão de crédito: a fatura do mês escolhido, o que falta pagar e o limite. O nome usa a linha toda. */
export function CardTile({ s, href }: { s: CardMonthView; href: string }) {
  const store = s.card.kind === 'STORE_CREDIT';
  // crediário sem ciclo ativo (D73): ainda não há fatura
  const idle = store && s.isCurrentMonth && !s.currentInvoice.id;
  const shown = idle ? null : s.isCurrentMonth ? s.currentInvoice : s.monthInvoice;
  const Icon = store ? ShoppingBag : CreditCard;
  const alsoThisMonth =
    s.isCurrentMonth && s.monthInvoice && s.monthInvoice.referenceMonth !== s.currentInvoice.referenceMonth
      ? s.monthInvoice
      : null;
  const unpaid = s.isCurrentMonth ? s.unpaidClosed[0] : undefined;
  return (
    <Link
      href={href}
      className="block w-[17.5rem] shrink-0 snap-start space-y-2.5 rounded-xl border bg-card p-4 shadow-sm transition-colors outline-none only:w-full hover:bg-muted/40 focus-visible:bg-muted/40 lg:w-auto lg:rounded-none lg:border-0 lg:px-5 lg:py-3.5 lg:shadow-none"
    >
      <div className="flex items-start gap-3">
        <span className={iconBox}>
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium break-words">
            {s.card.name}
            {s.card.isAdditional && <span className="font-normal text-muted-foreground"> · adicional</span>}
            {store && <span className="font-normal text-muted-foreground"> · crediário</span>}
          </div>
          <div className="text-xs text-muted-foreground">
            {shown
              ? `Fatura ${formatMonthShort(shown.referenceMonth)} · vence ${formatDateBR(shown.dueDate).slice(0, 5)}`
              : idle
                ? 'Nenhuma fatura em aberto'
                : `Nada em ${formatMonthShort(s.viewMonth)}`}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Amount
          cents={shown?.totalCents ?? 0}
          className={cn('text-xl font-semibold whitespace-nowrap', !shown && 'text-muted-foreground')}
        />
        {shown ? <InvoiceStateBadge state={shown.state} /> : <Badge variant="outline">Sem fatura</Badge>}
      </div>
      {unpaid && (
        <div className="rounded-md bg-warning/10 px-3 py-1.5 text-xs">
          Fatura {formatMonthShort(unpaid.referenceMonth)}{' '}
          {unpaid.state === 'OVERDUE' ? 'atrasada' : 'fechada'}: falta pagar{' '}
          <span className="font-semibold">{formatBRL(unpaid.remainingCents)}</span>
        </div>
      )}
      {alsoThisMonth && (
        <div className="text-xs text-muted-foreground">
          Fatura {formatMonthShort(alsoThisMonth.referenceMonth)}: {formatBRL(alsoThisMonth.totalCents)} ·{' '}
          {INVOICE_STATE_LABEL[alsoThisMonth.state].toLowerCase()}
        </div>
      )}
      <LimitBar s={s} />
    </Link>
  );
}

/** Cartão de benefícios numa linha: saldo total e o de cada carteira. */
export function BenefitRow({ c, href }: { c: BenefitCardView; href: string }) {
  return (
    <Link href={href} className={cn(rowLink, c.ended && 'opacity-70')}>
      <div className="flex items-center gap-3">
        <span className={iconBox}>
          <Utensils className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium break-words">{c.name}</div>
          <div className="text-xs text-muted-foreground">
            {c.wallets.map((w) => `${w.name} ${formatBRL(w.balanceCents)}`).join(' · ') || c.issuer}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Amount cents={c.totalBalanceCents} className="font-semibold" />
          <span className="text-xs text-muted-foreground">
            {c.ended
              ? 'Encerrado'
              : c.endMonth
                ? `Encerra em ${formatMonthShort(c.endMonth)}`
                : c.nextCreditDate
                  ? `Crédito ${formatDateBR(c.nextCreditDate).slice(0, 5)}`
                  : 'Ativo'}
          </span>
        </div>
      </div>
    </Link>
  );
}

/** Empréstimo numa linha: o que falta pagar e o avanço das parcelas. */
export function LoanRow({ l, href }: { l: LoanView; href: string }) {
  const s = l.summary;
  const pct = l.installmentCount > 0 ? Math.round((s.paidCount * 100) / l.installmentCount) : 0;
  return (
    <Link href={href} className={cn(rowLink, 'space-y-2.5')}>
      <div className="flex items-center gap-3">
        <span className={iconBox}>
          <Landmark className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium break-words">{l.name}</div>
          <div className="text-xs text-muted-foreground">
            {s.paidCount} de {l.installmentCount} parcelas pagas
            {s.nextDueDate ? ` · próxima ${formatDateBR(s.nextDueDate).slice(0, 5)}` : ''}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Amount cents={s.remainingCents} className="font-semibold" />
          {s.overdueCount > 0 ? (
            <Badge variant="destructive">
              {s.overdueCount} atrasada{s.overdueCount > 1 ? 's' : ''}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">falta pagar</span>
          )}
        </div>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label="Parcelas pagas"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </Link>
  );
}
