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
import { formatMonthLabel, type ISODate } from '@/domain/dates';
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
 * A 1ª tela da Início (U3): o saldo em destaque com a previsão do fim do mês e os quatro números do mês, em duas
 * linhas com as entradas à esquerda e as saídas à direita: o que já aconteceu (Entrou, Saiu) e o que ainda vai
 * acontecer (A receber, A pagar; D72: inclui os atrasados). No mês atual: o saldo de agora e para onde ele vai.
 * Em outro mês: o saldo no fim daquele mês (real, se já passou; estimado, se é futuro) e o de hoje em segundo plano.
 */
export function BalanceHero({
  month,
  isCurrentMonth,
  accountName,
  balanceCents,
  summary,
  suffix = '',
}: {
  month: ISODate;
  isCurrentMonth: boolean;
  accountName: string;
  balanceCents: number;
  summary: CashSummary;
  suffix?: string;
}) {
  const main = isCurrentMonth ? balanceCents : summary.endOfMonthCents;
  const delta = summary.endOfMonthCents - balanceCents;
  const Trend = delta >= 0 ? TrendingUp : TrendingDown;
  return (
    <Card className="gap-0 overflow-hidden border-primary/20 bg-gradient-to-br from-primary/15 via-card to-card py-0">
      <CardContent className="space-y-1.5 px-4 pt-4 pb-3.5 sm:px-6 sm:pt-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 truncate text-sm text-muted-foreground">
            {isCurrentMonth ? 'Saldo atual' : `Saldo no fim de ${formatMonthLabel(month)}`} · {accountName}
          </div>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="-my-1 h-7 shrink-0 bg-background/60 px-2.5 text-xs"
          >
            <Link href="/conta/conferencia">Conferir</Link>
          </Button>
        </div>
        <Amount
          cents={main}
          data-testid="balance-main"
          className={cn(
            'block text-4xl font-semibold tracking-tight sm:text-5xl',
            main < 0 && 'text-expense',
          )}
        />
        {isCurrentMonth ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm" data-testid="end-of-month">
            <Trend className={cn('size-4', delta >= 0 ? 'text-income' : 'text-expense')} aria-hidden />
            <span className="text-muted-foreground">{END_LABEL[summary.endOfMonthKind]}:</span>
            <span className="font-semibold tabular-nums">{formatBRL(summary.endOfMonthCents)}</span>
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

      <div className="grid grid-cols-2 gap-x-4 border-t bg-background/30 px-4 sm:px-6">
        <div className="py-3">
          <KpiLink
            slug="entrou"
            label="Entrou"
            cents={summary.incomeReceivedCents}
            Icon={ArrowDownLeft}
            tone="income"
            suffix={suffix}
          />
        </div>
        <div className="py-3">
          <KpiLink
            slug="saiu"
            label="Saiu"
            cents={summary.outPaidCents}
            Icon={ArrowUpRight}
            tone="expense"
            suffix={suffix}
          />
        </div>
        <div className="border-t border-dashed py-3">
          <KpiLink
            slug="a-receber"
            label="A receber"
            hint="previsto entrar"
            cents={summary.incomePendingCents}
            Icon={CalendarClock}
            tone="muted"
            suffix={suffix}
          />
        </div>
        <div className="border-t border-dashed py-3">
          <KpiLink
            slug="a-pagar"
            label="A pagar"
            hint="contas e faturas"
            cents={summary.outPendingCents}
            Icon={Receipt}
            tone="warning"
            suffix={suffix}
          />
        </div>
      </div>
    </Card>
  );
}
