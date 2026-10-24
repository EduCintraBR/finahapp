import { and, eq, isNull, sql } from 'drizzle-orm';
import { transactions } from '@/db/schema';
import type { Tx } from './context';

/**
 * Saldo atual de uma carteira de benefícios (fórmula canônica, D65): Σ INCOME POSTED − Σ EXPENSE POSTED da carteira,
 * não deletadas. Nunca armazenado. Vive aqui, sem outras dependências, para benefits.ts e entries.ts usarem sem ciclo.
 */
export async function walletBalance(tx: Tx, walletId: string): Promise<number> {
  const [r] = await tx
    .select({
      v: sql<string>`coalesce(sum(case when ${transactions.kind} = 'INCOME' then ${transactions.amountCents} else -${transactions.amountCents} end), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.benefitWalletId, walletId),
        eq(transactions.status, 'POSTED'),
        isNull(transactions.deletedAt),
      ),
    );
  return Number(r?.v ?? 0);
}
