/**
 * Cartões e faturas (Fase 3). Faturas são materializadas sob demanda a partir da regra do
 * cartão (D29) e ficam com datas reais editáveis (D27). Limite e total nunca são armazenados.
 */
import { and, asc, eq, gt, inArray, isNull, ne } from 'drizzle-orm';
import { creditCards, installmentPlans, invoiceItems, invoices, transactions } from '@/db/schema';
import { invoiceRows } from '@/db/queries/cards';
import {
  cardRule,
  ruleInvoice,
  windowFor,
  type InvoiceRule,
  type InvoiceWindow,
} from '@/domain/card/invoices';
import { placePurchase } from '@/domain/card/store-credit';
import { planClosingChange, type PlanPlacement } from '@/domain/card/reallocation';
import { addDays, addMonths, compareDates, monthStart, type ISODate } from '@/domain/dates';
import { audit } from './audit';
import { type ServiceCtx, type Tx, UserError } from './context';
import { getPrimaryAccount } from './entries';
import type { CardInput, InvoiceDatesInput } from './schemas';

export type CardRow = typeof creditCards.$inferSelect;
export type InvoiceRow = typeof invoices.$inferSelect;

const rule = (c: CardRow): InvoiceRule => cardRule(c);

export async function loadCard(
  tx: Tx,
  id: string,
  opts: { forUpdate?: boolean; allowArchived?: boolean } = {},
) {
  const q = tx.select().from(creditCards).where(eq(creditCards.id, id));
  const [card] = opts.forUpdate ? await q.for('update') : await q;
  if (!card) throw new UserError('Cartão não encontrado.');
  if (card.archivedAt && !opts.allowArchived) throw new UserError('Este cartão está arquivado.');
  return card;
}

async function materialized(tx: Tx, cardId: string): Promise<(InvoiceWindow & { id: string })[]> {
  return tx
    .select({
      id: invoices.id,
      referenceMonth: invoices.referenceMonth,
      closingDate: invoices.closingDate,
      dueDate: invoices.dueDate,
    })
    .from(invoices)
    .where(eq(invoices.creditCardId, cardId))
    .orderBy(asc(invoices.referenceMonth));
}

/** Fatura do mês de referência; cria pela regra do cartão se ainda não existir. */
export async function ensureInvoice(tx: Tx, card: CardRow, referenceMonth: ISODate): Promise<InvoiceRow> {
  const ref = monthStart(referenceMonth);
  const [existing] = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.creditCardId, card.id), eq(invoices.referenceMonth, ref)));
  if (existing) return existing;
  const w = ruleInvoice(ref, rule(card));
  const [created] = await tx
    .insert(invoices)
    .values({ creditCardId: card.id, referenceMonth: ref, closingDate: w.closingDate, dueDate: w.dueDate })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [raced] = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.creditCardId, card.id), eq(invoices.referenceMonth, ref)));
  if (!raced) {
    throw new UserError(
      'As datas geradas colidem com uma fatura editada. Ajuste o fechamento das faturas vizinhas.',
    );
  }
  return raced;
}

/**
 * Invariante 5 + parcelas em faturas consecutivas, materializando o que faltar. No crediário (D73), a compra
 * fora de um ciclo ativo abre um ciclo novo: o dia do vencimento do cadastro passa a ser o da nova fatura.
 */
export async function invoicesForPurchase(
  tx: Tx,
  card: CardRow,
  purchaseDate: ISODate,
  count: number,
): Promise<InvoiceRow[]> {
  const placed = placePurchase(card, purchaseDate, await invoiceRows(tx, [card.id]));
  const terms = placed.newCycle ? await startCycle(tx, card, placed.anchorDay) : card;
  return invoicesFrom(tx, terms, placed.window.referenceMonth, count);
}

/** Crediário (D73): ciclo novo; as faturas dele vencem no `anchorDay`, mês a mês. */
export async function startCycle(tx: Tx, card: CardRow, anchorDay: number): Promise<CardRow> {
  if (anchorDay === card.dueDay) return card;
  const [after] = await tx
    .update(creditCards)
    .set({ dueDay: anchorDay })
    .where(eq(creditCards.id, card.id))
    .returning();
  await audit(tx, {
    userId: null,
    entity: 'credit_cards',
    entityId: card.id,
    action: 'UPDATE',
    before: { dueDay: card.dueDay },
    after: { dueDay: anchorDay, reason: 'ciclo novo do crediário' },
  });
  return after!;
}

export async function invoicesFrom(tx: Tx, card: CardRow, firstRef: ISODate, count: number) {
  const rows: InvoiceRow[] = [];
  for (let k = 0; k < count; k++) rows.push(await ensureInvoice(tx, card, addMonths(firstRef, k)));
  return rows;
}

