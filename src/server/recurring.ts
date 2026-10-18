/**
 * Templates de fixos / recorrentes / receitas previstas e geração de ocorrências (SPEC §4).
 * Regras puras em src/domain/recurring/occurrences.ts; aqui só banco + transação + audit_log.
 */
import { and, eq, gt, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { AnyDB } from '@/db/client';
import { categories, recurringTemplates, transactions, users } from '@/db/schema';
import { compareDates, dateInMonth, type ISODate } from '@/domain/dates';
import {
  cardChargesDue,
  occurrenceKey,
  planChangeFrom,
  planOccurrences,
} from '@/domain/recurring/occurrences';
import { createSubscriptionCharge } from './card-purchases';
import { loadCard } from './cards';
import { audit } from './audit';
import { type ServiceCtx, type Tx, UserError } from './context';
import { getPrimaryAccount } from './entries';
import type { ChangeFromInput, TemplateInput } from './schemas';

type TemplateRow = typeof recurringTemplates.$inferSelect;

async function checkRefs(tx: Tx, categoryId: string, kind: 'INCOME' | 'EXPENSE', beneficiary: string | null) {
  const [cat] = await tx
    .select({ kind: categories.kind })
    .from(categories)
    .where(eq(categories.id, categoryId));
  if (!cat) throw new UserError('Categoria não encontrada.');
  if (cat.kind !== kind) {
    throw new UserError(
      kind === 'INCOME' ? 'Escolha uma categoria de receita.' : 'Escolha uma categoria de despesa.',
    );
  }
  if (beneficiary) {
    const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, beneficiary));
    if (!u) throw new UserError('Pessoa não encontrada.');
  }
}

export async function createTemplate(ctx: ServiceCtx, input: TemplateInput): Promise<{ id: string }> {
  if (input.endMonth && compareDates(input.endMonth, input.startMonth) < 0) {
    throw new UserError('O último mês não pode ser antes do primeiro.');
  }
  const id = await ctx.db.transaction(async (tx) => {
    const account = await getPrimaryAccount(tx);
    await checkRefs(tx, input.categoryId, input.direction, input.beneficiaryUserId);
    const target = await templateTarget(tx, input, input.direction, account.id);
    const [row] = await tx
      .insert(recurringTemplates)
      .values({
        type: input.type,
        direction: input.direction,
        description: input.description,
        categoryId: input.categoryId,
        expectedAmountCents: input.amount,
        dayOfMonth: input.dayOfMonth,
        paymentMethod: input.paymentMethod,
        ...target,
        startMonth: input.startMonth,
        endMonth: input.endMonth,
        beneficiaryUserId: input.beneficiaryUserId,
        createdByUserId: ctx.userId,
      })
      .returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'recurring_templates',
      entityId: row!.id,
      action: 'CREATE',
      after: row,
    });
    return row!.id;
  });
  await generateOccurrences(ctx.db, ctx.today);
  return { id };
}

/** D33: assinatura no cartão só como despesa, num cartão ativo; o resto sai da conta principal. */
async function templateTarget(
  tx: Tx,
  input: { paymentMethod: string; creditCardId: string | null },
  direction: 'INCOME' | 'EXPENSE',
  accountId: string | null,
) {
  if (input.paymentMethod !== 'CREDIT_CARD') return { bankAccountId: accountId, creditCardId: null };
  if (direction !== 'EXPENSE') throw new UserError('Receita não pode ser no cartão de crédito.');
  if (!input.creditCardId) throw new UserError('Escolha o cartão da assinatura.');
  const card = await loadCard(tx, input.creditCardId);
  return { bankAccountId: null, creditCardId: card.id };
}

async function loadTemplate(tx: Tx, id: string): Promise<TemplateRow> {
  const [t] = await tx.select().from(recurringTemplates).where(eq(recurringTemplates.id, id)).for('update');
  if (!t) throw new UserError('Lançamento fixo não encontrado.');
  return t;
}

/** Ocorrências pendentes (não deletadas) do template a partir de um mês. */
const pendingFrom = (templateId: string, month: ISODate) =>
  and(
    eq(transactions.recurringTemplateId, templateId),
    eq(transactions.status, 'PENDING'),
    isNull(transactions.deletedAt),
    gte(transactions.occurrenceMonth, month),
  );

/**
 * "Alterar a partir de" (D21). Valores novos valem do mês escolhido em diante;
 * ocorrências já pagas nunca mudam.
 */
