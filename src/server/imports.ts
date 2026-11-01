/**
 * Importação da fatura do cartão por OFX (SPEC §8, D34–D37). Nada entra sem revisão:
 * o upload só grava as linhas e as SUGESTÕES; cada linha é aceita, criada ou ignorada.
 *  - mesmo arquivo 2x → bloqueado (sha256); mesma transação em arquivos sobrepostos → não duplica (FITID);
 *  - um lançamento só concilia com uma linha (índices únicos em import_lines).
 */
import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, isNull, notExists, sql } from 'drizzle-orm';
import {
  categories,
  creditCards,
  importBatches,
  importLines,
  installmentPlans,
  invoiceItems,
  invoices,
  transactions,
} from '@/db/schema';
import { cardRule, ruleInvoice } from '@/domain/card/invoices';
import { addMonths, formatDateBR, monthStart, type ISODate } from '@/domain/dates';
import { formatBRL, splitInstallments } from '@/domain/money';
import { assignMatches, type MatchCandidate } from '@/domain/reconciliation/matching';
import {
  classifyCardLine,
  paymentsOfThisInvoice,
  suggestCategory,
  type CardLine,
} from '@/importers/nubank-card';
import { OfxError } from '@/importers/ofx';
import { readStatement } from '@/importers/statement';
import type { AnyDB } from '@/db/client';
import { audit } from './audit';
import { createCardPurchase, createOnboardingPlan } from './card-purchases';
import { ensureInvoice, loadCard, type CardRow } from './cards';
import { type ServiceCtx, type Tx, UserError } from './context';
import { payInvoice } from './invoice-ops';

/** O que guardamos em import_lines.raw_payload para a revisão. */
export type LinePayload = CardLine & {
  suggestedCategoryId: string | null;
  /** D34: pagamento desta fatura (true), da anterior (false) ou indefinido (null) */
  paysThisInvoice: boolean | null;
};

const asTx = (tx: Tx) => tx as unknown as AnyDB;

// ─────────── upload ───────────

