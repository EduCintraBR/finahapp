/**
 * Importação do extrato da conta por OFX (SPEC §8, D45–D47). Como no cartão: o upload só grava
 * as linhas e as SUGESTÕES; cada linha é aceita (concilia/dá baixa), criada ou ignorada.
 */
import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { AnyDB } from '@/db/client';
import { categories, creditCards, importBatches, importLines, transactions, users } from '@/db/schema';
import { checkNotBeforeOpening } from '@/domain/account/rules';
import { assignMatches, type MatchCandidate } from '@/domain/reconciliation/matching';
import { classifyAccountLine, type AccountLine, type AccountLineKind } from '@/importers/nubank-account';
import { suggestCategory } from '@/importers/nubank-card';
import { decodeOfx, OfxError, parseOfx } from '@/importers/ofx';
import { audit } from './audit';
import { type ServiceCtx, type Tx, UserError } from './context';
import { confirmPayment, createEntry, getPrimaryAccount } from './entries';
import { closeIfDone } from './imports';
import { payInvoice } from './invoice-ops';

export type AccountLinePayload = AccountLine & {
  suggestedCategoryId: string | null;
  ledgerBalanceCents: number | null;
};

const asTx = (tx: Tx) => tx as unknown as AnyDB;
const payloadOf = (raw: unknown) => raw as AccountLinePayload;

const OUT_KINDS = [
  'EXPENSE',
  'INVOICE_PAYMENT',
  'ANTICIPATION_PAYMENT',
  'TRANSFER_OUT',
  'ADJUSTMENT_OUT',
] as const;
const IN_KINDS = ['INCOME', 'TRANSFER_IN', 'ADJUSTMENT_IN'] as const;

export async function importAccountStatement(
  ctx: ServiceCtx,
  input: { fileName: string; bytes: Uint8Array },
): Promise<{ batchId: string; inserted: number; skipped: number }> {
  if (input.bytes.byteLength === 0) throw new UserError('O arquivo está vazio.');
  if (input.bytes.byteLength > 900_000) throw new UserError('Arquivo grande demais (máx. 900 KB).');
  const sha = createHash('sha256').update(input.bytes).digest('hex');
  let statement;
  try {
    statement = parseOfx(decodeOfx(input.bytes));
  } catch (err) {
    if (err instanceof OfxError) throw new UserError(err.message);
    throw err;
  }
  if (statement.account !== 'BANK')
    throw new UserError('Este OFX é de cartão de crédito: importe pela tela do cartão.');

  return ctx.db.transaction(async (tx) => {
    const account = await getPrimaryAccount(tx);
    const [dup] = await tx
      .select({ id: importBatches.id })
      .from(importBatches)
      .where(eq(importBatches.fileSha256, sha));
    if (dup) throw new UserError('Este arquivo já foi importado.');
    const early = statement.transactions.find((t) =>
      checkNotBeforeOpening(t.date, account.openingBalanceDate),
    );
    if (early) {
      throw new UserError(
        `${checkNotBeforeOpening(early.date, account.openingBalanceDate)} O arquivo tem lançamentos de ${early.date.split('-').reverse().join('/')}. Exporte a partir do início do controle.`,
      );
    }

    const owners = (await tx.select({ name: users.name }).from(users)).map(
      (u) => u.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/)[0] ?? '',
    );
    const holders = (
      await tx
        .select({ holderName: creditCards.holderName })
        .from(creditCards)
        .where(and(eq(creditCards.isAdditional, true), isNull(creditCards.archivedAt)))
    ).flatMap((c) => (c.holderName ? [c.holderName] : []));
    const cats = await tx
      .select({ id: categories.id, kind: categories.kind, botAliases: categories.botAliases })
      .from(categories)
      .where(isNull(categories.archivedAt));

    const [batch] = await tx
      .insert(importBatches)
      .values({
        kind: 'BANK_STATEMENT',
        format: 'OFX',
        fileName: input.fileName.slice(0, 255),
        fileSha256: sha,
        bankAccountId: account.id,
        status: 'IN_REVIEW',
        periodStart: statement.periodStart,
        periodEnd: statement.periodEnd,
        uploadedByUserId: ctx.userId,
      })
      .returning();

    let inserted = 0;
    for (const t of statement.transactions) {
      const line = classifyAccountLine(t, owners, holders);
      const payload: AccountLinePayload = {
        ...line,
        suggestedCategoryId:
          line.suggestedKind === 'EXPENSE' ? suggestCategory(line.description, cats) : null,
        ledgerBalanceCents: statement.ledgerBalanceCents,
      };
      const [row] = await tx
        .insert(importLines)
        .values({
          batchId: batch!.id,
          bankAccountId: account.id,
          dedupKey: t.fitid.slice(0, 128),
          lineDate: t.date,
          amountCents: t.amountCents,
          rawDescription: t.memo,
          rawPayload: payload,
        })
        .onConflictDoNothing()
        .returning({ id: importLines.id });
      if (row) inserted++;
    }
    await suggestAccountMatches(tx, batch!.id, account.id);
    await audit(tx, {
      userId: ctx.userId,
      entity: 'import_batches',
      entityId: batch!.id,
      action: 'CREATE',
      after: { fileName: input.fileName, sha, inserted, skipped: statement.transactions.length - inserted },
    });
    await closeIfDone(tx, batch!.id);
    return { batchId: batch!.id, inserted, skipped: statement.transactions.length - inserted };
  });
}

