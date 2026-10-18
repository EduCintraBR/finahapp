import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, lte, ne, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { monthEnd, monthStart, type ISODate } from '@/domain/dates';
import type { AnyDB } from '../client';
import {
  balanceCheckpoints,
  categories,
  installmentPlans,
  recurringTemplates,
  transactions,
  users,
} from '../schema';

/** Data que define em que dia/mês o lançamento aparece no extrato: paga → posted; pendente → vencimento. */
const effectiveDate = sql<string>`coalesce(${transactions.postedDate}, ${transactions.dueDate}, ${transactions.transactionDate})`;

const createdBy = alias(users, 'created_by');
const beneficiary = alias(users, 'beneficiary');

const entryColumns = {
  id: transactions.id,
  kind: transactions.kind,
  status: transactions.status,
  description: transactions.description,
  notes: transactions.notes,
  amountCents: transactions.amountCents,
  estimatedAmountCents: transactions.estimatedAmountCents,
  paymentMethod: transactions.paymentMethod,
  creditCardId: transactions.creditCardId,
  categoryId: transactions.categoryId,
  categoryName: categories.name,
  categoryIcon: categories.icon,
  date: effectiveDate,
  transactionDate: transactions.transactionDate,
  dueDate: transactions.dueDate,
  postedDate: transactions.postedDate,
  recurringTemplateId: transactions.recurringTemplateId,
  occurrenceMonth: transactions.occurrenceMonth,
  source: transactions.source,
  version: transactions.version,
  createdById: transactions.createdByUserId,
  createdByName: createdBy.name,
  createdByColor: createdBy.color,
  beneficiaryId: transactions.beneficiaryUserId,
  beneficiaryName: beneficiary.name,
};

const baseSelect = (db: AnyDB) =>
  db
    .select(entryColumns)
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .innerJoin(createdBy, eq(createdBy.id, transactions.createdByUserId))
    .leftJoin(beneficiary, eq(beneficiary.id, transactions.beneficiaryUserId));

export type EntryFilters = {
  month: ISODate;
  kind?: 'INCOME' | 'EXPENSE' | undefined;
  status?: 'POSTED' | 'PENDING' | undefined;
  categoryId?: string | undefined;
  paymentMethod?: string | undefined;
  createdBy?: string | undefined;
  /** id do usuário, ou 'casal' para gastos sem beneficiário */
  beneficiary?: string | undefined;
  q?: string | undefined;
};

/** Extrato da conta no mês (sem cancelados nem deletados). */
export async function listEntries(db: AnyDB, f: EntryFilters) {
  const where: (SQL | undefined)[] = [
    isNotNull(transactions.bankAccountId),
    isNull(transactions.deletedAt),
    ne(transactions.status, 'CANCELLED'),
    sql`${effectiveDate} between ${monthStart(f.month)} and ${monthEnd(f.month)}`,
    f.kind ? eq(transactions.kind, f.kind) : undefined,
    f.status ? eq(transactions.status, f.status) : undefined,
    f.categoryId ? eq(transactions.categoryId, f.categoryId) : undefined,
    f.paymentMethod
      ? eq(transactions.paymentMethod, f.paymentMethod as (typeof transactions.$inferSelect)['paymentMethod'])
      : undefined,
    f.createdBy ? eq(transactions.createdByUserId, f.createdBy) : undefined,
    f.beneficiary === 'casal'
      ? isNull(transactions.beneficiaryUserId)
      : f.beneficiary
        ? eq(transactions.beneficiaryUserId, f.beneficiary)
        : undefined,
    f.q ? ilike(transactions.description, `%${f.q.replace(/[%_\\]/g, '\\$&')}%`) : undefined,
  ];
  return baseSelect(db)
    .where(and(...where))
    .orderBy(desc(effectiveDate), desc(transactions.createdAt));
}

export type EntryRow = Awaited<ReturnType<typeof listEntries>>[number];

/** Pendentes até o fim do mês (inclui atrasados de meses anteriores), por vencimento. */
export async function listPending(db: AnyDB, month: ISODate) {
  return baseSelect(db)
    .where(
      and(
        isNotNull(transactions.bankAccountId),
        isNull(transactions.deletedAt),
        eq(transactions.status, 'PENDING'),
        lte(transactions.dueDate, monthEnd(month)),
      ),
    )
    .orderBy(asc(transactions.dueDate), asc(transactions.description));
}

/** Plano de uma compra no cartão (o lançamento abre na tela do cartão). */
export async function planIdOfTransaction(db: AnyDB, transactionId: string) {
  const [p] = await db
    .select({ id: installmentPlans.id })
    .from(installmentPlans)
    .where(eq(installmentPlans.transactionId, transactionId));
  return p?.id ?? null;
}

export async function getEntry(db: AnyDB, id: string) {
  const [row] = await baseSelect(db).where(and(eq(transactions.id, id), isNull(transactions.deletedAt)));
  return row ?? null;
}

export async function listTemplates(db: AnyDB) {
  return templateSelect(db).orderBy(asc(recurringTemplates.dayOfMonth), asc(recurringTemplates.description));
}

export type TemplateRow = Awaited<ReturnType<typeof listTemplates>>[number];

export async function getTemplate(db: AnyDB, id: string) {
  const rows = await templateSelect(db).where(eq(recurringTemplates.id, id));
  return rows[0] ?? null;
}

const templateSelect = (db: AnyDB) =>
  db
    .select({
      id: recurringTemplates.id,
      type: recurringTemplates.type,
      direction: recurringTemplates.direction,
      description: recurringTemplates.description,
      amountCents: recurringTemplates.expectedAmountCents,
      dayOfMonth: recurringTemplates.dayOfMonth,
      paymentMethod: recurringTemplates.paymentMethod,
      creditCardId: recurringTemplates.creditCardId,
      startMonth: recurringTemplates.startMonth,
      endMonth: recurringTemplates.endMonth,
      isActive: recurringTemplates.isActive,
      categoryId: recurringTemplates.categoryId,
      categoryName: categories.name,
      beneficiaryUserId: recurringTemplates.beneficiaryUserId,
    })
    .from(recurringTemplates)
    .innerJoin(categories, eq(categories.id, recurringTemplates.categoryId));

/** Ocorrências de um conjunto de templates (histórico na tela do fixo). */
export async function listOccurrences(db: AnyDB, templateIds: string[]) {
  if (templateIds.length === 0) return [];
  return baseSelect(db)
    .where(and(inArray(transactions.recurringTemplateId, templateIds), isNull(transactions.deletedAt)))
    .orderBy(desc(transactions.occurrenceMonth));
}

export async function listCheckpoints(db: AnyDB, limit = 12) {
  return db
    .select({
      id: balanceCheckpoints.id,
      date: balanceCheckpoints.checkpointDate,
      statementCents: balanceCheckpoints.statementBalanceCents,
      computedCents: balanceCheckpoints.computedBalanceCents,
      adjustmentTransactionId: balanceCheckpoints.adjustmentTransactionId,
      createdByName: users.name,
    })
    .from(balanceCheckpoints)
    .innerJoin(users, eq(users.id, balanceCheckpoints.createdByUserId))
    .orderBy(desc(balanceCheckpoints.checkpointDate))
    .limit(limit);
}
