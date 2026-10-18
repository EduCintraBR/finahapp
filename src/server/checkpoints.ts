/**
 * Conferência de saldo (SPEC §2, D20): o usuário informa o saldo que o banco mostra numa data;
 * comparamos com o saldo calculado até essa data e, se divergir e ele quiser, lançamos um ajuste.
 */
import { and, eq } from 'drizzle-orm';
import { getAccountBalance } from '@/db/queries/balance';
import { balanceCheckpoints, transactions } from '@/db/schema';
import { balanceAdjustment } from '@/domain/account/balance';
import { checkNotBeforeOpening } from '@/domain/account/rules';
import { compareDates } from '@/domain/dates';
import { audit } from './audit';
import { type ServiceCtx, UserError } from './context';
import { getPrimaryAccount } from './entries';
import type { CheckpointInput } from './schemas';

export type CheckpointResult = {
  id: string;
  computedCents: number;
  statementCents: number;
  adjustmentTransactionId: string | null;
};

export async function createCheckpoint(ctx: ServiceCtx, input: CheckpointInput): Promise<CheckpointResult> {
  if (compareDates(input.date, ctx.today) > 0)
    throw new UserError('A data da conferência não pode estar no futuro.');

  return ctx.db.transaction(async (tx) => {
    const account = await getPrimaryAccount(tx);
    const dateError = checkNotBeforeOpening(input.date, account.openingBalanceDate);
    if (dateError) throw new UserError(dateError);

    const [existing] = await tx
      .select({ id: balanceCheckpoints.id })
      .from(balanceCheckpoints)
      .where(
        and(
          eq(balanceCheckpoints.bankAccountId, account.id),
          eq(balanceCheckpoints.checkpointDate, input.date),
        ),
      );
    if (existing) throw new UserError('Já existe uma conferência nesse dia.');

    const computed = await getAccountBalance(tx, account.id, input.date);
    const adj = input.applyAdjustment ? balanceAdjustment(input.statementBalance, computed) : null;

    let adjustmentTransactionId: string | null = null;
    if (adj) {
      const [t] = await tx
        .insert(transactions)
        .values({
          kind: adj.kind,
          status: 'POSTED',
          description: 'Ajuste da conferência de saldo',
          amountCents: adj.amountCents,
          paymentMethod: 'OTHER',
          bankAccountId: account.id,
          transactionDate: input.date,
          postedDate: input.date,
          createdByUserId: ctx.userId,
          source: 'SYSTEM',
        })
        .returning();
      adjustmentTransactionId = t!.id;
      await audit(tx, {
        userId: ctx.userId,
        entity: 'transactions',
        entityId: t!.id,
        action: 'CREATE',
        after: t,
      });
    }

    const [cp] = await tx
      .insert(balanceCheckpoints)
      .values({
        bankAccountId: account.id,
        checkpointDate: input.date,
        statementBalanceCents: input.statementBalance,
        computedBalanceCents: computed,
        adjustmentTransactionId,
        createdByUserId: ctx.userId,
      })
      .returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'balance_checkpoints',
      entityId: cp!.id,
      action: 'CHECKPOINT',
      after: cp,
    });

    return {
      id: cp!.id,
      computedCents: computed,
      statementCents: input.statementBalance,
      adjustmentTransactionId,
    };
  });
}
