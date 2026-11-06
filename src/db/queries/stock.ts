/**
 * Leituras do estoque da Casa (D81 a D83). A quantidade de cada lote é Σ movimentos não cancelados, numa agregação
 * agrupada (sem subconsulta correlacionada); o resto (totais, FEFO, validade) sai das regras puras de domain/stock.
 */
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { lotCode } from '@/domain/stock/catalog';
import type { Measure } from '@/domain/stock/measure';
import {
  countByPackage,
  expiryLevel,
  sortFefo,
  totalInMeasure,
  type ExpiryLevel,
  type MovementKind,
} from '@/domain/stock/quantity';
import type { ISODate } from '@/domain/dates';
import { isLow, restockNeed, type RestockNeed } from '@/domain/stock/restock';
import type { MedicineForm } from '@/domain/stock/medicine';
import { checkDue, nextCheckDate } from '@/domain/stock/rotation';
import type { AnyDB } from '../client';
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
} from '../schema';

/** Ordem alfabética do português (o Postgres com collation C poria "Água" depois de "Remédios"). */
const byName = <T extends { name: string }>(rows: T[]): T[] =>
  rows.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

export type StockCategoryRow = {
  id: string;
  name: string;
  parentId: string | null;
  icon: string | null;
  archivedAt: Date | null;
};

export async function listStockCategories(
  db: AnyDB,
  opts: { includeArchived?: boolean } = {},
): Promise<StockCategoryRow[]> {
  const rows = await db
    .select({
      id: stockCategories.id,
      name: stockCategories.name,
      parentId: stockCategories.parentId,
      icon: stockCategories.icon,
      archivedAt: stockCategories.archivedAt,
    })
    .from(stockCategories)
    .where(opts.includeArchived ? undefined : isNull(stockCategories.archivedAt));
  return byName(rows);
}

export type StockLocationRow = { id: string; name: string; archivedAt: Date | null };

export async function listStockLocations(
  db: AnyDB,
  opts: { includeArchived?: boolean } = {},
): Promise<StockLocationRow[]> {
  const rows = await db
    .select({ id: stockLocations.id, name: stockLocations.name, archivedAt: stockLocations.archivedAt })
    .from(stockLocations)
    .where(opts.includeArchived ? undefined : isNull(stockLocations.archivedAt));
  return byName(rows);
}

export type StockPersonRow = { id: string; name: string; archivedAt: Date | null };

/** Pessoas e bichos da casa (D89). */
export async function listStockPeople(
  db: AnyDB,
  opts: { includeArchived?: boolean } = {},
): Promise<StockPersonRow[]> {
  const rows = await db
    .select({ id: stockPeople.id, name: stockPeople.name, archivedAt: stockPeople.archivedAt })
    .from(stockPeople)
    .where(opts.includeArchived ? undefined : isNull(stockPeople.archivedAt));
  return byName(rows);
}

export type ProductRow = {
  id: string;
  name: string;
  prefix: string;
  measure: Measure;
  categoryId: string;
  categoryName: string;
  /** categoria de topo (a própria, ou a mãe quando o produto está numa subcategoria) */
  topCategoryId: string;
  /** "Alimentos › Grãos" ou "Água" */
  categoryLabel: string;
  defaultLocationId: string | null;
  defaultLocationName: string | null;
  minQuantity: number | null;
  targetQuantity: number | null;
  defaultPackage: string | null;
  defaultContent: number | null;
  /** rótulo do prazo: validade ou "trocar até" (D85) */
  expiryKind: 'EXPIRY' | 'REPLACE_BY';
  /** prazo depois de envasado, em meses (D84) */
  repackShelfLifeMonths: number | null;
  /** conferência dos lotes a cada N meses (D85) */
  checkEveryMonths: number | null;
  /** remédio (D88) */
  isMedicine: boolean;
  activeIngredient: string | null;
  strength: string | null;
  medicineForm: MedicineForm | null;
  /** validade depois de aberto, em dias (D90) */
  openShelfLifeDays: number | null;
  /** para quem é (D89) */
  people: { id: string; name: string }[];
  notes: string | null;
  archivedAt: Date | null;
};