export async function importCardStatement(
  ctx: ServiceCtx,
  input: {
    cardId: string;
    fileName: string;
    bytes: Uint8Array;
    /** só para CSV (que não traz o período): o mês da fatura, 'AAAA-MM-01' */
    referenceMonth?: ISODate;
  },
): Promise<{ batchId: string; inserted: number; skipped: number }> {
  if (input.bytes.byteLength === 0) throw new UserError('O arquivo está vazio.');
  if (input.bytes.byteLength > 900_000) throw new UserError('Arquivo grande demais (máx. 900 KB).');
  const sha = createHash('sha256').update(input.bytes).digest('hex');

  let statement;
  try {
    statement = readStatement(input.bytes, 'CREDIT_CARD');
  } catch (err) {
    if (err instanceof OfxError) throw new UserError(err.message);
    throw err;
  }
  if (statement.account !== 'CREDIT_CARD')
    throw new UserError('Este arquivo é de conta corrente, não de cartão de crédito.');
  const isCsv = statement.format === 'CSV';
  if (isCsv && !input.referenceMonth) {
    throw new UserError('O CSV não traz o período da fatura: escolha o mês da fatura (o mês do vencimento).');
  }
  if (!isCsv && !statement.periodEnd) throw new UserError('O OFX não informa o período da fatura (DTEND).');

  return ctx.db.transaction(async (tx) => {
    const card = await loadCard(tx, input.cardId);
    if (card.kind === 'STORE_CREDIT')
      throw new UserError('Importar extrato de crediário ainda não é possível.');
    const [dup] = await tx
      .select({ createdAt: importBatches.createdAt })
      .from(importBatches)
      .where(eq(importBatches.fileSha256, sha));
    if (dup) throw new UserError('Este arquivo já foi importado.');

    const invoice = isCsv
      ? await ensureInvoice(tx, card, monthStart(input.referenceMonth!))
      : await invoiceOfPeriod(tx, card, statement.periodEnd!);
    const lines = statement.transactions.map(classifyCardLine);
    const ofThis = paymentsOfThisInvoice(lines, statement.ledgerBalanceCents);
    const cats = await tx
      .select({ id: categories.id, kind: categories.kind, botAliases: categories.botAliases })
      .from(categories)
      .where(isNull(categories.archivedAt));

    const [batch] = await tx
      .insert(importBatches)
      .values({
        kind: 'CARD_STATEMENT',
        format: statement.format,
        fileName: input.fileName.slice(0, 255),
        fileSha256: sha,
        creditCardId: card.id,
        invoiceId: invoice.id,
        status: 'IN_REVIEW',
        periodStart: statement.periodStart,
        periodEnd: isCsv ? invoice.closingDate : statement.periodEnd,
        uploadedByUserId: ctx.userId,
      })
      .returning();

    let inserted = 0;
    for (const l of lines) {
      const payload: LinePayload = {
        ...l,
        suggestedCategoryId:
          l.kind === 'PURCHASE' || l.kind === 'INSTALLMENT' ? suggestCategory(l.description, cats) : null,
        paysThisInvoice: l.kind === 'PAYMENT' ? (ofThis ? ofThis.has(l.fitid) : null) : null,
      };
      const [row] = await tx
        .insert(importLines)
        .values({
          batchId: batch!.id,
          creditCardId: card.id,
          dedupKey: l.fitid.slice(0, 128),
          lineDate: l.date,
          amountCents: l.bankAmountCents,
          rawDescription: l.memo,
          rawPayload: { ...payload, ledgerBalanceCents: statement.ledgerBalanceCents },
        })
        .onConflictDoNothing()
        .returning({ id: importLines.id });
      if (row) inserted++;
    }
    await suggestMatches(tx, batch!.id);
    await audit(tx, {
      userId: ctx.userId,
      entity: 'import_batches',
      entityId: batch!.id,
      action: 'CREATE',
      after: {
        fileName: input.fileName,
        sha,
        invoiceId: invoice.id,
        inserted,
        skipped: lines.length - inserted,
      },
    });
    await closeIfDone(tx, batch!.id);
    return { batchId: batch!.id, inserted, skipped: lines.length - inserted };
  });
}

/** A fatura cujo fechamento é o fim do período do arquivo (materializa pela regra se preciso). */
async function invoiceOfPeriod(tx: Tx, card: CardRow, periodEnd: ISODate) {
  const [materialized] = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.creditCardId, card.id), eq(invoices.closingDate, periodEnd)));
  if (materialized) return materialized;
  for (const ref of [monthStart(periodEnd), addMonths(monthStart(periodEnd), 1)]) {
    const w = ruleInvoice(ref, cardRule(card));
    if (w.closingDate === periodEnd) return ensureInvoice(tx, card, ref);
  }
  throw new UserError(
    `O arquivo fecha em ${formatDateBR(periodEnd)}, mas o cartão está configurado para fechar no dia ${card.closingDay}. ` +
      'Ajuste o dia de fechamento do cartão (ou as datas da fatura) e importe de novo.',
  );
}

// ─────────── sugestões (D37) ───────────

const payloadOf = (raw: unknown) => raw as LinePayload;

