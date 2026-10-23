/**
 * Compras no cartão — invariante 4: 1 transaction EXPENSE + 1 installment_plan + N invoice_items,
 * tudo numa transação, com audit_log. À vista = 1 parcela; resto do arredondamento na 1ª.
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  anticipationRecords,
  categories,
  installmentPlans,
  invoiceItems,
  invoices,
  refundRecords,
  transactions,
  users,
} from '@/db/schema';
import { checkNotBeforeOpening } from '@/domain/account/rules';
import { buildInstallments } from '@/domain/card/purchases';
import { compareDates, type ISODate } from '@/domain/dates';
import { audit } from './audit';
import { type ServiceCtx, type Tx, UserError } from './context';
import { invoicesForPurchase, invoicesFrom, loadCard, type CardRow, type InvoiceRow } from './cards';
import { getPrimaryAccount } from './entries';
import type { CardPurchaseEditInput, CardPurchaseInput, OnboardingInput } from './schemas';

/** `keepId`: a categoria atual do lançamento pode continuar mesmo arquivada (D49). */
export async function checkExpenseCategory(tx: Tx, categoryId: string, keepId?: string | null) {
  const [cat] = await tx
    .select({ kind: categories.kind, archivedAt: categories.archivedAt })
    .from(categories)
    .where(eq(categories.id, categoryId));
  if (!cat || (cat.archivedAt && categoryId !== keepId)) throw new UserError('Categoria não encontrada.');
  if (cat.kind !== 'EXPENSE') throw new UserError('Escolha uma categoria de despesa.');
}

export async function checkUser(tx: Tx, userId: string | null) {
  if (!userId) return;
  const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!u) throw new UserError('Pessoa não encontrada.');
}

const itemDescription = (description: string, k: number, n: number) =>
  n === 1 ? description : `${description} (${k}/${n})`;

type PlanSpec = {
  card: CardRow;
  description: string;
  notes: string | null;
  total: number;
  count: number;
  firstTracked: number;
  purchaseDate: ISODate;
  categoryId: string;
  beneficiaryUserId: string | null;
  invoices: InvoiceRow[];
  source: 'MANUAL' | 'BOT' | 'ONBOARDING' | 'RECURRING';
  recurring?: { templateId: string; month: ISODate };
};

/** Grava transaction + plano + parcelas. As faturas já vêm resolvidas. */
async function insertPlan(
  tx: Tx,
  ctx: ServiceCtx,
  s: PlanSpec,
): Promise<{ transactionId: string; planId: string; invoiceId: string }> {
  const lines = buildInstallments(s.total, s.count, s.firstTracked);
  if (lines.length !== s.invoices.length)
    throw new Error('Número de faturas diferente do número de parcelas.');

  const [t] = await tx
    .insert(transactions)
    .values({
      kind: 'EXPENSE',
      status: 'POSTED',
      description: s.description,
      notes: s.notes,
      amountCents: s.total,
      paymentMethod: 'CREDIT_CARD',
      creditCardId: s.card.id,
      categoryId: s.categoryId,
      transactionDate: s.purchaseDate,
      postedDate: s.purchaseDate,
      createdByUserId: ctx.userId,
      beneficiaryUserId: s.beneficiaryUserId,
      source: s.source,
      recurringTemplateId: s.recurring?.templateId ?? null,
      occurrenceMonth: s.recurring?.month ?? null,
    })
    .returning();
  const [plan] = await tx
    .insert(installmentPlans)
    .values({
      transactionId: t!.id,
      creditCardId: s.card.id,
      totalAmountCents: s.total,
      installmentCount: s.count,
      firstTrackedInstallment: s.firstTracked,
      purchaseDate: s.purchaseDate,
      firstInvoiceId: s.invoices[0]!.id,
    })
    .returning();
  const items = await tx
    .insert(invoiceItems)
    .values(
      lines.map((l, i) => ({
        invoiceId: s.invoices[i]!.id,
        creditCardId: s.card.id,
        kind: 'INSTALLMENT' as const,
        amountCents: l.amountCents,
        description: itemDescription(s.description, l.number, s.count),
        postingDate: s.purchaseDate,
        installmentPlanId: plan!.id,
        installmentNumber: l.number,
      })),
    )
    .returning({ id: invoiceItems.id });
  await audit(tx, {
    userId: ctx.userId,
    entity: 'installment_plans',
    entityId: plan!.id,
    action: 'CREATE',
    after: { transaction: t, plan, itemIds: items.map((i) => i.id) },
  });
  // invoiceId = a fatura onde a compra (a 1ª parcela) caiu: é para onde a tela volta depois de lançar
  return { transactionId: t!.id, planId: plan!.id, invoiceId: s.invoices[0]!.id };
}