async function productRows(
  db: AnyDB,
  where: { id?: string; includeArchived?: boolean },
): Promise<ProductRow[]> {
  const [rows, cats, links] = await Promise.all([
    db
      .select({
        id: stockProducts.id,
        name: stockProducts.name,
        prefix: stockProducts.prefix,
        measure: stockProducts.measure,
        categoryId: stockProducts.categoryId,
        defaultLocationId: stockProducts.defaultLocationId,
        defaultLocationName: stockLocations.name,
        minQuantity: stockProducts.minQuantity,
        targetQuantity: stockProducts.targetQuantity,
        defaultPackage: stockProducts.defaultPackage,
        defaultContent: stockProducts.defaultContent,
        expiryKind: stockProducts.expiryKind,
        repackShelfLifeMonths: stockProducts.repackShelfLifeMonths,
        checkEveryMonths: stockProducts.checkEveryMonths,
        isMedicine: stockProducts.isMedicine,
        activeIngredient: stockProducts.activeIngredient,
        strength: stockProducts.strength,
        medicineForm: stockProducts.medicineForm,
        openShelfLifeDays: stockProducts.openShelfLifeDays,
        notes: stockProducts.notes,
        archivedAt: stockProducts.archivedAt,
      })
      .from(stockProducts)
      .leftJoin(stockLocations, eq(stockLocations.id, stockProducts.defaultLocationId))
      .where(
        and(
          where.id ? eq(stockProducts.id, where.id) : undefined,
          where.includeArchived || where.id ? undefined : isNull(stockProducts.archivedAt),
        ),
      ),
    listStockCategories(db, { includeArchived: true }),
    db
      .select({ productId: stockProductPeople.productId, id: stockPeople.id, name: stockPeople.name })
      .from(stockProductPeople)
      .innerJoin(stockPeople, eq(stockPeople.id, stockProductPeople.personId)),
  ]);
  const byId = new Map(cats.map((c) => [c.id, c]));
  const peopleOf = new Map<string, { id: string; name: string }[]>();
  for (const l of links)
    peopleOf.set(l.productId, [...(peopleOf.get(l.productId) ?? []), { id: l.id, name: l.name }]);
  return byName(rows).map((r) => {
    const cat = byId.get(r.categoryId);
    const parent = cat?.parentId ? byId.get(cat.parentId) : undefined;
    return {
      ...r,
      people: byName(peopleOf.get(r.id) ?? []),
      categoryName: cat?.name ?? '',
      topCategoryId: parent?.id ?? r.categoryId,
      categoryLabel: parent ? `${parent.name} › ${cat!.name}` : (cat?.name ?? ''),
    };
  });
}

export type LotRow = {
  id: string;
  productId: string;
  number: number;
  code: string;
  locationId: string | null;
  locationName: string | null;
  packageName: string;
  contentPerPackage: number | null;
  entryDate: ISODate;
  expiryDate: ISODate | null;
  origin: 'PURCHASE' | 'REPACK' | 'OPENED';
  notes: string | null;
  /** embalagens: Σ movimentos não cancelados */
  quantity: number;
  /** última conferência (D85) */
  lastCheckDate: ISODate | null;
};

const toInt = (v: string | number | null | undefined) => {
  const n = Number(v ?? 0);
  if (!Number.isSafeInteger(n)) throw new Error(`Quantidade inválida vinda do banco: ${v}`);
  return n;
};

