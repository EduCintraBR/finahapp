/**
 * Gestão de categorias (D49). Nunca apaga: arquiva. Toda escrita em db.transaction() com audit_log.
 * Nome único entre irmãs (mesmo tipo e mesma mãe, sem diferenciar maiúsculas/acentos); apelidos do bot únicos entre as
 * ativas do mesmo tipo, mães e subcategorias juntas. Subcategorias (D74): 2 níveis, ver validateParent.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { categories } from '@/db/schema';
import {
  type CategoryKind,
  findAliasConflicts,
  findNameClash,
  isProtectedCategory,
  validateCategoryName,
  validateParent,
} from '@/domain/categories';
import { audit } from './audit';
import { type ServiceCtx, type Tx, UserError } from './context';

type CategoryRow = typeof categories.$inferSelect;

const snapshot = (c: CategoryRow) => ({
  name: c.name,
  kind: c.kind,
  parentId: c.parentId,
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

const childrenOf = (tx: Tx, id: string) => tx.select().from(categories).where(eq(categories.parentId, id));

const siblingsOf = (tx: Tx, kind: CategoryKind, parentId: string | null) =>
  tx
    .select()
    .from(categories)
    .where(
      and(
        eq(categories.kind, kind),
        parentId ? eq(categories.parentId, parentId) : isNull(categories.parentId),
      ),
    );

/** Confere a mãe pedida (existe, mesmo tipo, 2 níveis, ativa) e devolve a linha dela (null = categoria de topo). */
async function checkParent(
  tx: Tx,
  child: { id: string | null; kind: CategoryKind; name: string },
  parentId: string | null,
): Promise<CategoryRow | null> {
  if (parentId === null) return null;
  const [parent] = await tx.select().from(categories).where(eq(categories.id, parentId)).for('update');
  if (!parent) throw new UserError('Categoria não encontrada.');
  const hasChildren = child.id !== null && (await childrenOf(tx, child.id)).length > 0;
  const v = validateParent(
    { id: child.id ?? '', kind: child.kind, name: child.name, hasChildren },
    {
      id: parent.id,
      kind: parent.kind,
      parentId: parent.parentId,
      name: parent.name,
      archived: parent.archivedAt !== null,
    },
  );
  if (!v.ok) throw new UserError(v.error);
  return parent;
}

function checkName(raw: string, siblings: readonly CategoryRow[], selfId: string | null = null): string {
  const v = validateCategoryName(raw);
  if (!v.ok) throw new UserError(v.error);
  const clash = findNameClash(v.value, siblings, selfId);
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
  input: { kind: CategoryKind; name: string; aliases: string[]; parentId?: string | null },
): Promise<{ id: string }> {
  return ctx.db.transaction(async (tx) => {
    const parentId = input.parentId ?? null;
    const parent = await checkParent(tx, { id: null, kind: input.kind, name: input.name }, parentId);
    const kind = parent?.kind ?? input.kind;
    const name = checkName(input.name, await siblingsOf(tx, kind, parentId));
    checkAliases(input.aliases, await sameKind(tx, kind));
    const [row] = await tx
      .insert(categories)
      .values({ name, kind, parentId, botAliases: input.aliases })
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

/** Subcategoria nasce sempre dentro de uma categoria e herda o tipo dela (D77). O tipo nunca muda (D49). */
export async function createSubcategory(
  ctx: ServiceCtx,
  input: { parentId: string; name: string; aliases: string[] },
): Promise<{ id: string }> {
  const [parent] = await ctx.db
    .select({ kind: categories.kind })
    .from(categories)
    .where(eq(categories.id, input.parentId));
  if (!parent) throw new UserError('Categoria não encontrada.');
  return createCategory(ctx, { ...input, kind: parent.kind });
}

/**
 * Renomeia e troca os apelidos. Com `parentId`, também troca a subcategoria de categoria na mesma transação
 * (edição da subcategoria, D77), com as mesmas regras de `moveCategory`.
 */
export async function updateCategory(
  ctx: ServiceCtx,
  id: string,
  input: { name: string; aliases: string[]; parentId?: string | null },
) {
  return ctx.db.transaction(async (tx) => {
    const row = await loadForUpdate(tx, id);
    const parentId = input.parentId === undefined ? row.parentId : input.parentId;
    const moves = parentId !== row.parentId;
    if (moves) {
      await checkParent(tx, row, parentId);
      if (row.archivedAt && parentId !== null) throw new UserError('Restaure a categoria antes de movê-la.');
    }
    const others = (await sameKind(tx, row.kind)).filter((o) => o.id !== id);
    let name = row.name;
    if (input.name.replace(/\s+/g, ' ').trim() !== row.name) {
      if (isProtectedCategory(row.kind, row.name)) {
        throw new UserError(`"${row.name}" é usada pelo bot e pelas importações e não pode ser renomeada.`);
      }
      name = checkName(input.name, await siblingsOf(tx, row.kind, parentId), id);
    } else if (moves) {
      checkName(row.name, await siblingsOf(tx, row.kind, parentId), id);
    }
    // só confere os apelidos que mudaram (não bloqueia por conflito antigo)
    const added = input.aliases.filter((a) => !row.botAliases.includes(a));
    if (!row.archivedAt) checkAliases(added, others);
    const [updated] = await tx
      .update(categories)
      .set({ name, botAliases: input.aliases, parentId })
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

/**
 * Move a categoria para dentro de outra (vira subcategoria) ou de volta ao topo (`parentId` nulo) sem tocar em
 * nenhum lançamento: os relatórios somam pela mãe, então o histórico se reagrupa sozinho (D74).
 */
export async function moveCategory(ctx: ServiceCtx, id: string, parentId: string | null) {
  return ctx.db.transaction(async (tx) => {
    const row = await loadForUpdate(tx, id);
    if (row.parentId === parentId) return;
    await checkParent(tx, row, parentId);
    if (row.archivedAt && parentId !== null) throw new UserError('Restaure a categoria antes de movê-la.');
    checkName(row.name, await siblingsOf(tx, row.kind, parentId), id);
    const [updated] = await tx.update(categories).set({ parentId }).where(eq(categories.id, id)).returning();
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
    if (archived) {
      const active = (await childrenOf(tx, id)).filter((c) => !c.archivedAt);
      if (active.length > 0) {
        throw new UserError(
          active.length === 1
            ? `"${row.name}" tem uma subcategoria ativa: arquive-a ou mova-a antes.`
            : `"${row.name}" tem ${active.length} subcategorias ativas: arquive-as ou mova-as antes.`,
        );
      }
    } else if (row.parentId) {
      const [parent] = await tx.select().from(categories).where(eq(categories.id, row.parentId));
      if (parent?.archivedAt) throw new UserError(`Restaure a categoria "${parent.name}" antes.`);
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
