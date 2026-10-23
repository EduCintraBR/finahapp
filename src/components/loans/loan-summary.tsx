import Link from 'next/link';
import { Landmark } from 'lucide-react';
import { Amount } from '@/components/money/amount';
import { Badge } from '@/components/ui/badge';
import type { LoanView } from '@/db/queries/loans';
import { formatDateBR } from '@/domain/dates';
import { cn } from '@/lib/utils';

/** Empréstimo: o que falta pagar, quantas parcelas já foram e quando vence a próxima. */
export function LoanSummaryCard({ l, href }: { l: LoanView; href: string }) {
  const s = l.summary;
  const pct = l.installmentCount > 0 ? Math.round((s.paidCount * 100) / l.installmentCount) : 0;
  return (
    <Link
      href={href}
      className={cn(
        'block min-w-0 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40',
        s.settled && 'opacity-70',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Landmark className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium">{l.name}</div>
            {l.lender && <div className="truncate text-xs text-muted-foreground">{l.lender}</div>}
          </div>
        </div>
        {s.settled ? (
          <Badge variant="outline" className="shrink-0">
            Quitado
          </Badge>
        ) : s.overdueCount > 0 ? (
          <Badge variant="destructive" className="shrink-0">
            {s.overdueCount} atrasada{s.overdueCount > 1 ? 's' : ''}
          </Badge>
        ) : null}
      </div>
      <div className="mt-3">
        <div className="text-xs text-muted-foreground">Falta pagar</div>
        <Amount cents={s.remainingCents} className="text-2xl font-semibold" />
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label="Parcelas pagas"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {s.paidCount} de {l.installmentCount} parcelas pagas
        {s.nextDueDate ? ` · próxima em ${formatDateBR(s.nextDueDate)}` : ''}
      </p>
    </Link>
  );
}
