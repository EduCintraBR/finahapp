/**
 * Empréstimo (D66): cadastro, pagamento/antecipação de parcelas e exclusão. Tudo que escreve em mais de uma tabela
 * roda em transação e grava audit_log. O que falta pagar é derivado das parcelas (nunca armazenado).
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { categories, loans, transactions } from '@/db/schema';
import { checkNotBeforeOpening } from '@/domain/account/rules';
import { compareDates } from '@/domain/dates';
import { allocatePayment, buildLoanInstallments } from '@/domain/loans/loans';
import { audit } from './audit';
import { type ServiceCtx, type Tx, UserError } from './context';
import { getPrimaryAccount } from './entries';
import { recordFunding, requireFunding } from './funding';
import type { LoanInput, LoanPaymentInput } from './schemas';

export const LOAN_CATEGORY_NAME = 'Empréstimo';

/** Categoria do empréstimo (despesa das parcelas / receita do valor recebido), criada na primeira vez. */
async function loanCategoryId(tx: Tx, kind: 'INCOME' | 'EXPENSE'): Promise<string> {
  const [found] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.name, LOAN_CATEGORY_NAME), eq(categories.kind, kind)));
  if (found) return found.id;
  const [row] = await tx
    .insert(categories)
    .values({ name: LOAN_CATEGORY_NAME, kind, botAliases: kind === 'EXPENSE' ? ['emprestimo'] : [] })
    .returning({ id: categories.id });
  return row!.id;
}

/**
 * Cadastra o empréstimo: o valor recebido entra na conta agora (fora das receitas dos relatórios) e o total a pagar
 * vira N parcelas mensais pendentes, com o resto do arredondamento na 1ª.
 */
export async function createLoan(ctx: ServiceCtx, input: LoanInput): Promise<{ id: string }> {
  return ctx.db.transaction(async (tx) => {
    const account = await getPrimaryAccount(tx);
    if (compareDates(input.receivedDate, ctx.today) > 0) {
      throw new UserError('A data em que você recebeu o dinheiro não pode estar no futuro.');
    }
    const dateError = checkNotBeforeOpening(input.receivedDate, account.openingBalanceDate);
    if (dateError) throw new UserError(dateError);

    let plan;
    try {
      plan = buildLoanInstallments(input.total, input.installments, input.firstDueDate);
    } catch (e) {
      throw new UserError((e as Error).message);
    }

    const [loan] = await tx
      .insert(loans)
      .values({
        name: input.name,
        lender: input.lender,
        principalCents: input.principal,
        totalCents: input.total,
        installmentCount: input.installments,
        receivedDate: input.receivedDate,
        firstDueDate: input.firstDueDate,
        bankAccountId: account.id,
        notes: input.notes,
        createdByUserId: ctx.userId,
      })
      .returning();

    const incomeCategory = await loanCategoryId(tx, 'INCOME');
    const expenseCategory = await loanCategoryId(tx, 'EXPENSE');
    await tx.insert(transactions).values({
      kind: 'INCOME',
      status: 'POSTED',
      description: `Empréstimo recebido · ${input.name}`,
      amountCents: input.principal,
      paymentMethod: 'BANK_TRANSFER',
      bankAccountId: account.id,
      categoryId: incomeCategory,
      transactionDate: input.receivedDate,
      postedDate: input.receivedDate,
      loanId: loan!.id,
      createdByUserId: ctx.userId,
      source: 'MANUAL',
    });
    await tx.insert(transactions).values(
      plan.map((p) => ({
        kind: 'EXPENSE' as const,
        status: 'PENDING' as const,
        description: `${input.name} (${p.number}/${input.installments})`,
        amountCents: p.amountCents,
        paymentMethod: 'OTHER' as const,
        bankAccountId: account.id,
        categoryId: expenseCategory,
        transactionDate: p.dueDate,
        dueDate: p.dueDate,
        loanId: loan!.id,
        loanInstallmentNumber: p.number,
        createdByUserId: ctx.userId,
        source: 'MANUAL' as const,
      })),
    );
    await audit(tx, {
      userId: ctx.userId,
      entity: 'loans',
      entityId: loan!.id,
      action: 'CREATE',
      after: { loan, installments: plan },
    });
    return { id: loan!.id };
  });
}

/**
 * Paga uma ou mais parcelas de uma vez (em dia, adiantadas ou atrasadas): você informa o total que pagou e a data.
 * O valor é rateado entre as parcelas (proporcional ao valor de cada uma, resto na 1ª); o desconto de cada uma é
 * programado − pago (ou acréscimo, se pagou mais). É a mesma baixa dos outros lançamentos: o programado fica em
 * estimated_amount_cents e o pago em amount_cents.
 */
