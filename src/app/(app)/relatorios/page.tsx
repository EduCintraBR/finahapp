import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, CalendarRange, SlidersHorizontal } from 'lucide-react';
import { CategoryDonut } from '@/components/dashboard/charts';
import { buildSlices, sliceColor } from '@/components/dashboard/slices';
import { NativeSelect } from '@/components/forms/fields';
import { Amount } from '@/components/money/amount';
import { EvolutionChart, type EvolutionPoint } from '@/components/reports/evolution-chart';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SheetAction } from '@/components/ui/sheet-action';
import { getDb } from '@/db/client';
import { listActiveCards } from '@/db/queries/cards';
import { listCategories, listUsers } from '@/db/queries/lookups';
import {
  ADJUSTMENTS_KEY,
  anticipationSavings,
  grossSpend,
  monthlySpend,
  NO_CATEGORY_KEY,
  total,
  type ReportFilters,
} from '@/db/queries/reports';
import { addMonths, formatMonthLabel, monthEnd, parseISODate, toMonthParam } from '@/domain/dates';
import { formatBRL } from '@/domain/money';
import { ACCOUNT_PAYMENT_METHODS, PAYMENT_METHOD_LABEL } from '@/lib/labels';
import { resolveMonth } from '@/lib/month';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Relatórios' };

const str = (v: string | string[] | undefined) => (typeof v === 'string' && v !== '' ? v : undefined);
const uuid = (v: string | undefined) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const shortMonth = (m: string) => {
  const { year, month } = parseISODate(m);
  return `${MONTHS[month - 1]}/${String(year).slice(2)}`;
};
const monthName = (m: string) => formatMonthLabel(m).split(' de ')[0]!;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part * 100) / whole) : 0);

type View = 'mensal' | 'bruto';

/** Variação contra o mês anterior. Gastar mais é ruim (cor de saída); gastar menos, bom (cor de entrada). */
function Delta({ cents, base, className }: { cents: number; base: number; className?: string }) {
  if (cents === 0) return <span className={cn('text-muted-foreground', className)}>igual</span>;
  const up = cents > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 tabular-nums',
        up ? 'text-expense' : 'text-income',
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only">{up ? 'mais' : 'menos'} </span>
      {formatBRL(Math.abs(cents))}
      {base > 0 && <span className="opacity-80"> ({pct(Math.abs(cents), base)}%)</span>}
    </span>
  );
}

