/**
 * Leituras dos cartões. Limite, comprometido e total de fatura são SEMPRE derivados aqui
 * (fórmulas canônicas), nunca lidos de coluna.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { centsFromDb } from '@/server/context';
import {
  availableLimit,
  invoiceState,
  remainingToPay,
  resolveInvoice,
  type InvoiceState,
} from '@/domain/card/invoices';
import { compareDates, monthStart, type ISODate } from '@/domain/dates';
import type { AnyDB } from '../client';
import {
  anticipationRecords,
  categories,
  creditCards,
  installmentPlans,
  invoiceItems,
  invoices,
  refundRecords,
  transactions,
  users,
} from '../schema';

export type InvoiceSummary = {
  id: string | null;
  referenceMonth: ISODate;
  closingDate: ISODate;
  dueDate: ISODate;
  totalCents: number;
  paidCents: number;
  remainingCents: number;
  state: InvoiceState;
};

const paymentsSum = sql<string>`coalesce(sum(${transactions.amountCents}), 0)`;

/**
 * Totais (Σ itens ACTIVE) e pagamentos de todas as faturas dos cartões dados.
 * Agregações agrupadas e combinadas aqui — sem subconsulta correlacionada (o Drizzle não
 * qualifica a coluna da tabela externa dentro de sql``, e a soma silenciosamente vira zero).
 */
async function invoiceRows(db: AnyDB, cardIds: string[]) {
  if (cardIds.length === 0) return [];
  const [rows, totals, paid] = await Promise.all([
    db
      .select({
        id: invoices.id,
        cardId: invoices.creditCardId,
        referenceMonth: invoices.referenceMonth,
        closingDate: invoices.closingDate,
        dueDate: invoices.dueDate,
      })
      .from(invoices)
      .where(inArray(invoices.creditCardId, cardIds))
      .orderBy(asc(invoices.referenceMonth)),
    db
      .select({ invoiceId: invoiceItems.invoiceId, v: sql<string>`sum(${invoiceItems.amountCents})` })
      .from(invoiceItems)
      .where(and(inArray(invoiceItems.creditCardId, cardIds), eq(invoiceItems.status, 'ACTIVE')))
      .groupBy(invoiceItems.invoiceId),
    db
      .select({ invoiceId: transactions.paidInvoiceId, v: paymentsSum })
      .from(transactions)
      .innerJoin(invoices, eq(invoices.id, transactions.paidInvoiceId))
      .where(
        and(
          inArray(invoices.creditCardId, cardIds),
          eq(transactions.kind, 'INVOICE_PAYMENT'),
          eq(transactions.status, 'POSTED'),
          isNull(transactions.deletedAt),
        ),
      )
      .groupBy(transactions.paidInvoiceId),
  ]);
  const totalOf = new Map(totals.map((t) => [t.invoiceId, centsFromDb(t.v)]));
  const paidOf = new Map(paid.map((p) => [p.invoiceId, centsFromDb(p.v)]));
  return rows.map((r) => ({ ...r, totalCents: totalOf.get(r.id) ?? 0, paidCents: paidOf.get(r.id) ?? 0 }));
}

const summarize = (
  r: {
    id: string | null;
    referenceMonth: ISODate;
    closingDate: ISODate;
    dueDate: ISODate;
    totalCents: number;
    paidCents: number;
  },
  today: ISODate,
): InvoiceSummary => ({
  id: r.id,
  referenceMonth: r.referenceMonth,
  closingDate: r.closingDate,
  dueDate: r.dueDate,
  totalCents: r.totalCents,
  paidCents: r.paidCents,
  remainingCents: remainingToPay(r.totalCents, r.paidCents),
  state: invoiceState({ ...r, today }),
});

export type CardSummary = Awaited<ReturnType<typeof listCardSummaries>>[number];

