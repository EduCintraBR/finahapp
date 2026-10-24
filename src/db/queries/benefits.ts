/**
 * Cartão de benefícios (D65): saldo por carteira (derivado, nunca armazenado) e histórico.
 *   saldo da carteira = Σ INCOME POSTED − Σ EXPENSE POSTED da carteira (não deletadas)
 * SQL com agregação agrupada (nada de subconsulta correlacionada: ver CLAUDE.md).
 */
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { creditDateFor, type CreditRule } from '@/domain/benefits/credits';
import { addMonths, compareDates, monthEnd, monthStart, type ISODate } from '@/domain/dates';
import { formatBRL, type Cents } from '@/domain/money';
import { centsFromDb } from '@/server/context';
import type { AnyDB } from '../client';
import { benefitCards, benefitWallets, categories, transactions, users } from '../schema';

export type BenefitWalletView = {
  id: string;
  name: string;
  monthlyCreditCents: Cents;
  balanceCents: Cents;
  /** Σ créditos automáticos do mês escolhido */
  creditedInMonthCents: Cents;
  /** Σ gastos do mês escolhido */
  spentInMonthCents: Cents;
};

export type BenefitCardView = {
  id: string;
  name: string;
  issuer: string | null;
  last4: string | null;
  creditRule: CreditRule;
  creditDay: number | null;
  startMonth: ISODate;
  endMonth: ISODate | null;
  /** encerrado: já passou o último mês com crédito */
  ended: boolean;
  /** data do próximo crédito automático, ou null se encerrado */
  nextCreditDate: ISODate | null;
  wallets: BenefitWalletView[];
  totalBalanceCents: Cents;
};

/** Cartões com o saldo de cada carteira e o movimento do mês. Encerrados vêm por último. */
export async function listBenefitCards(
  db: AnyDB,
  today: ISODate,
  month: ISODate,
): Promise<BenefitCardView[]> {
  const from = monthStart(month);
  const to = monthEnd(month);
  const [cards, wallets, sums] = await Promise.all([
    db.select().from(benefitCards).orderBy(asc(benefitCards.createdAt)),
    db.select().from(benefitWallets).orderBy(asc(benefitWallets.createdAt)),
    db
      .select({
        walletId: transactions.benefitWalletId,
        balance: sql<string>`coalesce(sum(case when ${transactions.kind} = 'INCOME' then ${transactions.amountCents} else -${transactions.amountCents} end), 0)`,
        credited: sql<string>`coalesce(sum(case when ${transactions.kind} = 'INCOME' and ${transactions.benefitCreditMonth} is not null and ${transactions.postedDate} between ${from} and ${to} then ${transactions.amountCents} else 0 end), 0)`,
        spent: sql<string>`coalesce(sum(case when ${transactions.kind} = 'EXPENSE' and ${transactions.postedDate} between ${from} and ${to} then ${transactions.amountCents} else 0 end), 0)`,
      })
      .from(transactions)
      .where(
        and(
          sql`${transactions.benefitWalletId} is not null`,
          eq(transactions.status, 'POSTED'),
          isNull(transactions.deletedAt),
        ),
      )
      .groupBy(transactions.benefitWalletId),
  ]);
  const views = cards.map((c): BenefitCardView => {
    const ws = wallets
      .filter((w) => w.benefitCardId === c.id)
      .map((w): BenefitWalletView => {
        const s = sums.find((x) => x.walletId === w.id);
        return {
          id: w.id,
          name: w.name,
          monthlyCreditCents: w.monthlyCreditCents,
          balanceCents: centsFromDb(s?.balance),
          creditedInMonthCents: centsFromDb(s?.credited),
          spentInMonthCents: centsFromDb(s?.spent),
        };
      });
    const ended = c.endMonth !== null && compareDates(c.endMonth, monthStart(today)) < 0;
    return {
      id: c.id,
      name: c.name,
      issuer: c.issuer,
      last4: c.last4,
      creditRule: c.creditRule as CreditRule,
      creditDay: c.creditDay,
      startMonth: c.startMonth,
      endMonth: c.endMonth,
      ended,
      nextCreditDate: ended ? null : nextCreditDate(c, today),
      wallets: ws,
      totalBalanceCents: ws.reduce((s, w) => s + w.balanceCents, 0),
    };
  });
  return [...views.filter((v) => !v.ended), ...views.filter((v) => v.ended)];
}

