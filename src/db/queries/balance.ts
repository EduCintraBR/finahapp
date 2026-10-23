import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import type { ISODate } from '@/domain/dates';
import type { Cents } from '@/domain/money';
import { centsFromDb } from '@/server/context';
import type { AnyDB } from '../client';
import { bankAccounts, transactions } from '../schema';

/**
 * Saldo da conta — fórmula canônica (mesma do teste de referência em tests/acceptance/card-ledger.test.ts):
 *   opening_balance + Σ entradas − Σ saídas, só POSTED e não deletadas.
 * `asOf` limita a posted_date ≤ data e é OBRIGATÓRIO (D67): o saldo "atual" é o de hoje, e lançamento com data
 * futura (agendado) só entra no dia. Na conferência de saldo (D20) é a data conferida.
 */
export async function getAccountBalance(db: AnyDB, accountId: string, asOf: ISODate): Promise<Cents> {
  const [row] = await db
    .select({
      v: sql<string>`${bankAccounts.openingBalanceCents} + coalesce(sum(case
          when ${transactions.kind} in ('INCOME','TRANSFER_IN','ADJUSTMENT_IN') then ${transactions.amountCents}
          else -${transactions.amountCents} end), 0)`,
    })
    .from(bankAccounts)
    .leftJoin(
      transactions,
      and(
        eq(transactions.bankAccountId, bankAccounts.id),
        eq(transactions.status, 'POSTED'),
        isNull(transactions.deletedAt),
        lte(transactions.postedDate, asOf),
      ),
    )
    .where(eq(bankAccounts.id, accountId))
    .groupBy(bankAccounts.id);
  if (!row) throw new Error(`Conta ${accountId} não encontrada.`);
  return centsFromDb(row.v);
}
