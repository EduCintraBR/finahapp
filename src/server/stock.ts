/**
 * Estoque da Casa (D81 a D90): categorias, locais, pessoas, produtos, lotes, movimentos, envase, embalagem aberta e
 * conferência. Toda escrita
 * em transação, com audit_log. A quantidade nunca é armazenada; antes de cada saída o produto é travado (FOR UPDATE)
 * e a quantidade de cada lote é somada de novo dentro da transação, para nenhum lote ficar negativo.
 */
import { and, eq, inArray, isNull, max, ne, or, sql } from 'drizzle-orm';
import { listLots, type LotRow } from '@/db/queries/stock';
import {
  stockCategories,
  stockChecks,
  stockLocations,
  stockLots,
  stockMovements,
  stockPeople,
  stockProductPeople,
  stockProducts,
  users,
} from '@/db/schema';
import { compareDates } from '@/domain/dates';
import {
  normalizeText,
  suggestPrefix,
  SUGGESTED_CATEGORIES,
  SUGGESTED_PEOPLE,
  lotCode,
} from '@/domain/stock/catalog';
import {
  adjustmentDelta,
  allocateFefo,
  quantityAfter,
  signedQuantity,
  StockError,
  type MovementKind,
} from '@/domain/stock/quantity';
import { planOpening } from '@/domain/stock/medicine';
import { planRepack, repackExpiry } from '@/domain/stock/rotation';
import { audit } from './audit';
import { type ServiceCtx, type Tx, UserError } from './context';
import type {
  StockCheckInput,
  StockCountInput,
  StockLotInput,
  StockLotUpdateInput,
  StockOpenInput,
  StockProductInput,
  StockRepackInput,
  StockUseInput,
} from './stock-schemas';

/** Erro das regras puras → mensagem para o usuário. */
async function rule<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof StockError) throw new UserError(err.message);
    throw err;
  }
}

function notFuture(ctx: ServiceCtx, date: string, what: string) {
  if (compareDates(date, ctx.today) > 0) throw new UserError(`A data ${what} não pode ser no futuro.`);
}

// ───────────────────────────── categorias ─────────────────────────────

async function checkCategoryName(tx: Tx, name: string, parentId: string | null, exceptId?: string) {
  const siblings = await tx
    .select({ id: stockCategories.id, name: stockCategories.name })
    .from(stockCategories)
    .where(parentId ? eq(stockCategories.parentId, parentId) : isNull(stockCategories.parentId));
  const clash = siblings.find((s) => s.id !== exceptId && normalizeText(s.name) === normalizeText(name));
  if (clash) throw new UserError(`Já existe a categoria "${clash.name}".`);
}

/** Categoria de topo ou subcategoria (2 níveis, como D74). */
export async function createStockCategory(
  ctx: ServiceCtx,
  input: { name: string; parentId: string | null },
): Promise<{ id: string }> {
  return ctx.db.transaction(async (tx) => {
    if (input.parentId) {
      const [parent] = await tx.select().from(stockCategories).where(eq(stockCategories.id, input.parentId));
      if (!parent || parent.archivedAt) throw new UserError('Categoria não encontrada.');
      if (parent.parentId) throw new UserError('Subcategoria não tem subcategorias: escolha uma categoria.');
    }
    await checkCategoryName(tx, input.name, input.parentId);
    const [row] = await tx
      .insert(stockCategories)
      .values({ name: input.name, parentId: input.parentId })
      .returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'stock_categories',
      entityId: row!.id,
      action: 'CREATE',
      after: row,
    });
    return { id: row!.id };
  });
}

export async function renameStockCategory(ctx: ServiceCtx, id: string, name: string) {
  return ctx.db.transaction(async (tx) => {
    const [before] = await tx.select().from(stockCategories).where(eq(stockCategories.id, id)).for('update');
    if (!before) throw new UserError('Categoria não encontrada.');
    await checkCategoryName(tx, name, before.parentId, id);
    const [after] = await tx
      .update(stockCategories)
      .set({ name })
      .where(eq(stockCategories.id, id))
      .returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'stock_categories',
      entityId: id,
      action: 'UPDATE',
      before,
      after,
    });
  });
}