/** Lotes (de um produto, ou de todos os produtos ativos) com a quantidade de cada um. */
export async function listLots(db: AnyDB, productIds?: string[]): Promise<LotRow[]> {
  if (productIds && productIds.length === 0) return [];
  const sums = db
    .select({
      lotId: stockMovements.lotId,
      quantity: sql<string>`sum(${stockMovements.quantity})`.as('quantity'),
    })
    .from(stockMovements)
    .where(isNull(stockMovements.cancelledAt))
    .groupBy(stockMovements.lotId)
    .as('lot_sums');
  const checks = db
    .select({
      lotId: stockChecks.lotId,
      lastCheckDate: sql<string>`max(${stockChecks.checkDate})`.as('last_check_date'),
    })
    .from(stockChecks)
    .groupBy(stockChecks.lotId)
    .as('lot_checks');
  const rows = await db
    .select({
      id: stockLots.id,
      productId: stockLots.productId,
      number: stockLots.number,
      prefix: stockProducts.prefix,
      locationId: stockLots.locationId,
      locationName: stockLocations.name,
      packageName: stockLots.packageName,
      contentPerPackage: stockLots.contentPerPackage,
      entryDate: stockLots.entryDate,
      expiryDate: stockLots.expiryDate,
      origin: stockLots.origin,
      notes: stockLots.notes,
      quantity: sums.quantity,
      lastCheckDate: checks.lastCheckDate,
    })
    .from(stockLots)
    .innerJoin(stockProducts, eq(stockProducts.id, stockLots.productId))
    .leftJoin(stockLocations, eq(stockLocations.id, stockLots.locationId))
    .leftJoin(sums, eq(sums.lotId, stockLots.id))
    .leftJoin(checks, eq(checks.lotId, stockLots.id))
    .where(productIds ? inArray(stockLots.productId, productIds) : isNull(stockProducts.archivedAt))
    .orderBy(asc(stockLots.number));
  return rows.map(({ prefix, quantity, lastCheckDate, ...r }) => ({
    ...r,
    code: lotCode(prefix, r.number),
    quantity: toInt(quantity),
    lastCheckDate: lastCheckDate ?? null,
  }));
}

export type ProductSummary = ProductRow & {
  /** embalagens em estoque (Σ lotes) */
  packages: number;
  /** total na medida do produto (un, g ou ml) */
  total: number;
  lotsInStock: number;
  /** nomes das embalagens em estoque ("pacote", "garrafa PET") */
  packageNames: string[];
  /** embalagens por nome, a de uso primeiro (D90: "1 caixa" e "7 comprimidos") */
  packageCounts: { name: string; count: number }[];
  /** locais dos lotes em estoque (ou o local padrão, sem estoque) */
  locationNames: string[];
  nextExpiry: ISODate | null;
  expiry: ExpiryLevel | null;
  /** abaixo do estoque mínimo (sem mínimo = false) */
  low: boolean;
};

function summarize(product: ProductRow, lots: LotRow[], today: ISODate): ProductSummary {
  const inStock = sortFefo(lots.filter((l) => l.quantity > 0));
  const total = totalInMeasure(inStock);
  const nextExpiry = inStock.find((l) => l.expiryDate)?.expiryDate ?? null;
  const unique = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  const locations = unique(inStock.map((l) => l.locationName));
  return {
    ...product,
    packages: inStock.reduce((s, l) => s + l.quantity, 0),
    total,
    lotsInStock: inStock.length,
    packageNames: unique(inStock.map((l) => l.packageName)),
    packageCounts: countByPackage(inStock),
    locationNames: locations.length > 0 ? locations : unique([product.defaultLocationName]),
    nextExpiry,
    expiry: expiryLevel(nextExpiry, today),
    low: isLow(total, product.minQuantity),
  };
}

/** Todos os produtos ativos com quantidade, locais e próxima validade (a casa tem centenas, não milhões). */
export async function stockOverview(db: AnyDB, today: ISODate): Promise<ProductSummary[]> {
  const [products, lots] = await Promise.all([productRows(db, {}), listLots(db)]);
  const byProduct = new Map<string, LotRow[]>();
  for (const l of lots) byProduct.set(l.productId, [...(byProduct.get(l.productId) ?? []), l]);
  return products.map((p) => summarize(p, byProduct.get(p.id) ?? [], today));
}

export type ShoppingItem = ProductSummary & { need: RestockNeed };

/**
 * Lista de compras (D86), gerada e nunca armazenada: os produtos abaixo da meta (sem meta, abaixo do mínimo), com
 * quanto falta. Primeiro o que está acabando (abaixo do mínimo), depois por categoria e nome.
 */