/** Cartões ativos com limite, comprometido, fatura atual e parcelamentos — para a Home e /cartoes. */
export async function listCardSummaries(db: AnyDB, today: ISODate, opts: { cardId?: string } = {}) {
  const cards = await db
    .select()
    .from(creditCards)
    .where(and(isNull(creditCards.archivedAt), opts.cardId ? eq(creditCards.id, opts.cardId) : undefined))
    .orderBy(asc(creditCards.isAdditional), asc(creditCards.name));
  const ids = cards.map((c) => c.id);
  if (ids.length === 0) return [];

  const [used, paid, plans, invs] = await Promise.all([
    db
      .select({
        cardId: invoiceItems.creditCardId,
        v: sql<string>`coalesce(sum(${invoiceItems.amountCents}), 0)`,
      })
      .from(invoiceItems)
      .where(and(inArray(invoiceItems.creditCardId, ids), eq(invoiceItems.status, 'ACTIVE')))
      .groupBy(invoiceItems.creditCardId),
    db
      .select({ cardId: invoices.creditCardId, v: paymentsSum })
      .from(transactions)
      .innerJoin(invoices, eq(invoices.id, transactions.paidInvoiceId))
      .where(
        and(
          inArray(invoices.creditCardId, ids),
          eq(transactions.kind, 'INVOICE_PAYMENT'),
          eq(transactions.status, 'POSTED'),
          isNull(transactions.deletedAt),
        ),
      )
      .groupBy(invoices.creditCardId),
    db
      .select({
        cardId: installmentPlans.creditCardId,
        active: sql<number>`count(distinct ${installmentPlans.id}) filter (where ${installmentPlans.installmentCount} > 1)::int`,
        lastMonth: sql<string | null>`max(${invoices.referenceMonth})::text`,
      })
      .from(installmentPlans)
      .innerJoin(invoiceItems, eq(invoiceItems.installmentPlanId, installmentPlans.id))
      .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
      .where(
        and(
          inArray(installmentPlans.creditCardId, ids),
          eq(installmentPlans.status, 'ACTIVE'),
          eq(invoiceItems.status, 'ACTIVE'),
          sql`${invoices.closingDate} > ${today}`,
        ),
      )
      .groupBy(installmentPlans.creditCardId),
    invoiceRows(db, ids),
  ]);

  return cards.map((c) => {
    const usedCents = centsFromDb(used.find((u) => u.cardId === c.id)?.v);
    const paidCents = centsFromDb(paid.find((p) => p.cardId === c.id)?.v);
    const mine = invs.filter((i) => i.cardId === c.id);
    const rule = { closingDay: c.closingDay, dueDay: c.dueDay };
    const currentWindow = resolveInvoice(today, mine, rule);
    const current = mine.find((i) => i.referenceMonth === currentWindow.referenceMonth);
    // fatura fechada ainda não paga (a que vence agora), se houver
    const toPay = mine
      .map((i) => summarize(i, today))
      .filter((i) => (i.state === 'CLOSED' || i.state === 'OVERDUE') && i.remainingCents > 0);
    const p = plans.find((x) => x.cardId === c.id);
    return {
      card: c,
      limitTotalCents: c.limitTotalCents,
      committedCents: usedCents - paidCents,
      availableCents: availableLimit(c.limitTotalCents, usedCents, paidCents),
      currentInvoice: summarize(
        current ?? { ...currentWindow, id: null, totalCents: 0, paidCents: 0 },
        today,
      ),
      unpaidClosed: toPay,
      activeInstallmentPlans: p?.active ?? 0,
      lastInstallmentMonth: p?.lastMonth ?? null,
    };
  });
}

/**
 * Cada cartão no mês escolhido no seletor: o resumo de sempre (limite, fatura aberta) mais a fatura cujo mês de
 * referência é o mês escolhido. `monthInvoice` null = esse cartão não tem fatura lançada nesse mês.
 */
export type CardMonthView = Awaited<ReturnType<typeof listCardSummaries>>[number] & {
  viewMonth: ISODate;
  isCurrentMonth: boolean;
  monthInvoice: InvoiceSummary | null;
};