/** Arquiva (nunca apaga) uma categoria sem produtos ativos e sem subcategorias ativas. */
export async function archiveStockCategory(ctx: ServiceCtx, id: string) {
  return ctx.db.transaction(async (tx) => {
    const [before] = await tx.select().from(stockCategories).where(eq(stockCategories.id, id)).for('update');
    if (!before || before.archivedAt) throw new UserError('Categoria não encontrada.');
    const [child] = await tx
      .select({ id: stockCategories.id })
      .from(stockCategories)
      .where(and(eq(stockCategories.parentId, id), isNull(stockCategories.archivedAt)))
      .limit(1);
    if (child) throw new UserError('Remova as subcategorias desta categoria antes.');
    const [product] = await tx
      .select({ id: stockProducts.id })
      .from(stockProducts)
      .where(and(eq(stockProducts.categoryId, id), isNull(stockProducts.archivedAt)))
      .limit(1);
    if (product) throw new UserError('Há produtos nesta categoria: mude a categoria deles antes.');
    const [after] = await tx
      .update(stockCategories)
      .set({ archivedAt: new Date() })
      .where(eq(stockCategories.id, id))
      .returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'stock_categories',
      entityId: id,
      action: 'UPDATE',
      before,
      after,
    });
  });
}

/** "Usar categorias sugeridas" (D81): só quando a Casa ainda não tem nenhuma categoria. */
export async function createSuggestedStockCategories(ctx: ServiceCtx) {
  return ctx.db.transaction(async (tx) => {
    const [any] = await tx.select({ id: stockCategories.id }).from(stockCategories).limit(1);
    if (any) throw new UserError('A Casa já tem categorias.');
    for (const s of SUGGESTED_CATEGORIES) {
      const [top] = await tx.insert(stockCategories).values({ name: s.name, icon: s.icon }).returning();
      await audit(tx, {
        userId: ctx.userId,
        entity: 'stock_categories',
        entityId: top!.id,
        action: 'CREATE',
        after: top,
      });
      for (const child of s.children) {
        const [row] = await tx.insert(stockCategories).values({ name: child, parentId: top!.id }).returning();
        await audit(tx, {
          userId: ctx.userId,
          entity: 'stock_categories',
          entityId: row!.id,
          action: 'CREATE',
          after: row,
        });
      }
    }
  });
}

// ───────────────────────────── locais ─────────────────────────────

async function checkLocationName(tx: Tx, name: string, exceptId?: string) {
  const rows = await tx.select({ id: stockLocations.id, name: stockLocations.name }).from(stockLocations);
  const clash = rows.find((r) => r.id !== exceptId && normalizeText(r.name) === normalizeText(name));
  if (clash) throw new UserError(`Já existe o local "${clash.name}".`);
}

export async function createStockLocation(ctx: ServiceCtx, name: string): Promise<{ id: string }> {
  return ctx.db.transaction(async (tx) => {
    await checkLocationName(tx, name);
    const [row] = await tx.insert(stockLocations).values({ name }).returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'stock_locations',
      entityId: row!.id,
      action: 'CREATE',
      after: row,
    });
    return { id: row!.id };
  });
}

export async function renameStockLocation(ctx: ServiceCtx, id: string, name: string) {
  return ctx.db.transaction(async (tx) => {
    const [before] = await tx.select().from(stockLocations).where(eq(stockLocations.id, id)).for('update');
    if (!before) throw new UserError('Local não encontrado.');
    await checkLocationName(tx, name, id);
    const [after] = await tx
      .update(stockLocations)
      .set({ name })
      .where(eq(stockLocations.id, id))
      .returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'stock_locations',
      entityId: id,
      action: 'UPDATE',
      before,
      after,
    });
  });
}

