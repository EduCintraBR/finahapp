/**
 * Lançamentos da conta principal (Fase 2): receita e despesa à vista, ocorrências de fixos,
 * baixa ("Confirmar pagamento") e estorno da baixa.
 * Toda escrita: db.transaction() + audit_log + lock otimista (coluna version).
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { bankAccounts, categories, transactions, users } from '@/db/schema';
import { checkNotBeforeOpening } from '@/domain/account/rules';
import { audit } from './audit';
import { type ServiceCtx, type Tx, UserError } from './context';
import type { ConfirmPaymentInput, EntryInput } from './schemas';

type TxRow = typeof transactions.$inferSelect;

export async function getPrimaryAccount(tx: Tx) {
  const [acc] = await tx
    .select({ id: bankAccounts.id, openingBalanceDate: bankAccounts.openingBalanceDate })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.isPrimary, true), isNull(bankAccounts.archivedAt)));
  if (!acc) throw new UserError('A conta principal ainda não foi configurada (rode o seed).');
  return acc;
}

/** `keepId`: a categoria atual do lançamento pode continuar mesmo arquivada (D49). */
async function checkCategory(tx: Tx, categoryId: string, kind: 'INCOME' | 'EXPENSE', keepId?: string | null) {
  const [cat] = await tx
    .select({ kind: categories.kind, archivedAt: categories.archivedAt })
    .from(categories)
    .where(eq(categories.id, categoryId));
  if (!cat || (cat.archivedAt && categoryId !== keepId)) throw new UserError('Categoria não encontrada.');
  if (cat.kind !== kind) {
    throw new UserError(
      kind === 'INCOME' ? 'Escolha uma categoria de receita.' : 'Escolha uma categoria de despesa.',
    );
  }
}

async function checkUser(tx: Tx, userId: string | null) {
  if (userId === null) return;
  const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!u) throw new UserError('Pessoa não encontrada.');
}

async function loadForUpdate(tx: Tx, id: string): Promise<TxRow> {
  const [row] = await tx
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), isNull(transactions.deletedAt)))
    .for('update');
  if (!row) throw new UserError('Lançamento não encontrado.');
  return row;
}

function checkVersion(row: TxRow, version: number) {
  if (row.version !== version) {
    throw new UserError(
      'Este lançamento foi alterado por outra pessoa. Recarregue a página e tente de novo.',
    );
  }
}

function checkEditableKind(row: TxRow, opts: { allowTransfer?: boolean } = {}) {
  const transfer = row.kind === 'TRANSFER_IN' || row.kind === 'TRANSFER_OUT';
  if (row.kind !== 'INCOME' && row.kind !== 'EXPENSE' && !(opts.allowTransfer && transfer)) {
    throw new UserError('Este tipo de lançamento não pode ser alterado por aqui.');
  }
  if (row.bankAccountId === null) throw new UserError('Compras no cartão são editadas na tela do cartão.');
}

/** Snapshot sem campos internos, para o audit_log. */
const snapshot = (r: Partial<TxRow>) => {
  const { createdAt: _c, updatedAt: _u, ...rest } = r;
  return rest;
};

export async function createEntry(
  ctx: ServiceCtx,
  input: EntryInput,
  source: 'MANUAL' | 'BOT' = 'MANUAL',
): Promise<{ id: string }> {
  return ctx.db.transaction(async (tx) => {
    const account = await getPrimaryAccount(tx);
    const dateError = checkNotBeforeOpening(input.date, account.openingBalanceDate);
    if (dateError) throw new UserError(dateError);
    await checkCategory(tx, input.categoryId, input.kind);
    await checkUser(tx, input.beneficiaryUserId);

    const [row] = await tx
      .insert(transactions)
      .values({
        kind: input.kind,
        status: 'POSTED',
        description: input.description,
        notes: input.notes,
        amountCents: input.amount,
        paymentMethod: input.paymentMethod,
        bankAccountId: account.id,
        categoryId: input.categoryId,
        transactionDate: input.date,
        postedDate: input.date,
        createdByUserId: ctx.userId,
        beneficiaryUserId: input.beneficiaryUserId,
        source,
      })
      .returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'transactions',
      entityId: row!.id,
      action: 'CREATE',
      after: snapshot(row!),
    });
    return { id: row!.id };
  });
}

/**
 * Edita um lançamento. Pago: a data move transaction_date e posted_date.
 * Pendente (ocorrência de fixo): a data é o vencimento e o valor é a estimativa.
 */
