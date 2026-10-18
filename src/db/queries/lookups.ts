import { asc, count, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import type { AnyDB } from '../client';
import { categories, recurringTemplates, transactions, users } from '../schema';

export type CategoryOption = { id: string; name: string; kind: 'EXPENSE' | 'INCOME'; icon: string | null };
export type UserOption = { id: string; name: string; color: string | null };

/**
 * Categorias para listas de escolha: só as ativas. `alsoIds` mantém na lista a categoria atual de um
 * lançamento que está sendo editado, mesmo arquivada. `includeArchived` serve para dar nome em relatórios.
 */
export async function listCategories(
  db: AnyDB,
  opts: { alsoIds?: (string | null | undefined)[]; includeArchived?: boolean } = {},
): Promise<CategoryOption[]> {
  const keep = (opts.alsoIds ?? []).filter((x): x is string => !!x);
  const where: SQL | undefined = opts.includeArchived
    ? undefined
    : keep.length > 0
      ? or(isNull(categories.archivedAt), inArray(categories.id, keep))
      : isNull(categories.archivedAt);
  return db
    .select({ id: categories.id, name: categories.name, kind: categories.kind, icon: categories.icon })
    .from(categories)
    .where(where)
    .orderBy(asc(categories.name));
}

export type ManagedCategory = {
  id: string;
  name: string;
  kind: 'EXPENSE' | 'INCOME';
  botAliases: string[];
  archived: boolean;
  /** lançamentos (não apagados) + fixos ativos que usam a categoria */
  usageCount: number;
};

/** Todas as categorias, com quantos lançamentos usam cada uma (tela de gestão). */
export async function listManagedCategories(db: AnyDB): Promise<ManagedCategory[]> {
  const [cats, txCounts, tplCounts] = await Promise.all([
    db.select().from(categories).orderBy(asc(categories.name)),
    db
      .select({ id: transactions.categoryId, n: count() })
      .from(transactions)
      .where(isNull(transactions.deletedAt))
      .groupBy(transactions.categoryId),
    db
      .select({ id: recurringTemplates.categoryId, n: count() })
      .from(recurringTemplates)
      .where(eq(recurringTemplates.isActive, true))
      .groupBy(recurringTemplates.categoryId),
  ]);
  const used = (id: string) =>
    Number(txCounts.find((x) => x.id === id)?.n ?? 0) + Number(tplCounts.find((x) => x.id === id)?.n ?? 0);
  return cats.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    botAliases: c.botAliases,
    archived: c.archivedAt !== null,
    usageCount: used(c.id),
  }));
}

export async function listUsers(db: AnyDB): Promise<UserOption[]> {
  return db
    .select({ id: users.id, name: users.name, color: users.color })
    .from(users)
    .orderBy(asc(users.name));
}