/** Arquiva o local: some das escolhas; os lotes que estão nele continuam mostrando o nome. */
export async function archiveStockLocation(ctx: ServiceCtx, id: string) {
  return ctx.db.transaction(async (tx) => {
    const [before] = await tx.select().from(stockLocations).where(eq(stockLocations.id, id)).for('update');
    if (!before || before.archivedAt) throw new UserError('Local não encontrado.');
    const [after] = await tx
      .update(stockLocations)
      .set({ archivedAt: new Date() })
      .where(eq(stockLocations.id, id))
      .returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'stock_locations',
      entityId: id,
      action: 'UPDATE',
      before,
      after,
    });
  });
}

async function checkLocation(tx: Tx, id: string | null) {
  if (!id) return;
  const [loc] = await tx.select().from(stockLocations).where(eq(stockLocations.id, id));
  if (!loc || loc.archivedAt) throw new UserError('Local não encontrado.');
}

// ───────────────────────────── pessoas e bichos (D89) ─────────────────────────────

async function checkPersonName(tx: Tx, name: string, exceptId?: string) {
  const rows = await tx.select({ id: stockPeople.id, name: stockPeople.name }).from(stockPeople);
  const clash = rows.find((r) => r.id !== exceptId && normalizeText(r.name) === normalizeText(name));
  if (clash) throw new UserError(`Já existe "${clash.name}" na lista.`);
}

export async function createStockPerson(ctx: ServiceCtx, name: string): Promise<{ id: string }> {
  return ctx.db.transaction(async (tx) => {
    await checkPersonName(tx, name);
    const [row] = await tx.insert(stockPeople).values({ name }).returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'stock_people',
      entityId: row!.id,
      action: 'CREATE',
      after: row,
    });
    return { id: row!.id };
  });
}

export async function renameStockPerson(ctx: ServiceCtx, id: string, name: string) {
  return ctx.db.transaction(async (tx) => {
    const [before] = await tx.select().from(stockPeople).where(eq(stockPeople.id, id)).for('update');
    if (!before) throw new UserError('Pessoa não encontrada.');
    await checkPersonName(tx, name, id);
    const [after] = await tx.update(stockPeople).set({ name }).where(eq(stockPeople.id, id)).returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'stock_people',
      entityId: id,
      action: 'UPDATE',
      before,
      after,
    });
  });
}

/** Arquiva: some das escolhas; os produtos que já eram dela continuam mostrando o nome. */
export async function archiveStockPerson(ctx: ServiceCtx, id: string) {
  return ctx.db.transaction(async (tx) => {
    const [before] = await tx.select().from(stockPeople).where(eq(stockPeople.id, id)).for('update');
    if (!before || before.archivedAt) throw new UserError('Pessoa não encontrada.');
    const [after] = await tx
      .update(stockPeople)
      .set({ archivedAt: new Date() })
      .where(eq(stockPeople.id, id))
      .returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'stock_people',
      entityId: id,
      action: 'UPDATE',
      before,
      after,
    });
  });
}

/** "Usar os sugeridos" (D89): os usuários do app mais a filha e o bicho; só quando a lista está vazia. */
export async function createSuggestedStockPeople(ctx: ServiceCtx) {
  return ctx.db.transaction(async (tx) => {
    const [any] = await tx.select({ id: stockPeople.id }).from(stockPeople).limit(1);
    if (any) throw new UserError('A lista de pessoas já tem nomes.');
    const members = await tx.select({ name: users.name }).from(users).orderBy(users.createdAt);
    const names = [...members.map((u) => u.name.trim().split(/\s+/)[0]!), ...SUGGESTED_PEOPLE];
    const seen = new Set<string>();
    for (const name of names) {
      if (seen.has(normalizeText(name))) continue;
      seen.add(normalizeText(name));
      const [row] = await tx.insert(stockPeople).values({ name }).returning();
      await audit(tx, {
        userId: ctx.userId,
        entity: 'stock_people',
        entityId: row!.id,
        action: 'CREATE',
        after: row,
      });
    }
  });
}

// ───────────────────────────── produtos ─────────────────────────────

async function checkPeople(tx: Tx, ids: string[]) {
  if (ids.length === 0) return;
  const unique = [...new Set(ids)];
  const rows = await tx.select().from(stockPeople).where(inArray(stockPeople.id, unique));
  if (rows.length !== unique.length || rows.some((r) => r.archivedAt)) {
    throw new UserError('Pessoa não encontrada.');
  }
}