export async function payLoanInstallments(
  ctx: ServiceCtx,
  loanId: string,
  input: LoanPaymentInput,
): Promise<{ scheduledCents: number; paidCents: number; savingsCents: number; lateFeesCents: number }> {
  return ctx.db.transaction(async (tx) => {
    const [loan] = await tx
      .select()
      .from(loans)
      .where(and(eq(loans.id, loanId), isNull(loans.deletedAt)))
      .for('update');
    if (!loan) throw new UserError('Empréstimo não encontrado.');
    if (compareDates(input.date, ctx.today) > 0)
      throw new UserError('A data do pagamento não pode estar no futuro.');
    const account = await getPrimaryAccount(tx);
    const dateError = checkNotBeforeOpening(input.date, account.openingBalanceDate);
    if (dateError) throw new UserError(dateError);

    const rows = await tx
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.loanId, loanId),
          inArray(transactions.id, input.installmentIds),
          isNull(transactions.deletedAt),
        ),
      )
      .orderBy(transactions.loanInstallmentNumber)
      .for('update');
    if (
      rows.length !== new Set(input.installmentIds).size ||
      rows.some((r) => r.loanInstallmentNumber === null)
    ) {
      throw new UserError('Parcela não encontrada neste empréstimo.');
    }
    if (rows.some((r) => r.status !== 'PENDING')) throw new UserError('Uma das parcelas já está paga.');

    let shares: number[];
    try {
      shares = allocatePayment(
        rows.map((r) => r.amountCents),
        input.paid,
      );
    } catch (e) {
      throw new UserError((e as Error).message);
    }

    // sem saldo na conta para pagar as parcelas: o que faltou precisa de explicação (aporte, D69)
    const funding = await requireFunding(tx, account.id, input.paid, input.date, input);

    let scheduled = 0;
    let savings = 0;
    let lateFees = 0;
    for (const [i, row] of rows.entries()) {
      const paid = shares[i]!;
      scheduled += row.amountCents;
      if (paid < row.amountCents) savings += row.amountCents - paid;
      else lateFees += paid - row.amountCents;
      const [updated] = await tx
        .update(transactions)
        .set({
          status: 'POSTED',
          postedDate: input.date,
          estimatedAmountCents: row.amountCents,
          amountCents: paid,
          transactionDate: input.date, // conta no mês em que foi paga, mesmo se adiantada
          version: sql`${transactions.version} + 1`,
        })
        .where(eq(transactions.id, row.id))
        .returning();
      await audit(tx, {
        userId: ctx.userId,
        entity: 'transactions',
        entityId: row.id,
        action: 'CONFIRM_PAYMENT',
        before: row,
        after: updated,
      });
    }
    if (funding) await recordFunding(tx, ctx, account.id, funding, input.date, rows[0]!.id, loan.name);
    return {
      scheduledCents: scheduled,
      paidCents: input.paid,
      savingsCents: savings,
      lateFeesCents: lateFees,
    };
  });
}

/**
 * Exclui o empréstimo (delete lógico) enquanto nenhuma parcela foi paga: sai o valor recebido do saldo e as
 * parcelas somem. Depois do primeiro pagamento o dinheiro já se mexeu de verdade e não dá mais para apagar.
 */
export async function deleteLoan(ctx: ServiceCtx, loanId: string) {
  return ctx.db.transaction(async (tx) => {
    const [loan] = await tx
      .select()
      .from(loans)
      .where(and(eq(loans.id, loanId), isNull(loans.deletedAt)))
      .for('update');
    if (!loan) throw new UserError('Empréstimo não encontrado.');
    const rows = await tx
      .select({ id: transactions.id, status: transactions.status, n: transactions.loanInstallmentNumber })
      .from(transactions)
      .where(and(eq(transactions.loanId, loanId), isNull(transactions.deletedAt)))
      .for('update');
    if (rows.some((r) => r.n !== null && r.status !== 'PENDING')) {
      throw new UserError(
        'Este empréstimo já tem parcela paga e não pode ser excluído. Para desfazer um pagamento, volte a parcela para pendente.',
      );
    }
    const now = new Date();
    await tx
      .update(transactions)
      .set({ deletedAt: now, version: sql`${transactions.version} + 1` })
      .where(and(eq(transactions.loanId, loanId), isNull(transactions.deletedAt)));
    await tx.update(loans).set({ deletedAt: now }).where(eq(loans.id, loanId));
    await audit(tx, {
      userId: ctx.userId,
      entity: 'loans',
      entityId: loanId,
      action: 'DELETE',
      before: { loan, transactionIds: rows.map((r) => r.id) },
    });
  });
}