/** Recalcula as sugestões das linhas pendentes do lote (1:1, sem usar o que já foi conciliado). */
async function suggestMatches(tx: Tx, batchId: string) {
  const [batch] = await tx.select().from(importBatches).where(eq(importBatches.id, batchId));
  const pending = await tx
    .select()
    .from(importLines)
    .where(and(eq(importLines.batchId, batchId), eq(importLines.status, 'PENDING_REVIEW')));
  if (!batch || pending.length === 0) return;
  const cardId = batch.creditCardId!;

  // itens (parcelas) ainda não conciliados com nenhuma linha
  const freeItem = notExists(
    tx
      .select({ x: sql`1` })
      .from(importLines)
      .where(eq(importLines.matchedInvoiceItemId, invoiceItems.id)),
  );
  const items = await tx
    .select({
      id: invoiceItems.id,
      amountCents: invoiceItems.amountCents,
      number: invoiceItems.installmentNumber,
      count: installmentPlans.installmentCount,
      purchaseDate: installmentPlans.purchaseDate,
      description: transactions.description,
    })
    .from(invoiceItems)
    .innerJoin(installmentPlans, eq(installmentPlans.id, invoiceItems.installmentPlanId))
    .innerJoin(transactions, eq(transactions.id, installmentPlans.transactionId))
    .where(
      and(
        eq(invoiceItems.invoiceId, batch.invoiceId!),
        eq(invoiceItems.kind, 'INSTALLMENT'),
        eq(invoiceItems.status, 'ACTIVE'),
        isNull(transactions.deletedAt),
        freeItem,
      ),
    );
  // pagamento livre = não conciliado por outra linha de FATURA; a linha do extrato da conta é outro lado
  const freePayment = sql`not exists (select 1 from import_lines il
    where il.matched_transaction_id = "transactions"."id" and il.credit_card_id is not null)`;
  const payments = await tx
    .select({
      id: transactions.id,
      amountCents: transactions.amountCents,
      date: transactions.postedDate,
      description: transactions.description,
    })
    .from(transactions)
    .innerJoin(invoices, eq(invoices.id, transactions.paidInvoiceId))
    .where(
      and(
        eq(invoices.creditCardId, cardId),
        eq(transactions.kind, 'INVOICE_PAYMENT'),
        isNull(transactions.deletedAt),
        freePayment,
      ),
    );

  const lines = pending.map((p) => ({ row: p, payload: payloadOf(p.rawPayload) }));
  const itemCands: (MatchCandidate & { count: number })[] = items.map((i) => ({
    id: i.id,
    amountCents: i.amountCents,
    date: i.purchaseDate,
    description: i.description,
    installmentNumber: i.count === 1 ? null : i.number,
    count: i.count,
  }));
  const purchaseLines = lines.filter(
    (l) => l.payload.kind === 'PURCHASE' || l.payload.kind === 'INSTALLMENT',
  );
  const itemMatches = assignMatches(
    purchaseLines.map((l) => ({
      id: l.row.id,
      amountCents: l.payload.amountCents,
      date: l.payload.date,
      description: l.payload.description,
      installmentNumber: l.payload.installment?.k ?? null,
    })),
    // parcela k/N só casa com plano de N parcelas
    itemCands,
  ).filter((a) => {
    const line = purchaseLines.find((l) => l.row.id === a.lineId)!;
    const cand = itemCands.find((c) => c.id === a.candidateId)!;
    return line.payload.installment ? cand.count === line.payload.installment.n : cand.count === 1;
  });
  const paymentLines = lines.filter((l) => l.payload.kind === 'PAYMENT');
  const paymentMatches = assignMatches(
    paymentLines.map((l) => ({
      id: l.row.id,
      amountCents: l.payload.amountCents,
      date: l.payload.date,
      description: '',
      installmentNumber: null,
    })),
    payments.map((p) => ({
      id: p.id,
      amountCents: p.amountCents,
      date: p.date!,
      description: '',
      installmentNumber: null,
    })),
  );

  for (const l of lines) {
    const im = itemMatches.find((m) => m.lineId === l.row.id);
    const pm = paymentMatches.find((m) => m.lineId === l.row.id);
    await tx
      .update(importLines)
      .set({
        suggestedInvoiceItemId: im?.candidateId ?? null,
        suggestedTransactionId: pm?.candidateId ?? null,
        matchScore: im?.score ?? pm?.score ?? null,
      })
      .where(eq(importLines.id, l.row.id));
  }
}