/** Troca a lista de "para quem" do produto pela informada. */
async function setProductPeople(tx: Tx, productId: string, ids: string[]) {
  await tx.delete(stockProductPeople).where(eq(stockProductPeople.productId, productId));
  const unique = [...new Set(ids)];
  if (unique.length > 0) {
    await tx.insert(stockProductPeople).values(unique.map((personId) => ({ productId, personId })));
  }
}

async function checkProductFields(tx: Tx, input: StockProductInput, exceptId?: string) {
  const [cat] = await tx.select().from(stockCategories).where(eq(stockCategories.id, input.categoryId));
  if (!cat || cat.archivedAt) throw new UserError('Categoria não encontrada.');
  await checkLocation(tx, input.defaultLocationId);
  await checkPeople(tx, input.personIds);
  const others = await tx
    .select({ id: stockProducts.id, name: stockProducts.name, prefix: stockProducts.prefix })
    .from(stockProducts)
    .where(and(isNull(stockProducts.archivedAt), exceptId ? ne(stockProducts.id, exceptId) : undefined));
  const clash = others.find((o) => normalizeText(o.name) === normalizeText(input.name));
  if (clash) throw new UserError(`Já existe o produto "${clash.name}".`);
}

async function takenPrefixes(tx: Tx, exceptId?: string): Promise<string[]> {
  // arquivados também: o código dos lotes antigos continua valendo
  const rows = await tx
    .select({ prefix: stockProducts.prefix })
    .from(stockProducts)
    .where(exceptId ? ne(stockProducts.id, exceptId) : undefined);
  return rows.map((r) => r.prefix);
}

export async function createStockProduct(ctx: ServiceCtx, input: StockProductInput): Promise<{ id: string }> {
  return ctx.db.transaction(async (tx) => {
    await checkProductFields(tx, input);
    const taken = await takenPrefixes(tx);
    if (input.prefix && taken.includes(input.prefix)) {
      throw new UserError(`O código ${input.prefix} já é de outro produto.`);
    }
    const { prefix, personIds, ...fields } = input;
    const [row] = await tx
      .insert(stockProducts)
      .values({ ...fields, prefix: prefix ?? suggestPrefix(input.name, taken), createdByUserId: ctx.userId })
      .returning();
    await setProductPeople(tx, row!.id, personIds);
    await audit(tx, {
      userId: ctx.userId,
      entity: 'stock_products',
      entityId: row!.id,
      action: 'CREATE',
      after: { ...row, personIds },
    });
    return { id: row!.id };
  });
}

/** A medida e o código só mudam enquanto o produto não tem lotes (mudariam o sentido do que já entrou). */
export async function updateStockProduct(ctx: ServiceCtx, id: string, input: StockProductInput) {
  return ctx.db.transaction(async (tx) => {
    const [before] = await tx.select().from(stockProducts).where(eq(stockProducts.id, id)).for('update');
    if (!before || before.archivedAt) throw new UserError('Produto não encontrado.');
    await checkProductFields(tx, input, id);
    const [lot] = await tx
      .select({ id: stockLots.id })
      .from(stockLots)
      .where(eq(stockLots.productId, id))
      .limit(1);
    const prefix = input.prefix ?? before.prefix;
    if (lot && input.measure !== before.measure) {
      throw new UserError('O produto já tem entradas: a forma de contar não muda mais.');
    }
    if (lot && prefix !== before.prefix) {
      throw new UserError('O produto já tem lotes: o código não muda mais (as etiquetas usam ele).');
    }
    if (prefix !== before.prefix && (await takenPrefixes(tx, id)).includes(prefix)) {
      throw new UserError(`O código ${prefix} já é de outro produto.`);
    }
    const { personIds, ...fields } = input;
    const beforeIds = (
      await tx
        .select({ personId: stockProductPeople.personId })
        .from(stockProductPeople)
        .where(eq(stockProductPeople.productId, id))
    ).map((r) => r.personId);
    const [after] = await tx
      .update(stockProducts)
      .set({ ...fields, prefix })
      .where(eq(stockProducts.id, id))
      .returning();
    await setProductPeople(tx, id, personIds);
    await audit(tx, {
      userId: ctx.userId,
      entity: 'stock_products',
      entityId: id,
      action: 'UPDATE',
      before: { ...before, personIds: beforeIds },
      after: { ...after, personIds },
    });
  });
}

