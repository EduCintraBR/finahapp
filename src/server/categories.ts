/**
 * Gestão de categorias (D49). Nunca apaga: arquiva. Toda escrita em db.transaction() com audit_log.
 * Nome único por tipo (sem diferenciar maiúsculas/acentos); apelidos do bot únicos entre as ativas do mesmo tipo.
 */
import { eq } from 'drizzle-orm';
import { categories } from '@/db/schema';
import {
  type CategoryKind,
  findAliasConflicts,
  isProtectedCategory,
  normalizeAlias,
  validateCategoryName,
} from '@/domain/categories';
import { audit } from './audit';
import { type ServiceCtx, type Tx, UserError } from './context';

type CategoryRow = typeof categories.$inferSelect;

const snapshot = (c: CategoryRow) => ({
  name: c.name,
  kind: c.kind,
  botAliases: c.botAliases,
  archived: c.archivedAt !== null,
});

async function loadForUpdate(tx: Tx, id: string): Promise<CategoryRow> {
  const [row] = await tx.select().from(categories).where(eq(categories.id, id)).for('update');
  if (!row) throw new UserError('Categoria não encontrada.');
  return row;
}

const sameKind = (tx: Tx, kind: CategoryKind) =>
  tx.select().from(categories).where(eq(categories.kind, kind));

function checkName(raw: string, others: readonly CategoryRow[]): string {
  const v = validateCategoryName(raw);
  if (!v.ok) throw new UserError(v.error);
  const clash = others.find((o) => normalizeAlias(o.name) === normalizeAlias(v.value));
  if (clash) {
    throw new UserError(
      clash.archivedAt
        ? `Já existe uma categoria "${clash.name}" arquivada: restaure-a em vez de criar outra.`
        : `Já existe uma categoria chamada "${clash.name}".`,
    );
  }
  return v.value;
}

function checkAliases(aliases: readonly string[], others: readonly CategoryRow[]) {
  const active = others.filter((o) => !o.archivedAt);
  const conflicts = findAliasConflicts(aliases, active);
  if (conflicts.length > 0) {
    throw new UserError(
      conflicts.map((c) => `O apelido "${c.alias}" já é da categoria "${c.categoryName}".`).join(' ') +
        ' Tire-o de lá primeiro.',
    );
  }
}

export async function createCategory(
  ctx: ServiceCtx,
  input: { kind: CategoryKind; name: string; aliases: string[] },
): Promise<{ id: string }> {
  return ctx.db.transaction(async (tx) => {
    const others = await sameKind(tx, input.kind);
    const name = checkName(input.name, others);
    checkAliases(input.aliases, others);
    const [row] = await tx
      .insert(categories)
      .values({ name, kind: input.kind, botAliases: input.aliases })
      .returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'categories',
      entityId: row!.id,
      action: 'CREATE',
      after: snapshot(row!),
    });
    return { id: row!.id };
  });
}

export async function updateCategory(
  ctx: ServiceCtx,
  id: string,
  input: { name: string; aliases: string[] },
) {
  return ctx.db.transaction(async (tx) => {
    const row = await loadForUpdate(tx, id);
    const others = (await sameKind(tx, row.kind)).filter((o) => o.id !== id);
    let name = row.name;
    if (input.name.replace(/\s+/g, ' ').trim() !== row.name) {
      if (isProtectedCategory(row.kind, row.name)) {
        throw new UserError(`"${row.name}" é usada pelo bot e pelas importações e não pode ser renomeada.`);
      }
      name = checkName(input.name, others);
    }
    // só confere os apelidos que mudaram (não bloqueia por conflito antigo)
    const added = input.aliases.filter((a) => !row.botAliases.includes(a));
    if (!row.archivedAt) checkAliases(added, others);
    const [updated] = await tx
      .update(categories)
      .set({ name, botAliases: input.aliases })
      .where(eq(categories.id, id))
      .returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'categories',
      entityId: id,
      action: 'UPDATE',
      before: snapshot(row),
      after: snapshot(updated!),
    });
  });
}

/** Arquivar tira a categoria das listas de escolha; lançamentos antigos, relatórios e histórico seguem iguais. */
export async function setCategoryArchived(ctx: ServiceCtx, id: string, archived: boolean) {
  return ctx.db.transaction(async (tx) => {
    const row = await loadForUpdate(tx, id);
    if (archived === (row.archivedAt !== null)) return;
    if (archived && isProtectedCategory(row.kind, row.name)) {
      throw new UserError(`"${row.name}" é usada pelo bot e pelas importações e não pode ser arquivada.`);
    }
    if (!archived) {
      // ao restaurar, os apelidos voltam a valer: não podem colidir com os de outra categoria ativa
      const others = (await sameKind(tx, row.kind)).filter((o) => o.id !== id);
      checkAliases(row.botAliases, others);
    }
    const [updated] = await tx
      .update(categories)
      .set({ archivedAt: archived ? new Date() : null })
      .where(eq(categories.id, id))
      .returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'categories',
      entityId: id,
      action: 'UPDATE',
      before: snapshot(row),
      after: snapshot(updated!),
    });
  });
}
