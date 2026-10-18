/**
 * D44: correção do saldo inicial da conta principal (valor errado no onboarding).
 * Muda o saldo derivado de todo o histórico — por isso fica registrado no audit_log.
 */
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { bankAccounts, transactions } from '@/db/schema';
import type { ISODate } from '@/domain/dates';
import { formatDateBR } from '@/domain/dates';
import type { Cents } from '@/domain/money';
import { audit } from './audit';
import { type ServiceCtx, UserError } from './context';
import { getPrimaryAccount } from './entries';

export async function updateOpeningBalance(ctx: ServiceCtx, input: { amount: Cents; date: ISODate }) {
  return ctx.db.transaction(async (tx) => {
    const account = await getPrimaryAccount(tx);
    const [before] = await tx
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.id, account.id))
      .for('update');
    // D18 continua valendo: nada pode ficar antes do início do controle
    const [early] = await tx
      .select({
        d: sql<string>`min(coalesce(${transactions.postedDate}, ${transactions.dueDate}, ${transactions.transactionDate}))::text`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.bankAccountId, account.id),
          isNull(transactions.deletedAt),
          lt(
            sql`coalesce(${transactions.postedDate}, ${transactions.dueDate}, ${transactions.transactionDate})`,
            input.date,
          ),
        ),
      );
    if (early?.d) {
      throw new UserError(`Há lançamentos em ${formatDateBR(early.d)}, antes da nova data de início.`);
    }
    const [after] = await tx
      .update(bankAccounts)
      .set({ openingBalanceCents: input.amount, openingBalanceDate: input.date })
      .where(eq(bankAccounts.id, account.id))
      .returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'bank_accounts',
      entityId: account.id,
      action: 'UPDATE',
      before: {
        openingBalanceCents: before!.openingBalanceCents,
        openingBalanceDate: before!.openingBalanceDate,
      },
      after: {
        openingBalanceCents: after!.openingBalanceCents,
        openingBalanceDate: after!.openingBalanceDate,
        reason: 'D44',
      },
    });
  });
}