/** D47: mesmo valor, mesma direção, data ±3 dias (pendente pelo vencimento); 1:1. */
async function suggestAccountMatches(tx: Tx, batchId: string, accountId: string) {
  const pending = await tx
    .select()
    .from(importLines)
    .where(and(eq(importLines.batchId, batchId), eq(importLines.status, 'PENDING_REVIEW')));
  if (pending.length === 0) return;
  // livre = ainda não conciliado por OUTRA linha de extrato da conta; o mesmo pagamento de fatura
  // pode (e deve) estar conciliado também com a linha da fatura do cartão
  const free = sql`not exists (select 1 from import_lines il
    where il.matched_transaction_id = "transactions"."id" and il.bank_account_id is not null)`;
  const cands = await tx
    .select({
      id: transactions.id,
      kind: transactions.kind,
      amountCents: transactions.amountCents,
      date: sql<string>`coalesce(${transactions.postedDate}, ${transactions.dueDate}, ${transactions.transactionDate})::text`,
      description: transactions.description,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.bankAccountId, accountId),
        isNull(transactions.deletedAt),
        inArray(transactions.status, ['POSTED', 'PENDING']),
        free,
      ),
    );
  const lines = pending.map((p) => ({ row: p, payload: payloadOf(p.rawPayload) }));
  const toMatch = (dir: 'IN' | 'OUT') => {
    const kinds: readonly string[] = dir === 'OUT' ? OUT_KINDS : IN_KINDS;
    const ls = lines.filter((l) => l.payload.direction === dir);
    const cs: MatchCandidate[] = cands
      .filter((c) => kinds.includes(c.kind))
      .map((c) => ({
        id: c.id,
        amountCents: c.amountCents,
        date: c.date,
        description: c.description,
        installmentNumber: null,
      }));
    return assignMatches(
      ls.map((l) => ({
        id: l.row.id,
        amountCents: l.payload.amountCents,
        date: l.payload.date,
        description: l.payload.description,
        installmentNumber: null,
      })),
      cs,
    );
  };
  const matches = [...toMatch('OUT'), ...toMatch('IN')];
  for (const l of lines) {
    const m = matches.find((x) => x.lineId === l.row.id);
    await tx
      .update(importLines)
      .set({ suggestedTransactionId: m?.candidateId ?? null, matchScore: m?.score ?? null })
      .where(eq(importLines.id, l.row.id));
  }
}

