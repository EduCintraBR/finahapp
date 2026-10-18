import Link from 'next/link';
import { CardSummaryCard } from '@/components/cards/card-summary';
import { auth } from '@/auth';
import { EntryList } from '@/components/entries/entry-list';
import { PendingList } from '@/components/entries/pending-list';
import { Amount } from '@/components/money/amount';
import { MonthSummaryCard, SpendCard } from '@/components/reports/month-summary';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { getPrimaryAccount } from '@/db/queries/accounts';
import { getAccountBalance } from '@/db/queries/balance';
import { listCardSummaries } from '@/db/queries/cards';
import { listEntries, listPending } from '@/db/queries/entries';
import { anticipationSavings, cashSummary, grossSpend, monthlySpend, total } from '@/db/queries/reports';
import { formatDateBR, formatMonthLabel, monthEnd, today, toMonthParam } from '@/domain/dates';
import { resolveMonth } from '@/lib/month';
import { ensureOccurrences } from '@/server/ensure-occurrences';

export default async function HomePage({ searchParams }: PageProps<'/'>) {
  await ensureOccurrences();
  const db = getDb();
  const [session, month, account] = await Promise.all([
    auth(),
    resolveMonth(searchParams),
    getPrimaryAccount(db),
  ]);
  const firstName = session?.user?.name?.split(' ')[0] ?? '';
  const hoje = today();

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

  const end = monthEnd(month);
  const [balance, pending, cards, summary, monthly, gross, savings, entries] = await Promise.all([
    getAccountBalance(db, account.id),
    listPending(db, month),
    listCardSummaries(db, hoje),
    cashSummary(db, month, hoje),
    monthlySpend(db, month, end, 'category'),
    grossSpend(db, month, end, 'category'),
    anticipationSavings(db, month, end),
    listEntries(db, { month }),
  ]);
  const recent = entries.filter((e) => e.status === 'POSTED').slice(0, 5);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Olá, {firstName}</h1>
        <p className="text-sm text-muted-foreground first-letter:uppercase">{formatMonthLabel(month)}</p>
      </div>

      <Card>
        <CardHeader>
          <CardDescription>Saldo atual · {account.name}</CardDescription>
          <CardTitle className="text-3xl">
            <Amount cents={balance} className={balance < 0 ? 'text-expense' : undefined} />
          </CardTitle>
          <CardDescription>desde {formatDateBR(account.openingBalanceDate)}</CardDescription>
          <CardAction>
            <Button asChild variant="outline" size="sm">
              <Link href="/conta/conferencia">Conferir</Link>
            </Button>
          </CardAction>
        </CardHeader>
      </Card>

      {summary && <MonthSummaryCard s={summary} month={month} />}

      <Card className="gap-0 pb-0">
        <CardHeader className="pb-3">
          <CardTitle>Pendentes</CardTitle>
          <CardDescription>Até o fim de {formatMonthLabel(month)}, incluindo atrasados</CardDescription>
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

      <SpendCard
        monthlyCents={total(monthly)}
        grossCents={total(gross)}
        savingsCents={savings}
        month={month}
      />

      {cards.length > 0 ? (
        <section aria-label="Cartões" className="grid gap-4 sm:grid-cols-2">
          {cards.map((c) => (
            <CardSummaryCard key={c.card.id} s={c} />
          ))}
        </section>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Cartões</CardTitle>
            <CardDescription>Nenhum cartão cadastrado ainda.</CardDescription>
            <CardAction>
              <Button asChild variant="outline" size="sm">
                <Link href="/cartoes/novo">Cadastrar</Link>
              </Button>
            </CardAction>
          </CardHeader>
        </Card>
      )}

      <Card className="gap-0 pb-0">
        <CardHeader className="pb-3">
          <CardTitle>Últimos lançamentos</CardTitle>
          <CardAction>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/lancamentos?mes=${toMonthParam(month)}`}>Ver todos</Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="border-t px-0">
          <EntryList entries={recent} today={hoje} returnTo="/" />
        </CardContent>
      </Card>
    </div>
  );
}