async function lockProduct(tx: Tx, id: string) {
  const [product] = await tx.select().from(stockProducts).where(eq(stockProducts.id, id)).for('update');
  if (!product) throw new UserError('Produto não encontrado.');
  return product;
}

/** Arquiva o produto sem estoque: some das listas; o histórico fica. */
export async function archiveStockProduct(ctx: ServiceCtx, id: string) {
  return ctx.db.transaction(async (tx) => {
    const before = await lockProduct(tx, id);
    if (before.archivedAt) throw new UserError('Produto não encontrado.');
    const left = (await listLots(tx, [id])).reduce((s, l) => s + Math.max(l.quantity, 0), 0);
    if (left > 0) throw new UserError('O produto ainda tem estoque: dê baixa ou descarte antes de arquivar.');
    const [after] = await tx
      .update(stockProducts)
      .set({ archivedAt: new Date() })
      .where(eq(stockProducts.id, id))
      .returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'stock_products',
      entityId: id,
      action: 'UPDATE',
      before,
      after,
    });
  });
}

// ───────────────────────────── lotes e movimentos ─────────────────────────────

function checkContent(measure: 'UNIT' | 'WEIGHT' | 'VOLUME', content: number | null) {
  if (measure !== 'UNIT' && content === null) {
    throw new UserError(
      measure === 'WEIGHT'
        ? 'Informe o peso de cada embalagem (ex.: 5 kg).'
        : 'Informe o volume de cada embalagem (ex.: 5 L).',
    );
  }
}

async function insertMovement(
  tx: Tx,
  ctx: ServiceCtx,
  values: {
    lotId: string;
    kind: MovementKind;
    quantity: number;
    date: string;
    notes: string | null;
    /** REPACK_OUT: o lote envasado que nasceu dele */
    repackLotId?: string;
  },
) {
  const [row] = await tx
    .insert(stockMovements)
    .values({
      lotId: values.lotId,
      kind: values.kind,
      quantity: values.quantity,
      repackLotId: values.repackLotId ?? null,
      movementDate: values.date,
      notes: values.notes,
      createdByUserId: ctx.userId,
    })
    .returning();
  await audit(tx, {
    userId: ctx.userId,
    entity: 'stock_movements',
    entityId: row!.id,
    action: 'CREATE',
    after: row,
  });
  return row!;
}

/** Entrada (D83): um lote novo com o próximo número do produto e o movimento IN das embalagens. */
export async function addStockLot(
  ctx: ServiceCtx,
  input: StockLotInput,
): Promise<{ id: string; code: string }> {
  return ctx.db.transaction(async (tx) => {
    const product = await lockProduct(tx, input.productId);
    if (product.archivedAt) throw new UserError('Produto não encontrado.');
    checkContent(product.measure, input.contentPerPackage);
    await checkLocation(tx, input.locationId);
    notFuture(ctx, input.entryDate, 'de entrada');
    const number = await nextLotNumber(tx, product.id);
    const { packages, productId, ...fields } = input;
    const [lot] = await tx
      .insert(stockLots)
      .values({ ...fields, productId, number, createdByUserId: ctx.userId })
      .returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'stock_lots',
      entityId: lot!.id,
      action: 'CREATE',
      after: lot,
    });
    await insertMovement(tx, ctx, {
      lotId: lot!.id,
      kind: 'IN',
      quantity: await rule(() => signedQuantity('IN', packages)),
      date: input.entryDate,
      notes: null,
    });
    return { id: lot!.id, code: lotCode(product.prefix, number) };
  });
}