/** Recalcula as sugestões das linhas ainda pendentes (ex.: depois de importar o outro lado do mesmo pagamento). */
export async function refreshSuggestions(ctx: ServiceCtx, batchId: string) {
  await ctx.db.transaction(async (tx) => {
    const [b] = await tx.select().from(importBatches).where(eq(importBatches.id, batchId)).for('update');
    if (!b || b.kind !== 'CARD_STATEMENT') throw new UserError('Importação não encontrada.');
    await suggestMatches(tx, batchId);
  });
}

export async function closeIfDone(tx: Tx, batchId: string) {
  const [left] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(importLines)
    .where(and(eq(importLines.batchId, batchId), eq(importLines.status, 'PENDING_REVIEW')));
  await tx
    .update(importBatches)
    .set({ status: (left?.n ?? 0) === 0 ? 'COMPLETED' : 'IN_REVIEW' })
    .where(eq(importBatches.id, batchId));
}

// ─────────── revisão ───────────

async function loadPendingLine(tx: Tx, lineId: string) {
  const [line] = await tx.select().from(importLines).where(eq(importLines.id, lineId)).for('update');
  if (!line) throw new UserError('Linha não encontrada.');
  if (line.status !== 'PENDING_REVIEW') throw new UserError('Esta linha já foi revisada.');
  const [batch] = await tx.select().from(importBatches).where(eq(importBatches.id, line.batchId));
  return { line, batch: batch!, payload: payloadOf(line.rawPayload) };
}

const reviewed = (ctx: ServiceCtx) => ({ reviewedByUserId: ctx.userId, reviewedAt: new Date() });

/** Aceita a sugestão (ou outro candidato escolhido em "trocar"). */
export async function acceptMatch(ctx: ServiceCtx, lineId: string, candidateId?: string) {
  return ctx.db.transaction(async (tx) => {
    const { line, batch, payload } = await loadPendingLine(tx, lineId);
    if (payload.kind === 'PAYMENT') {
      const id = candidateId ?? line.suggestedTransactionId;
      if (!id) throw new UserError('Esta linha não tem um pagamento correspondente.');
      const [t] = await tx.select().from(transactions).where(eq(transactions.id, id));
      if (!t || t.kind !== 'INVOICE_PAYMENT' || t.deletedAt || t.amountCents !== payload.amountCents) {
        throw new UserError('O pagamento escolhido não corresponde a esta linha.');
      }
      await tx
        .update(importLines)
        .set({ status: 'MATCHED', matchedTransactionId: id, ...reviewed(ctx) })
        .where(eq(importLines.id, lineId));
    } else if (payload.kind === 'PURCHASE' || payload.kind === 'INSTALLMENT') {
      const id = candidateId ?? line.suggestedInvoiceItemId;
      if (!id) throw new UserError('Esta linha não tem um lançamento correspondente.');
      const [it] = await tx.select().from(invoiceItems).where(eq(invoiceItems.id, id));
      if (
        !it ||
        it.creditCardId !== batch.creditCardId ||
        it.status !== 'ACTIVE' ||
        it.amountCents !== payload.amountCents
      ) {
        throw new UserError(
          'O lançamento escolhido não corresponde a esta linha (valor ou cartão diferente).',
        );
      }
      await tx
        .update(importLines)
        .set({ status: 'MATCHED', matchedInvoiceItemId: id, ...reviewed(ctx) })
        .where(eq(importLines.id, lineId));
    } else {
      throw new UserError(
        'Créditos/estornos ainda não podem ser conciliados: registre pela tela da compra e ignore a linha.',
      );
    }
    await audit(tx, {
      userId: ctx.userId,
      entity: 'import_lines',
      entityId: lineId,
      action: 'UPDATE',
      after: { status: 'MATCHED', candidateId },
    });
    await closeIfDone(tx, line.batchId);
  });
}

