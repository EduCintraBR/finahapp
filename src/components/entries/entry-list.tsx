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

/** Colunas da tabela de lançamentos no desktop (a mesma grade no cabeçalho e nas linhas). */
const TABLE_COLS =
  'lg:grid lg:grid-cols-[2.25rem_minmax(0,1fr)_8.5rem_7.5rem_6rem_9.5rem_7rem] lg:items-center lg:gap-x-4';

/** Cabeçalho da tabela de lançamentos (só no desktop). */
function TableHeader() {
  return (
    <div
      aria-hidden
      className={cn(
        'hidden px-4 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase',
        TABLE_COLS,
      )}
    >
      <span />
      <span>Descrição</span>
      <span>Categoria</span>
      <span>Meio</span>
      <span>De quem</span>
      <span>Situação</span>
      <span className="text-right">Valor</span>
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
  table = false,
}: {
  e: EntryRow;
  today: ISODate;
  href: string;
  viewerId?: string;
  /** fora da lista agrupada por dia (ex.: histórico do fixo), a data vai na linha */
  showDate?: boolean;
  /** no desktop, vira linha de tabela (categoria, meio, de quem e situação em colunas) */
  table?: boolean;
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
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50',
        table && TABLE_COLS,
      )}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
        <CategoryIcon name={e.categoryIcon} className="size-4" />
      </span>
      {/* na tabela, os filhos deste bloco viram células da grade (lg:contents): a situação vai para a coluna dela */}
      <div className={cn('min-w-0 flex-1 space-y-0.5', table && 'lg:contents')}>
        <div className={cn('flex items-center gap-1.5', table && 'lg:col-start-2 lg:min-w-0')}>
          <span className="truncate font-medium">{e.description}</span>
          {e.recurringTemplateId && (
            <Repeat className="size-3.5 shrink-0 text-muted-foreground" aria-label="Fixo" />
          )}
        </div>
        <div className={cn('text-xs text-muted-foreground', table && 'lg:hidden')}>{details.join(' · ')}</div>
        {table && (
          <>
            <span className="hidden truncate text-sm lg:col-start-3 lg:block">
              {e.categoryName ?? KIND_LABEL[e.kind]}
            </span>
            <span className="hidden truncate text-sm text-muted-foreground lg:col-start-4 lg:block">
              {PAYMENT_METHOD_LABEL[e.paymentMethod]}
            </span>
            <span className="hidden truncate text-sm text-muted-foreground lg:col-start-5 lg:block">
              {e.beneficiaryName ?? 'Casal'}
              {viewerId && e.createdById !== viewerId && (
                <span className="block text-xs">por {e.createdByName}</span>
              )}
            </span>
          </>
        )}
        <div className={cn(table && 'lg:col-start-6')}>
          <StatusLine e={e} today={today} />
        </div>
      </div>
      <Amount
        cents={e.amountCents}
        direction={directionOf(e.kind)}
        className={cn(
          'shrink-0 text-sm font-medium whitespace-nowrap',
          table && 'lg:col-start-7 lg:text-right',
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
  table = false,
}: {
  entries: EntryRow[];
  today: ISODate;
  returnTo: string;
  month?: ISODate;
  viewerId?: string;
  /** no desktop, mostra como tabela (tela de Lançamentos) */
  table?: boolean;
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
    <EntryRowItem
      key={e.id}
      e={e}
      today={today}
      href={`/lancamentos/${e.id}${qs}`}
      viewerId={viewerId}
      table={table}
    />
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
      {table && <TableHeader />}
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
