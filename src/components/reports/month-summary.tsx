import Link from 'next/link';
import { Amount } from '@/components/money/amount';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { CashSummary } from '@/db/queries/reports';
import { formatMonthLabel, toMonthParam } from '@/domain/dates';

const END_LABEL: Record<CashSummary['endOfMonthKind'], string> = {
  projected: 'Saldo previsto no fim do mês',
  actual: 'Saldo no fim do mês',
  estimated: 'Saldo estimado no fim do mês',
};

/** Visão de caixa do mês (D38): o que entrou/saiu e o que ainda vai entrar/sair. */
export function MonthSummaryCard({ s, month }: { s: CashSummary; month: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="first-letter:uppercase">
          Caixa de {formatMonthLabel(month)}
        </CardDescription>
        <CardTitle className="text-2xl">
          <Amount cents={s.endOfMonthCents} className={s.endOfMonthCents < 0 ? 'text-expense' : undefined} />
        </CardTitle>
        <CardDescription>{END_LABEL[s.endOfMonthKind]}</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 text-sm">
        <Stat label="Entrou" cents={s.incomeReceivedCents} direction="in" />
        <Stat label="Saiu" cents={s.outPaidCents} direction="out" />
        <Stat label="A receber" cents={s.incomePendingCents} muted />
        <Stat label="A pagar (contas + faturas)" cents={s.outPendingCents} muted />
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  cents,
  direction,
  muted,
}: {
  label: string;
  cents: number;
  direction?: 'in' | 'out';
  muted?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <Amount
        cents={cents}
        direction={direction}
        className={muted ? 'font-medium text-muted-foreground' : 'font-medium'}
      />
    </div>
  );
}

/** Gasto do mês nas duas visões (SPEC §5): Mensal (caixa) e Bruto (competência), mais a economia. */
export function SpendCard({
  monthlyCents,
  grossCents,
  savingsCents,
  month,
}: {
  monthlyCents: number;
  grossCents: number;
  savingsCents: number;
  month: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Gasto do mês</CardTitle>
        <CardDescription>Mensal: o que sai no mês. Bruto: o que foi comprado no mês.</CardDescription>
        <CardAction>
          <Button asChild variant="ghost" size="sm">
            <Link href={`/relatorios?mes=${toMonthParam(month)}`}>Detalhes</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">Mensal</div>
          <Amount cents={monthlyCents} className="text-lg font-semibold" data-testid="spend-monthly" />
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Bruto</div>
          <Amount cents={grossCents} className="text-lg font-semibold" data-testid="spend-gross" />
        </div>
        {savingsCents > 0 && (
          <p className="col-span-2 text-xs text-muted-foreground">
            Economia com antecipação: <Amount cents={savingsCents} direction="in" className="font-medium" />
          </p>
        )}
      </CardContent>
    </Card>
  );
}