export async function createCardPurchase(
  ctx: ServiceCtx,
  input: CardPurchaseInput,
  source: 'MANUAL' | 'BOT' = 'MANUAL',
): Promise<{ transactionId: string; planId: string; invoiceId: string }> {
  return ctx.db.transaction(async (tx) => {
    const account = await getPrimaryAccount(tx);
    const dateError = checkNotBeforeOpening(input.date, account.openingBalanceDate);
    if (dateError)
      throw new UserError(`${dateError} Compras parceladas antigas: use "Parcelamento em andamento".`);
    if (input.amount < input.installments)
      throw new UserError('Cada parcela precisa ter pelo menos R$ 0,01.');
    const card = await loadCard(tx, input.cardId);
    await checkExpenseCategory(tx, input.categoryId);
    await checkUser(tx, input.beneficiaryUserId);
    return insertPlan(tx, ctx, {
      card,
      description: input.description,
      notes: input.notes,
      total: input.amount,
      count: input.installments,
      firstTracked: 1,
      purchaseDate: input.date,
      categoryId: input.categoryId,
      beneficiaryUserId: input.beneficiaryUserId,
      invoices: await invoicesForPurchase(tx, card, input.date, input.installments),
      source,
    });
  });
}

/** Assinatura no cartão (D33): compra à vista ligada ao template e ao mês. */
export async function createSubscriptionCharge(
  tx: Tx,
  ctx: ServiceCtx,
  p: {
    card: CardRow;
    templateId: string;
    month: ISODate;
    chargeDate: ISODate;
    description: string;
    amount: number;
    categoryId: string;
    beneficiaryUserId: string | null;
  },
) {
  return insertPlan(tx, ctx, {
    card: p.card,
    description: p.description,
    notes: null,
    total: p.amount,
    count: 1,
    firstTracked: 1,
    purchaseDate: p.chargeDate,
    categoryId: p.categoryId,
    beneficiaryUserId: p.beneficiaryUserId,
    invoices: await invoicesForPurchase(tx, p.card, p.chargeDate, 1),
    source: 'RECURRING',
    recurring: { templateId: p.templateId, month: p.month },
  });
}

/**
 * Parcelamento já em andamento (D9): cria só as parcelas a partir da atual, na fatura informada
 * e nas seguintes; source = ONBOARDING (fica fora do Gasto Bruto).
 */
export async function createOnboardingPlan(ctx: ServiceCtx, input: OnboardingInput) {
  return ctx.db.transaction(async (tx) => {
    const card = await loadCard(tx, input.cardId);
    await checkExpenseCategory(tx, input.categoryId);
    await checkUser(tx, input.beneficiaryUserId);
    if (compareDates(input.purchaseDate, input.currentInvoiceMonth) > 0 && input.currentInstallment > 1) {
      throw new UserError('A data da compra precisa ser anterior à fatura da parcela atual.');
    }
    const count = input.installments - input.currentInstallment + 1;
    return insertPlan(tx, ctx, {
      card,
      description: input.description,
      notes: null,
      total: input.total,
      count: input.installments,
      firstTracked: input.currentInstallment,
      purchaseDate: input.purchaseDate,
      categoryId: input.categoryId,
      beneficiaryUserId: input.beneficiaryUserId,
      invoices: await invoicesFrom(tx, card, input.currentInvoiceMonth, count),
      source: 'ONBOARDING',
    });
  });
}

export async function loadPlan(tx: Tx, planId: string) {
  const [row] = await tx
    .select({ plan: installmentPlans, tx: transactions })
    .from(installmentPlans)
    .innerJoin(transactions, eq(transactions.id, installmentPlans.transactionId))
    .where(eq(installmentPlans.id, planId))
    .for('update');
  if (!row || row.tx.deletedAt) throw new UserError('Compra não encontrada.');
  return row;
}

export async function planItems(tx: Tx, planId: string) {
  return tx
    .select({
      id: invoiceItems.id,
      kind: invoiceItems.kind,
      status: invoiceItems.status,
      amountCents: invoiceItems.amountCents,
      installmentNumber: invoiceItems.installmentNumber,
      invoiceId: invoiceItems.invoiceId,
      closingDate: invoices.closingDate,
    })
    .from(invoiceItems)
    .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
    .where(eq(invoiceItems.installmentPlanId, planId))
    .orderBy(asc(invoiceItems.installmentNumber));
}

/**
 * Corrigir descrição, categoria, de quem é, observações e valor total. Parcelas e número de parcelas não mudam
 * (para isso, excluir e lançar de novo). O valor só muda enquanto nada da compra foi fechado: nenhuma parcela em fatura
 * fechada, nem antecipação ou estorno (mesma regra da exclusão, D31). Refaz as parcelas com a mesma regra do lançamento
 * (resto do arredondamento na 1ª) e grava no histórico.
 */