export async function updateEntry(ctx: ServiceCtx, id: string, version: number, input: EntryInput) {
  return ctx.db.transaction(async (tx) => {
    const row = await loadForUpdate(tx, id);
    checkVersion(row, version);
    checkEditableKind(row);
    if (row.status === 'CANCELLED') throw new UserError('Lançamento cancelado não pode ser editado.');
    const account = await getPrimaryAccount(tx);
    const dateError = checkNotBeforeOpening(input.date, account.openingBalanceDate);
    if (dateError) throw new UserError(dateError);
    await checkCategory(tx, input.categoryId, input.kind, row.categoryId);
    await checkUser(tx, input.beneficiaryUserId);

    const pending = row.status === 'PENDING';
    const [updated] = await tx
      .update(transactions)
      .set({
        kind: input.kind,
        description: input.description,
        notes: input.notes,
        amountCents: input.amount,
        paymentMethod: input.paymentMethod,
        categoryId: input.categoryId,
        beneficiaryUserId: input.beneficiaryUserId,
        transactionDate: input.date,
        ...(pending ? { dueDate: input.date } : { postedDate: input.date }),
        version: sql`${transactions.version} + 1`,
      })
      .where(eq(transactions.id, id))
      .returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'transactions',
      entityId: id,
      action: 'UPDATE',
      before: snapshot(row),
      after: snapshot(updated!),
    });
  });
}

/**
 * Remove um lançamento (nunca apaga fisicamente — invariante 7).
 * Ocorrência de fixo → status CANCELLED (a geração não a recria); avulso → deleted_at.
 */
export async function removeEntry(ctx: ServiceCtx, id: string, version: number) {
  return ctx.db.transaction(async (tx) => {
    const row = await loadForUpdate(tx, id);
    checkVersion(row, version);
    checkEditableKind(row, { allowTransfer: true }); // transferência pode ser excluída, não editada
    const isOccurrence = row.recurringTemplateId !== null;
    const [updated] = await tx
      .update(transactions)
      .set(
        isOccurrence
          ? { status: 'CANCELLED', version: sql`${transactions.version} + 1` }
          : { deletedAt: new Date(), version: sql`${transactions.version} + 1` },
      )
      .where(eq(transactions.id, id))
      .returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'transactions',
      entityId: id,
      action: isOccurrence ? 'CANCEL' : 'DELETE',
      before: snapshot(row),
      after: snapshot(updated!),
    });
  });
}

/** Baixa: PENDING → POSTED com data e valor reais; a estimativa fica em estimated_amount_cents. */
export async function confirmPayment(
  ctx: ServiceCtx,
  id: string,
  version: number,
  input: ConfirmPaymentInput,
) {
  return ctx.db.transaction(async (tx) => {
    const row = await loadForUpdate(tx, id);
    checkVersion(row, version);
    if (row.status !== 'PENDING') throw new UserError('Este lançamento não está pendente.');
    if (row.bankAccountId === null) throw new UserError('Lançamento sem conta bancária.');
    const account = await getPrimaryAccount(tx);
    const dateError = checkNotBeforeOpening(input.date, account.openingBalanceDate);
    if (dateError) throw new UserError(dateError);

    const [updated] = await tx
      .update(transactions)
      .set({
        status: 'POSTED',
        postedDate: input.date,
        estimatedAmountCents: row.amountCents,
        amountCents: input.amount,
        version: sql`${transactions.version} + 1`,
      })
      .where(eq(transactions.id, id))
      .returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'transactions',
      entityId: id,
      action: 'CONFIRM_PAYMENT',
      before: snapshot(row),
      after: snapshot(updated!),
    });
  });
}

/** Estornar baixa (D16): volta a PENDING, valor volta ao estimado, posted_date limpo. */
export async function revertPayment(ctx: ServiceCtx, id: string, version: number) {
  return ctx.db.transaction(async (tx) => {
    const row = await loadForUpdate(tx, id);
    checkVersion(row, version);
    if (row.status !== 'POSTED' || row.dueDate === null) {
      throw new UserError('Só dá para estornar a baixa de uma conta que estava pendente.');
    }
    const [updated] = await tx
      .update(transactions)
      .set({
        status: 'PENDING',
        postedDate: null,
        amountCents: row.estimatedAmountCents ?? row.amountCents,
        estimatedAmountCents: null,
        version: sql`${transactions.version} + 1`,
      })
      .where(eq(transactions.id, id))
      .returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'transactions',
      entityId: id,
      action: 'REVERT_PAYMENT',
      before: snapshot(row),
      after: snapshot(updated!),
    });
  });
}