async function loadPendingLine(tx: Tx, lineId: string) {
  const [line] = await tx.select().from(importLines).where(eq(importLines.id, lineId)).for('update');
  if (!line || !line.bankAccountId) throw new UserError('Linha não encontrada.');
  if (line.status !== 'PENDING_REVIEW') throw new UserError('Esta linha já foi revisada.');
  return { line, payload: payloadOf(line.rawPayload) };
}

const reviewed = (ctx: ServiceCtx) => ({ reviewedByUserId: ctx.userId, reviewedAt: new Date() });

/** Aceita a sugestão; se o lançamento estiver pendente, dá a baixa com a data e o valor da linha. */
export async function acceptAccountMatch(ctx: ServiceCtx, lineId: string, candidateId?: string) {
  return ctx.db.transaction(async (tx) => {
    const { line, payload } = await loadPendingLine(tx, lineId);
    const id = candidateId ?? line.suggestedTransactionId;
    if (!id) throw new UserError('Esta linha não tem um lançamento correspondente.');
    const [t] = await tx.select().from(transactions).where(eq(transactions.id, id));
    const kinds: readonly string[] = payload.direction === 'OUT' ? OUT_KINDS : IN_KINDS;
    if (
      !t ||
      t.deletedAt ||
      t.bankAccountId !== line.bankAccountId ||
      !kinds.includes(t.kind) ||
      t.amountCents !== payload.amountCents
    ) {
      throw new UserError(
        'O lançamento escolhido não corresponde a esta linha (valor, direção ou conta diferentes).',
      );
    }
    if (t.status === 'PENDING') {
      await confirmPayment({ ...ctx, db: asTx(tx) }, t.id, t.version, {
        date: payload.date,
        amount: payload.amountCents,
      });
    }
    await tx
      .update(importLines)
      .set({ status: 'MATCHED', matchedTransactionId: id, ...reviewed(ctx) })
      .where(eq(importLines.id, lineId));
    await audit(tx, {
      userId: ctx.userId,
      entity: 'import_lines',
      entityId: lineId,
      action: 'UPDATE',
      after: { status: 'MATCHED', id },
    });
    await closeIfDone(tx, line.batchId);
  });
}

export type CreateAccountLineInput = {
  kind: AccountLineKind;
  description: string;
  categoryId: string | null;
  beneficiaryUserId: string | null;
  /** obrigatório para pagamento de fatura (D46) */
  invoiceId: string | null;
};

export async function createFromAccountLine(ctx: ServiceCtx, lineId: string, input: CreateAccountLineInput) {
  return ctx.db.transaction(async (tx) => {
    const { line, payload } = await loadPendingLine(tx, lineId);
    const sub: ServiceCtx = { ...ctx, db: asTx(tx) };
    const out = payload.direction === 'OUT';
    let transactionId: string;

    if (input.kind === 'EXPENSE' || input.kind === 'INCOME') {
      if ((input.kind === 'EXPENSE') !== out) {
        throw new UserError(
          out
            ? 'Esta linha é uma saída: lance como despesa.'
            : 'Esta linha é uma entrada: lance como receita.',
        );
      }
      if (!input.categoryId) throw new UserError('Escolha uma categoria.');
      transactionId = (
        await createEntry(sub, {
          kind: input.kind,
          amount: payload.amountCents,
          description: input.description,
          categoryId: input.categoryId,
          paymentMethod: payload.paymentMethod,
          date: payload.date,
          beneficiaryUserId: input.beneficiaryUserId,
          notes: null,
        })
      ).id;
      await tx.update(transactions).set({ source: 'IMPORT' }).where(eq(transactions.id, transactionId));
    } else if (input.kind === 'TRANSFER') {
      // D45: entre contas próprias / investimento — mexe no saldo, não é gasto nem receita
      const account = await getPrimaryAccount(tx);
      const [t] = await tx
        .insert(transactions)
        .values({
          kind: out ? 'TRANSFER_OUT' : 'TRANSFER_IN',
          status: 'POSTED',
          description: input.description,
          amountCents: payload.amountCents,
          paymentMethod: payload.paymentMethod,
          bankAccountId: account.id,
          transactionDate: payload.date,
          postedDate: payload.date,
          transferGroupId: randomUUID(),
          createdByUserId: ctx.userId,
          source: 'IMPORT',
        })
        .returning();
      transactionId = t!.id;
      await audit(tx, {
        userId: ctx.userId,
        entity: 'transactions',
        entityId: t!.id,
        action: 'CREATE',
        after: t,
      });
    } else {
      // D46: pagamento de fatura (inclusive Pix para a titular do adicional)
      if (!out) throw new UserError('Pagamento de fatura é sempre uma saída.');
      if (!input.invoiceId) throw new UserError('Escolha a fatura paga.');
      transactionId = (
        await payInvoice(sub, input.invoiceId, {
          amount: payload.amountCents,
          date: payload.date,
          paymentMethod: payload.paymentMethod === 'CASH' ? 'OTHER' : payload.paymentMethod,
        })
      ).transactionId;
    }

    await tx
      .update(importLines)
      .set({ status: 'CREATED', matchedTransactionId: transactionId, ...reviewed(ctx) })
      .where(eq(importLines.id, lineId));
    await audit(tx, {
      userId: ctx.userId,
      entity: 'import_lines',
      entityId: lineId,
      action: 'CREATE',
      after: { transactionId, kind: input.kind },
    });
    await closeIfDone(tx, line.batchId);
  });
}

