/**
 * Lançamentos da conta principal (Fase 2): receita e despesa à vista, ocorrências de fixos,
 * baixa ("Confirmar pagamento") e estorno da baixa.
 * Toda escrita: db.transaction() + audit_log + lock otimista (coluna version).
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { bankAccounts, benefitWallets, categories, transactions, users } from '@/db/schema';
import { checkNotBeforeOpening } from '@/domain/account/rules';
import { compareDates } from '@/domain/dates';
import { formatBRL } from '@/domain/money';
import { audit } from './audit';
import { type ServiceCtx, type Tx, UserError } from './context';
import { recordFunding, requireFunding } from './funding';
import type { ConfirmPaymentInput, EntryInput } from './schemas';
import { walletBalance } from './wallet-balance';

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
  if (row.loanId !== null) {
    throw new UserError('Parcela e valor recebido de empréstimo são tratados na tela do empréstimo.');
  }
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

    // D69: despesa lançada no app pode ficar "a pagar" (vence na data informada, vencida se já passou) até a baixa.
    // Receita é sempre recebida; bot e importação não informam a chave e seguem já pagos.
    const paid = input.kind === 'INCOME' ? true : (input.paid ?? true);
    // quem marca "já paguei" no formulário está tirando dinheiro da conta agora: sem saldo, explica o aporte
    const funding =
      input.kind === 'EXPENSE' && input.paid === true
        ? await requireFunding(tx, account.id, input.amount, input.date, input)
        : null;

    const [row] = await tx
      .insert(transactions)
      .values({
        kind: input.kind,
        status: paid ? 'POSTED' : 'PENDING',
        description: input.description,
        notes: input.notes,
        amountCents: input.amount,
        paymentMethod: input.paymentMethod,
        bankAccountId: account.id,
        categoryId: input.categoryId,
        transactionDate: input.date,
        dueDate: paid ? null : input.date,
        postedDate: paid ? input.date : null,
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
    if (funding) await recordFunding(tx, ctx, account.id, funding, input.date, row!.id, input.description);
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

    // paga com a carteira do cartão de benefícios: o valor inteiro sai dela e não mexe no saldo da conta
    let wallet: { id: string } | null = null;
    if (input.walletId) {
      if (row.kind !== 'EXPENSE')
        throw new UserError('Só despesas podem ser pagas com o cartão de benefícios.');
      if (row.loanId !== null) throw new UserError('Parcela de empréstimo é paga pela conta.');
      if (compareDates(input.date, ctx.today) > 0) {
        throw new UserError('Pagando com o cartão de benefícios, a data não pode estar no futuro.');
      }
      const [w] = await tx
        .select()
        .from(benefitWallets)
        .where(eq(benefitWallets.id, input.walletId))
        .for('update');
      if (!w) throw new UserError('Carteira não encontrada.');
      const balance = await walletBalance(tx, w.id);
      if (input.amount > balance) {
        throw new UserError(
          `Saldo insuficiente em ${w.name}: tem ${formatBRL(balance)} e a conta é de ${formatBRL(input.amount)}. Pague com a conta.`,
        );
      }
      wallet = w;
    }
    // sem saldo na conta: o que faltou precisa de explicação (aporte)
    const funding =
      !wallet && row.kind === 'EXPENSE'
        ? await requireFunding(tx, row.bankAccountId, input.amount, input.date, input)
        : null;

    const [updated] = await tx
      .update(transactions)
      .set({
        status: 'POSTED',
        postedDate: input.date,
        estimatedAmountCents: row.amountCents,
        amountCents: input.amount,
        // parcela de empréstimo (D66): conta no mês em que foi paga, mesmo se adiantada
        ...(row.loanInstallmentNumber !== null ? { transactionDate: input.date } : {}),
        ...(wallet
          ? { bankAccountId: null, benefitWalletId: wallet.id, paymentMethod: 'BENEFIT_CARD' as const }
          : {}),
        version: sql`${transactions.version} + 1`,
      })
      .where(eq(transactions.id, id))
      .returning();
    if (funding) {
      await recordFunding(tx, ctx, row.bankAccountId, funding, input.date, id, row.description);
    }
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
    // D69: despesa lançada no app já paga também pode voltar a "a pagar" (vence na data em que foi lançada)
    const reopenable =
      row.status === 'POSTED' &&
      (row.dueDate !== null ||
        (row.kind === 'EXPENSE' && row.loanId === null && (row.source === 'MANUAL' || row.source === 'BOT')));
    if (!reopenable) {
      throw new UserError(
        'Só dá para voltar a "a pagar" uma despesa lançada no app ou uma conta que estava pendente.',
      );
    }
    if (row.benefitWalletId !== null) {
      throw new UserError(
        'Conta paga com o cartão de benefícios: exclua o gasto no histórico do cartão e lance de novo.',
      );
    }
    const [updated] = await tx
      .update(transactions)
      .set({
        status: 'PENDING',
        dueDate: row.dueDate ?? row.postedDate,
        postedDate: null,
        amountCents: row.estimatedAmountCents ?? row.amountCents,
        estimatedAmountCents: null,
        ...(row.loanInstallmentNumber !== null && row.dueDate ? { transactionDate: row.dueDate } : {}),
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
