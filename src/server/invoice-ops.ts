/**
 * Operações sobre faturas e planos: pagamento (D25, D30), antecipação (§3.5, D32) e estornos
 * (§3.6, D26). Tudo em db.transaction() com audit_log.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  anticipationRecords,
  installmentPlans,
  invoiceItems,
  invoices,
  refundRecords,
  transactions,
} from '@/db/schema';
import { checkNotBeforeOpening } from '@/domain/account/rules';
import { invoiceState } from '@/domain/card/invoices';
import {
  checkPartialRefund,
  planAnticipation,
  planCancelPurchase,
  type PlanItem,
} from '@/domain/card/purchases';
import { compareDates, formatMonthLabel, type ISODate } from '@/domain/dates';
import { centsFromDb, type ServiceCtx, type Tx, UserError } from './context';
import { audit } from './audit';
import { loadCard } from './cards';
import { loadPlan, planItems } from './card-purchases';
import { getPrimaryAccount } from './entries';
import { recordFunding, requireFunding } from './funding';
import type { AnticipationInput, InvoicePaymentInput, RefundInput } from './schemas';

// ─────────── totais e situação ───────────

export async function invoiceTotals(tx: Tx, invoiceId: string) {
  const [row] = await tx
    .select({
      total: sql<string>`coalesce((select sum(${invoiceItems.amountCents}) from ${invoiceItems}
        where ${invoiceItems.invoiceId} = ${invoiceId} and ${invoiceItems.status} = 'ACTIVE'), 0)`,
      paid: sql<string>`coalesce((select sum(${transactions.amountCents}) from ${transactions}
        where ${transactions.paidInvoiceId} = ${invoiceId} and ${transactions.kind} = 'INVOICE_PAYMENT'
          and ${transactions.status} = 'POSTED' and ${transactions.deletedAt} is null), 0)`,
      lastPaid: sql<string | null>`(select max(${transactions.postedDate})::text from ${transactions}
        where ${transactions.paidInvoiceId} = ${invoiceId} and ${transactions.kind} = 'INVOICE_PAYMENT'
          and ${transactions.status} = 'POSTED' and ${transactions.deletedAt} is null)`,
    })
    .from(invoices)
    .where(eq(invoices.id, invoiceId));
  return {
    totalCents: centsFromDb(row?.total),
    paidCents: centsFromDb(row?.paid),
    lastPaid: row?.lastPaid ?? null,
  };
}

/** D30: a coluna status só guarda o marcador PAID (com paid_at); o resto é derivado. */
export async function syncInvoiceStatus(tx: Tx, invoiceId: string, today: ISODate) {
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) return;
  const t = await invoiceTotals(tx, invoiceId);
  const paid = t.totalCents > 0 && t.paidCents >= t.totalCents;
  const stored = paid ? 'PAID' : compareDates(today, inv.closingDate) < 0 ? 'OPEN' : 'CLOSED';
  await tx
    .update(invoices)
    .set({ status: stored, paidAt: paid ? (t.lastPaid ?? today) : null })
    .where(eq(invoices.id, invoiceId));
}

// ─────────── pagamento de fatura ───────────

export async function payInvoice(ctx: ServiceCtx, invoiceId: string, input: InvoicePaymentInput) {
  return ctx.db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for('update');
    if (!inv) throw new UserError('Fatura não encontrada.');
    const card = await loadCard(tx, inv.creditCardId, { allowArchived: true });
    const account = await getPrimaryAccount(tx);
    const dateError = checkNotBeforeOpening(input.date, account.openingBalanceDate);
    if (dateError) throw new UserError(dateError);
    // sem saldo na conta de pagamento: o que faltou precisa de explicação (aporte, D69)
    const funding = await requireFunding(tx, card.paymentAccountId, input.amount, input.date, input);

    const [t] = await tx
      .insert(transactions)
      .values({
        kind: 'INVOICE_PAYMENT',
        status: 'POSTED',
        description: `Fatura ${card.name} · ${formatMonthLabel(inv.referenceMonth)}`,
        amountCents: input.amount,
        paymentMethod: input.paymentMethod,
        bankAccountId: card.paymentAccountId,
        transactionDate: input.date,
        postedDate: input.date,
        paidInvoiceId: inv.id,
        createdByUserId: ctx.userId,
      })
      .returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'transactions',
      entityId: t!.id,
      action: 'CREATE',
      after: t,
    });
    if (funding) {
      await recordFunding(tx, ctx, card.paymentAccountId, funding, input.date, t!.id, `Fatura ${card.name}`);
    }
    await syncInvoiceStatus(tx, inv.id, ctx.today);
    return { transactionId: t!.id };
  });
}