/** A fatura aberta "atual" (menor fechamento > hoje), materializada. */
export async function currentOpenInvoice(tx: Tx, card: CardRow, today: ISODate) {
  const [inv] = await invoicesForPurchase(tx, card, today, 1);
  return inv!;
}

// ─────────── CRUD de cartões ───────────

/**
 * Campos do cadastro (o schema já garante os de cada tipo). O crediário (D73) não tem dia de fechamento nem
 * de vencimento fixos: o dia do vencimento do ciclo (`dueDay`) é definido pela compra que abre o ciclo.
 */
const cardValues = (input: CardInput, kind: CardRow['kind']) => {
  const common = { name: input.name, limitTotalCents: input.limitTotal, botAliases: input.botAliases };
  if (kind === 'STORE_CREDIT') {
    return {
      ...common,
      issuer: null,
      last4: null,
      isAdditional: false,
      holderName: null,
      closingDay: null,
      firstDueDays: input.firstDueDays!,
      closeBeforeDays: input.closeBeforeDays!,
    };
  }
  return {
    ...common,
    issuer: input.issuer,
    last4: input.last4,
    isAdditional: input.isAdditional,
    holderName: input.isAdditional ? input.holderName : null,
    closingDay: input.closingDay!,
    dueDay: input.dueDay!,
    firstDueDays: null,
    closeBeforeDays: null,
  };
};

export async function createCard(ctx: ServiceCtx, input: CardInput): Promise<{ id: string }> {
  return ctx.db.transaction(async (tx) => {
    const account = await getPrimaryAccount(tx);
    const kind = input.kind ?? 'CARD';
    // crediário: o dia de verdade vem da 1ª compra (ciclo novo); até lá, o do prazo contado de hoje
    const dueDay =
      kind === 'STORE_CREDIT' ? Number(addDays(ctx.today, input.firstDueDays!).slice(8)) : input.dueDay!;
    const [card] = await tx
      .insert(creditCards)
      .values({ dueDay, ...cardValues(input, kind), kind, paymentAccountId: account.id })
      .returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'credit_cards',
      entityId: card!.id,
      action: 'CREATE',
      after: card,
    });
    return { id: card!.id };
  });
}

/** Mudar os dias de fechamento/vencimento só afeta faturas ainda não materializadas. */
export async function updateCard(ctx: ServiceCtx, id: string, input: CardInput) {
  return ctx.db.transaction(async (tx) => {
    const before = await loadCard(tx, id, { forUpdate: true });
    if ((input.kind ?? 'CARD') !== before.kind)
      throw new UserError('Não dá para transformar cartão em crediário (ou o contrário). Cadastre outro.');
    const [after] = await tx
      .update(creditCards)
      .set(cardValues(input, before.kind))
      .where(eq(creditCards.id, id))
      .returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'credit_cards',
      entityId: id,
      action: 'UPDATE',
      before,
      after,
    });
  });
}

export async function archiveCard(ctx: ServiceCtx, id: string) {
  return ctx.db.transaction(async (tx) => {
    const before = await loadCard(tx, id, { forUpdate: true });
    const pending = await tx
      .select({ id: invoiceItems.id })
      .from(invoiceItems)
      .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
      .where(
        and(
          eq(invoiceItems.creditCardId, id),
          eq(invoiceItems.status, 'ACTIVE'),
          gt(invoices.closingDate, ctx.today),
        ),
      )
      .limit(1);
    if (pending.length > 0)
      throw new UserError('Este cartão ainda tem parcelas em faturas abertas ou futuras.');
    const [after] = await tx
      .update(creditCards)
      .set({ archivedAt: new Date() })
      .where(eq(creditCards.id, id))
      .returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'credit_cards',
      entityId: id,
      action: 'END',
      before,
      after,
    });
  });
}

// ─────────── datas da fatura (D27) ───────────

export type InvoiceDatesResult = { moved: { description: string; direction: 'forward' | 'backward' }[] };

