import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Pencil } from 'lucide-react';
import { BudgetBar, LevelBadge } from '@/components/budgets/budget-bar';
import { BudgetChart } from '@/components/budgets/budget-chart';
import { BudgetForm, StopBudgetForm } from '@/components/budgets/budget-forms';
import { PageHeader } from '@/components/layout/page-header';
import { Amount } from '@/components/money/amount';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SheetAction } from '@/components/ui/sheet-action';
import { getDb } from '@/db/client';
import { budgetHistory, getBudgetRecord } from '@/db/queries/budgets';
import { amountForMonth, budgetStatus } from '@/domain/budgets/budgets';
import { formatMonthLabel, toMonthParam } from '@/domain/dates';
import { formatDecimalBR } from '@/domain/money';
import { resolveMonth } from '@/lib/month';
import { ensureOccurrences } from '@/server/ensure-occurrences';

export const metadata: Metadata = { title: 'Orçamento' };

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Um orçamento (D79): situação no mês, gasto × orçamento nos últimos 6 meses e os valores ao longo do tempo. */
export default async function BudgetPage({ params, searchParams }: PageProps<'/orcamentos/[id]'>) {
  await ensureOccurrences();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = getDb();
  const month = await resolveMonth(searchParams);
  const mes = toMonthParam(month);
  const record = await getBudgetRecord(db, id);
  if (!record) notFound();
  const history = await budgetHistory(db, record, month);
  const current = history.at(-1)!;
  const limit = amountForMonth(record.amounts, month);
  const status = limit === null ? null : budgetStatus(current.spentCents, limit);
  const monthLabel = formatMonthLabel(month);
  const isCap = record.categoryId === null;
  const spendHref = isCap
    ? `/relatorios?mes=${mes}`
    : `/relatorios/categoria/${record.categoryId}?mes=${mes}&visao=mensal`;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title={record.name}
        description={
          <span className="block first-letter:uppercase">
            {monthLabel} · {isCap ? 'todos os gastos do mês' : 'categoria com as subcategorias'}
          </span>
        }
        back={{ href: `/orcamentos?mes=${mes}`, label: 'Orçamentos' }}
      />

      <Card className="gap-3">
        <CardHeader className="pb-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardDescription>Gasto Mensal em {monthLabel}</CardDescription>
              <Amount cents={current.spentCents} className="text-3xl font-semibold tracking-tight" />
            </div>
            {status && <LevelBadge level={status.level} />}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {status && limit !== null ? (
            <BudgetBar spentCents={current.spentCents} limitCents={limit} {...status} />
          ) : (
            <p className="text-sm text-muted-foreground">Sem orçamento em {monthLabel}.</p>
          )}
          <Button asChild variant="link" className="h-auto px-0">
            <Link href={spendHref}>Ver os gastos do mês</Link>
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-2 sm:flex">
        <SheetAction
          label={limit === null ? 'Voltar a acompanhar' : 'Mudar o valor'}
          title={record.name}
          description="O novo valor vale a partir do mês escolhido; os meses anteriores não mudam."
          icon={<Pencil aria-hidden />}
        >
          <BudgetForm
            month={mes}
            categoryId={record.categoryId ?? ''}
            defaultAmountText={limit === null ? undefined : formatDecimalBR(limit)}
          />
        </SheetAction>
        {limit !== null && (
          <SheetAction
            label="Parar de acompanhar"
            title={`Parar de acompanhar ${record.name}`}
            description="Os meses anteriores continuam com o orçamento que tinham."
          >
            <StopBudgetForm id={record.id} month={mes} />
          </SheetAction>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Últimos 6 meses</CardTitle>
          <CardDescription>Gasto Mensal de cada mês e o orçamento que valia nele.</CardDescription>
        </CardHeader>
        <CardContent>
          <BudgetChart
            title={`Gasto Mensal × orçamento de ${record.name} nos últimos 6 meses`}
            data={history.map((p) => ({ ...p, selected: p.month === month }))}
          />
        </CardContent>
      </Card>

      <Card className="gap-0 pb-0">
        <CardHeader className="pb-3">
          <CardTitle>Valores</CardTitle>
          <CardDescription>Cada valor vale do mês indicado até a próxima mudança.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y border-t px-0">
          {[...record.amounts].reverse().map((a) => (
            <div key={a.startMonth} className="flex items-center justify-between gap-3 px-6 py-3 text-sm">
              <span>A partir de {capitalize(formatMonthLabel(a.startMonth))}</span>
              {a.amountCents === null ? (
                <span className="text-muted-foreground">parou de acompanhar</span>
              ) : (
                <Amount cents={a.amountCents} className="font-medium" />
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
