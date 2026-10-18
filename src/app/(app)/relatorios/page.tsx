import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarRange, SlidersHorizontal } from 'lucide-react';
import { NativeSelect } from '@/components/forms/fields';
import { Amount } from '@/components/money/amount';
import { EvolutionChart, type EvolutionPoint } from '@/components/reports/evolution-chart';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

type View = 'mensal' | 'bruto';

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
      meio === 'CREDIT_CARD' || ACCOUNT_PAYMENT_METHODS.includes(meio as never) ? meio : undefined,
  };
  const activeFilters = Object.values(filters).filter(Boolean).length;
  const db = getDb();
  const end = monthEnd(month);
  const first = addMonths(month, -11);
  const spend = view === 'bruto' ? grossSpend : monthlySpend;

  const [byCategory, savings, grossByMonth, monthlyByMonth, categories, users, cards] = await Promise.all([
    spend(db, month, end, 'category', filters),
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
    .map(([k, v]) => ({ key: k, name: nameOf(k), cents: v }))
    .sort((a, b) => b.cents - a.cents);
  const sum = total(byCategory);
  const max = Math.max(1, ...rows.map((r) => r.cents));

  const evolution: EvolutionPoint[] = Array.from({ length: 12 }, (_, i) => {
    const m = addMonths(first, i);
    return {
      month: m,
      label: shortMonth(m),
      monthlyCents: monthlyByMonth.get(m) ?? 0,
      grossCents: grossByMonth.get(m) ?? 0,
    };
  });

  const params = (over: Record<string, string>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === 'string' && v) q.set(k, v);
    for (const [k, v] of Object.entries(over)) q.set(k, v);
    return `/relatorios?${q}`;
  };
  const mesParam = toMonthParam(month);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Relatórios</h1>
        <Button asChild variant="ghost" size="sm">
          <Link href="/relatorios/projecao">
            <CalendarRange aria-hidden /> Projeção
          </Link>
        </Button>
      </div>

      <div
        role="tablist"
        aria-label="Visão"
        className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm"
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
              'rounded-md px-3 py-1.5 text-center font-medium',
              view === v ? 'bg-background shadow-sm' : 'text-muted-foreground',
            )}
          >
            {label}
          </Link>
        ))}
      </div>

      <details className="group rounded-xl border bg-card" open={activeFilters > 0}>
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium">
          <SlidersHorizontal className="size-4" aria-hidden /> Filtros
          {activeFilters > 0 && <span className="text-primary">({activeFilters})</span>}
        </summary>
        <form method="get" className="grid grid-cols-2 gap-3 px-4 pb-4 sm:grid-cols-4">
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
          <NativeSelect name="meio" defaultValue={filters.paymentMethod ?? ''} aria-label="Meio de pagamento">
            <option value="">Todos os meios</option>
            <option value="CREDIT_CARD">{PAYMENT_METHOD_LABEL.CREDIT_CARD}</option>
            {ACCOUNT_PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABEL[m]}
              </option>
            ))}
          </NativeSelect>
          <div className="col-span-2 flex gap-2 sm:col-span-4">
            <Button type="submit" size="sm">
              Filtrar
            </Button>
            {activeFilters > 0 && (
              <Button asChild variant="ghost" size="sm">
                <Link href={`/relatorios?mes=${mesParam}&visao=${view}`}>Limpar</Link>
              </Button>
            )}
          </div>
        </form>
      </details>

      <Card className="gap-3">
        <CardHeader>
          <CardDescription className="first-letter:uppercase">
            {view === 'mensal' ? 'Gasto Mensal' : 'Gasto Bruto'} · {formatMonthLabel(month)}
          </CardDescription>
          <CardTitle className="text-2xl">
            <Amount cents={sum} data-testid="report-total" />
          </CardTitle>
          <CardDescription>
            {view === 'mensal'
              ? 'O que sai da conta no mês: despesas da conta, faturas que vencem no mês e antecipações.'
              : 'O que foi comprado no mês (cartão pela data da compra), menos estornos.'}
          </CardDescription>
          {savings > 0 && (
            <CardDescription>
              Economia com antecipação: <Amount cents={savings} direction="in" className="font-medium" />
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhum gasto neste mês.</p>
          ) : (
            <ul className="space-y-3" aria-label="Gasto por categoria">
              {rows.map((r) => (
                <li key={r.key} className="space-y-1">
                  <div className="flex items-baseline gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {sum > 0 ? `${Math.round((r.cents / sum) * 100)}%` : ''}
                    </span>
                    <Amount cents={r.cents} className="w-28 text-right font-medium" />
                  </div>
                  <div className="h-2 rounded-full bg-muted" aria-hidden>
                    <div
                      className="h-2 rounded-full bg-series-1"
                      style={{ width: `${Math.max(0, (r.cents / max) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="gap-3">
        <CardHeader>
          <CardTitle>Evolução · 12 meses</CardTitle>
          <CardDescription>
            Mensal e Bruto com os mesmos filtros, até {formatMonthLabel(month)}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EvolutionChart data={evolution} />
        </CardContent>
      </Card>
    </div>
  );
}
