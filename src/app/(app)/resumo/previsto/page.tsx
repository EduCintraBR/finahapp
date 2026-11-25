import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { CashForecastExplorer } from '@/components/dashboard/cash-forecast';
import { monthSuffix } from '@/components/layout/month-link';
import { Amount } from '@/components/money/amount';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { cashForecast, forecastRange } from '@/db/queries/cash-forecast';
import {
  addDays,
  addMonths,
  compareDates,
  formatDateBR,
  formatMonthLabel,
  formatMonthShort,
  monthStart,
  today,
  toMonthParam,
} from '@/domain/dates';
import type { Cents } from '@/domain/money';
import {
  breakdown,
  groupByMonth,
  toPoints,
  type BreakdownKey,
  type MonthForecast,
} from '@/domain/reports/cash-forecast';
import { resolveMonth } from '@/lib/month';
import { cn } from '@/lib/utils';
import { ensureOccurrences } from '@/server/ensure-occurrences';

export const metadata: Metadata = { title: 'Previsto do mês' };

/** Meses depois do atual que a tela sempre calcula (folga do cartão e a faixa dos próximos meses). */
const AHEAD = 12;

const LABEL: Record<BreakdownKey, string> = {
  realizedIn: 'Entrou na conta',
  realizedOut: 'Saiu da conta',
  overdueIn: 'Receitas atrasadas (contam hoje)',
  overdueOut: 'Contas atrasadas (contam hoje)',
  pendingIn: 'A receber',
  pendingOut: 'Contas a pagar',
  scheduledIn: 'Entradas agendadas',
  scheduledOut: 'Saídas agendadas',
  invoices: 'Faturas do cartão',
  loans: 'Parcelas de empréstimo',
  fixedIn: 'Receitas previstas (fixos)',
  fixedOut: 'Contas fixas',
  variableOut: 'Recorrentes (estimativa)',
  subscriptions: 'Assinaturas no cartão',
  simulation: 'Simulação',
};

/** Ordem das linhas: entradas antes das saídas, e o que é mais certo antes do que é estimado. */
const ORDER: BreakdownKey[] = [
  'overdueIn',
  'pendingIn',
  'scheduledIn',
  'fixedIn',
  'overdueOut',
  'pendingOut',
  'scheduledOut',
  'invoices',
  'loans',
  'fixedOut',
  'variableOut',
  'subscriptions',
];

function Line({
  label,
  cents,
  total,
  hint,
}: {
  label: string;
  cents: Cents;
  total?: boolean;
  hint?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-3 py-1.5 text-sm',
        total && 'border-t font-semibold',
      )}
    >
      <span className={cn(!total && 'text-muted-foreground')}>
        {label}
        {hint && <span className="block text-xs font-normal text-muted-foreground">{hint}</span>}
      </span>
      {total ? (
        <Amount cents={cents} className={cn(cents < 0 && 'text-expense')} />
      ) : (
        <Amount cents={Math.abs(cents)} direction={cents >= 0 ? 'in' : 'out'} />
      )}
    </div>
  );
}

function Parts({ parts }: { parts: Partial<Record<BreakdownKey, Cents>> }) {
  return (
    <>
      {ORDER.filter((k) => (parts[k] ?? 0) !== 0).map((k) => (
        <Line key={k} label={LABEL[k]} cents={parts[k]!} />
      ))}
    </>
  );
}