export async function changeTemplateFrom(ctx: ServiceCtx, id: string, input: ChangeFromInput) {
  const result = await ctx.db.transaction(async (tx) => {
    const old = await loadTemplate(tx, id);
    if (!old.isActive) throw new UserError('Este lançamento fixo está encerrado.');
    const plan = planChangeFrom(old, input.effectiveMonth);
    if ('error' in plan) throw new UserError(plan.error);
    await checkRefs(tx, input.categoryId, old.direction, input.beneficiaryUserId);
    if ((input.paymentMethod === 'CREDIT_CARD') !== (old.paymentMethod === 'CREDIT_CARD')) {
      throw new UserError('Para trocar entre conta e cartão, encerre este lançamento fixo e cadastre outro.');
    }
    const target = await templateTarget(tx, input, old.direction, old.bankAccountId);

    const values = {
      ...target,
      type: input.type,
      description: input.description,
      categoryId: input.categoryId,
      expectedAmountCents: input.amount,
      dayOfMonth: input.dayOfMonth,
      paymentMethod: input.paymentMethod,
      beneficiaryUserId: input.beneficiaryUserId,
    };

    let targetId = id;
    if (plan.mode === 'IN_PLACE') {
      const [updated] = await tx
        .update(recurringTemplates)
        .set(values)
        .where(eq(recurringTemplates.id, id))
        .returning();
      await audit(tx, {
        userId: ctx.userId,
        entity: 'recurring_templates',
        entityId: id,
        action: 'UPDATE',
        before: old,
        after: updated,
      });
    } else {
      await tx
        .update(recurringTemplates)
        .set({ endMonth: plan.oldEndMonth })
        .where(eq(recurringTemplates.id, id));
      const [created] = await tx
        .insert(recurringTemplates)
        .values({
          ...values,
          direction: old.direction,
          startMonth: plan.newStartMonth,
          endMonth: old.endMonth,
          createdByUserId: ctx.userId,
        })
        .returning();
      targetId = created!.id;
      await audit(tx, {
        userId: ctx.userId,
        entity: 'recurring_templates',
        entityId: id,
        action: 'CHANGE_FROM',
        before: old,
        after: { endMonth: plan.oldEndMonth, replacedBy: targetId },
      });
      await audit(tx, {
        userId: ctx.userId,
        entity: 'recurring_templates',
        entityId: targetId,
        action: 'CREATE',
        after: created,
      });
    }

    // Pendentes a partir do mês da mudança passam a seguir os valores novos (e o template novo).
    const affected = await tx
      .select()
      .from(transactions)
      .where(pendingFrom(id, input.effectiveMonth))
      .for('update');
    for (const occ of affected) {
      const dueDate = dateInMonth(occ.occurrenceMonth!, input.dayOfMonth);
      const [updated] = await tx
        .update(transactions)
        .set({
          recurringTemplateId: targetId,
          description: input.description,
          categoryId: input.categoryId,
          amountCents: input.amount,
          paymentMethod: input.paymentMethod,
          beneficiaryUserId: input.beneficiaryUserId,
          dueDate,
          transactionDate: dueDate,
          version: sql`${transactions.version} + 1`,
        })
        .where(eq(transactions.id, occ.id))
        .returning();
      await audit(tx, {
        userId: ctx.userId,
        entity: 'transactions',
        entityId: occ.id,
        action: 'UPDATE',
        before: occ,
        after: updated,
      });
    }

    // Já pagas/canceladas desses meses só trocam de template (valores intactos), para o novo
    // template não gerar uma segunda conta num mês que já tem a sua.
    if (plan.mode === 'SPLIT') {
      const moved = await tx
        .update(transactions)
        .set({ recurringTemplateId: targetId, version: sql`${transactions.version} + 1` })
        .where(
          and(
            eq(transactions.recurringTemplateId, id),
            isNull(transactions.deletedAt),
            gte(transactions.occurrenceMonth, input.effectiveMonth),
            ne(transactions.status, 'PENDING'),
          ),
        )
        .returning({ id: transactions.id });
      for (const m of moved) {
        await audit(tx, {
          userId: ctx.userId,
          entity: 'transactions',
          entityId: m.id,
          action: 'UPDATE',
          after: { recurringTemplateId: targetId, reason: 'alterar a partir de' },
        });
      }
    }
    return { id: targetId };
  });
  await generateOccurrences(ctx.db, ctx.today);
  return result;
}

/**
 * Encerra o template: `lastMonth` é o último mês com ocorrência. Pendentes depois dele são
 * canceladas. Encerrar antes do início desativa o template.
 */
