import Link from 'next/link';
import { Repeat } from 'lucide-react';
import { Amount, directionOf } from '@/components/money/amount';
import { Badge } from '@/components/ui/badge';
import type { EntryRow } from '@/db/queries/entries';
import { dueHighlight, DUE_HIGHLIGHT_LABEL, isScheduled } from '@/domain/account/rules';
import { formatDayLabel, type ISODate } from '@/domain/dates';
import { KIND_LABEL, PAYMENT_METHOD_LABEL } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { UserBadge } from './user-badge';

export function HighlightBadge({ dueDate, today }: { dueDate: ISODate | null; today: ISODate }) {
  if (!dueDate) return null;
  const h = dueHighlight(dueDate, today);
  if (!h) return null;
  return (
    <Badge
      variant={h === 'OVERDUE' ? 'destructive' : 'secondary'}
      className={cn(h === 'TODAY' && 'bg-warning text-warning-foreground')}
    >
      {DUE_HIGHLIGHT_LABEL[h]}
    </Badge>
  );
}

export function EntryRowItem({ e, today, href }: { e: EntryRow; today: ISODate; href: string }) {
  const pending = e.status === 'PENDING';
  return (
    <Link href={href} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50">
      <UserBadge name={e.createdByName} color={e.createdByColor} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{e.description}</span>
          {e.recurringTemplateId && (
            <Repeat className="size-3.5 shrink-0 text-muted-foreground" aria-label="Fixo" />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          <span>{e.categoryName ?? KIND_LABEL[e.kind]}</span>
          <span aria-hidden>·</span>
          <span>{PAYMENT_METHOD_LABEL[e.paymentMethod]}</span>
          {e.beneficiaryName && (
            <>
              <span aria-hidden>·</span>
              <span>de {e.beneficiaryName}</span>
            </>
          )}
          {pending && <Badge variant="outline">Pendente</Badge>}
          {isScheduled(e, today) && (
            <Badge variant="outline" className="border-warning text-warning-text">
              Agendado
            </Badge>
          )}
          {e.status === 'CANCELLED' && <Badge variant="outline">Cancelado</Badge>}
          {pending && <HighlightBadge dueDate={e.dueDate} today={today} />}
        </div>
      </div>
      <Amount
        cents={e.amountCents}
        direction={directionOf(e.kind)}
        className={cn(
          'text-sm font-medium',
          pending && 'opacity-60',
          e.status === 'CANCELLED' && 'line-through opacity-50',
        )}
      />
    </Link>
  );
}

/** Extrato agrupado por dia. */
export function EntryList({
  entries,
  today,
  returnTo,
}: {
  entries: EntryRow[];
  today: ISODate;
  returnTo: string;
}) {
  if (entries.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Nenhum lançamento neste mês.</p>;
  }
  const groups = new Map<string, EntryRow[]>();
  for (const e of entries) groups.set(e.date, [...(groups.get(e.date) ?? []), e]);
  const qs = `?voltar=${encodeURIComponent(returnTo)}`;
  return (
    <div className="space-y-4">
      {[...groups].map(([date, items]) => (
        <section key={date} aria-label={formatDayLabel(date)}>
          <h3 className="mb-1 px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {formatDayLabel(date)}
          </h3>
          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            {items.map((e) => (
              <EntryRowItem key={e.id} e={e} today={today} href={`/lancamentos/${e.id}${qs}`} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
