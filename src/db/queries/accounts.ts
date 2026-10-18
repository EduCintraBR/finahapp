import { and, eq, isNull } from 'drizzle-orm';
import type { AnyDB } from '../client';
import { bankAccounts } from '../schema';

export async function getPrimaryAccount(db: AnyDB) {
  const [account] = await db
    .select({
      id: bankAccounts.id,
      name: bankAccounts.name,
      openingBalanceCents: bankAccounts.openingBalanceCents,
      openingBalanceDate: bankAccounts.openingBalanceDate,
    })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.isPrimary, true), isNull(bankAccounts.archivedAt)));
  return account ?? null;
}
