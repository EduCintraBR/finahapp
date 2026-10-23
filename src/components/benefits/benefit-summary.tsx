import Link from 'next/link';
import { Utensils } from 'lucide-react';
import { Amount } from '@/components/money/amount';
import { Badge } from '@/components/ui/badge';
import type { BenefitCardView } from '@/db/queries/benefits';
import { formatDateBR, formatMonthShort } from '@/domain/dates';
import { cn } from '@/lib/utils';

/** Cartão de benefícios: saldo total, saldo por carteira e quando cai o próximo crédito. */
export function BenefitSummaryCard({ c, href }: { c: BenefitCardView; href: string }) {
  return (
    <Link
      href={href}
      className={cn(
        'block min-w-0 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40',
        c.ended && 'opacity-70',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Utensils className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium">{c.name}</div>
            {c.issuer && <div className="truncate text-xs text-muted-foreground">{c.issuer}</div>}
          </div>
        </div>
        <Badge variant={c.ended || c.endMonth ? 'outline' : 'secondary'} className="shrink-0">
          {c.ended ? 'Encerrado' : c.endMonth ? `Encerra em ${formatMonthShort(c.endMonth)}` : 'Ativo'}
        </Badge>
      </div>
      <div className="mt-3">
        <div className="text-xs text-muted-foreground">Saldo total</div>
        <Amount cents={c.totalBalanceCents} className="text-2xl font-semibold" />
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        {c.wallets.map((w) => (
          <li key={w.id} className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-muted-foreground">{w.name}</span>
            <Amount cents={w.balanceCents} className="font-medium" />
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        {c.nextCreditDate
          ? `Próximo crédito em ${formatDateBR(c.nextCreditDate)}`
          : c.ended
            ? 'Sem novos créditos'
            : 'Sem crédito agendado'}
      </p>
    </Link>
  );
}