export async function ignoreLine(ctx: ServiceCtx, lineId: string) {
  return ctx.db.transaction(async (tx) => {
    const { line } = await loadPendingLine(tx, lineId);
    await tx
      .update(importLines)
      .set({ status: 'IGNORED', ...reviewed(ctx) })
      .where(eq(importLines.id, lineId));
    await audit(tx, {
      userId: ctx.userId,
      entity: 'import_lines',
      entityId: lineId,
      action: 'UPDATE',
      after: { status: 'IGNORED' },
    });
    await closeIfDone(tx, line.batchId);
  });
}

/**
 * Ignora várias linhas de uma vez (qualquer tipo de lote). SELECTED: as marcadas. EXCEPT: todas as pendentes
 * menos as marcadas (cartão adicional: a fatura é do titular e quase tudo nela não é do casal).
 */
export async function ignoreLines(
  ctx: ServiceCtx,
  batchId: string,
  input: { mode: 'SELECTED' | 'EXCEPT'; lineIds: string[] },
): Promise<number> {
  return ctx.db.transaction(async (tx) => {
    const [batch] = await tx.select().from(importBatches).where(eq(importBatches.id, batchId)).for('update');
    if (!batch) throw new UserError('Importação não encontrada.');
    const chosen = new Set(input.lineIds);
    if (input.mode === 'SELECTED' && chosen.size === 0)
      throw new UserError('Marque as linhas que quer ignorar.');
    const pending = await tx
      .select({ id: importLines.id })
      .from(importLines)
      .where(and(eq(importLines.batchId, batchId), eq(importLines.status, 'PENDING_REVIEW')));
    const targets = pending.filter((l) => (input.mode === 'SELECTED' ? chosen.has(l.id) : !chosen.has(l.id)));
    if (targets.length === 0) throw new UserError('Nenhuma linha pendente para ignorar.');
    await tx
      .update(importLines)
      .set({ status: 'IGNORED', ...reviewed(ctx) })
      .where(
        inArray(
          importLines.id,
          targets.map((t) => t.id),
        ),
      );
    await audit(tx, {
      userId: ctx.userId,
      entity: 'import_batches',
      entityId: batchId,
      action: 'UPDATE',
      after: { ignoredLines: targets.length, mode: input.mode },
    });
    await closeIfDone(tx, batchId);
    return targets.length;
  });
}

export type CreateFromLineInput = {
  description: string;
  categoryId: string;
  beneficiaryUserId: string | null;
  /** D36: total da compra, obrigatório para "Parcela 1/N" */
  total: number | null;
  /** D34: pagamento → fatura do arquivo ('THIS') ou a anterior ('PREVIOUS') */
  paymentTarget: 'THIS' | 'PREVIOUS' | null;
};

const PREVIOUS_BALANCE = 'Saldo da fatura anterior ao controle';

/** Cria o lançamento a partir da linha (D34–D37). */
/** D18 com o caminho para resolver: período anterior ao início do controle (D50). */
export function withBackfillHint(err: unknown): unknown {
  if (
    err instanceof UserError &&
    err.message.startsWith('A data não pode ser anterior ao início do controle')
  ) {
    return new UserError(
      `${err.message} Para lançar este período, importe antes o extrato da conta dele (o app recua o início do controle sozinho) ou ajuste o saldo inicial em Ajustes.`,
    );
  }
  return err;
}

export async function createFromLine(ctx: ServiceCtx, lineId: string, input: CreateFromLineInput) {
  try {
    return await createFromLineTx(ctx, lineId, input);
  } catch (err) {
    throw withBackfillHint(err);
  }
}