export async function updateInvoiceDates(
  ctx: ServiceCtx,
  invoiceId: string,
  input: InvoiceDatesInput,
): Promise<InvoiceDatesResult> {
  return ctx.db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for('update');
    if (!inv) throw new UserError('Fatura não encontrada.');
    const card = await loadCard(tx, inv.creditCardId, { allowArchived: true });

    if (monthStart(input.dueDate) !== inv.referenceMonth) {
      throw new UserError(
        'O vencimento precisa continuar no mesmo mês (a fatura é identificada pelo mês de vencimento).',
      );
    }
    if (compareDates(input.closingDate, input.dueDate) >= 0) {
      throw new UserError('O fechamento precisa ser antes do vencimento.');
    }

    const moved: InvoiceDatesResult['moved'] = [];
    if (input.closingDate !== inv.closingDate) {
      const all = await materialized(tx, card.id);
      const prev = windowFor(addMonths(inv.referenceMonth, -1), all, rule(card));
      const next = windowFor(addMonths(inv.referenceMonth, 1), all, rule(card));
      const placements = await placementsNear(
        tx,
        card.id,
        [inv.referenceMonth, next.referenceMonth],
        ctx.today,
      );
      const plan = planClosingChange(
        {
          referenceMonth: inv.referenceMonth,
          oldClosing: inv.closingDate,
          newClosing: input.closingDate,
          dueDate: input.dueDate,
          prevClosing: prev.closingDate,
          nextClosing: next.closingDate,
          today: ctx.today,
        },
        placements,
      );
      if ('error' in plan) throw new UserError(plan.error);

      await tx
        .update(invoices)
        .set({ closingDate: input.closingDate, dueDate: input.dueDate })
        .where(eq(invoices.id, invoiceId));

      for (const [list, delta, direction] of [
        [plan.forward, 1, 'forward'],
        [plan.backward, -1, 'backward'],
      ] as const) {
        for (const p of list) {
          await shiftPlan(tx, card, p.planId, delta);
          moved.push({ description: p.description, direction });
        }
      }
    } else if (input.dueDate !== inv.dueDate) {
      await tx.update(invoices).set({ dueDate: input.dueDate }).where(eq(invoices.id, invoiceId));
    }

    await audit(tx, {
      userId: ctx.userId,
      entity: 'invoices',
      entityId: invoiceId,
      action: 'UPDATE',
      before: { closingDate: inv.closingDate, dueDate: inv.dueDate },
      after: { ...input, moved },
    });
    return { moved };
  });
}

/** Planos cuja 1ª parcela rastreada está nas faturas dos meses dados. */
async function placementsNear(
  tx: Tx,
  cardId: string,
  months: ISODate[],
  today: ISODate,
): Promise<PlanPlacement[]> {
  const plans = await tx
    .select({
      planId: installmentPlans.id,
      description: transactions.description,
      purchaseDate: installmentPlans.purchaseDate,
      firstRef: invoices.referenceMonth,
      source: transactions.source,
      status: installmentPlans.status,
    })
    .from(installmentPlans)
    .innerJoin(transactions, eq(transactions.id, installmentPlans.transactionId))
    .innerJoin(invoices, eq(invoices.id, installmentPlans.firstInvoiceId))
    .where(
      and(
        eq(installmentPlans.creditCardId, cardId),
        inArray(invoices.referenceMonth, months),
        ne(installmentPlans.status, 'CANCELLED'),
        isNull(transactions.deletedAt),
      ),
    );
  if (plans.length === 0) return [];
  const items = await tx
    .select({
      planId: invoiceItems.installmentPlanId,
      kind: invoiceItems.kind,
      status: invoiceItems.status,
      closing: invoices.closingDate,
    })
    .from(invoiceItems)
    .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
    .where(
      inArray(
        invoiceItems.installmentPlanId,
        plans.map((p) => p.planId),
      ),
    );
  return plans.map((p) => {
    const mine = items.filter((i) => i.planId === p.planId);
    return {
      planId: p.planId,
      description: p.description,
      purchaseDate: p.purchaseDate,
      firstReferenceMonth: p.firstRef,
      onboarding: p.source === 'ONBOARDING',
      movable: mine.every(
        (i) => i.kind === 'INSTALLMENT' && i.status === 'ACTIVE' && compareDates(today, i.closing) < 0,
      ),
    };
  });
}

/** Move todas as parcelas de um plano `delta` faturas (±1), materializando as novas. */
async function shiftPlan(tx: Tx, card: CardRow, planId: string, delta: 1 | -1) {
  const items = await tx
    .select({ id: invoiceItems.id, ref: invoices.referenceMonth, number: invoiceItems.installmentNumber })
    .from(invoiceItems)
    .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
    .where(eq(invoiceItems.installmentPlanId, planId))
    .orderBy(asc(invoiceItems.installmentNumber));
  let firstInvoiceId: string | null = null;
  for (const it of items) {
    const target = await ensureInvoice(tx, card, addMonths(it.ref, delta));
    firstInvoiceId ??= target.id;
    await tx.update(invoiceItems).set({ invoiceId: target.id }).where(eq(invoiceItems.id, it.id));
  }
  if (firstInvoiceId) {
    await tx.update(installmentPlans).set({ firstInvoiceId }).where(eq(installmentPlans.id, planId));
  }
}
