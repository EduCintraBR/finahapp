import Link from 'next/link';
import { auth } from '@/auth';
import { BenefitSummaryCard } from '@/components/benefits/benefit-summary';
import { CardSummaryCard } from '@/components/cards/card-summary';
import { CategoryDonut, MonthlyBars, type MonthBar, type Slice } from '@/components/dashboard/charts';
import { BalanceHero, KpiGrid } from '@/components/dashboard/overview';
import { EntryList } from '@/components/entries/entry-list';
import { PendingList } from '@/components/entries/pending-list';
import { monthSuffix } from '@/components/layout/month-link';
import { Amount } from '@/components/money/amount';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { getPrimaryAccount } from '@/db/queries/accounts';
import { getAccountBalance } from '@/db/queries/balance';
import { benefitCreditsTotal, listBenefitCards } from '@/db/queries/benefits';
import { listCardMonthViews } from '@/db/queries/cards';
import { listEntries, listPending } from '@/db/queries/entries';
import { listCategories } from '@/db/queries/lookups';
import {
  ADJUSTMENTS_KEY,
  anticipationSavings,
  cashSummary,
  grossSpend,
  monthlySpend,
  NO_CATEGORY_KEY,
  total,
} from '@/db/queries/reports';
import {
  addMonths,
  formatMonthLabel,
  formatMonthShort,
  monthEnd,
  monthStart,
  today,
  toMonthParam,
} from '@/domain/dates';
import { resolveMonth } from '@/lib/month';
import { ensureOccurrences } from '@/server/ensure-occurrences';

/** Cores das fatias: a paleta validada (slots 1 a 5) e um neutro para "Outras". */
const SLICE_COLORS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
];
const TOP_SLICES = 5;

