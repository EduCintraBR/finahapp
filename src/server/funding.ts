/**
 * Aporte (D69): quando a conta não tem saldo para um pagamento, o usuário explica de onde veio o que faltou. O aporte
 * vira uma entrada (INCOME) na conta, na data do pagamento, com a observação dele, ligada à transação que ele cobriu
 * (`funding_for_transaction_id`). Fica fora de "Entrou" e das receitas, como o dinheiro de empréstimo: é dinheiro que
 * entrou no saldo, não renda do mês.
 */
import { and, eq } from 'drizzle-orm';
import { categories, transactions } from '@/db/schema';
import { getAccountBalance } from '@/db/queries/balance';
import { fundingNeeded } from '@/domain/account/rules';
import type { ISODate } from '@/domain/dates';
import { formatBRL } from '@/domain/money';
import { audit } from './audit';
import { type ServiceCtx, type Tx, UserError } from './context';

export const FUNDING_CATEGORY_NAME = 'Aporte';
const MIN_NOTE = 3;

/** O que a tela manda quando o pagamento precisa de aporte. */
export type FundingInput = { fundingAmount?: number | undefined; fundingNote?: string | undefined };
export type Funding = { amountCents: number; note: string };

async function fundingCategoryId(tx: Tx): Promise<string> {
  const [found] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.name, FUNDING_CATEGORY_NAME), eq(categories.kind, 'INCOME')));
  if (found) return found.id;
  const [row] = await tx
    .insert(categories)
    .values({ name: FUNDING_CATEGORY_NAME, kind: 'INCOME', botAliases: [] })
    .returning({ id: categories.id });
  return row!.id;
}

/**
 * Confere o saldo da conta na data do pagamento (ANTES de gravar o pagamento). Se bastar, devolve null. Se faltar,
 * exige o aporte: pelo menos o que falta, com observação. O UserError leva `fundingShortCents` para a tela pedir.
 */
export async function requireFunding(
  tx: Tx,
  accountId: string,
  amountCents: number,
  date: ISODate,
  input: FundingInput,
): Promise<Funding | null> {
  const balance = await getAccountBalance(tx, accountId, date);
  const needed = fundingNeeded(balance, amountCents);
  if (needed === 0) return null;
  const details = { fundingShortCents: needed };
  if (!input.fundingAmount) {
    throw new UserError(
      `Saldo insuficiente na conta: faltam ${formatBRL(needed)}. Informe de onde veio o dinheiro para cobrir (aporte).`,
      details,
    );
  }
  if (input.fundingAmount < needed) {
    throw new UserError(`O aporte precisa cobrir pelo menos ${formatBRL(needed)}.`, details);
  }
  const note = input.fundingNote?.trim() ?? '';
  if (note.length < MIN_NOTE) {
    throw new UserError('Explique de onde veio o aporte (ex.: "poupança", "empréstimo da mãe").', details);
  }
  return { amountCents: input.fundingAmount, note };
}

/** Grava o aporte, ligado ao pagamento que ele cobriu. Chamar DEPOIS que a transação paga existir. */
export async function recordFunding(
  tx: Tx,
  ctx: ServiceCtx,
  accountId: string,
  funding: Funding,
  date: ISODate,
  payingTransactionId: string,
  label: string,
): Promise<string> {
  const categoryId = await fundingCategoryId(tx);
  const [row] = await tx
    .insert(transactions)
    .values({
      kind: 'INCOME',
      status: 'POSTED',
      description: `Aporte · ${label}`.slice(0, 200),
      notes: funding.note,
      amountCents: funding.amountCents,
      paymentMethod: 'OTHER',
      bankAccountId: accountId,
      categoryId,
      transactionDate: date,
      postedDate: date,
      fundingForTransactionId: payingTransactionId,
      createdByUserId: ctx.userId,
      source: 'MANUAL',
    })
    .returning();
  await audit(tx, {
    userId: ctx.userId,
    entity: 'transactions',
    entityId: row!.id,
    action: 'CREATE',
    after: row,
  });
  return row!.id;
}
