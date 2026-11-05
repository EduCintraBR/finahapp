/**
 * Orçamentos (D79): definir o valor de uma categoria (ou do teto do mês) a partir de um mês e parar de acompanhar.
 * O gasto nunca é armazenado (vem do Gasto Mensal). Toda escrita em transação, com audit_log.
 */
import { and, asc, eq, gte, isNull } from 'drizzle-orm';
import { budgetAmounts, budgets, categories } from '@/db/schema';
import { amountForMonth, nextAmounts } from '@/domain/budgets/budgets';
import { formatMonthLabel, type ISODate } from '@/domain/dates';
import { audit } from './audit';
import { type ServiceCtx, type Tx, UserError } from './context';
import type { BudgetInput } from './schemas';

async function checkBudgetCategory(tx: Tx, categoryId: string) {
  const [cat] = await tx
    .select({ kind: categories.kind, parentId: categories.parentId, archivedAt: categories.archivedAt })
    .from(categories)
    .where(eq(categories.id, categoryId));
  if (!cat || cat.archivedAt) throw new UserError('Categoria não encontrada.');
  if (cat.kind !== 'EXPENSE') throw new UserError('Orçamento é só para categorias de despesa.');
  if (cat.parentId !== null) {
    throw new UserError('Escolha a categoria: o orçamento soma as subcategorias dela.');
  }
}

async function amountRows(tx: Tx, budgetId: string) {
  return tx
    .select({ startMonth: budgetAmounts.startMonth, amountCents: budgetAmounts.amountCents })
    .from(budgetAmounts)
    .where(eq(budgetAmounts.budgetId, budgetId))
    .orderBy(asc(budgetAmounts.startMonth));
}

/** Troca as linhas do mês em diante pela linha nova (o valor vale dali em diante; os meses anteriores ficam). */
async function replaceFrom(tx: Tx, budgetId: string, from: ISODate, amount: number | null) {
  await tx
    .delete(budgetAmounts)
    .where(and(eq(budgetAmounts.budgetId, budgetId), gte(budgetAmounts.startMonth, from)));
  await tx.insert(budgetAmounts).values({ budgetId, startMonth: from, amountCents: amount });
}

/**
 * Define o orçamento de uma categoria-mãe (ou o teto do mês, `categoryId` nulo) a partir de `fromMonth`.
 * Cria na primeira vez; depois, muda o valor dali em diante sem mexer nos meses anteriores.
 */
export async function setBudget(ctx: ServiceCtx, input: BudgetInput): Promise<{ id: string }> {
  return ctx.db.transaction(async (tx) => {
    if (input.categoryId) await checkBudgetCategory(tx, input.categoryId);
    const [found] = await tx
      .select()
      .from(budgets)
      .where(input.categoryId ? eq(budgets.categoryId, input.categoryId) : isNull(budgets.categoryId))
      .for('update');
    const budget =
      found ??
      (
        await tx
          .insert(budgets)
          .values({ categoryId: input.categoryId, createdByUserId: ctx.userId })
          .returning()
      )[0]!;
    const before = found ? await amountRows(tx, budget.id) : [];
    await replaceFrom(tx, budget.id, input.fromMonth, input.amount);
    await audit(tx, {
      userId: ctx.userId,
      entity: 'budgets',
      entityId: budget.id,
      action: found ? 'CHANGE_FROM' : 'CREATE',
      before: found ? { budget, amounts: before } : undefined,
      after: { budget, amounts: nextAmounts(before, input.fromMonth, input.amount) },
    });
    return { id: budget.id };
  });
}

/** Para de acompanhar a partir de `fromMonth`: os meses anteriores continuam com o orçamento que tinham. */
export async function stopBudget(ctx: ServiceCtx, id: string, fromMonth: ISODate) {
  return ctx.db.transaction(async (tx) => {
    const [budget] = await tx.select().from(budgets).where(eq(budgets.id, id)).for('update');
    if (!budget) throw new UserError('Orçamento não encontrado.');
    const before = await amountRows(tx, id);
    const after = nextAmounts(before, fromMonth, null);
    if (before.every((r) => r.startMonth < fromMonth) && amountForMonth(before, fromMonth) === null) {
      throw new UserError(`Este orçamento já não vale em ${formatMonthLabel(fromMonth)}.`);
    }
    await replaceFrom(tx, id, fromMonth, null);
    await audit(tx, {
      userId: ctx.userId,
      entity: 'budgets',
      entityId: id,
      action: 'END',
      before: { budget, amounts: before },
      after: { budget, amounts: after },
    });
  });
}