function nextCreditDate(
  c: { creditRule: string; creditDay: number | null; startMonth: ISODate; endMonth: ISODate | null },
  today: ISODate,
): ISODate | null {
  const rule = { rule: c.creditRule as CreditRule, day: c.creditDay };
  let m = compareDates(c.startMonth, monthStart(today)) > 0 ? c.startMonth : monthStart(today);
  for (let i = 0; i < 3; i++, m = addMonths(m, 1)) {
    if (c.endMonth && compareDates(m, c.endMonth) > 0) return null;
    const d = creditDateFor(rule, m);
    if (compareDates(d, today) > 0) return d;
  }
  return null;
}

export type BenefitMovement = {
  id: string;
  walletId: string;
  walletName: string;
  kind: 'INCOME' | 'EXPENSE';
  description: string;
  amountCents: Cents;
  date: ISODate;
  categoryName: string | null;
  createdByName: string;
  /** crédito automático / saldo inicial / gasto */
  type: 'CREDIT' | 'OPENING' | 'SPEND';
};

/** Histórico de uma carteira ou do cartão todo (mais recente primeiro). */
export async function listBenefitMovements(
  db: AnyDB,
  cardId: string,
  opts: { limit?: number } = {},
): Promise<BenefitMovement[]> {
  const rows = await db
    .select({
      id: transactions.id,
      walletId: benefitWallets.id,
      walletName: benefitWallets.name,
      kind: transactions.kind,
      description: transactions.description,
      amountCents: transactions.amountCents,
      date: transactions.postedDate,
      source: transactions.source,
      creditMonth: transactions.benefitCreditMonth,
      categoryName: categories.name,
      createdByName: users.name,
    })
    .from(transactions)
    .innerJoin(benefitWallets, eq(benefitWallets.id, transactions.benefitWalletId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .innerJoin(users, eq(users.id, transactions.createdByUserId))
    .where(
      and(
        eq(benefitWallets.benefitCardId, cardId),
        eq(transactions.status, 'POSTED'),
        isNull(transactions.deletedAt),
      ),
    )
    .orderBy(desc(transactions.postedDate), desc(transactions.createdAt))
    .limit(opts.limit ?? 100);
  return rows.map((r) => ({
    id: r.id,
    walletId: r.walletId,
    walletName: r.walletName,
    kind: r.kind as 'INCOME' | 'EXPENSE',
    description: r.description,
    amountCents: r.amountCents,
    date: r.date!,
    categoryName: r.categoryName,
    createdByName: r.createdByName,
    type: r.kind === 'EXPENSE' ? 'SPEND' : r.creditMonth ? 'CREDIT' : 'OPENING',
  }));
}

export async function getBenefitCard(
  db: AnyDB,
  id: string,
  today: ISODate,
  month: ISODate,
): Promise<BenefitCardView | null> {
  return (await listBenefitCards(db, today, month)).find((c) => c.id === id) ?? null;
}

/** Σ dos créditos automáticos de benefício no período (a "receita" do cartão, fora do saldo da conta). */
export async function benefitCreditsTotal(db: AnyDB, from: ISODate, to: ISODate): Promise<Cents> {
  const [r] = await db
    .select({ v: sql<string>`coalesce(sum(${transactions.amountCents}), 0)` })
    .from(transactions)
    .where(
      and(
        sql`${transactions.benefitCreditMonth} is not null`,
        eq(transactions.status, 'POSTED'),
        isNull(transactions.deletedAt),
        sql`${transactions.postedDate} between ${from} and ${to}`,
      ),
    );
  return centsFromDb(r?.v);
}

/** Carteiras com saldo, para pagar uma conta com o cartão de benefícios (D69). `label` já traz o saldo. */
export function payableWallets(cards: BenefitCardView[]): { id: string; label: string }[] {
  return cards.flatMap((c) =>
    c.wallets
      .filter((w) => w.balanceCents > 0)
      .map((w) => ({ id: w.id, label: `${c.name} · ${w.name} · saldo ${formatBRL(w.balanceCents)}` })),
  );
}