export function shoppingItems(products: readonly ProductSummary[]): ShoppingItem[] {
  const items: ShoppingItem[] = [];
  for (const p of products) {
    const need = restockNeed({
      total: p.total,
      min: p.minQuantity,
      target: p.targetQuantity,
      measure: p.measure,
      defaultContent: p.defaultContent,
    });
    if (need) items.push({ ...p, need });
  }
  return items.sort(
    (a, b) =>
      Number(b.need.belowMin) - Number(a.need.belowMin) ||
      a.categoryLabel.localeCompare(b.categoryLabel, 'pt-BR') ||
      a.name.localeCompare(b.name, 'pt-BR'),
  );
}

export type MovementRow = {
  id: string;
  lotId: string;
  lotCode: string;
  kind: MovementKind;
  quantity: number;
  movementDate: ISODate;
  notes: string | null;
  userName: string;
  createdAt: Date;
  cancelledAt: Date | null;
};

async function movementRows(db: AnyDB, opts: { productId?: string; limit: number }): Promise<MovementRow[]> {
  const rows = await db
    .select({
      id: stockMovements.id,
      lotId: stockMovements.lotId,
      number: stockLots.number,
      prefix: stockProducts.prefix,
      kind: stockMovements.kind,
      quantity: stockMovements.quantity,
      movementDate: stockMovements.movementDate,
      notes: stockMovements.notes,
      userName: users.name,
      createdAt: stockMovements.createdAt,
      cancelledAt: stockMovements.cancelledAt,
    })
    .from(stockMovements)
    .innerJoin(stockLots, eq(stockLots.id, stockMovements.lotId))
    .innerJoin(stockProducts, eq(stockProducts.id, stockLots.productId))
    .innerJoin(users, eq(users.id, stockMovements.createdByUserId))
    .where(opts.productId ? eq(stockLots.productId, opts.productId) : undefined)
    .orderBy(desc(stockMovements.createdAt))
    .limit(opts.limit);
  return rows.map(({ number, prefix, ...r }) => ({ ...r, lotCode: lotCode(prefix, number) }));
}

export type ProductDetail = {
  product: ProductSummary;
  /** em estoque na ordem de uso (FEFO), depois os zerados (mais recentes primeiro) */
  lots: LotRow[];
  movements: MovementRow[];
};

export async function productDetail(db: AnyDB, id: string, today: ISODate): Promise<ProductDetail | null> {
  const [product] = await productRows(db, { id });
  if (!product) return null;
  const [lots, movements] = await Promise.all([
    listLots(db, [id]),
    movementRows(db, { productId: id, limit: 50 }),
  ]);
  const inStock = sortFefo(lots.filter((l) => l.quantity > 0));
  const empty = lots.filter((l) => l.quantity <= 0).sort((a, b) => b.number - a.number);
  return { product: summarize(product, lots, today), lots: [...inStock, ...empty], movements };
}

export type RecentMovement = MovementRow & { productId: string; productName: string; packageName: string };

/** Últimos movimentos da casa toda (Início da Casa). */
export async function recentMovements(db: AnyDB, limit = 6): Promise<RecentMovement[]> {
  const rows = await movementRows(db, { limit });
  if (rows.length === 0) return [];
  const lots = await db
    .select({
      id: stockLots.id,
      productId: stockLots.productId,
      productName: stockProducts.name,
      packageName: stockLots.packageName,
    })
    .from(stockLots)
    .innerJoin(stockProducts, eq(stockProducts.id, stockLots.productId))
    .where(inArray(stockLots.id, [...new Set(rows.map((r) => r.lotId))]));
  const byLot = new Map(lots.map((l) => [l.id, l]));
  return rows.map((r) => {
    const l = byLot.get(r.lotId)!;
    return { ...r, productId: l.productId, productName: l.productName, packageName: l.packageName };
  });
}

export type RotationLot = LotRow & {
  productName: string;
  measure: Measure;
  expiryKind: 'EXPIRY' | 'REPLACE_BY';
  expiry: ExpiryLevel | null;
  /** próxima conferência (null: o produto não tem conferência periódica) */
  nextCheck: ISODate | null;
  checkDue: boolean;
};

/**
 * Rodízio (D85): todos os lotes com estoque, com validade, próxima conferência e se ela já chegou, na ordem FEFO
 * da casa toda. Base dos quadros Vencidos/Vencendo e Conferir da Início da Casa e do painel de rodízio.
 */