/** Corrige os dados do lote (embalagem, conteúdo, local, datas). A quantidade muda só por movimento. */
export async function updateStockLot(ctx: ServiceCtx, input: StockLotUpdateInput) {
  return ctx.db.transaction(async (tx) => {
    const [found] = await tx.select().from(stockLots).where(eq(stockLots.id, input.id));
    if (!found) throw new UserError('Lote não encontrado.');
    const product = await lockProduct(tx, found.productId);
    checkContent(product.measure, input.contentPerPackage);
    await checkLocation(tx, input.locationId);
    notFuture(ctx, input.entryDate, 'de entrada');
    const { id, ...fields } = input;
    const [after] = await tx.update(stockLots).set(fields).where(eq(stockLots.id, id)).returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'stock_lots',
      entityId: id,
      action: 'UPDATE',
      before: found,
      after,
    });
  });
}

/**
 * "Usei" / "Descartei": sem lote escolhido, tira na ordem FEFO (o que vence primeiro), passando ao lote seguinte
 * quando um acaba; com lote escolhido, só dele. Nunca deixa um lote negativo.
 */
export async function consumeStock(ctx: ServiceCtx, input: StockUseInput): Promise<{ lots: string[] }> {
  return ctx.db.transaction(async (tx) => {
    await lockProduct(tx, input.productId);
    notFuture(ctx, input.date, 'do movimento');
    const lots = await listLots(tx, [input.productId]);
    let plan: { lotId: string; packages: number }[];
    if (input.lotId) {
      const lot = lots.find((l) => l.id === input.lotId);
      if (!lot) throw new UserError('Lote não encontrado.');
      await rule(() => quantityAfter(lot.quantity, -input.packages, lot.code));
      plan = [{ lotId: lot.id, packages: input.packages }];
    } else {
      plan = await rule(() => allocateFefo(lots, input.packages));
    }
    const byId = new Map<string, LotRow>(lots.map((l) => [l.id, l]));
    for (const p of plan) {
      await insertMovement(tx, ctx, {
        lotId: p.lotId,
        kind: input.kind,
        quantity: await rule(() => signedQuantity(input.kind, p.packages)),
        date: input.date,
        notes: input.notes,
      });
    }
    return { lots: plan.map((p) => byId.get(p.lotId)!.code) };
  });
}

/** "Contei" (ADJUST): o lote passa a ter o que foi contado. */
export async function countStockLot(ctx: ServiceCtx, input: StockCountInput) {
  return ctx.db.transaction(async (tx) => {
    const [found] = await tx.select().from(stockLots).where(eq(stockLots.id, input.lotId));
    if (!found) throw new UserError('Lote não encontrado.');
    await lockProduct(tx, found.productId);
    notFuture(ctx, input.date, 'da contagem');
    const lot = (await listLots(tx, [found.productId])).find((l) => l.id === found.id)!;
    const delta = await rule(() => adjustmentDelta(lot.quantity, input.counted));
    await insertMovement(tx, ctx, {
      lotId: lot.id,
      kind: 'ADJUST',
      quantity: delta,
      date: input.date,
      notes: input.notes,
    });
  });
}

/** Próximo número de lote do produto: o maior + 1 (lote não se apaga, então nunca se repete). */
async function nextLotNumber(tx: Tx, productId: string): Promise<number> {
  const [last] = await tx
    .select({ n: max(stockLots.number) })
    .from(stockLots)
    .where(eq(stockLots.productId, productId));
  return (last?.n ?? 0) + 1;
}

/**
 * Envasar (D84): numa transação, tira as embalagens dos lotes de origem (REPACK_OUT, cada um apontando o lote
 * novo) e cria o lote envasado (REPACK) com as garrafas (REPACK_IN), a selagem como entrada e a validade = selagem
 * + prazo do produto, a menos que o usuário informe outra. Vale sempre o prazo do envase, mesmo depois da
 * validade original do pacote.
 */