export async function updateCardPurchase(ctx: ServiceCtx, planId: string, input: CardPurchaseEditInput) {
  return ctx.db.transaction(async (tx) => {
    const { plan, tx: t } = await loadPlan(tx, planId);
    await checkExpenseCategory(tx, input.categoryId, t.categoryId);
    await checkUser(tx, input.beneficiaryUserId);
    const newTotal = input.amount ?? plan.totalAmountCents;
    const changesAmount = newTotal !== plan.totalAmountCents;
    const items = await planItems(tx, planId);
    if (changesAmount) {
      if (newTotal < plan.installmentCount)
        throw new UserError('Cada parcela precisa ter pelo menos R$ 0,01.');
      const [antic] = await tx
        .select({ id: anticipationRecords.id })
        .from(anticipationRecords)
        .where(eq(anticipationRecords.installmentPlanId, planId))
        .limit(1);
      const [refund] = await tx
        .select({ id: refundRecords.id })
        .from(refundRecords)
        .where(eq(refundRecords.installmentPlanId, planId))
        .limit(1);
      const clean =
        !antic &&
        !refund &&
        items.every(
          (i) =>
            i.kind === 'INSTALLMENT' && i.status === 'ACTIVE' && compareDates(ctx.today, i.closingDate) < 0,
        );
      if (!clean)
        throw new UserError(
          'Esta compra já tem parcela em fatura fechada, antecipação ou estorno: o valor não pode mudar. Use "Estornar" ou lance de novo.',
        );
    }
    const [after] = await tx
      .update(transactions)
      .set({
        description: input.description,
        categoryId: input.categoryId,
        beneficiaryUserId: input.beneficiaryUserId,
        notes: input.notes,
        ...(changesAmount ? { amountCents: newTotal } : {}),
        version: sql`${transactions.version} + 1`,
      })
      .where(eq(transactions.id, t.id))
      .returning();
    if (changesAmount) {
      await tx
        .update(installmentPlans)
        .set({ totalAmountCents: newTotal })
        .where(eq(installmentPlans.id, planId));
      const lines = buildInstallments(newTotal, plan.installmentCount, plan.firstTrackedInstallment);
      for (const line of lines) {
        await tx
          .update(invoiceItems)
          .set({ amountCents: line.amountCents })
          .where(
            and(eq(invoiceItems.installmentPlanId, planId), eq(invoiceItems.installmentNumber, line.number)),
          );
      }
    }
    const installments = await tx
      .select({ id: invoiceItems.id, number: invoiceItems.installmentNumber })
      .from(invoiceItems)
      .where(and(eq(invoiceItems.installmentPlanId, planId), eq(invoiceItems.kind, 'INSTALLMENT')));
    for (const it of installments) {
      await tx
        .update(invoiceItems)
        .set({ description: itemDescription(input.description, it.number!, plan.installmentCount) })
        .where(eq(invoiceItems.id, it.id));
    }
    await audit(tx, {
      userId: ctx.userId,
      entity: 'transactions',
      entityId: t.id,
      action: 'UPDATE',
      before: t,
      after,
    });
  });
}

/**
 * Excluir compra (D31): só se nada foi cobrado nem mexido — todas as parcelas ACTIVE em faturas
 * que não fecharam, sem antecipação nem estorno. Nada é apagado: itens CANCELLED, plano CANCELLED,
 * transaction com deleted_at.
 */
export async function deleteCardPurchase(ctx: ServiceCtx, planId: string) {
  return ctx.db.transaction(async (tx) => {
    const { plan, tx: t } = await loadPlan(tx, planId);
    const items = await planItems(tx, planId);
    const [antic] = await tx
      .select({ id: anticipationRecords.id })
      .from(anticipationRecords)
      .where(eq(anticipationRecords.installmentPlanId, planId))
      .limit(1);
    const [refund] = await tx
      .select({ id: refundRecords.id })
      .from(refundRecords)
      .where(eq(refundRecords.installmentPlanId, planId))
      .limit(1);
    const clean =
      !antic &&
      !refund &&
      items.every(
        (i) =>
          i.kind === 'INSTALLMENT' && i.status === 'ACTIVE' && compareDates(ctx.today, i.closingDate) < 0,
      );
    if (!clean) {
      throw new UserError(
        'Esta compra já tem parcela em fatura fechada, antecipação ou estorno. Use "Estornar" em vez de excluir.',
      );
    }
    await tx
      .update(invoiceItems)
      .set({ status: 'CANCELLED' })
      .where(eq(invoiceItems.installmentPlanId, planId));
    await tx.update(installmentPlans).set({ status: 'CANCELLED' }).where(eq(installmentPlans.id, planId));
    await tx
      .update(transactions)
      .set({ deletedAt: new Date(), version: sql`${transactions.version} + 1` })
      .where(and(eq(transactions.id, t.id), isNull(transactions.deletedAt)));
    await audit(tx, {
      userId: ctx.userId,
      entity: 'installment_plans',
      entityId: planId,
      action: 'DELETE',
      before: { plan, transaction: t, items },
    });
  });
}
