import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { LinePayload } from '@/server/imports';
import { centsFromDb } from '@/server/context';
import type { AnyDB } from '../client';
import {
  creditCards,
  importBatches,
  importLines,
  installmentPlans,
  invoiceItems,
  invoices,
  transactions,
} from '../schema';

export async function listCardImports(db: AnyDB, cardId: string) {
  return db
    .select({
      id: importBatches.id,
      fileName: importBatches.fileName,
      status: importBatches.status,
      createdAt: importBatches.createdAt,
      referenceMonth: invoices.referenceMonth,
      // tabela externa referenciada explicitamente (ver CLAUDE.md: subconsulta correlacionada no Drizzle)
      pending: sql<number>`(select count(*)::int from import_lines l where l.batch_id = import_batches.id and l.status = 'PENDING_REVIEW')`,
    })
    .from(importBatches)
    .innerJoin(invoices, eq(invoices.id, importBatches.invoiceId))
    .where(eq(importBatches.creditCardId, cardId))
    .orderBy(desc(importBatches.createdAt))
    .limit(10);
}

/** Lote + linhas com a descrição do que foi sugerido/conciliado, e a conferência com o arquivo. */
export async function getImportReview(db: AnyDB, batchId: string) {
  const [head] = await db
    .select({ batch: importBatches, card: creditCards, invoice: invoices })
    .from(importBatches)
    .innerJoin(creditCards, eq(creditCards.id, importBatches.creditCardId))
    .innerJoin(invoices, eq(invoices.id, importBatches.invoiceId))
    .where(eq(importBatches.id, batchId));
  if (!head) return null;

  const rows = await db
    .select()
    .from(importLines)
    .where(eq(importLines.batchId, batchId))
    .orderBy(desc(importLines.lineDate), importLines.rawDescription);

  const itemIds = rows
    .flatMap((r) => [r.suggestedInvoiceItemId, r.matchedInvoiceItemId])
    .filter((x): x is string => !!x);
  const txIds = rows
    .flatMap((r) => [r.suggestedTransactionId, r.matchedTransactionId])
    .filter((x): x is string => !!x);
  const [items, txs] = await Promise.all([
    itemIds.length
      ? db
          .select({
            id: invoiceItems.id,
            planId: installmentPlans.id,
            description: transactions.description,
            number: invoiceItems.installmentNumber,
            count: installmentPlans.installmentCount,
            purchaseDate: installmentPlans.purchaseDate,
          })
          .from(invoiceItems)
          .innerJoin(installmentPlans, eq(installmentPlans.id, invoiceItems.installmentPlanId))
          .innerJoin(transactions, eq(transactions.id, installmentPlans.transactionId))
          .where(inArray(invoiceItems.id, itemIds))
      : [],
    txIds.length
      ? db
          .select({
            id: transactions.id,
            description: transactions.description,
            date: transactions.postedDate,
          })
          .from(transactions)
          .where(inArray(transactions.id, txIds))
      : [],
  ]);
  const describe = (itemId: string | null, txId: string | null) => {
    const it = itemId ? items.find((i) => i.id === itemId) : undefined;
    if (it) {
      return {
        label: it.count > 1 ? `${it.description} (${it.number}/${it.count})` : it.description,
        date: it.purchaseDate,
        href: `/cartoes/compras/${it.planId}`,
      };
    }
    const t = txId ? txs.find((x) => x.id === txId) : undefined;
    return t ? { label: t.description, date: t.date, href: `/lancamentos/${t.id}` } : null;
  };

  const lines = rows.map((r) => ({
    id: r.id,
    status: r.status,
    date: r.lineDate,
    memo: r.rawDescription,
    payload: r.rawPayload as LinePayload & { ledgerBalanceCents: number | null },
    score: r.matchScore,
    suggestion: describe(r.suggestedInvoiceItemId, r.suggestedTransactionId),
    result: describe(r.matchedInvoiceItemId, r.matchedTransactionId),
  }));

  // conferência: o que falta pagar da fatura no app × saldo do arquivo
  const [tot] = await db
    .select({
      total: sql<string>`coalesce(sum(${invoiceItems.amountCents}) filter (where ${invoiceItems.status} = 'ACTIVE'), 0)`,
    })
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, head.invoice.id));
  const [paid] = await db
    .select({ v: sql<string>`coalesce(sum(${transactions.amountCents}), 0)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.paidInvoiceId, head.invoice.id),
        eq(transactions.kind, 'INVOICE_PAYMENT'),
        sql`${transactions.deletedAt} is null`,
      ),
    );
  const ledger = lines.find((l) => l.payload.ledgerBalanceCents !== null)?.payload.ledgerBalanceCents ?? null;
  return {
    ...head,
    lines,
    appRemainingCents: centsFromDb(tot?.total) - centsFromDb(paid?.v),
    fileRemainingCents: ledger === null ? null : -ledger,
  };
}

// ─────────── extrato da conta ───────────

export async function listBankImports(db: AnyDB) {
  return db
    .select({
      id: importBatches.id,
      fileName: importBatches.fileName,
      status: importBatches.status,
      periodStart: importBatches.periodStart,
      periodEnd: importBatches.periodEnd,
      pending: sql<number>`(select count(*)::int from import_lines l where l.batch_id = import_batches.id and l.status = 'PENDING_REVIEW')`,
    })
    .from(importBatches)
    .where(eq(importBatches.kind, 'BANK_STATEMENT'))
    .orderBy(desc(importBatches.createdAt))
    .limit(10);
}

export async function batchKind(db: AnyDB, batchId: string) {
  const [b] = await db
    .select({ kind: importBatches.kind })
    .from(importBatches)
    .where(eq(importBatches.id, batchId));
  return b?.kind ?? null;
}

/** Revisão do extrato da conta: linhas, sugestões/resultados e conferência de saldo (D47). */
export async function getAccountImportReview(db: AnyDB, batchId: string) {
  const [batch] = await db.select().from(importBatches).where(eq(importBatches.id, batchId));
  if (!batch || batch.kind !== 'BANK_STATEMENT') return null;
  const rows = await db
    .select()
    .from(importLines)
    .where(eq(importLines.batchId, batchId))
    .orderBy(desc(importLines.lineDate), importLines.rawDescription);
  const txIds = rows
    .flatMap((r) => [r.suggestedTransactionId, r.matchedTransactionId])
    .filter((x): x is string => !!x);
  const txs = txIds.length
    ? await db
        .select({
          id: transactions.id,
          description: transactions.description,
          kind: transactions.kind,
          status: transactions.status,
          date: sql<string>`coalesce(${transactions.postedDate}, ${transactions.dueDate})::text`,
        })
        .from(transactions)
        .where(inArray(transactions.id, txIds))
    : [];
  const describeTx = (id: string | null) => {
    const t = id ? txs.find((x) => x.id === id) : undefined;
    return t ? { label: t.description, pending: t.status === 'PENDING', href: `/lancamentos/${t.id}` } : null;
  };
  const lines = rows.map((r) => ({
    id: r.id,
    status: r.status,
    date: r.lineDate,
    memo: r.rawDescription,
    payload: r.rawPayload as import('@/server/account-imports').AccountLinePayload,
    suggestion: describeTx(r.suggestedTransactionId),
    result: describeTx(r.matchedTransactionId),
  }));
  const ledger = lines[0]?.payload.ledgerBalanceCents ?? null;
  const { getAccountBalance } = await import('./balance');
  const appBalance =
    batch.bankAccountId && batch.periodEnd
      ? await getAccountBalance(db, batch.bankAccountId, batch.periodEnd)
      : null;

  // faturas para "pagamento de fatura": abertas ou com valor a pagar
  const invs = await db
    .select({
      id: invoices.id,
      cardName: creditCards.name,
      referenceMonth: invoices.referenceMonth,
      total: sql<string>`coalesce((select sum(ii.amount_cents) from invoice_items ii where ii.invoice_id = invoices.id and ii.status = 'ACTIVE'), 0)`,
      paid: sql<string>`coalesce((select sum(tt.amount_cents) from transactions tt where tt.paid_invoice_id = invoices.id and tt.kind = 'INVOICE_PAYMENT' and tt.status = 'POSTED' and tt.deleted_at is null), 0)`,
    })
    .from(invoices)
    .innerJoin(creditCards, eq(creditCards.id, invoices.creditCardId))
    .where(sql`${creditCards.archivedAt} is null`)
    .orderBy(invoices.referenceMonth);
  const invoiceOptions = invs.map((i) => ({
    id: i.id,
    cardName: i.cardName,
    referenceMonth: i.referenceMonth,
    remainingCents: Math.max(0, centsFromDb(i.total) - centsFromDb(i.paid)),
  }));
  return { batch, lines, appBalanceCents: appBalance, fileBalanceCents: ledger, invoiceOptions };
}