export default async function ReportsPage({ searchParams }: PageProps<'/relatorios'>) {
  const sp = await searchParams;
  const month = await resolveMonth(searchParams);
  const view: View = str(sp.visao) === 'bruto' ? 'bruto' : 'mensal';
  const meio = str(sp.meio);
  const filters: ReportFilters = {
    createdBy: uuid(str(sp.lancou)),
    beneficiary: str(sp.dequem) === 'casal' ? 'casal' : uuid(str(sp.dequem)),
    cardId: uuid(str(sp.cartao)),
    paymentMethod:
      meio === 'CREDIT_CARD' || meio === 'BENEFIT_CARD' || ACCOUNT_PAYMENT_METHODS.includes(meio as never)
        ? meio
        : undefined,
  };
  const activeFilters = Object.values(filters).filter(Boolean).length;
  const db = getDb();
  const end = monthEnd(month);
  const prev = addMonths(month, -1);
  const first = addMonths(month, -11);
  const spend = view === 'bruto' ? grossSpend : monthlySpend;

  const [byCategory, prevByCategory, savings, grossByMonth, monthlyByMonth, categories, users, cards] =
    await Promise.all([
      spend(db, month, end, 'category', filters),
      spend(db, prev, monthEnd(prev), 'category', filters),
      anticipationSavings(db, month, end, filters),
      grossSpend(db, first, end, 'month', filters),
      monthlySpend(db, first, end, 'month', filters),
      listCategories(db, { includeArchived: true }),
      listUsers(db),
      listActiveCards(db),
    ]);

  const nameOf = (key: string) =>
    key === ADJUSTMENTS_KEY
      ? 'Ajustes de fatura'
      : key === NO_CATEGORY_KEY
        ? 'Sem categoria'
        : (categories.find((c) => c.id === key)?.name ?? 'Categoria removida');
  const rows = [...byCategory.entries()]
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => ({ key: k, name: nameOf(k), cents: v, prevCents: prevByCategory.get(k) ?? 0 }))
    .sort((a, b) => b.cents - a.cents);
  const sum = total(byCategory);
  const prevSum = total(prevByCategory);
  const max = Math.max(1, ...rows.map((r) => r.cents));
  const slices = buildSlices(rows);

  // a série só começa no 1º mês com algum gasto: antes disso não há histórico (não é zero)
  const months = Array.from({ length: 12 }, (_, i) => addMonths(first, i));
  const firstWithData = months.findIndex(
    (m) => (monthlyByMonth.get(m) ?? 0) !== 0 || (grossByMonth.get(m) ?? 0) !== 0,
  );
  const evolution: EvolutionPoint[] = months.map((m, i) => {
    const before = firstWithData === -1 || i < firstWithData;
    return {
      month: m,
      label: shortMonth(m),
      monthlyCents: before ? null : (monthlyByMonth.get(m) ?? 0),
      grossCents: before ? null : (grossByMonth.get(m) ?? 0),
    };
  });
  // média dos meses anteriores com histórico, na visão escolhida
  const series = view === 'bruto' ? grossByMonth : monthlyByMonth;
  const history = months.slice(firstWithData === -1 ? 12 : firstWithData, 11).map((m) => series.get(m) ?? 0);
  const average = history.length > 0 ? Math.round(history.reduce((s, v) => s + v, 0) / history.length) : null;

  const params = (over: Record<string, string>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === 'string' && v) q.set(k, v);
    for (const [k, v] of Object.entries(over)) q.set(k, v);
    return `/relatorios?${q}`;
  };
  const mesParam = toMonthParam(month);
  const viewName = view === 'mensal' ? 'Gasto Mensal' : 'Gasto Bruto';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Relatórios</h1>
        <Button asChild variant="outline" size="sm">
          <Link href="/relatorios/projecao">
            <CalendarRange aria-hidden /> Projeção
          </Link>
        </Button>
      </div>

      <div className="space-y-3">
        <div
          role="tablist"
          aria-label="Visão"
          className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm sm:max-w-md"
        >
          {(
            [
              ['mensal', 'Mensal (caixa)'],
              ['bruto', 'Bruto (compras)'],
            ] as const
          ).map(([v, label]) => (
            <Link
              key={v}
              role="tab"
              aria-selected={view === v}
              href={params({ visao: v })}
              className={cn(
                'rounded-md px-3 py-1.5 text-center font-medium transition-colors',
                view === v ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </Link>
          ))}
        </div>

        {/* filtros num painel (antes: bloco <details>); "Limpar" fica à vista quando há filtro */}
        <div className="flex items-center gap-2">
          <SheetAction
            label="Filtros"
            title="Filtrar relatórios"
            icon={<SlidersHorizontal aria-hidden />}
            className="w-auto"
            triggerContent={
              <>
                Filtros
                {activeFilters > 0 && <span className="text-primary">({activeFilters})</span>}
              </>
            }
          >
            <form method="get" className="grid grid-cols-2 gap-3">
              <input type="hidden" name="mes" value={mesParam} />
              <input type="hidden" name="visao" value={view} />
              <NativeSelect name="dequem" defaultValue={filters.beneficiary ?? ''} aria-label="De quem é">
                <option value="">De qualquer um</option>
                <option value="casal">Do casal</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    De {u.name}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect name="lancou" defaultValue={filters.createdBy ?? ''} aria-label="Quem lançou">
                <option value="">Lançado por qualquer um</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    Lançado por {u.name}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect name="cartao" defaultValue={filters.cardId ?? ''} aria-label="Cartão">
                <option value="">Conta e cartões</option>
                {cards.map((c) => (
                  <option key={c.id} value={c.id}>
                    Só {c.name}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                name="meio"
                defaultValue={filters.paymentMethod ?? ''}
                aria-label="Meio de pagamento"
              >
                <option value="">Todos os meios</option>
                <option value="CREDIT_CARD">{PAYMENT_METHOD_LABEL.CREDIT_CARD}</option>
                <option value="BENEFIT_CARD">{PAYMENT_METHOD_LABEL.BENEFIT_CARD}</option>
                {ACCOUNT_PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABEL[m]}
                  </option>
                ))}
              </NativeSelect>
              <Button type="submit" className="col-span-2 h-11">
                Filtrar
              </Button>
            </form>
          </SheetAction>
          {activeFilters > 0 && (
            <Button asChild variant="ghost" size="sm">
              <Link href={`/relatorios?mes=${mesParam}&visao=${view}`}>Limpar</Link>
            </Button>
          )}
        </div>
      </div>

      {/* resumo do mês: o total, a comparação com o mês anterior e a média */}
      <Card className="gap-0 py-0">
        <div className="grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="px-5 py-4">
            <div className="text-xs text-muted-foreground first-letter:uppercase">
              {viewName} · {formatMonthLabel(month)}
            </div>
            <Amount
              cents={sum}
              className="mt-1 block text-3xl font-semibold tracking-tight"
              data-testid="report-total"
            />
            {savings > 0 && (
              <div className="mt-1 text-xs text-muted-foreground">
                Economia com antecipação: <Amount cents={savings} direction="in" className="font-medium" />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 divide-x sm:col-span-2">
            <div className="px-5 py-4">
              <div className="text-xs text-muted-foreground">vs {monthName(prev)}</div>
              {prevSum !== 0 || sum !== 0 ? (
                <Delta cents={sum - prevSum} base={prevSum} className="mt-1.5 text-sm font-semibold" />
              ) : (
                <div className="mt-1.5 text-sm text-muted-foreground">—</div>
              )}
              <div className="mt-1 text-xs text-muted-foreground">{formatBRL(prevSum)} no mês anterior</div>
            </div>
            <div className="px-5 py-4">
              <div className="text-xs text-muted-foreground">
                Média{' '}
                {history.length > 0 ? `de ${history.length} ${history.length > 1 ? 'meses' : 'mês'}` : ''}
              </div>
              {average !== null ? (
                <>
                  <Amount cents={average} className="mt-1.5 block text-sm font-semibold" />
                  <div className="mt-1 text-xs text-muted-foreground">
                    {sum > average ? 'acima' : sum < average ? 'abaixo' : 'igual'} da média
                  </div>
                </>
              ) : (
                <div className="mt-1.5 text-sm text-muted-foreground">sem histórico</div>
              )}
            </div>
          </div>
        </div>
        <p className="border-t px-5 py-2.5 text-xs text-muted-foreground">
          {view === 'mensal'
            ? 'Mensal: o que sai da conta no mês — despesas da conta, faturas que vencem no mês e antecipações.'
            : 'Bruto: o que foi comprado no mês (cartão pela data da compra), menos estornos.'}
        </p>
      </Card>

      <div className="space-y-5">
        <Card className="min-w-0 gap-4">
          <CardHeader>
            <CardTitle>Por categoria</CardTitle>
            <CardDescription>
              {prevSum > 0 ? `Setas: diferença para ${monthName(prev)}.` : 'Onde foi o dinheiro no mês.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nenhum gasto neste mês.</p>
            ) : (
              <div className="flex flex-col gap-6 md:grid md:grid-cols-[13rem_1fr] md:items-start md:gap-10">
                {slices.length > 0 && (
                  <div className="md:sticky md:top-20">
                    <CategoryDonut
                      slices={slices}
                      totalCents={slices.reduce((s, x) => s + x.cents, 0)}
                      centerLabel={view === 'mensal' ? 'Saiu no mês' : 'Comprado no mês'}
                      legend={false}
                    />
                  </div>
                )}
                <ul className="space-y-4" aria-label="Gasto por categoria">
                  {rows.map((r, i) => (
                    <li key={r.key} className="space-y-1.5">
                      <div className="flex items-center gap-2 text-sm">
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ background: r.cents > 0 ? sliceColor(i) : 'var(--muted-foreground)' }}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                        <Amount cents={r.cents} className="text-right font-semibold" />
                      </div>
                      <div className="flex items-center gap-3 pl-[18px]">
                        <div className="h-1.5 flex-1 rounded-full bg-muted" aria-hidden>
                          <div
                            className="h-1.5 rounded-full"
                            style={{
                              width: `${Math.max(0, (r.cents / max) * 100)}%`,
                              background: sliceColor(i),
                            }}
                          />
                        </div>
                        <span className="w-9 text-right text-xs text-muted-foreground tabular-nums">
                          {sum > 0 ? `${pct(r.cents, sum)}%` : ''}
                        </span>
                        {prevSum > 0 && (
                          <span className="w-28 text-right text-xs">
                            {r.prevCents === 0 ? (
                              <span className="text-muted-foreground">novo</span>
                            ) : (
                              <Delta cents={r.cents - r.prevCents} base={0} />
                            )}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0 gap-4">
          <CardHeader>
            <CardTitle>Evolução · 12 meses</CardTitle>
            <CardDescription>
              Mensal e Bruto com os mesmos filtros, até {formatMonthLabel(month)}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EvolutionChart data={evolution} active={view === 'mensal' ? 'monthlyCents' : 'grossCents'} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