export default async function HomePage({ searchParams }: PageProps<'/'>) {
  await ensureOccurrences();
  const db = getDb();
  const hoje = today();
  const [session, month, account] = await Promise.all([
    auth(),
    resolveMonth(searchParams),
    getPrimaryAccount(db),
  ]);
  const firstName = session?.user?.name?.split(' ')[0] ?? '';

  if (!account) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Conta principal não configurada</CardTitle>
          <CardDescription>Rode o seed (pnpm db:seed) com o saldo inicial no .env.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const current = monthStart(hoje);
  const isCurrentMonth = month === current;
  const end = monthEnd(month);
  const sixMonthsAgo = addMonths(month, -5);
  const [
    balance,
    summary,
    gross,
    monthlyTotals,
    monthlyByMonth,
    savings,
    pending,
    cards,
    entries,
    categories,
    benefitCards,
    benefitCredited,
  ] = await Promise.all([
    getAccountBalance(db, account.id),
    cashSummary(db, month, hoje),
    grossSpend(db, month, end, 'category'),
    monthlySpend(db, month, end, 'category'),
    monthlySpend(db, sixMonthsAgo, end, 'month'),
    anticipationSavings(db, month, end),
    listPending(db, month),
    listCardMonthViews(db, hoje, month),
    listEntries(db, { month }),
    listCategories(db, { includeArchived: true }),
    listBenefitCards(db, hoje, month),
    benefitCreditsTotal(db, month, end),
  ]);
  if (!summary) return null;

  // gastos por categoria (compras do mês): as 5 maiores e o resto em "Outras"
  const nameOf = (key: string) =>
    key === ADJUSTMENTS_KEY
      ? 'Ajustes de fatura'
      : key === NO_CATEGORY_KEY
        ? 'Sem categoria'
        : (categories.find((c) => c.id === key)?.name ?? 'Outra');
  const ranked = [...gross.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const slices: Slice[] = ranked.slice(0, TOP_SLICES).map(([key, cents], i) => ({
    key,
    name: nameOf(key),
    cents,
    color: SLICE_COLORS[i]!,
  }));
  const rest = ranked.slice(TOP_SLICES).reduce((sum, [, v]) => sum + v, 0);
  if (rest > 0) slices.push({ key: 'outras', name: 'Outras', cents: rest, color: 'var(--series-other)' });

  const bars: MonthBar[] = Array.from({ length: 6 }, (_, i) => {
    const m = addMonths(sixMonthsAgo, i);
    return { month: m, label: formatMonthShort(m), cents: monthlyByMonth.get(m) ?? 0, selected: m === month };
  });

  const recent = entries.filter((e) => e.status === 'POSTED').slice(0, 5);
  const suffix = monthSuffix(month, current);
  const monthLabel = formatMonthLabel(month);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Olá, {firstName}</h1>
        <p className="text-sm text-muted-foreground first-letter:uppercase">{monthLabel}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <BalanceHero
            month={month}
            isCurrentMonth={isCurrentMonth}
            accountName={account.name}
            startDate={account.openingBalanceDate}
            balanceCents={balance}
            summary={summary}
          />
        </div>
        <KpiGrid summary={summary} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="min-w-0 lg:col-span-3">
          <CardHeader>
            <CardTitle>Gastos do mês</CardTitle>
            <CardDescription>
              Mensal: o que sai da conta no mês. Bruto: o que foi comprado no mês.
            </CardDescription>
            <CardAction>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/relatorios?mes=${toMonthParam(month)}`}>Detalhes</Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-muted-foreground">Mensal</div>
                <Amount
                  cents={total(monthlyTotals)}
                  className="text-lg font-semibold"
                  data-testid="spend-monthly"
                />
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Bruto</div>
                <Amount cents={total(gross)} className="text-lg font-semibold" data-testid="spend-gross" />
              </div>
              {savings > 0 && (
                <p className="col-span-2 text-xs text-muted-foreground">
                  Economia com antecipação: <Amount cents={savings} direction="in" className="font-medium" />
                </p>
              )}
            </div>
            <CategoryDonut slices={slices} totalCents={total(gross)} />
          </CardContent>
        </Card>

        <Card className="min-w-0 lg:col-span-2">
          <CardHeader>
            <CardTitle>Saídas por mês</CardTitle>
            <CardDescription>Últimos 6 meses (o que saiu da conta)</CardDescription>
          </CardHeader>
          <CardContent>
            <MonthlyBars bars={bars} />
          </CardContent>
        </Card>
      </div>

      <section aria-label="Cartões" className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-medium text-muted-foreground">Cartões</h2>
          <Button asChild variant="ghost" size="sm">
            <Link href={`/cartoes${suffix}`}>{cards.length > 0 ? 'Ver todos' : 'Cadastrar'}</Link>
          </Button>
        </div>
        {cards.length > 0 ? (
          <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 lg:grid-cols-3">
            {cards.map((c) => (
              <div key={c.card.id} className="w-[85%] shrink-0 snap-start md:w-auto">
                <CardSummaryCard s={c} href={`/cartoes/${c.card.id}${suffix}`} />
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            Nenhum cartão cadastrado ainda.
          </div>
        )}
      </section>

      {benefitCards.length > 0 && (
        <section aria-label="Cartões de benefícios" className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-medium text-muted-foreground">
              Benefícios
              {benefitCredited > 0 && (
                <span className="ml-2 font-normal">
                  · creditado em {monthLabel}: <Amount cents={benefitCredited} direction="in" />
                </span>
              )}
            </h2>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/cartoes${suffix}`}>Ver todos</Link>
            </Button>
          </div>
          <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 lg:grid-cols-3">
            {benefitCards.map((c) => (
              <div key={c.id} className="w-[85%] shrink-0 snap-start md:w-auto">
                <BenefitSummaryCard c={c} href={`/beneficios/${c.id}${suffix}`} />
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Card className="min-w-0 gap-0 pb-0">
          <CardHeader className="pb-3">
            <CardTitle>Pendentes</CardTitle>
            <CardDescription>Até o fim de {monthLabel}, incluindo atrasados</CardDescription>
            <CardAction>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/lancamentos?status=PENDING&mes=${toMonthParam(month)}`}>Ver todos</Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="border-t px-0">
            <PendingList entries={pending} today={hoje} />
          </CardContent>
        </Card>

        <Card className="min-w-0 gap-0 pb-0">
          <CardHeader className="pb-3">
            <CardTitle>Últimos lançamentos</CardTitle>
            <CardAction>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/lancamentos?mes=${toMonthParam(month)}`}>Ver todos</Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="border-t px-0">
            <EntryList entries={recent} today={hoje} returnTo={`/${suffix}`} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