export async function removeInvoicePayment(ctx: ServiceCtx, transactionId: string) {
  return ctx.db.transaction(async (tx) => {
    const [t] = await tx
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, transactionId), isNull(transactions.deletedAt)))
      .for('update');
    if (!t || t.kind !== 'INVOICE_PAYMENT' || !t.paidInvoiceId)
      throw new UserError('Pagamento não encontrado.');
    const [after] = await tx
      .update(transactions)
      .set({ deletedAt: new Date(), version: sql`${transactions.version} + 1` })
      .where(eq(transactions.id, transactionId))
      .returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'transactions',
      entityId: transactionId,
      action: 'DELETE',
      before: t,
      after,
    });
    await syncInvoiceStatus(tx, t.paidInvoiceId, ctx.today);
  });
}

// ─────────── antecipação ───────────

const toPlanItems = (rows: Awaited<ReturnType<typeof planItems>>, asOf: ISODate): PlanItem[] =>
  rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    installmentNumber: r.installmentNumber,
    amountCents: r.amountCents,
    invoiceClosed: compareDates(asOf, r.closingDate) >= 0,
  }));

export async function anticipate(ctx: ServiceCtx, planId: string, input: AnticipationInput) {
  if (compareDates(input.date, ctx.today) > 0)
    throw new UserError('A data da antecipação não pode estar no futuro.');
  return ctx.db.transaction(async (tx) => {
    const { plan, tx: purchase } = await loadPlan(tx, planId);
    if (plan.status !== 'ACTIVE') throw new UserError('Esta compra não está mais ativa.');
    const card = await loadCard(tx, plan.creditCardId, { allowArchived: true });
    const rows = await planItems(tx, planId);
    const calc = planAnticipation(toPlanItems(rows, input.date), input.itemIds, input.paid);
    if ('error' in calc) throw new UserError(calc.error);

    let paymentTransactionId: string | null = null;
    let target: typeof invoices.$inferSelect | undefined;
    if (input.settlement === 'DIRECT_PAYMENT') {
      const account = await getPrimaryAccount(tx);
      const dateError = checkNotBeforeOpening(input.date, account.openingBalanceDate);
      if (dateError) throw new UserError(dateError);
      const [t] = await tx
        .insert(transactions)
        .values({
          kind: 'ANTICIPATION_PAYMENT',
          status: 'POSTED',
          description: `Antecipação · ${purchase.description}`,
          amountCents: calc.paidCents,
          paymentMethod: 'PIX',
          bankAccountId: card.paymentAccountId,
          transactionDate: input.date,
          postedDate: input.date,
          createdByUserId: ctx.userId,
        })
        .returning();
      paymentTransactionId = t!.id;
      await audit(tx, {
        userId: ctx.userId,
        entity: 'transactions',
        entityId: t!.id,
        action: 'CREATE',
        after: t,
      });
    } else {
      [target] = await tx.select().from(invoices).where(eq(invoices.id, input.targetInvoiceId!));
      if (!target || target.creditCardId !== card.id) throw new UserError('Fatura de destino inválida.');
      if (compareDates(input.date, target.closingDate) >= 0) {
        throw new UserError('A antecipação na fatura precisa cair numa fatura aberta.');
      }
    }

    const [record] = await tx
      .insert(anticipationRecords)
      .values({
        installmentPlanId: planId,
        anticipationDate: input.date,
        installmentsCount: input.itemIds.length,
        grossAmountCents: calc.grossCents,
        discountCents: calc.discountCents,
        paidAmountCents: calc.paidCents,
        settlement: input.settlement,
        targetInvoiceId: target?.id ?? null,
        paymentTransactionId,
        createdByUserId: ctx.userId,
      })
      .returning();

    const numbers = rows.filter((r) => input.itemIds.includes(r.id)).map((r) => r.installmentNumber);
    if (target) {
      await tx.insert(invoiceItems).values({
        invoiceId: target.id,
        creditCardId: card.id,
        kind: 'ANTICIPATION',
        amountCents: calc.paidCents,
        description: `Antecipação ${purchase.description} (${numbers.join(', ')}/${plan.installmentCount})`,
        postingDate: input.date,
        anticipationRecordId: record!.id,
        installmentPlanId: planId,
      });
    }
    await tx
      .update(invoiceItems)
      .set({ status: 'ANTICIPATED', anticipationRecordId: record!.id })
      .where(inArray(invoiceItems.id, input.itemIds));

    const stillActive = rows.some(
      (r) => r.kind === 'INSTALLMENT' && r.status === 'ACTIVE' && !input.itemIds.includes(r.id),
    );
    if (!stillActive) {
      await tx
        .update(installmentPlans)
        .set({ status: 'FULLY_ANTICIPATED' })
        .where(eq(installmentPlans.id, planId));
    }
    await audit(tx, {
      userId: ctx.userId,
      entity: 'anticipation_records',
      entityId: record!.id,
      action: 'ANTICIPATE',
      after: { record, itemIds: input.itemIds },
    });
    const touched = new Set([
      ...rows.filter((r) => input.itemIds.includes(r.id)).map((r) => r.invoiceId),
      ...(target ? [target.id] : []),
    ]);
    for (const id of touched) await syncInvoiceStatus(tx, id, ctx.today);
    return { anticipationId: record!.id, ...calc };
  });
}

// ─────────── estornos ───────────