export async function endTemplate(ctx: ServiceCtx, id: string, lastMonth: ISODate) {
  return ctx.db.transaction(async (tx) => {
    const old = await loadTemplate(tx, id);
    const beforeStart = compareDates(lastMonth, old.startMonth) < 0;
    const [updated] = await tx
      .update(recurringTemplates)
      .set(beforeStart ? { isActive: false } : { endMonth: lastMonth })
      .where(eq(recurringTemplates.id, id))
      .returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'recurring_templates',
      entityId: id,
      action: 'END',
      before: old,
      after: updated,
    });

    const after = await tx
      .update(transactions)
      .set({ status: 'CANCELLED', version: sql`${transactions.version} + 1` })
      .where(
        and(
          eq(transactions.recurringTemplateId, id),
          eq(transactions.status, 'PENDING'),
          isNull(transactions.deletedAt),
          beforeStart ? undefined : gt(transactions.occurrenceMonth, lastMonth),
        ),
      )
      .returning({ id: transactions.id });
    for (const t of after) {
      await audit(tx, {
        userId: ctx.userId,
        entity: 'transactions',
        entityId: t.id,
        action: 'CANCEL',
        after: { reason: 'template encerrado' },
      });
    }
  });
}

/**
 * Materializa o que falta (D17, D33). Idempotente: pode rodar no worker e ao abrir o app ao
 * mesmo tempo — o índice único (template, mês) garante uma ocorrência por mês.
 *  - template da conta → transaction PENDING no vencimento;
 *  - assinatura no cartão → compra à vista no dia da cobrança (quando o dia chega).
 */
export async function generateOccurrences(db: AnyDB, today: ISODate): Promise<number> {
  return db.transaction(async (tx) => {
    const account = await getPrimaryAccount(tx).catch(() => null);
    if (!account) return 0;
    const templates = await tx.select().from(recurringTemplates).where(eq(recurringTemplates.isActive, true));
    if (templates.length === 0) return 0;

    const existingRows = await tx
      .select({ templateId: transactions.recurringTemplateId, month: transactions.occurrenceMonth })
      .from(transactions)
      .where(
        and(
          inArray(
            transactions.recurringTemplateId,
            templates.map((t) => t.id),
          ),
          isNull(transactions.deletedAt),
        ),
      );
    const existing = new Set(existingRows.map((r) => occurrenceKey(r.templateId!, r.month!)));
    const byId = new Map(templates.map((t) => [t.id, t]));
    let created = 0;

    const accountTemplates = templates.filter((t) => t.bankAccountId !== null);
    for (const p of planOccurrences(accountTemplates, existing, account.openingBalanceDate, today)) {
      const t = byId.get(p.templateId)!;
      const [row] = await tx
        .insert(transactions)
        .values({
          kind: t.direction,
          status: 'PENDING',
          description: t.description,
          amountCents: t.expectedAmountCents,
          paymentMethod: t.paymentMethod,
          bankAccountId: t.bankAccountId,
          categoryId: t.categoryId,
          transactionDate: p.dueDate,
          dueDate: p.dueDate,
          recurringTemplateId: t.id,
          occurrenceMonth: p.occurrenceMonth,
          createdByUserId: t.createdByUserId,
          beneficiaryUserId: t.beneficiaryUserId,
          source: 'RECURRING',
        })
        .onConflictDoNothing()
        .returning({ id: transactions.id });
      if (row) {
        created++;
        await audit(tx, {
          userId: null,
          entity: 'transactions',
          entityId: row.id,
          action: 'GENERATE',
          after: { templateId: t.id, occurrenceMonth: p.occurrenceMonth, dueDate: p.dueDate },
        });
      }
    }

    for (const t of templates.filter((x) => x.creditCardId !== null)) {
      const card = await loadCard(tx, t.creditCardId!, { allowArchived: true });
      if (card.archivedAt) continue;
      for (const c of cardChargesDue(t, account.openingBalanceDate, today)) {
        if (existing.has(occurrenceKey(t.id, c.month))) continue;
        try {
          // savepoint: se outra execução gerou ao mesmo tempo, o índice único barra só esta cobrança
          await tx.transaction(async (sp) => {
            await createSubscriptionCharge(
              sp as unknown as Tx,
              { db: sp as unknown as AnyDB, userId: t.createdByUserId, today },
              {
                card,
                templateId: t.id,
                month: c.month,
                chargeDate: c.chargeDate,
                description: t.description,
                amount: t.expectedAmountCents,
                categoryId: t.categoryId,
                beneficiaryUserId: t.beneficiaryUserId,
              },
            );
          });
          created++;
        } catch (err) {
          if (!String((err as { cause?: unknown })?.cause ?? err).includes('tx_recurring_occurrence'))
            throw err;
        }
      }
    }
    return created;
  });
}
