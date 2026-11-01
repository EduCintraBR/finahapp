import Link from 'next/link';
import { auth } from '@/auth';
import { CategoryDonut, MonthlyBars, type MonthBar } from '@/components/dashboard/charts';
import { BenefitRow, CardStrip, CardTile, LoanRow, Panel } from '@/components/dashboard/home-panels';
import { BalanceHero } from '@/components/dashboard/overview';
import { buildSlices } from '@/components/dashboard/slices';
import { EntryList } from '@/components/entries/entry-list';
import { PendingList } from '@/components/entries/pending-list';
import { monthSuffix } from '@/components/layout/month-link';
import { PageHeader } from '@/components/layout/page-header';
import { Amount } from '@/components/money/amount';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardDescription, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { getPrimaryAccount } from '@/db/queries/accounts';
import { getAccountBalance } from '@/db/queries/balance';
import { benefitCreditsTotal, listBenefitCards, payableWallets } from '@/db/queries/benefits';
import { listLoans } from '@/db/queries/loans';
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
import { formatBRL } from '@/domain/money';
import { resolveMonth } from '@/lib/month';
import { ensureOccurrences } from '@/server/ensure-occurrences';

/**
 * U3: no celular, a 1ª tela (sem rolar) traz o saudação, o saldo com a previsão do fim do mês, Entrou/Saiu,
 * A receber/A pagar e o começo dos pendentes; gastos, cartões, benefícios, empréstimos e o extrato vêm na rolagem.
 * No desktop viram duas colunas: o mês à esquerda e os compromissos numa coluna lateral de largura fixa (os nomes
 * não são cortados). As colunas usam `contents` no celular para que a ordem (`order-*`) valha entre as duas.
 */
