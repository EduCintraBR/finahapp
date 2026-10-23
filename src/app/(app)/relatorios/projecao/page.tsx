import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Amount } from '@/components/money/amount';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { projection } from '@/db/queries/reports';
import {
  addMonths,
  compareDates,
  formatMonthLabel,
  monthStart,
  parseMonthParam,
  today,
  toMonthParam,
} from '@/domain/dates';
import { ensureOccurrences } from '@/server/ensure-occurrences';

export const metadata: Metadata = { title: 'Projeção' };

const MAX_MONTHS = 36;

export default async function ProjectionPage({ searchParams }: PageProps<'/relatorios/projecao'>) {
  await ensureOccurrences();
  const sp = await searchParams;
  const hoje = today();
  const current = monthStart(hoje);
  const raw = typeof sp.ate === 'string' ? parseMonthParam(sp.ate) : null;
  const min = addMonths(current, 1);
  const maxMonth = addMonths(current, MAX_MONTHS);
  let until = raw ?? addMonths(current, 6);
  if (compareDates(until, min) < 0) until = min;
  if (compareDates(until, maxMonth) > 0) until = maxMonth;

  const rows = await projection(getDb(), hoje, until);
  const last = rows.at(-1);
  const canMore = compareDates(until, maxMonth) < 0;
  const canLess = compareDates(until, addMonths(current, 3)) > 0;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/relatorios">
          <ArrowLeft aria-hidden /> Relatórios
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardDescription className="first-letter:uppercase">
            Saldo estimado no fim de {formatMonthLabel(until)}
          </CardDescription>
          <CardTitle className="text-2xl">
            {last && (
              <Amount
                cents={last.estimatedBalanceCents}
                className={last.estimatedBalanceCents < 0 ? 'text-expense' : undefined}
              />
            )}
          </CardTitle>
          <CardDescription>
            Estimativa: parte do saldo previsto para o fim deste mês e soma o resultado de cada mês. Entram
            receitas e contas fixas cadastradas, a estimativa dos recorrentes, o que falta pagar das faturas
            já agendadas e as assinaturas no cartão. Compras futuras no cartão ainda não feitas não entram.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          {canLess && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/relatorios/projecao?ate=${toMonthParam(addMonths(until, -3))}`}>− 3 meses</Link>
            </Button>
          )}
          {canMore && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/relatorios/projecao?ate=${toMonthParam(addMonths(until, 3))}`}>+ 3 meses</Link>
            </Button>
          )}
        </CardContent>
      </Card>

      <ul className="space-y-2" aria-label="Projeção por mês">
        {rows.map((r) => {
          const out = r.fixedCents + r.variableCents + r.invoicesCents + r.subscriptionsCents + r.loansCents;
          return (
            <li key={r.month}>
              <Card className="gap-2 py-4" data-testid="projection-month">
                <CardContent className="space-y-2 px-4 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium first-letter:uppercase">{formatMonthLabel(r.month)}</span>
                    <Amount
                      cents={Math.abs(r.resultCents)}
                      direction={r.resultCents >= 0 ? 'in' : 'out'}
                      className="font-semibold"
                    />
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <Row label="Receitas" cents={r.incomeCents} />
                    <Row label="Saídas" cents={out} />
                    {r.fixedCents > 0 && <Row label="· Fixos" cents={r.fixedCents} />}
                    {r.variableCents > 0 && <Row label="· Recorrentes (estim.)" cents={r.variableCents} />}
                    {r.invoicesCents > 0 && <Row label="· Faturas" cents={r.invoicesCents} />}
                    {r.loansCents > 0 && <Row label="· Empréstimos" cents={r.loansCents} />}
                    {r.subscriptionsCents > 0 && <Row label="· Assinaturas" cents={r.subscriptionsCents} />}
                  </dl>
                  <div className="flex justify-between border-t pt-2 text-xs">
                    <span className="text-muted-foreground">Saldo estimado no fim do mês</span>
                    <Amount
                      cents={r.estimatedBalanceCents}
                      className={r.estimatedBalanceCents < 0 ? 'font-medium text-expense' : 'font-medium'}
                    />
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Row({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="truncate">{label}</dt>
      <dd className="tabular-nums">
        <Amount cents={cents} />
      </dd>
    </div>
  );
}