async function createFromLineTx(ctx: ServiceCtx, lineId: string, input: CreateFromLineInput) {
  return ctx.db.transaction(async (tx) => {
    const { line, batch, payload } = await loadPendingLine(tx, lineId);
    const sub: ServiceCtx = { ...ctx, db: asTx(tx) };
    const card = await loadCard(tx, batch.creditCardId!);
    const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, batch.invoiceId!));

    let matched: { matchedInvoiceItemId?: string; matchedTransactionId?: string };
    if (payload.kind === 'PAYMENT') {
      const target = input.paymentTarget ?? (payload.paysThisInvoice === false ? 'PREVIOUS' : 'THIS');
      let targetInvoice = invoice!;
      if (target === 'PREVIOUS') {
        targetInvoice = await ensureInvoice(tx, card, addMonths(invoice!.referenceMonth, -1));
        const [hasItems] = await tx
          .select({ id: invoiceItems.id })
          .from(invoiceItems)
          .where(and(eq(invoiceItems.invoiceId, targetInvoice.id), eq(invoiceItems.status, 'ACTIVE')))
          .limit(1);
        if (!hasItems) {
          // D34: fatura anterior ao controle — o saldo entra como ajuste para o limite fechar
          const [adj] = await tx
            .insert(invoiceItems)
            .values({
              invoiceId: targetInvoice.id,
              creditCardId: card.id,
              kind: 'ADJUSTMENT',
              amountCents: payload.amountCents,
              description: PREVIOUS_BALANCE,
              postingDate: targetInvoice.closingDate,
            })
            .returning();
          await audit(tx, {
            userId: ctx.userId,
            entity: 'invoice_items',
            entityId: adj!.id,
            action: 'CREATE',
            after: adj,
          });
        }
      }
      const { transactionId } = await payInvoice(sub, targetInvoice.id, {
        amount: payload.amountCents,
        date: payload.date,
        paymentMethod: 'OTHER',
      });
      matched = { matchedTransactionId: transactionId };
    } else if (
      payload.kind === 'PURCHASE' ||
      (payload.kind === 'INSTALLMENT' && payload.installment!.k === 1)
    ) {
      const n = payload.installment?.n ?? 1;
      const total = n === 1 ? payload.amountCents : input.total;
      if (!total) throw new UserError('Informe o valor total da compra parcelada (confira no app do banco).');
      if (total < n) throw new UserError('Cada parcela precisa ter pelo menos R$ 0,01.');
      const first = splitInstallments(total, n)[0]!;
      if (first !== payload.amountCents) {
        throw new UserError(
          `Com o total de ${formatBRL(total)}, a 1ª parcela seria ${formatBRL(first)}, mas na fatura ela é ${formatBRL(payload.amountCents)}.`,
        );
      }
      const { planId } = await createCardPurchase(
        sub,
        {
          cardId: card.id,
          amount: total,
          installments: n,
          description: input.description,
          categoryId: input.categoryId,
          date: payload.date,
          beneficiaryUserId: input.beneficiaryUserId,
          notes: null,
        },
        'MANUAL',
      );
      matched = { matchedInvoiceItemId: await itemOf(tx, planId, 1, batch.invoiceId!) };
      await tx
        .update(transactions)
        .set({ source: 'IMPORT' })
        .where(eq(transactions.id, await txOfPlan(tx, planId)));
    } else if (payload.kind === 'INSTALLMENT') {
      // D35: parcelamento de antes do controle → onboarding a partir da parcela k
      const { k, n } = payload.installment!;
      const { planId } = await createOnboardingPlan(sub, {
        cardId: card.id,
        description: input.description,
        total: payload.amountCents * n,
        installments: n,
        currentInstallment: k,
        purchaseDate: addMonths(payload.date, -(k - 1)),
        currentInvoiceMonth: invoice!.referenceMonth,
        categoryId: input.categoryId,
        beneficiaryUserId: input.beneficiaryUserId,
      });
      matched = { matchedInvoiceItemId: await itemOf(tx, planId, k, batch.invoiceId!) };
    } else {
      throw new UserError(
        'Créditos/estornos ainda não são criados pela importação: registre pela tela da compra e ignore a linha.',
      );
    }

    await tx
      .update(importLines)
      .set({ status: 'CREATED', ...matched, ...reviewed(ctx) })
      .where(eq(importLines.id, lineId));
    await audit(tx, {
      userId: ctx.userId,
      entity: 'import_lines',
      entityId: lineId,
      action: 'CREATE',
      after: matched,
    });
    await closeIfDone(tx, line.batchId);
  });
}