const MOBILE_ORDER = {
  hero: 'order-1',
  pending: 'order-2',
  spend: 'order-3',
  cards: 'order-4',
  benefits: 'order-5',
  loans: 'order-6',
  recent: 'order-7',
} as const;

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
    loans,
  ] = await Promise.all([
    getAccountBalance(db, account.id, hoje),
    cashSummary(db, month, hoje),
    grossSpend(db, month, end, 'category'),
    monthlySpend(db, month, end, 'category'),
    monthlySpend(db, sixMonthsAgo, end, 'month'),
    anticipationSavings(db, month, end),
    listPending(db, month, hoje),
    listCardMonthViews(db, hoje, month),
    listEntries(db, { month }),
    listCategories(db, { includeArchived: true }),
    listBenefitCards(db, hoje, month),
    benefitCreditsTotal(db, month, end),
    listLoans(db, hoje),
  ]);
  if (!summary) return null;

  // gastos por categoria (compras do mês): as 5 maiores e o resto em "Outras"
  const nameOf = (key: string) =>
    key === ADJUSTMENTS_KEY
      ? 'Ajustes de fatura'
      : key === NO_CATEGORY_KEY
        ? 'Sem categoria'
        : (categories.find((c) => c.id === key)?.name ?? 'Outra');
  const slices = buildSlices(
    [...gross.entries()]
      .map(([key, cents]) => ({ key, name: nameOf(key), cents }))
      .sort((a, b) => b.cents - a.cents),
  );

  const bars: MonthBar[] = Array.from({ length: 6 }, (_, i) => {
    const m = addMonths(sixMonthsAgo, i);
    return { month: m, label: formatMonthShort(m), cents: monthlyByMonth.get(m) ?? 0, selected: m === month };
  });
  const withData = bars.filter((b) => b.cents > 0);
  const average =
    withData.length > 1 ? Math.round(withData.reduce((s, b) => s + b.cents, 0) / withData.length) : null;

  const recent = entries.filter((e) => e.status === 'POSTED').slice(0, 6);
  const suffix = monthSuffix(month, current);
  const monthLabel = formatMonthLabel(month);
  const mes = toMonthParam(month);
  const activeLoans = loans.filter((l) => !l.summary.settled);

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Olá, ${firstName}`}
        description={<span className="block first-letter:uppercase">{monthLabel}</span>}
      />

      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_24rem]">
        {/* coluna principal: o mês */}
        <div className="contents lg:flex lg:flex-col lg:gap-5">
          <div className={`${MOBILE_ORDER.hero} lg:order-none`}>
            <BalanceHero
              month={month}
              isCurrentMonth={isCurrentMonth}
              accountName={account.name}
              balanceCents={balance}
              summary={summary}
              suffix={suffix}
            />
          </div>

          <Card className={`${MOBILE_ORDER.spend} min-w-0 gap-0 py-0 lg:order-none`}>
            <div className="flex items-start justify-between gap-3 px-5 pt-4 sm:px-6">
              <h2 className="font-semibold">Gastos do mês</h2>
              <Button asChild variant="ghost" size="sm" className="-mt-1 -mr-2 text-primary">
                <Link href={`/relatorios?mes=${mes}`}>Detalhes</Link>
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3 px-5 pt-3 sm:px-6">
              <div className="rounded-lg bg-muted/50 px-3 py-2.5">
                <div className="text-xs text-muted-foreground">Mensal · saiu da conta</div>
                <Amount
                  cents={total(monthlyTotals)}
                  className="text-lg font-semibold"
                  data-testid="spend-monthly"
                />
              </div>
              <div className="rounded-lg bg-muted/50 px-3 py-2.5">
                <div className="text-xs text-muted-foreground">Bruto · comprado</div>
                <Amount cents={total(gross)} className="text-lg font-semibold" data-testid="spend-gross" />
              </div>
            </div>
            {savings > 0 && (
              <p className="px-5 pt-2 text-xs text-muted-foreground sm:px-6">
                Economia com antecipação: <Amount cents={savings} direction="in" className="font-medium" />
              </p>
            )}
            <div className="px-5 py-5 sm:px-6">
              <CategoryDonut slices={slices} totalCents={total(gross)} />
            </div>
            <div className="border-t px-5 pt-4 pb-3 sm:px-6">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium">Saídas por mês</h3>
                {average !== null && (
                  <span className="text-xs text-muted-foreground">média {formatBRL(average)}</span>
                )}
              </div>
              <MonthlyBars bars={bars} />
            </div>
          </Card>

          <Panel
            title="Últimos lançamentos"
            action={{ href: `/lancamentos?mes=${mes}`, label: 'Ver todos' }}
            className={`${MOBILE_ORDER.recent} lg:order-none`}
          >
            <EntryList entries={recent} today={hoje} returnTo={`/${suffix}`} flat />
          </Panel>
        </div>

        {/* coluna lateral: compromissos */}
        <div className="contents lg:flex lg:flex-col lg:gap-5">
          <div className={`${MOBILE_ORDER.pending} lg:order-none`}>
            <Panel
              region
              title="Pendentes"
              description={pending.length > 0 ? 'Até o fim do mês, com os atrasados' : undefined}
            >
              <div className="border-t">
                <PendingList
                  entries={pending}
                  today={hoje}
                  wallets={payableWallets(benefitCards)}
                  limit={3}
                />
              </div>
            </Panel>
          </div>

          <div className={`${MOBILE_ORDER.cards} lg:order-none`}>
            <CardStrip
              title="Cartões"
              action={{ href: `/cartoes${suffix}`, label: cards.length > 0 ? 'Ver todos' : 'Cadastrar' }}
            >
              {cards.length > 0 ? (
                cards.map((c) => <CardTile key={c.card.id} s={c} href={`/cartoes/${c.card.id}${suffix}`} />)
              ) : (
                <p className="w-full rounded-xl border bg-card px-5 py-6 text-center text-sm text-muted-foreground lg:rounded-none lg:border-0">
                  Nenhum cartão cadastrado ainda.
                </p>
              )}
            </CardStrip>
          </div>

          {benefitCards.length > 0 && (
            <div className={`${MOBILE_ORDER.benefits} lg:order-none`}>
              <Panel
                region
                title="Benefícios"
                description={
                  benefitCredited > 0 ? (
                    <>
                      Creditado em {monthLabel}: <Amount cents={benefitCredited} direction="in" />
                    </>
                  ) : undefined
                }
                action={{ href: `/cartoes${suffix}#beneficios`, label: 'Ver todos' }}
              >
                <div className="divide-y border-t">
                  {benefitCards.map((c) => (
                    <BenefitRow key={c.id} c={c} href={`/beneficios/${c.id}${suffix}`} />
                  ))}
                </div>
              </Panel>
            </div>
          )}

          {activeLoans.length > 0 && (
            <div className={`${MOBILE_ORDER.loans} lg:order-none`}>
              <Panel region title="Empréstimos" action={{ href: '/emprestimos', label: 'Ver todos' }}>
                <div className="divide-y border-t">
                  {activeLoans.map((l) => (
                    <LoanRow key={l.id} l={l} href={`/emprestimos/${l.id}`} />
                  ))}
                </div>
              </Panel>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