export async function listCardMonthViews(
  db: AnyDB,
  today: ISODate,
  month: ISODate | null,
): Promise<CardMonthView[]> {
  const viewMonth = month ?? monthStart(today);
  const summaries = await listCardSummaries(db, today);
  return Promise.all(
    summaries.map(async (s) => {
      const invoices = await listCardInvoices(db, s.card.id, today);
      return {
        ...s,
        viewMonth,
        isCurrentMonth: viewMonth === monthStart(today),
        monthInvoice: invoices.find((i) => i.referenceMonth === viewMonth) ?? null,
      };
    }),
  );
}

/** Faturas de um cartão, da mais nova para a mais antiga (inclui a atual pela regra, se ainda não existir). */
export async function listCardInvoices(db: AnyDB, cardId: string, today: ISODate): Promise<InvoiceSummary[]> {
  const [card] = await db.select().from(creditCards).where(eq(creditCards.id, cardId));
  if (!card) return [];
  const rows = await invoiceRows(db, [cardId]);
  const current = resolveInvoice(today, rows, { closingDay: card.closingDay, dueDay: card.dueDay });
  const all = rows.some((r) => r.referenceMonth === current.referenceMonth)
    ? rows
    : [...rows, { ...current, id: null, totalCents: 0, paidCents: 0 }];
  return all.map((r) => summarize(r, today)).sort((x, y) => compareDates(y.referenceMonth, x.referenceMonth));
}