export async function repackStock(
  ctx: ServiceCtx,
  input: StockRepackInput,
): Promise<{ id: string; code: string }> {
  return ctx.db.transaction(async (tx) => {
    const product = await lockProduct(tx, input.productId);
    if (product.archivedAt) throw new UserError('Produto não encontrado.');
    checkContent(product.measure, input.contentPerPackage);
    await checkLocation(tx, input.locationId);
    notFuture(ctx, input.sealDate, 'de selagem');
    const lots = await listLots(tx, [product.id]);
    const plan = await rule(() => planRepack(lots, input.sources));
    const expiryDate = input.expiryDate ?? repackExpiry(input.sealDate, product.repackShelfLifeMonths);
    const number = await nextLotNumber(tx, product.id);
    const [lot] = await tx
      .insert(stockLots)
      .values({
        productId: product.id,
        number,
        locationId: input.locationId,
        packageName: input.packageName,
        contentPerPackage: input.contentPerPackage,
        entryDate: input.sealDate,
        expiryDate,
        origin: 'REPACK',
        notes: input.notes,
        createdByUserId: ctx.userId,
      })
      .returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'stock_lots',
      entityId: lot!.id,
      action: 'CREATE',
      after: lot,
    });
    for (const p of plan) {
      await insertMovement(tx, ctx, {
        lotId: p.lotId,
        kind: 'REPACK_OUT',
        quantity: await rule(() => signedQuantity('REPACK_OUT', p.packages)),
        date: input.sealDate,
        notes: null,
        repackLotId: lot!.id,
      });
    }
    await insertMovement(tx, ctx, {
      lotId: lot!.id,
      kind: 'REPACK_IN',
      quantity: await rule(() => signedQuantity('REPACK_IN', input.packages)),
      date: input.sealDate,
      notes: null,
    });
    return { id: lot!.id, code: lotCode(product.prefix, number) };
  });
}

/**
 * "Abri" (D90): numa transação, 1 embalagem fechada do lote sai (OPEN_OUT, apontando o lote novo) e nasce o lote
 * aberto (origem OPENED) com OPEN_IN: as unidades soltas (comprimido, cápsula…) ou 1 embalagem aberta. O total do
 * produto não muda; a validade do lote aberto é o menor entre a da embalagem e a abertura + prazo do produto.
 */
export async function openStockLot(
  ctx: ServiceCtx,
  input: StockOpenInput,
): Promise<{ id: string; code: string }> {
  return ctx.db.transaction(async (tx) => {
    const [found] = await tx.select().from(stockLots).where(eq(stockLots.id, input.lotId));
    if (!found) throw new UserError('Lote não encontrado.');
    const product = await lockProduct(tx, found.productId);
    if (product.archivedAt) throw new UserError('Produto não encontrado.');
    notFuture(ctx, input.date, 'da abertura');
    if (compareDates(input.date, found.entryDate) < 0) {
      throw new UserError('A abertura não pode ser antes da entrada do lote.');
    }
    const lot = (await listLots(tx, [product.id])).find((l) => l.id === found.id)!;
    const plan = await rule(() =>
      planOpening(
        {
          measure: product.measure,
          form: product.medicineForm,
          openShelfLifeDays: product.openShelfLifeDays,
          packageName: lot.packageName,
          contentPerPackage: lot.contentPerPackage,
          expiryDate: lot.expiryDate,
          origin: lot.origin,
          quantity: lot.quantity,
        },
        input.date,
      ),
    );
    const number = await nextLotNumber(tx, product.id);
    const [opened] = await tx
      .insert(stockLots)
      .values({
        productId: product.id,
        number,
        locationId: lot.locationId,
        packageName: plan.packageName,
        contentPerPackage: plan.contentPerPackage,
        entryDate: input.date,
        expiryDate: plan.expiryDate,
        origin: 'OPENED',
        notes: null,
        createdByUserId: ctx.userId,
      })
      .returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'stock_lots',
      entityId: opened!.id,
      action: 'CREATE',
      after: opened,
    });
    await insertMovement(tx, ctx, {
      lotId: lot.id,
      kind: 'OPEN_OUT',
      quantity: await rule(() => signedQuantity('OPEN_OUT', 1)),
      date: input.date,
      notes: null,
      repackLotId: opened!.id,
    });
    await insertMovement(tx, ctx, {
      lotId: opened!.id,
      kind: 'OPEN_IN',
      quantity: await rule(() => signedQuantity('OPEN_IN', plan.packages)),
      date: input.date,
      notes: null,
    });
    return { id: opened!.id, code: lotCode(product.prefix, number) };
  });
}