export async function acceptAllAccountSuggestions(ctx: ServiceCtx, batchId: string): Promise<number> {
  const pending = await ctx.db
    .select({ id: importLines.id })
    .from(importLines)
    .where(
      and(
        eq(importLines.batchId, batchId),
        eq(importLines.status, 'PENDING_REVIEW'),
        sql`${importLines.suggestedTransactionId} is not null`,
      ),
    );
  for (const p of pending) await acceptAccountMatch(ctx, p.id);
  return pending.length;
}

export type AccountBatchResult = {
  created: number;
  skipped: { lineId: string; description: string; reason: string }[];
};

/** Cria as linhas novas com o tipo e a categoria sugeridos. Pagamento de fatura sem par pede a fatura. */
export async function createAllNewAccountLines(
  ctx: ServiceCtx,
  batchId: string,
): Promise<AccountBatchResult> {
  const fallbacks = await ctx.db
    .select({ id: categories.id, name: categories.name, kind: categories.kind })
    .from(categories)
    .where(inArray(categories.name, ['A classificar', 'Outras receitas']));
  const fallbackOf = (kind: 'EXPENSE' | 'INCOME') =>
    fallbacks.find(
      (c) => c.kind === kind && c.name === (kind === 'EXPENSE' ? 'A classificar' : 'Outras receitas'),
    )?.id ?? null;
  const pending = await ctx.db
    .select()
    .from(importLines)
    .where(
      and(
        eq(importLines.batchId, batchId),
        eq(importLines.status, 'PENDING_REVIEW'),
        isNull(importLines.suggestedTransactionId),
      ),
    )
    .orderBy(asc(importLines.lineDate));
  const result: AccountBatchResult = { created: 0, skipped: [] };
  for (const l of pending) {
    const p = payloadOf(l.rawPayload);
    if (p.suggestedKind === 'INVOICE_PAYMENT') {
      result.skipped.push({ lineId: l.id, description: p.description, reason: 'escolha a fatura paga' });
      continue;
    }
    try {
      await createFromAccountLine(ctx, l.id, {
        kind: p.suggestedKind,
        description: p.description,
        categoryId:
          p.suggestedKind === 'EXPENSE'
            ? (p.suggestedCategoryId ?? fallbackOf('EXPENSE'))
            : p.suggestedKind === 'INCOME'
              ? fallbackOf('INCOME')
              : null,
        beneficiaryUserId: null,
        invoiceId: null,
      });
      result.created++;
    } catch (err) {
      if (!(err instanceof UserError)) throw err;
      result.skipped.push({ lineId: l.id, description: p.description, reason: err.message });
    }
  }
  return result;
}
