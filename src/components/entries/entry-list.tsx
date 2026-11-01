import Link from 'next/link';
import { Repeat } from 'lucide-react';
import { CategoryIcon } from '@/components/categories/category-icon';
import { Amount, directionOf } from '@/components/money/amount';
import { Badge } from '@/components/ui/badge';
import type { EntryRow } from '@/db/queries/entries';
import { dueHighlight, DUE_HIGHLIGHT_LABEL, isScheduled } from '@/domain/account/rules';
import { compareDates, formatDateBR, formatDayLabel, type ISODate } from '@/domain/dates';
import { KIND_LABEL, PAYMENT_METHOD_LABEL } from '@/lib/labels';
import { cn } from '@/lib/utils';

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

/** Vencimento em texto, colorido só quando pede atenção ("Venceu" vale para conta e para receita). */
export function DueText({ dueDate, today }: { dueDate: ISODate; today: ISODate }) {
  const h = dueHighlight(dueDate, today);
  const day = formatDateBR(dueDate).slice(0, 5);
  return (
    <span
      className={cn(
        'whitespace-nowrap',
        h === 'OVERDUE'
          ? 'font-medium text-expense'
          : h
            ? 'font-medium text-warning-text'
            : 'text-muted-foreground',
      )}
    >
      {h === 'OVERDUE' ? `Venceu ${day}` : h === 'TODAY' ? 'Vence hoje' : `Vence ${day}`}
    </span>
  );
}

/** Situação só quando foge do normal: pago na data é o caso comum e não ganha selo. */
function StatusLine({ e, today }: { e: EntryRow; today: ISODate }) {
  const scheduled = isScheduled(e, today);
  const parts: React.ReactNode[] = [];
  if (e.status === 'PENDING') {
    parts.push(
      <span key="s" className="font-medium text-warning-text">
        Pendente
      </span>,
    );
    if (e.dueDate) parts.push(<DueText key="d" dueDate={e.dueDate} today={today} />);
  }
  if (scheduled)
    parts.push(
      <span key="s" className="font-medium text-warning-text">
        Agendado para {formatDateBR(e.postedDate!).slice(0, 5)}
      </span>,
    );
  if (e.status === 'CANCELLED') parts.push(<span key="s">Cancelado</span>);
  if (e.status === 'ANTICIPATED') parts.push(<span key="s">Pago antes · fora das somas</span>);
  if (e.anticipatesId && !scheduled)
    parts.push(
      <span key="a" className="text-income">
        Antecipado
      </span>,
    );
  if (parts.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
      {parts.flatMap((p, i) =>
        i === 0
          ? [p]
          : [
              <span key={`sep${i}`} aria-hidden>
                ·
              </span>,
              p,
            ],
      )}
    </div>
  );
}

/**
 * Linha de lançamento (ListRow): ícone da categoria, descrição, categoria · meio · de quem e, só quando não foi você,
 * quem lançou; o valor à direita. Nada é cortado além da descrição (que tem a tela inteira para ela).
 */
export function EntryRowItem({
  e,
  today,
  href,
  viewerId,
  showDate = false,
}: {
  e: EntryRow;
  today: ISODate;
  href: string;
  viewerId?: string;
  /** fora da lista agrupada por dia (ex.: histórico do fixo), a data vai na linha */
  showDate?: boolean;
}) {
  const pending = e.status === 'PENDING';
  const details = [
    showDate && formatDateBR(e.date),
    e.categoryName ?? KIND_LABEL[e.kind],
    PAYMENT_METHOD_LABEL[e.paymentMethod],
    e.beneficiaryName && `de ${e.beneficiaryName}`,
    viewerId && e.createdById !== viewerId && `lançado por ${e.createdByName}`,
  ].filter(Boolean);
  return (
    <Link href={href} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
        <CategoryIcon name={e.categoryIcon} className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{e.description}</span>
          {e.recurringTemplateId && (
            <Repeat className="size-3.5 shrink-0 text-muted-foreground" aria-label="Fixo" />
          )}
        </div>
        <div className="text-xs text-muted-foreground">{details.join(' · ')}</div>
        <StatusLine e={e} today={today} />
      </div>
      <Amount
        cents={e.amountCents}
        direction={directionOf(e.kind)}
        className={cn(
          'shrink-0 text-sm font-medium whitespace-nowrap',
          pending && 'opacity-60',
          e.status === 'CANCELLED' && 'line-through opacity-50',
          e.status === 'ANTICIPATED' && 'line-through opacity-50', // não soma: o dinheiro está no pagamento ligado
        )}
      />
    </Link>
  );
}

const CARRIED = 'carried';

/**
 * Extrato agrupado por dia. Com `month`, os pendentes com data antes dele (atrasados que acompanham o mês, D72)
 * vêm primeiro, num grupo só.
 */
export function EntryList({
  entries,
  today,
  returnTo,
  month,
  viewerId,
  flat = false,
}: {
  entries: EntryRow[];
  today: ISODate;
  returnTo: string;
  month?: ISODate;
  viewerId?: string;
  /** dentro de um painel (Home): uma lista só, com o dia como subtítulo, sem caixas por dia */
  flat?: boolean;
}) {
  if (entries.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Nenhum lançamento neste mês.</p>;
  }
  const groups = new Map<string, EntryRow[]>();
  const carried = month ? entries.filter((e) => compareDates(e.date, month) < 0) : [];
  if (carried.length > 0)
    groups.set(
      CARRIED,
      [...carried].sort((a, b) => compareDates(a.date, b.date)),
    );
  for (const e of entries) {
    if (month && compareDates(e.date, month) < 0) continue;
    groups.set(e.date, [...(groups.get(e.date) ?? []), e]);
  }
  const label = (key: string) => (key === CARRIED ? 'De meses anteriores · sem baixa' : formatDayLabel(key));
  const qs = `?voltar=${encodeURIComponent(returnTo)}`;
  const row = (e: EntryRow) => (
    <EntryRowItem key={e.id} e={e} today={today} href={`/lancamentos/${e.id}${qs}`} viewerId={viewerId} />
  );
  if (flat) {
    return (
      <div>
        {[...groups].map(([key, items]) => (
          <section key={key} aria-label={label(key)}>
            <h3 className="border-y bg-muted/30 px-5 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {label(key)}
            </h3>
            <div className="divide-y [&>a]:px-5">{items.map(row)}</div>
          </section>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {[...groups].map(([key, items]) => (
        <section key={key} aria-label={label(key)}>
          {/* o dia fica preso no topo enquanto a lista dele rola (logo abaixo do cabeçalho do app) */}
          <h3
            className={cn(
              'sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-10 -mx-1 mb-1 bg-background/95 px-2 py-1.5 text-xs font-medium tracking-wide uppercase backdrop-blur',
              key === CARRIED ? 'text-expense' : 'text-muted-foreground',
            )}
          >
            {label(key)}
          </h3>
          <div className="divide-y overflow-hidden rounded-xl border bg-card">{items.map(row)}</div>
        </section>
      ))}
    </div>
  );
}