async function txOfPlan(tx: Tx, planId: string) {
  const [p] = await tx
    .select({ t: installmentPlans.transactionId })
    .from(installmentPlans)
    .where(eq(installmentPlans.id, planId));
  return p!.t;
}

/** Item da parcela k do plano; precisa estar na fatura do arquivo (D37). */
async function itemOf(tx: Tx, planId: string, k: number, invoiceId: string) {
  const [it] = await tx
    .select({ id: invoiceItems.id, invoiceId: invoiceItems.invoiceId })
    .from(invoiceItems)
    .where(and(eq(invoiceItems.installmentPlanId, planId), eq(invoiceItems.installmentNumber, k)));
  if (!it || it.invoiceId !== invoiceId) {
    throw new UserError(
      'A compra cairia em outra fatura pela data. Confira os dias de fechamento do cartão (ou as datas da fatura) antes de importar.',
    );
  }
  return it.id;
}

// ─────────── ações em lote ───────────

/** Aceita todas as sugestões pendentes do lote. */
export async function acceptAllSuggestions(ctx: ServiceCtx, batchId: string): Promise<number> {
  const pending = await ctx.db
    .select({ id: importLines.id })
    .from(importLines)
    .where(
      and(
        eq(importLines.batchId, batchId),
        eq(importLines.status, 'PENDING_REVIEW'),
        sql`(${importLines.suggestedInvoiceItemId} is not null or ${importLines.suggestedTransactionId} is not null)`,
      ),
    );
  for (const p of pending) await acceptMatch(ctx, p.id);
  return pending.length;
}

export type BatchCreateResult = {
  created: number;
  skipped: { lineId: string; description: string; reason: string }[];
};

/**
 * Cria todos os lançamentos novos (sem sugestão) com a categoria sugerida (ou "A classificar").
 * Pula a "Parcela 1/N" (precisa do total confirmado, D36) e os créditos.
 */
export async function createAllNew(ctx: ServiceCtx, batchId: string): Promise<BatchCreateResult> {
  const [fallback] = await ctx.db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.name, 'A classificar'), eq(categories.kind, 'EXPENSE')));
  const pending = await ctx.db
    .select()
    .from(importLines)
    .where(
      and(
        eq(importLines.batchId, batchId),
        eq(importLines.status, 'PENDING_REVIEW'),
        isNull(importLines.suggestedInvoiceItemId),
        isNull(importLines.suggestedTransactionId),
      ),
    )
    .orderBy(asc(importLines.lineDate));
  const result: BatchCreateResult = { created: 0, skipped: [] };
  for (const l of pending) {
    const p = payloadOf(l.rawPayload);
    if (p.kind === 'CREDIT' || (p.kind === 'INSTALLMENT' && p.installment!.k === 1)) {
      result.skipped.push({
        lineId: l.id,
        description: p.description,
        reason: p.kind === 'CREDIT' ? 'crédito/estorno' : 'confirme o total da compra',
      });
      continue;
    }
    try {
      await createFromLine(ctx, l.id, {
        description: p.description,
        categoryId: p.suggestedCategoryId ?? fallback!.id,
        beneficiaryUserId: null,
        total: null,
        paymentTarget: null,
      });
      result.created++;
    } catch (err) {
      if (!(err instanceof UserError)) throw err;
      result.skipped.push({ lineId: l.id, description: p.description, reason: err.message });
    }
  }
  return result;
}

/** Cartões do lote (para checagem de acesso das telas). */
export async function batchCardId(db: AnyDB, batchId: string) {
  const [b] = await db
    .select({ cardId: importBatches.creditCardId })
    .from(importBatches)
    .innerJoin(creditCards, eq(creditCards.id, importBatches.creditCardId))
    .where(eq(importBatches.id, batchId));
  return b?.cardId ?? null;
}
