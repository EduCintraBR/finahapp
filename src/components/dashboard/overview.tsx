import Link from 'next/link';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarClock,
  ChevronRight,
  Receipt,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
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

type Tone = 'income' | 'expense' | 'warning' | 'muted';
const TONE: Record<Tone, string> = {
  income: 'bg-income/15 text-income',
  expense: 'bg-expense/15 text-expense',
  warning: 'bg-warning/20 text-warning-text',
  muted: 'bg-muted text-muted-foreground',
};

/**
 * Atalho para o detalhe de um indicador do mês (D68): ícone e rótulo em cima, o valor embaixo, sempre inteiro
 * (valor de dinheiro nunca é cortado com "…"). O valor é o primeiro (e único) do texto, e o detalhe em
 * /resumo/{slug} soma os mesmos itens.
 */
export function KpiLink({
  slug,
  label,
  hint,
  cents,
  Icon,
  tone,
  suffix = '',
}: {
  slug: string;
  label: string;
  hint?: string;
  cents: number;
  Icon: LucideIcon;
  tone: Tone;
  suffix?: string;
}) {
  return (
    <Link
      href={`/resumo/${slug}${suffix}`}
      data-testid={`kpi-${slug}`}
      className="group -m-2 block min-w-0 space-y-1 rounded-lg p-2 transition-colors outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className={cn('grid size-6 shrink-0 place-items-center rounded-full', TONE[tone])}>
          <Icon className="size-3.5" aria-hidden />
        </span>
        <span className="min-w-0 truncate">
          {label}
          {hint && <span className="hidden xl:inline"> · {hint}</span>}
        </span>
        <ChevronRight
          className="ml-auto size-3.5 shrink-0 opacity-60 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </span>
      <Amount cents={cents} className="block text-lg font-semibold whitespace-nowrap tabular-nums" />
    </Link>
  );
}

/**
 * Saldo em destaque e o caixa do mês (Entrou × Saiu) no mesmo card. No mês atual: o saldo de agora e para onde
 * ele vai até o fim do mês. Em outro mês: o saldo no fim daquele mês (real, se já passou; estimado, se é futuro)
 * e o saldo de hoje em segundo plano.
 */
export function BalanceHero({
  month,
  isCurrentMonth,
  accountName,
  startDate,
  balanceCents,
  summary,
  suffix = '',
}: {
  month: ISODate;
  isCurrentMonth: boolean;
  accountName: string;
  startDate: ISODate;
  balanceCents: number;
  summary: CashSummary;
  suffix?: string;
}) {
  const main = isCurrentMonth ? balanceCents : summary.endOfMonthCents;
  const delta = summary.endOfMonthCents - balanceCents;
  const flow = summary.incomeReceivedCents + summary.outPaidCents;
  const inShare = flow > 0 ? Math.round((summary.incomeReceivedCents * 100) / flow) : 0;
  const Trend = delta >= 0 ? TrendingUp : TrendingDown;
  return (
    <Card className="gap-0 overflow-hidden border-primary/20 bg-gradient-to-br from-primary/15 via-card to-card py-0">
      <CardContent className="space-y-3 px-5 pt-5 pb-4 sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 text-sm text-muted-foreground">
            {isCurrentMonth ? 'Saldo atual' : `Saldo no fim de ${formatMonthLabel(month)}`} · {accountName}
          </div>
          <Button asChild variant="outline" size="sm" className="-mt-1 shrink-0 bg-background/60">
            <Link href="/conta/conferencia">Conferir</Link>
          </Button>
        </div>
        <div>
          <Amount
            cents={main}
            className={cn(
              'block text-4xl font-semibold tracking-tight sm:text-5xl',
              main < 0 && 'text-expense',
            )}
          />
          <div className="mt-1 text-xs text-muted-foreground">desde {formatDateBR(startDate)}</div>
        </div>
        {isCurrentMonth ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <Trend className={cn('size-4', delta >= 0 ? 'text-income' : 'text-expense')} aria-hidden />
            <span className="text-muted-foreground">{END_LABEL[summary.endOfMonthKind]}:</span>
            <span className="font-medium tabular-nums">{formatBRL(summary.endOfMonthCents)}</span>
            {delta !== 0 && (
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
                  delta > 0 ? 'bg-income/15 text-income' : 'bg-expense/15 text-expense',
                )}
              >
                {delta > 0 ? '+' : '−'}
                {formatBRL(Math.abs(delta))}
              </span>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            {END_LABEL[summary.endOfMonthKind]} · saldo de hoje: {formatBRL(balanceCents)}
          </div>
        )}
      </CardContent>

      <div className="space-y-3 border-t bg-background/30 px-5 py-4 sm:px-6">
        <div className="grid grid-cols-2 gap-4">
          <KpiLink
            slug="entrou"
            label="Entrou"
            cents={summary.incomeReceivedCents}
            Icon={ArrowDownLeft}
            tone="income"
            suffix={suffix}
          />
          <KpiLink
            slug="saiu"
            label="Saiu"
            cents={summary.outPaidCents}
            Icon={ArrowUpRight}
            tone="expense"
            suffix={suffix}
          />
        </div>
        {flow > 0 && (
          <div
            className="flex h-1.5 gap-0.5 overflow-hidden rounded-full"
            role="img"
            aria-label={`Entrou ${formatBRL(summary.incomeReceivedCents)}, saiu ${formatBRL(summary.outPaidCents)}`}
          >
            <div className="h-full rounded-full bg-income" style={{ width: `${inShare}%` }} />
            <div className="h-full flex-1 rounded-full bg-expense/70" />
          </div>
        )}
      </div>
    </Card>
  );
}

/** A pagar e a receber até o fim do mês: o cabeçalho do painel de pendentes. */
export function PendingTotals({ summary, suffix = '' }: { summary: CashSummary; suffix?: string }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <KpiLink
        slug="a-pagar"
        label="A pagar"
        hint="contas e faturas"
        cents={summary.outPendingCents}
        Icon={Receipt}
        tone="warning"
        suffix={suffix}
      />
      <KpiLink
        slug="a-receber"
        label="A receber"
        cents={summary.incomePendingCents}
        Icon={CalendarClock}
        tone="muted"
        suffix={suffix}
      />
    </div>
  );
}