/** "Conferi" (D85): registra a conferência do lote; a próxima conta a partir dela. */
export async function checkStockLot(ctx: ServiceCtx, input: StockCheckInput) {
  return ctx.db.transaction(async (tx) => {
    const [lot] = await tx.select().from(stockLots).where(eq(stockLots.id, input.lotId));
    if (!lot) throw new UserError('Lote não encontrado.');
    await lockProduct(tx, lot.productId);
    notFuture(ctx, input.date, 'da conferência');
    if (compareDates(input.date, lot.entryDate) < 0) {
      throw new UserError('A conferência não pode ser antes da entrada do lote.');
    }
    const [row] = await tx
      .insert(stockChecks)
      .values({ lotId: lot.id, checkDate: input.date, notes: input.notes, createdByUserId: ctx.userId })
      .returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'stock_checks',
      entityId: row!.id,
      action: 'CREATE',
      after: row,
    });
  });
}

/**
 * Desfaz um movimento (cancelled_at): sai da soma. Num envase ou numa abertura, desfaz a operação inteira (as saídas dos lotes de
 * origem e a entrada das garrafas), nunca uma parte. Recusa se algum lote ficaria negativo.
 */
export async function cancelStockMovement(ctx: ServiceCtx, id: string) {
  return ctx.db.transaction(async (tx) => {
    const [found] = await tx
      .select({ movement: stockMovements, productId: stockLots.productId })
      .from(stockMovements)
      .innerJoin(stockLots, eq(stockLots.id, stockMovements.lotId))
      .where(eq(stockMovements.id, id));
    if (!found) throw new UserError('Movimento não encontrado.');
    await lockProduct(tx, found.productId);
    const [target] = await tx.select().from(stockMovements).where(eq(stockMovements.id, id)).for('update');
    if (target!.cancelledAt) throw new UserError('Este movimento já foi desfeito.');

    const repackLot =
      target!.kind === 'REPACK_IN' || target!.kind === 'OPEN_IN'
        ? target!.lotId
        : target!.kind === 'REPACK_OUT' || target!.kind === 'OPEN_OUT'
          ? target!.repackLotId
          : null;
    const group = repackLot
      ? await tx
          .select()
          .from(stockMovements)
          .where(
            and(
              isNull(stockMovements.cancelledAt),
              or(
                and(
                  eq(stockMovements.lotId, repackLot),
                  inArray(stockMovements.kind, ['REPACK_IN', 'OPEN_IN']),
                ),
                eq(stockMovements.repackLotId, repackLot),
              ),
            ),
          )
          .for('update')
      : [target!];

    const lots = new Map((await listLots(tx, [found.productId])).map((l) => [l.id, l]));
    const after = new Map<string, number>();
    for (const m of group)
      after.set(m.lotId, (after.get(m.lotId) ?? lots.get(m.lotId)!.quantity) - m.quantity);
    for (const [lotId, quantity] of after) {
      if (quantity >= 0) continue;
      const code = lots.get(lotId)!.code;
      throw new UserError(
        repackLot && lotId === repackLot
          ? `Parte das embalagens do ${code} já saiu: desfaça esses movimentos antes de desfazer o envase ou a abertura.`
          : `O lote ${code} ficaria negativo: desfaça antes os movimentos que vieram depois.`,
      );
    }
    for (const m of group) {
      const [cancelled] = await tx
        .update(stockMovements)
        .set({ cancelledAt: sql`now()`, cancelledByUserId: ctx.userId })
        .where(eq(stockMovements.id, m.id))
        .returning();
      await audit(tx, {
        userId: ctx.userId,
        entity: 'stock_movements',
        entityId: m.id,
        action: 'CANCEL',
        before: m,
        after: cancelled,
      });
    }
  });
}
