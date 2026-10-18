import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import type { ISODate } from '@/domain/dates';
import type { Cents } from '@/domain/money';
import { centsFromDb } from '@/server/context';
import type { AnyDB } from '../client';
import { bankAccounts, transactions } from '../schema';

/**
 * Saldo da conta — fórmula canônica (mesma do teste de referência em tests/acceptance/card-ledger.test.ts):
 *   opening_balance + Σ entradas − Σ saídas, só POSTED e não deletadas.
 * `asOf` limita a posted_date ≤ data (conferência de saldo, D20).
 */
export async function getAccountBalance(db: AnyDB, accountId: string, asOf?: ISODate): Promise<Cents> {
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
        asOf ? lte(transactions.postedDate, asOf) : undefined,
      ),
    )
    .where(eq(bankAccounts.id, accountId))
    .groupBy(bankAccounts.id);
  if (!row) throw new Error(`Conta ${accountId} não encontrada.`);
  return centsFromDb(row.v);
}