export async function getInvoiceDetail(db: AnyDB, invoiceId: string, today: ISODate) {
  const [inv] = await db
    .select({ invoice: invoices, card: creditCards })
    .from(invoices)
    .innerJoin(creditCards, eq(creditCards.id, invoices.creditCardId))
    .where(eq(invoices.id, invoiceId));
  if (!inv) return null;
  const [row] = await invoiceRows(db, [inv.card.id]).then((rs) => rs.filter((r) => r.id === invoiceId));
  const items = await db
    .select({
      id: invoiceItems.id,
      kind: invoiceItems.kind,
      status: invoiceItems.status,
      amountCents: invoiceItems.amountCents,
      description: invoiceItems.description,
      postingDate: invoiceItems.postingDate,
      installmentNumber: invoiceItems.installmentNumber,
      planId: invoiceItems.installmentPlanId,
      installmentCount: installmentPlans.installmentCount,
      categoryName: categories.name,
      categoryIcon: categories.icon,
      createdById: transactions.createdByUserId,
      createdByName: users.name,
      createdByColor: users.color,
    })
    .from(invoiceItems)
    .leftJoin(installmentPlans, eq(installmentPlans.id, invoiceItems.installmentPlanId))
    .leftJoin(transactions, eq(transactions.id, installmentPlans.transactionId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(users, eq(users.id, transactions.createdByUserId))
    // Compra excluída (deleted_at) some da fatura; cancelada por estorno continua, como histórico.
    .where(and(eq(invoiceItems.invoiceId, invoiceId), isNull(transactions.deletedAt)))
    .orderBy(asc(invoiceItems.postingDate), asc(invoiceItems.description));
  const payments = await db
    .select({
      id: transactions.id,
      amountCents: transactions.amountCents,
      date: transactions.postedDate,
      paymentMethod: transactions.paymentMethod,
      createdByName: users.name,
    })
    .from(transactions)
    .innerJoin(users, eq(users.id, transactions.createdByUserId))
    .where(
      and(
        eq(transactions.paidInvoiceId, invoiceId),
        eq(transactions.kind, 'INVOICE_PAYMENT'),
        isNull(transactions.deletedAt),
      ),
    )
    .orderBy(asc(transactions.postedDate));
  return {
    card: inv.card,
    summary: summarize(
      { ...inv.invoice, totalCents: row?.totalCents ?? 0, paidCents: row?.paidCents ?? 0 },
      today,
    ),
    items,
    payments,
  };
}

export async function listCardPlans(db: AnyDB, cardId: string, today: ISODate) {
  const rows = await db
    .select({
      planId: installmentPlans.id,
      status: installmentPlans.status,
      total: installmentPlans.totalAmountCents,
      count: installmentPlans.installmentCount,
      firstTracked: installmentPlans.firstTrackedInstallment,
      purchaseDate: installmentPlans.purchaseDate,
      description: transactions.description,
      source: transactions.source,
      remainingCents: sql<string>`coalesce(sum(${invoiceItems.amountCents}) filter (
        where ${invoiceItems.status} = 'ACTIVE' and ${invoiceItems.kind} = 'INSTALLMENT' and ${invoices.closingDate} > ${today}), 0)`,
      remainingCount: sql<number>`(count(*) filter (
        where ${invoiceItems.status} = 'ACTIVE' and ${invoiceItems.kind} = 'INSTALLMENT' and ${invoices.closingDate} > ${today}))::int`,
      lastMonth: sql<
        string | null
      >`max(${invoices.referenceMonth}) filter (where ${invoiceItems.kind} = 'INSTALLMENT')::text`,
    })
    .from(installmentPlans)
    .innerJoin(transactions, eq(transactions.id, installmentPlans.transactionId))
    .leftJoin(invoiceItems, eq(invoiceItems.installmentPlanId, installmentPlans.id))
    .leftJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
    .where(and(eq(installmentPlans.creditCardId, cardId), isNull(transactions.deletedAt)))
    .groupBy(installmentPlans.id, transactions.id)
    .orderBy(desc(installmentPlans.purchaseDate));
  return rows.map((r) => ({ ...r, remainingCents: centsFromDb(r.remainingCents) }));
}

export async function getPlanDetail(db: AnyDB, planId: string, today: ISODate) {
  const [head] = await db
    .select({
      plan: installmentPlans,
      purchase: transactions,
      card: creditCards,
      categoryName: categories.name,
      createdByName: users.name,
    })
    .from(installmentPlans)
    .innerJoin(transactions, eq(transactions.id, installmentPlans.transactionId))
    .innerJoin(creditCards, eq(creditCards.id, installmentPlans.creditCardId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .innerJoin(users, eq(users.id, transactions.createdByUserId))
    .where(eq(installmentPlans.id, planId));
  if (!head || head.purchase.deletedAt) return null;
  const [items, anticipations, refunds, cardInvoices] = await Promise.all([
    db
      .select({
        id: invoiceItems.id,
        kind: invoiceItems.kind,
        status: invoiceItems.status,
        amountCents: invoiceItems.amountCents,
        description: invoiceItems.description,
        installmentNumber: invoiceItems.installmentNumber,
        invoiceId: invoices.id,
        referenceMonth: invoices.referenceMonth,
        closingDate: invoices.closingDate,
      })
      .from(invoiceItems)
      .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
      .where(eq(invoiceItems.installmentPlanId, planId))
      .orderBy(asc(invoices.referenceMonth), asc(invoiceItems.installmentNumber)),
    db.select().from(anticipationRecords).where(eq(anticipationRecords.installmentPlanId, planId)),
    db.select().from(refundRecords).where(eq(refundRecords.installmentPlanId, planId)),
    invoiceRows(db, [head.card.id]),
  ]);
  return {
    ...head,
    items: items.map((i) => ({ ...i, invoiceClosed: compareDates(today, i.closingDate) >= 0 })),
    anticipations,
    refunds,
    invoices: cardInvoices.map((i) => summarize(i, today)),
  };
}

export async function listActiveCards(db: AnyDB) {
  return db
    .select({
      id: creditCards.id,
      name: creditCards.name,
      isAdditional: creditCards.isAdditional,
      holderName: creditCards.holderName,
      botAliases: creditCards.botAliases,
      closingDay: creditCards.closingDay,
      dueDay: creditCards.dueDay,
    })
    .from(creditCards)
    .where(isNull(creditCards.archivedAt))
    .orderBy(asc(creditCards.isAdditional), asc(creditCards.name));
}
