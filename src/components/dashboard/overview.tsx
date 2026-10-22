import Link from 'next/link';
import { ArrowDownLeft, ArrowUpRight, CalendarClock, Receipt, TrendingDown, TrendingUp } from 'lucide-react';
import { Amount } from '@/components/money/amount';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { CashSummary } from '@/db/queries/reports';
import { formatDateBR, formatMonthLabel, type ISODate } from '@/domain/dates';
import { formatBRL } from '@/domain/money';
import { cn } from '@/lib/utils';

const END_LABEL: Record<CashSummary['endOfMonthKind'], string> = {
  projected: 'Previsto no fim do mês',
  actual: 'Saldo no fim do mês',
  estimated: 'Estimado no fim do mês',
};

/**
 * Saldo em destaque. No mês atual: o saldo de agora e para onde ele vai até o fim do mês. Em outro mês: o saldo
 * no fim daquele mês (real, se já passou; estimado, se é futuro) e, no mês passado, o saldo de hoje em segundo plano.
 */
export function BalanceHero({
  month,
  isCurrentMonth,
  accountName,
  startDate,
  balanceCents,
  summary,
}: {
  month: ISODate;
  isCurrentMonth: boolean;
  accountName: string;
  startDate: ISODate;
  balanceCents: number;
  summary: CashSummary;
}) {
  const main = isCurrentMonth ? balanceCents : summary.endOfMonthCents;
  const delta = summary.endOfMonthCents - balanceCents;
  const total = summary.incomeReceivedCents + summary.outPaidCents;
  const inShare = total > 0 ? Math.round((summary.incomeReceivedCents * 100) / total) : 0;
  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/15 via-card to-card">
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm text-muted-foreground">
              {isCurrentMonth ? 'Saldo atual' : `Saldo no fim de ${formatMonthLabel(month)}`} · {accountName}
            </div>
            <Amount
              cents={main}
              className={cn('text-4xl font-semibold tracking-tight', main < 0 && 'text-expense')}
            />
            <div className="text-xs text-muted-foreground">desde {formatDateBR(startDate)}</div>
          </div>
          <Button asChild variant="outline" size="sm" className="bg-background/60">
            <Link href="/conta/conferencia">Conferir</Link>
          </Button>
        </div>

        {isCurrentMonth ? (
          <div
            className={cn(
              'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium',
              delta >= 0 ? 'bg-income/15 text-income' : 'bg-expense/15 text-expense',
            )}
          >
            {delta >= 0 ? (
              <TrendingUp className="size-3.5" aria-hidden />
            ) : (
              <TrendingDown className="size-3.5" aria-hidden />
            )}
            {END_LABEL[summary.endOfMonthKind]}: {formatBRL(summary.endOfMonthCents)}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            {END_LABEL[summary.endOfMonthKind]} · saldo de hoje: {formatBRL(balanceCents)}
          </div>
        )}

        {total > 0 && (
          <div className="space-y-1.5">
            <div
              className="flex h-2 overflow-hidden rounded-full bg-expense/30"
              role="img"
              aria-label={`Entrou ${formatBRL(summary.incomeReceivedCents)}, saiu ${formatBRL(summary.outPaidCents)}`}
            >
              <div className="h-full bg-income" style={{ width: `${inShare}%` }} />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Entrou no mês</span>
              <span>Saiu no mês</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Quatro indicadores do mês, cada um com seu ícone e cor. */
export function KpiGrid({ summary }: { summary: CashSummary }) {
  const tiles = [
    { label: 'Entrou', cents: summary.incomeReceivedCents, Icon: ArrowDownLeft, tone: 'income' as const },
    { label: 'Saiu', cents: summary.outPaidCents, Icon: ArrowUpRight, tone: 'expense' as const },
    { label: 'A receber', cents: summary.incomePendingCents, Icon: CalendarClock, tone: 'muted' as const },
    {
      label: 'A pagar',
      cents: summary.outPendingCents,
      Icon: Receipt,
      tone: 'warning' as const,
      hint: 'contas e faturas',
    },
  ];
  const tone = {
    income: 'bg-income/15 text-income',
    expense: 'bg-expense/15 text-expense',
    warning: 'bg-warning/20 text-warning-text',
    muted: 'bg-muted text-muted-foreground',
  };
  return (
    <div className="grid grid-cols-2 gap-3">
      {tiles.map(({ label, cents, Icon, tone: t, hint }) => (
        <Card key={label} className="gap-2 py-4">
          <CardContent className="space-y-2 px-4">
            <span className={cn('flex size-8 items-center justify-center rounded-full', tone[t])}>
              <Icon className="size-4" aria-hidden />
            </span>
            <div>
              <div className="text-xs text-muted-foreground">
                {label}
                {hint && <span className="hidden sm:inline"> · {hint}</span>}
              </div>
              <Amount cents={cents} className="text-base font-semibold" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
