/**
 * Trocar a categoria de um lançamento já feito (D75): a reclassificação que alimenta o detalhe da categoria.
 * Só muda `category_id`; valor, datas e status ficam como estão. Toda escrita em db.transaction() com lock otimista
 * (coluna version) e audit_log. A troca vale mesmo com a fatura fechada (a trava da D62 é só do valor).
 */
import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { categories, recurringTemplates, transactions } from '@/db/schema';
import { categoryChangeBlock } from '@/domain/categories';
import { audit } from './audit';
import { type ServiceCtx, type Tx, UserError } from './context';

type TxRow = typeof transactions.$inferSelect;

export type CategoryScope = 'THIS' | 'THIS_AND_FUTURE';

async function loadTx(tx: Tx, id: string): Promise<TxRow> {
  const [row] = await tx
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), isNull(transactions.deletedAt)))
    .for('update');
  if (!row) throw new UserError('Lançamento não encontrado.');
  return row;
}

async function recategorize(tx: Tx, ctx: ServiceCtx, row: TxRow, categoryId: string, reason: string) {
  const [updated] = await tx
    .update(transactions)
    .set({ categoryId, version: sql`${transactions.version} + 1` })
    .where(eq(transactions.id, row.id))
    .returning();
  await audit(tx, {
    userId: ctx.userId,
    entity: 'transactions',
    entityId: row.id,
    action: 'UPDATE',
    before: { categoryId: row.categoryId, reason },
    after: { categoryId: updated!.categoryId, version: updated!.version },
  });
}

/**
 * Troca a categoria de um lançamento.
 * - Pagamento antecipado (D70): o pagamento e a conta original guardam a categoria cada um, e trocar um troca os dois.
 * - Gerado por um fixo: `scope = 'THIS_AND_FUTURE'` também muda o fixo e as ocorrências pendentes dali em diante
 *   (as já pagas ficam como estão); `'THIS'` mexe só neste lançamento.
 * - Empréstimo, crédito de benefício e pagamentos que não são gasto são recusados (`categoryChangeBlock`).
 * Devolve quantos lançamentos mudaram.
 */
export async function setTransactionCategory(
  ctx: ServiceCtx,
  id: string,
  input: { categoryId: string; version: number; scope?: CategoryScope },
): Promise<{ changed: number }> {
  return ctx.db.transaction(async (tx) => {
    const row = await loadTx(tx, id);
    if (row.version !== input.version) {
      throw new UserError(
        'Este lançamento foi alterado por outra pessoa. Recarregue a página e tente de novo.',
      );
    }
    const blocked = categoryChangeBlock(row);
    if (blocked) throw new UserError(blocked);

    const [cat] = await tx
      .select({ kind: categories.kind, archivedAt: categories.archivedAt })
      .from(categories)
      .where(eq(categories.id, input.categoryId));
    if (!cat || (cat.archivedAt && input.categoryId !== row.categoryId))
      throw new UserError('Categoria não encontrada.');
    if (cat.kind !== row.kind) {
      throw new UserError(
        row.kind === 'INCOME' ? 'Escolha uma categoria de receita.' : 'Escolha uma categoria de despesa.',
      );
    }

    // o par do pagamento antecipado: a conta original ↔ o lançamento do pagamento
    const pair: TxRow[] = [];
    if (row.anticipatesTransactionId) {
      pair.push(await loadTx(tx, row.anticipatesTransactionId));
    } else if (row.status === 'ANTICIPATED') {
      pair.push(
        ...(await tx
          .select()
          .from(transactions)
          .where(and(eq(transactions.anticipatesTransactionId, row.id), isNull(transactions.deletedAt)))
          .for('update')),
      );
    }
    const touched = [row, ...pair];
    let changed = 0;
    for (const t of touched) {
      if (t.categoryId === input.categoryId) continue;
      await recategorize(tx, ctx, t, input.categoryId, 'trocar categoria');
      changed++;
    }

    if (input.scope === 'THIS_AND_FUTURE') {
      const origin = touched.find((t) => t.recurringTemplateId !== null);
      if (!origin) throw new UserError('Este lançamento não vem de um lançamento fixo.');
      const templateId = origin.recurringTemplateId!;
      const [template] = await tx
        .select()
        .from(recurringTemplates)
        .where(eq(recurringTemplates.id, templateId))
        .for('update');
      if (!template) throw new UserError('Lançamento fixo não encontrado.');
      if (template.categoryId !== input.categoryId) {
        const [updated] = await tx
          .update(recurringTemplates)
          .set({ categoryId: input.categoryId })
          .where(eq(recurringTemplates.id, templateId))
          .returning();
        await audit(tx, {
          userId: ctx.userId,
          entity: 'recurring_templates',
          entityId: templateId,
          action: 'UPDATE',
          before: { categoryId: template.categoryId },
          after: { categoryId: updated!.categoryId, reason: 'trocar categoria deste e dos próximos' },
        });
      }
      // pendentes do mês deste lançamento em diante (as já pagas ou canceladas não mudam)
      const month = origin.occurrenceMonth;
      if (month) {
        const done = new Set(touched.map((t) => t.id));
        const later = await tx
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.recurringTemplateId, templateId),
              eq(transactions.status, 'PENDING'),
              isNull(transactions.deletedAt),
              gte(transactions.occurrenceMonth, month),
              inArray(transactions.kind, ['EXPENSE', 'INCOME']),
            ),
          )
          .for('update');
        for (const t of later) {
          if (done.has(t.id) || t.categoryId === input.categoryId) continue;
          await recategorize(tx, ctx, t, input.categoryId, 'trocar categoria deste e dos próximos');
          changed++;
        }
      }
    }
    return { changed };
  });
}