export async function refundPurchase(ctx: ServiceCtx, planId: string, input: RefundInput) {
  return ctx.db.transaction(async (tx) => {
    const { plan, tx: purchase } = await loadPlan(tx, planId);
    if (plan.status === 'CANCELLED') throw new UserError('Esta compra já foi cancelada.');
    if (compareDates(input.refundDate, plan.purchaseDate) < 0) {
      throw new UserError('O estorno não pode ser anterior à compra.');
    }
    const card = await loadCard(tx, plan.creditCardId, { allowArchived: true });
    let target: typeof invoices.$inferSelect | undefined;
    if (input.targetInvoiceId) {
      [target] = await tx.select().from(invoices).where(eq(invoices.id, input.targetInvoiceId));
      if (!target || target.creditCardId !== card.id) throw new UserError('Fatura do crédito inválida.');
    }
    const [prev] = await tx
      .select({ v: sql<string>`coalesce(sum(${refundRecords.amountCents}), 0)` })
      .from(refundRecords)
      .where(eq(refundRecords.installmentPlanId, planId));
    const previousRefunds = centsFromDb(prev?.v);
    const rows = await planItems(tx, planId);

    let amount: number;
    let credit: number;
    let cancelIds: string[] = [];
    if (input.mode === 'CREDIT_KEEP_INSTALLMENTS') {
      if (input.amount === null) throw new UserError('Informe o valor do estorno.');
      if (!target) throw new UserError('Escolha a fatura onde o crédito caiu.');
      const err = checkPartialRefund(input.amount, plan.totalAmountCents, previousRefunds);
      if (err) throw new UserError(err);
      amount = input.amount;
      credit = input.amount;
    } else {
      const [direct] = await tx
        .select({ v: sql<string>`coalesce(sum(${anticipationRecords.paidAmountCents}), 0)` })
        .from(anticipationRecords)
        .where(
          and(
            eq(anticipationRecords.installmentPlanId, planId),
            eq(anticipationRecords.settlement, 'DIRECT_PAYMENT'),
          ),
        );
      const calc = planCancelPurchase({
        items: toPlanItems(rows, input.refundDate),
        purchaseTotal: plan.totalAmountCents,
        trackedTotal: rows.filter((r) => r.kind === 'INSTALLMENT').reduce((s, r) => s + r.amountCents, 0),
        onboarding: purchase.source === 'ONBOARDING',
        directAnticipationsPaid: centsFromDb(direct?.v),
        previousRefundRecords: previousRefunds,
      });
      if ('error' in calc) throw new UserError(calc.error);
      if (calc.grossRefundCents <= 0) throw new UserError('Esta compra já está totalmente estornada.');
      if (calc.creditCents > 0 && !target) throw new UserError('Escolha a fatura onde o crédito caiu.');
      amount = calc.grossRefundCents;
      credit = calc.creditCents;
      cancelIds = calc.cancelItemIds;
    }

    const [record] = await tx
      .insert(refundRecords)
      .values({
        transactionId: purchase.id,
        installmentPlanId: planId,
        mode: input.mode,
        refundDate: input.refundDate,
        amountCents: amount,
        targetInvoiceId: credit > 0 ? target!.id : null,
        reason: input.reason,
        createdByUserId: ctx.userId,
      })
      .returning();
    if (cancelIds.length) {
      await tx.update(invoiceItems).set({ status: 'CANCELLED' }).where(inArray(invoiceItems.id, cancelIds));
    }
    if (credit > 0) {
      await tx.insert(invoiceItems).values({
        invoiceId: target!.id,
        creditCardId: card.id,
        kind: 'REFUND_CREDIT',
        amountCents: -credit,
        description: `Estorno ${purchase.description}`,
        postingDate: input.refundDate,
        refundRecordId: record!.id,
        installmentPlanId: planId,
      });
    }
    if (input.mode === 'CANCEL_PURCHASE') {
      await tx.update(installmentPlans).set({ status: 'CANCELLED' }).where(eq(installmentPlans.id, planId));
    }
    await audit(tx, {
      userId: ctx.userId,
      entity: 'refund_records',
      entityId: record!.id,
      action: 'REFUND',
      after: { record, creditCents: credit, cancelledItemIds: cancelIds },
    });
    const touched = new Set([
      ...rows.filter((r) => cancelIds.includes(r.id)).map((r) => r.invoiceId),
      ...(target ? [target.id] : []),
    ]);
    for (const id of touched) await syncInvoiceStatus(tx, id, ctx.today);
    return {
      refundId: record!.id,
      grossRefundCents: amount,
      creditCents: credit,
      cancelledItems: cancelIds.length,
    };
  });
}

/** Situação derivada de uma fatura (para serviços e telas). */
export async function invoiceStateOf(tx: Tx, invoiceId: string, today: ISODate) {
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) throw new UserError('Fatura não encontrada.');
  const t = await invoiceTotals(tx, invoiceId);
  return { ...t, state: invoiceState({ ...inv, totalCents: t.totalCents, paidCents: t.paidCents, today }) };
}
