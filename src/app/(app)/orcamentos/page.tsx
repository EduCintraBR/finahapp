import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, ChevronRight, Plus } from 'lucide-react';
import { BudgetBar, LevelBadge } from '@/components/budgets/budget-bar';
import { BudgetChart } from '@/components/budgets/budget-chart';
import { BudgetForm } from '@/components/budgets/budget-forms';
import { CategoryIcon } from '@/components/categories/category-icon';
import { PageHeader } from '@/components/layout/page-header';
import { Amount } from '@/components/money/amount';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SheetAction } from '@/components/ui/sheet-action';
import { getDb } from '@/db/client';
import {
  budgetHistory,
  budgetMonthView,
  CAP_NAME,
  listBudgetRecords,
  type BudgetLine,
} from '@/db/queries/budgets';
import { listCategories } from '@/db/queries/lookups';
import { formatMonthLabel, toMonthParam } from '@/domain/dates';
import { resolveMonth } from '@/lib/month';
import { cn } from '@/lib/utils';
import { ensureOccurrences } from '@/server/ensure-occurrences';

export const metadata: Metadata = { title: 'Orçamentos' };

/** Frase do alerta: o que passou e quanto, ou o quanto já foi. */
function alertText(l: BudgetLine): string {
  return l.level === 'over' ? `passou do orçamento (${l.percent}%)` : `está em ${l.percent}% do orçamento`;
}

/**
 * Orçamentos do mês (D79): teto do mês e limite por categoria, medidos pelo Gasto Mensal (o que sai no mês),
 * com alertas a partir de 80% e acima do limite e o histórico dos últimos 6 meses do teto.
 */
export default async function BudgetsPage({ searchParams }: PageProps<'/orcamentos'>) {
  await ensureOccurrences();
  const db = getDb();
  const month = await resolveMonth(searchParams);
  const mes = toMonthParam(month);
  const [view, records, categories] = await Promise.all([
    budgetMonthView(db, month),
    listBudgetRecords(db),
    listCategories(db),
  ]);
  const capRecord = records.find((r) => r.categoryId === null);
  const history = capRecord ? await budgetHistory(db, capRecord, month) : [];
  const monthLabel = formatMonthLabel(month);

  // o que ainda dá para acompanhar neste mês: o teto (se não tem) e as categorias-mãe de despesa sem orçamento
  const tracked = new Set(view.lines.map((l) => l.categoryId));
  const options = [
    ...(view.cap ? [] : [{ id: '', name: `${CAP_NAME} (todos os gastos)` }]),
    ...categories
      .filter((c) => c.kind === 'EXPENSE' && c.parentId === null && !tracked.has(c.id))
      .map((c) => ({ id: c.id, name: c.name })),
  ];
  const detail = (id: string) => `/orcamentos/${id}?mes=${mes}`;
  const empty = !view.cap && view.lines.length === 0;

  return (
    <div className="mx-auto max-w-2xl space-y-4 lg:max-w-5xl">
      <PageHeader
        title="Orçamentos"
        description={<span className="block first-letter:uppercase">{monthLabel}</span>}
        actions={
          options.length > 0 && (
            <SheetAction
              label="Novo orçamento"
              description="Um limite por mês para uma categoria, ou o teto de todos os gastos do mês."
              icon={<Plus aria-hidden />}
              variant="default"
            >
              <BudgetForm month={mes} options={options} />
            </SheetAction>
          )
        }
      />

      {view.alerts.length > 0 && (
        <section
          aria-label="Alertas"
          className="space-y-2 rounded-xl border border-warning/60 bg-warning/10 px-4 py-3"
          data-testid="budget-alerts"
        >
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="size-4 text-warning-text" aria-hidden />
            {view.alerts.length === 1 ? '1 alerta' : `${view.alerts.length} alertas`} em {monthLabel}
          </h2>
          <ul className="space-y-1 text-sm">
            {view.alerts.map((a) => (
              <li key={a.id}>
                <Link href={detail(a.id)} className="hover:underline">
                  <span className="font-medium">{a.name}</span> {alertText(a)}
                  {a.level === 'over' ? (
                    <>
                      : passou <Amount cents={-a.remainingCents} className="font-medium text-expense" />
                    </>
                  ) : (
                    <>
                      : falta <Amount cents={a.remainingCents} className="font-medium" />
                    </>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {empty ? (
        <Card>
          <CardHeader>
            <CardTitle>Nenhum orçamento em {monthLabel}</CardTitle>
            <CardDescription>
              Defina um teto para todos os gastos do mês e limites por categoria (Mercado, Lazer…). O app
              compara com o Gasto Mensal (o que sai no mês: contas, gastos no benefício e as faturas que
              vencem no mês) e avisa quando passar de 80% e do limite.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          <Card className="gap-3">
            <CardHeader className="pb-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle>{CAP_NAME}</CardTitle>
                  <CardDescription>Todos os gastos do mês (Gasto Mensal)</CardDescription>
                </div>
                {view.cap && <LevelBadge level={view.cap.level} />}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {view.cap ? (
                <Link href={detail(view.cap.id)} className="block" data-testid="budget-cap">
                  <BudgetBar {...view.cap} />
                </Link>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Sem teto em {monthLabel}. Gasto Mensal até agora:{' '}
                  <Amount cents={view.totalSpentCents} className="font-medium text-foreground" />.
                </p>
              )}
              {history.some((p) => p.limitCents !== null) && (
                <div className="border-t pt-4">
                  <h3 className="mb-2 text-sm font-medium">Últimos 6 meses</h3>
                  <BudgetChart
                    title={`Gasto Mensal × teto do mês nos últimos 6 meses`}
                    data={history.map((p) => ({ ...p, selected: p.month === month }))}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="gap-0 pb-0">
            <CardHeader className="pb-3">
              <CardTitle>Por categoria</CardTitle>
              <CardDescription>
                Do mais apertado para o mais folgado. Toque para ver o histórico.
              </CardDescription>
            </CardHeader>
            <CardContent className="divide-y border-t px-0">
              {view.lines.length === 0 ? (
                <p className="px-6 py-6 text-center text-sm text-muted-foreground">
                  Nenhuma categoria com orçamento neste mês.
                </p>
              ) : (
                view.lines.map((l) => (
                  <Link
                    key={l.id}
                    href={detail(l.id)}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 sm:px-6"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                      <CategoryIcon name={l.icon} className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{l.name}</span>
                        <LevelBadge level={l.level} />
                      </div>
                      <BudgetBar {...l} size="sm" />
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                ))
              )}
              <p
                className={cn(
                  'px-4 py-3 text-xs text-muted-foreground sm:px-6',
                  view.lines.length === 0 && 'border-t',
                )}
              >
                Gastos sem orçamento de categoria em {monthLabel}:{' '}
                <Amount cents={view.unbudgetedCents} className="font-medium text-foreground" />
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
