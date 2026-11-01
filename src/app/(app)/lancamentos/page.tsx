import type { Metadata } from 'next';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { auth } from '@/auth';
import { MonthKpis } from '@/components/dashboard/overview';
import { EntryList } from '@/components/entries/entry-list';
import { monthSuffix } from '@/components/layout/month-link';
import { PageHeader } from '@/components/layout/page-header';
import { Amount } from '@/components/money/amount';
import { Card } from '@/components/ui/card';
import { FilterChip } from '@/components/ui/filter-chip';
import { Input } from '@/components/ui/input';
import { getDb } from '@/db/client';
import { listEntries, type EntryFilters } from '@/db/queries/entries';
import { listCategories, listUsers } from '@/db/queries/lookups';
import { cashSummary } from '@/db/queries/reports';
import { monthStart, today, toMonthParam } from '@/domain/dates';
import { ACCOUNT_PAYMENT_METHODS, PAYMENT_METHOD_LABEL } from '@/lib/labels';
import { resolveMonth } from '@/lib/month';
import { ensureOccurrences } from '@/server/ensure-occurrences';

export const metadata: Metadata = { title: 'Lançamentos' };

const str = (v: string | string[] | undefined) => (typeof v === 'string' && v !== '' ? v : undefined);
const oneOf = <T extends string>(v: string | undefined, allowed: readonly T[]) =>
  allowed.includes(v as T) ? (v as T) : undefined;
const uuidOrUndefined = (v: string | undefined) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);

export default async function EntriesPage({ searchParams }: PageProps<'/lancamentos'>) {
  await ensureOccurrences();
  const sp = await searchParams;
  const month = await resolveMonth(searchParams);
  const db = getDb();
  const hoje = today();

  const filters: EntryFilters = {
    month,
    kind: oneOf(str(sp.tipo), ['INCOME', 'EXPENSE'] as const),
    status: oneOf(str(sp.status), ['POSTED', 'PENDING'] as const),
    categoryId: uuidOrUndefined(str(sp.categoria)),
    paymentMethod: oneOf(str(sp.meio), ACCOUNT_PAYMENT_METHODS),
    createdBy: uuidOrUndefined(str(sp.lancou)),
    beneficiary: str(sp.dequem) === 'casal' ? 'casal' : uuidOrUndefined(str(sp.dequem)),
    q: str(sp.q)?.slice(0, 100),
  };
  const [session, entries, categories, users, summary] = await Promise.all([
    auth(),
    // D72: os atrasados de antes que ainda pedem baixa entram no mês (a lista bate com o A pagar / A receber)
    listEntries(db, { ...filters, overdueAsOf: filters.status === 'POSTED' ? undefined : hoje }),
    listCategories(db, { includeArchived: true }),
    listUsers(db),
    cashSummary(db, month, hoje),
  ]);

  const current = monthStart(hoje);
  const suffix = monthSuffix(month, current);
  // os filtros vivem na URL: cada opção é um link que troca só o seu parâmetro
  const params = Object.fromEntries(
    Object.entries(sp).flatMap(([k, v]) => (typeof v === 'string' && v !== '' ? [[k, v]] : [])),
  );
  const hrefWith = (key: string, value?: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    return qs ? `/lancamentos?${qs}` : '/lancamentos';
  };
  const chip = (key: string, current: string | undefined, all: string, choices: [string, string][]) => ({
    value: choices.find(([v]) => v === current)?.[1],
    options: [
      { label: all, href: hrefWith(key), active: current === undefined },
      ...choices.map(([v, label]) => ({ label, href: hrefWith(key, v), active: v === current })),
    ],
  });
  const chips = [
    {
      label: 'Tipo',
      ...chip('tipo', filters.kind, 'Receitas e despesas', [
        ['EXPENSE', 'Despesas'],
        ['INCOME', 'Receitas'],
      ]),
    },
    {
      label: 'Situação',
      ...chip('status', filters.status, 'Pagos e pendentes', [
        ['POSTED', 'Pagos'],
        ['PENDING', 'Pendentes'],
      ]),
    },
    {
      label: 'Categoria',
      ...chip(
        'categoria',
        filters.categoryId,
        'Todas as categorias',
        // mesmo nome em despesa e receita (ex.: Empréstimo): a de receita ganha o sufixo
        categories.map((c): [string, string] => [
          c.id,
          c.kind === 'INCOME' && categories.some((o) => o.kind === 'EXPENSE' && o.name === c.name)
            ? `${c.name} (receita)`
            : c.name,
        ]),
      ),
    },
    {
      label: 'Meio',
      ...chip(
        'meio',
        filters.paymentMethod,
        'Todos os meios',
        ACCOUNT_PAYMENT_METHODS.map((m): [string, string] => [m, PAYMENT_METHOD_LABEL[m] ?? m]),
      ),
    },
    {
      label: 'De quem é',
      ...chip('dequem', filters.beneficiary, 'De qualquer um', [
        ['casal', 'Do casal'],
        ...users.map((u): [string, string] => [u.id, `De ${u.name}`]),
      ]),
    },
    {
      label: 'Quem lançou',
      ...chip(
        'lancou',
        filters.createdBy,
        'Qualquer um',
        users.map((u) => [u.id, `Lançado por ${u.name}`]),
      ),
    },
  ];

  const activeFilters = Object.entries(filters).filter(([k, v]) => k !== 'month' && v !== undefined).length;
  const mesParam = toMonthParam(month);
  const returnTo = `/lancamentos?${new URLSearchParams(params)}`;

  return (
    <div className="space-y-4">
      {/* Fixos, Empréstimos, Importar e Conferir ficam no "Mais" (celular) e na sidebar (desktop) */}
      <PageHeader title="Lançamentos" />

      {summary && (
        <Card className="gap-0 py-0" aria-label="Resumo do mês">
          <MonthKpis summary={summary} suffix={suffix} />
          <div
            className="flex items-baseline justify-between gap-3 border-t px-4 py-3 text-sm sm:px-6"
            data-testid="kpi-saidas"
          >
            <span>
              <span className="font-medium">Saídas do mês</span>
              <span className="block text-xs text-muted-foreground">já saiu + a pagar, com atrasados</span>
            </span>
            <Amount cents={summary.outTotalCents} className="text-lg font-semibold whitespace-nowrap" />
          </div>
        </Card>
      )}

      <div className="space-y-2">
        <form method="get" role="search" className="relative">
          {Object.entries(params)
            .filter(([k]) => k !== 'q')
            .map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            name="q"
            aria-label="Buscar descrição"
            placeholder="Buscar descrição"
            defaultValue={filters.q}
            className="pl-9"
          />
        </form>
        <div
          className="-mx-4 flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 pb-1"
          aria-label="Filtros"
        >
          {chips.map((c) => (
            <FilterChip key={c.label} label={c.label} value={c.value} options={c.options} />
          ))}
          {activeFilters > 0 && (
            <Link
              href={`/lancamentos?mes=${mesParam}`}
              className="inline-flex h-8 shrink-0 items-center px-2 text-sm font-medium whitespace-nowrap text-primary"
            >
              Limpar filtros
            </Link>
          )}
        </div>
        {activeFilters > 0 && (
          <p className="text-xs text-muted-foreground">
            O resumo acima é do mês inteiro; a lista segue os filtros.
          </p>
        )}
      </div>

      <EntryList
        entries={entries}
        today={hoje}
        returnTo={returnTo}
        month={month}
        viewerId={session?.user?.id}
      />
    </div>
  );
}