export async function rotationLots(db: AnyDB, today: ISODate): Promise<RotationLot[]> {
  const [products, lots] = await Promise.all([productRows(db, {}), listLots(db)]);
  const byId = new Map(products.map((p) => [p.id, p]));
  return sortFefo(lots.filter((l) => l.quantity > 0 && byId.has(l.productId))).map((l) => {
    const p = byId.get(l.productId)!;
    const nextCheck = nextCheckDate(l.entryDate, l.lastCheckDate, p.checkEveryMonths);
    return {
      ...l,
      productName: p.name,
      measure: p.measure,
      expiryKind: p.expiryKind,
      expiry: expiryLevel(l.expiryDate, today),
      nextCheck,
      checkDue: checkDue(nextCheck, today),
    };
  });
}

export type CheckRow = { id: string; checkDate: ISODate; notes: string | null; userName: string };

export type LotDetail = {
  lot: LotRow;
  product: ProductRow;
  /** lote envasado: de quais lotes saíram as embalagens */
  sources: { lotId: string; code: string; packages: number }[];
  /** envases e aberturas que saíram deste lote (`opened`: o lote que nasceu é uma embalagem aberta, D90) */
  repacks: { lotId: string; code: string; packages: number; opened: boolean }[];
  movements: MovementRow[];
  checks: CheckRow[];
  nextCheck: ISODate | null;
  checkDue: boolean;
  expiry: ExpiryLevel | null;
};

/** Um lote (D87: o QR da etiqueta abre aqui), com a origem do envase ou da abertura, as conferências e o histórico. */
export async function lotDetail(db: AnyDB, id: string, today: ISODate): Promise<LotDetail | null> {
  const [found] = await db
    .select({ productId: stockLots.productId })
    .from(stockLots)
    .where(eq(stockLots.id, id));
  if (!found) return null;
  const [[product], lots, checks, links] = await Promise.all([
    productRows(db, { id: found.productId }),
    listLots(db, [found.productId]),
    db
      .select({
        id: stockChecks.id,
        checkDate: stockChecks.checkDate,
        notes: stockChecks.notes,
        userName: users.name,
      })
      .from(stockChecks)
      .innerJoin(users, eq(users.id, stockChecks.createdByUserId))
      .where(eq(stockChecks.lotId, id))
      .orderBy(desc(stockChecks.checkDate), desc(stockChecks.createdAt)),
    // REPACK_OUT e OPEN_OUT ativos ligados a este lote: como origem (sai dele) ou como destino (nasceu dele)
    db
      .select({
        fromLot: stockMovements.lotId,
        toLot: stockMovements.repackLotId,
        quantity: stockMovements.quantity,
      })
      .from(stockMovements)
      .where(
        and(
          inArray(stockMovements.kind, ['REPACK_OUT', 'OPEN_OUT']),
          isNull(stockMovements.cancelledAt),
          or(eq(stockMovements.lotId, id), eq(stockMovements.repackLotId, id)),
        ),
      ),
  ]);
  const lot = lots.find((l) => l.id === id)!;
  // as origens e os destinos são do mesmo produto (D84)
  const code = (lotId: string) => lots.find((l) => l.id === lotId)?.code ?? '';
  const nextCheck = nextCheckDate(lot.entryDate, lot.lastCheckDate, product!.checkEveryMonths);
  const movements = (await movementRows(db, { productId: found.productId, limit: 200 })).filter(
    (m) => m.lotId === id,
  );
  return {
    lot,
    product: product!,
    sources: links
      .filter((l) => l.toLot === id)
      .map((l) => ({ lotId: l.fromLot, code: code(l.fromLot), packages: -l.quantity })),
    repacks: links
      .filter((l) => l.fromLot === id && l.toLot)
      .map((l) => ({
        lotId: l.toLot!,
        code: code(l.toLot!),
        packages: -l.quantity,
        opened: lots.find((x) => x.id === l.toLot)?.origin === 'OPENED',
      })),
    movements,
    checks,
    nextCheck,
    checkDue: checkDue(nextCheck, today),
    expiry: expiryLevel(lot.expiryDate, today),
  };
}