export default async function ForecastPage({ searchParams }: PageProps<'/resumo/previsto'>) {
  await ensureOccurrences();
  const hoje = today();
  const current = monthStart(hoje);
  const month = await resolveMonth(searchParams);
  const suffix = monthSuffix(month, current);
  const range = forecastRange(month, hoje, AHEAD);
  const data = await cashForecast(getDb(), hoje, range.from, range.to);

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link href={`/${suffix}`}>
        <ArrowLeft aria-hidden /> Início
      </Link>
    </Button>
  );
  if (!data) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        {back}
        <p className="text-sm text-muted-foreground">A conta principal ainda não foi configurada.</p>
      </div>
    );
  }

  const months = groupByMonth(data.days);
  const view = months.find((m) => m.month === month)!;
  const isPast = compareDates(month, current) < 0;
  const isCurrent = month === current;
  const label = formatMonthLabel(month);
  const endDate = view.days.at(-1)!.date;
  const title = isPast
    ? 'Saldo no fim do mês'
    : isCurrent
      ? 'Previsto no fim do mês'
      : 'Estimado no fim do mês';

  // composição: no mês atual, o que já aconteceu fecha no saldo de hoje; o resto é o que ainda vai acontecer
  const realized = breakdown(view.days.filter((d) => compareDates(d.date, hoje) <= 0));
  const realizedIn = realized.realizedIn ?? 0;
  const realizedOut = realized.realizedOut ?? 0;
  const todayBalance = view.openingCents + realizedIn + realizedOut;
  const ahead = breakdown(isCurrent ? view.days.filter((d) => compareDates(d.date, hoje) >= 0) : view.days);
  delete ahead.realizedIn;
  delete ahead.realizedOut;

  // horizonte para a folga do cartão e a simulação: de hoje até o fim do que foi calculado
  const points = isPast ? [] : toPoints(data.days.filter((d) => compareDates(d.date, hoje) >= 0));
  const nextMonths: MonthForecast[] = isPast
    ? []
    : months.filter((m) => compareDates(m.month, current) >= 0).slice(0, 7);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {back}

      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {title} · <span className="first-letter:uppercase">{label}</span>
        </h1>
        <Amount
          cents={view.closingCents}
          className={cn('text-3xl font-semibold', view.closingCents < 0 && 'text-expense')}
          data-testid="forecast-total"
        />
        <p className="text-sm text-muted-foreground">
          {isPast
            ? `O saldo real da ${data.accountName} em ${formatDateBR(endDate)}, dia a dia.`
            : isCurrent
              ? `Saldo de hoje mais tudo o que ainda vai entrar e sair da ${data.accountName} até ${formatDateBR(endDate)}. Atrasados contam hoje, como se fossem pagos agora.`
              : `Parte do saldo previsto para o fim de ${formatMonthLabel(addMonths(month, -1))} e soma o que deve entrar e sair no mês. É uma estimativa.`}
        </p>
      </div>

      <Card className="gap-0 py-3" data-testid="forecast-equation">
        <CardContent className="px-4">
          <h2 className="pb-1 text-sm font-semibold">Como chegamos nesse número</h2>
          {isPast || isCurrent ? (
            <>
              <Line
                label={`Saldo em ${formatDateBR(addDays(view.days[0]!.date, -1))}`}
                cents={view.openingCents}
                total
              />
              {realizedIn !== 0 && (
                <Line label={LABEL.realizedIn} cents={realizedIn} hint="o que já foi recebido" />
              )}
              {realizedOut !== 0 && (
                <Line label={LABEL.realizedOut} cents={realizedOut} hint="o que já foi pago" />
              )}
              {isCurrent && (
                <Line label={`Saldo hoje (${formatDateBR(hoje).slice(0, 5)})`} cents={todayBalance} total />
              )}
            </>
          ) : (
            <Line
              label={`Estimado no fim de ${formatMonthLabel(addMonths(month, -1))}`}
              cents={view.openingCents}
              total
            />
          )}
          {!isPast && <Parts parts={ahead} />}
          <Line
            label={`${title.replace(' no fim do mês', '')} em ${formatDateBR(endDate)}`}
            cents={view.closingCents}
            total
          />
        </CardContent>
      </Card>

      <CashForecastExplorer
        month={month}
        today={hoje}
        viewDays={view.days}
        points={points}
        cards={data.cards}
      />

      {nextMonths.length > 1 && (
        <section className="space-y-2" aria-label="Próximos meses">
          <h2 className="font-semibold">Mês a mês</h2>
          <p className="text-xs text-muted-foreground">
            Cada mês começa no saldo previsto do fim do anterior.
          </p>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {nextMonths.map((m) => {
              const low = m.days.reduce(
                (lo, d) =>
                  compareDates(d.date, hoje) >= 0 && d.closingCents < lo.cents
                    ? { cents: d.closingCents, date: d.date }
                    : lo,
                { cents: Number.POSITIVE_INFINITY, date: '' },
              );
              return (
                <li key={m.month}>
                  <Link
                    href={`/resumo/previsto${monthSuffix(m.month, current)}`}
                    aria-current={m.month === month ? 'page' : undefined}
                    data-testid="forecast-month"
                    className={cn(
                      'block rounded-xl border bg-card px-3 py-2 transition-colors hover:bg-muted/50',
                      m.month === month && 'border-primary/50 bg-primary/5',
                    )}
                  >
                    <span className="flex items-center justify-between text-xs text-muted-foreground">
                      {formatMonthShort(m.month)}
                      <ChevronRight className="size-3" aria-hidden />
                    </span>
                    <Amount
                      cents={m.closingCents}
                      className={cn('block text-sm font-semibold', m.closingCents < 0 && 'text-expense')}
                    />
                    {low.date && (
                      <span
                        className={cn(
                          'block text-[11px] text-muted-foreground',
                          low.cents < 0 && 'text-expense',
                        )}
                      >
                        menor: {formatDateBR(low.date).slice(0, 5)} · {formatBRLShort(low.cents)}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
          <Link
            href={`/relatorios/projecao?ate=${toMonthParam(addMonths(current, 12))}`}
            className="text-sm text-primary hover:underline"
          >
            Ver a projeção completa
          </Link>
        </section>
      )}
    </div>
  );
}

const short = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});
/** Valor curto só para a faixa dos meses (o exato está no card do mês). */
function formatBRLShort(cents: Cents) {
  return short.format(Math.trunc(cents / 100));
}
